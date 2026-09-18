import type { ManagementInputState } from './management-input-state.js';
import { computeEffectiveStockBasis, type WholeChainComponents } from './whole-chain-economics.js';

export const recoveryStateVersion = 'theta-recovery-state-v1' as const;

/**
 * A structured state vector for an assigned/held stock position deciding
 * among RECOVERY_WAIT / SELL_STOCK / SELL_CC. This module NEVER invents a
 * recovery probability, expected recovery time, or further-downside
 * estimate -- those require an actual research model (regime-conditioned,
 * validated OOS) that does not exist yet. They are permanently `null` here
 * with an explanatory note, not fabricated placeholders. A future
 * challenger model may populate a PARALLEL, separately-labeled probabilistic
 * field set -- it must never silently overwrite these deterministic ones.
 */
export type BasisSource = 'CANONICAL_WHOLE_CHAIN' | 'BROKER_RECORDED_REFERENCE' | 'UNKNOWN';

export interface RecoveryState {
  readonly contractVersion: typeof recoveryStateVersion;
  /**
   * The ONE canonical basis (computeEffectiveStockBasis, whole-chain-
   * economics.ts) -- STRICTLY only populated when the full chain-history
   * components (initial put premium, roll credits/close costs, fees,
   * slippage) are supplied and complete. `null` otherwise -- this field
   * NEVER silently falls back to anything else.
   */
  readonly canonicalEffectiveBasisPerShare: number | null;
  /**
   * The broker/DB-recorded stock lot basis (`economics.stockBasisPerShare`),
   * exposed separately and unconditionally so callers can always see it
   * on its own terms -- it may or may not include the same economic
   * adjustments (put premiums, roll history, fees) the canonical formula
   * applies, and this module makes no claim that the two are equivalent.
   */
  readonly brokerRecordedBasisPerShare: number | null;
  /** Which of the two above is actually backing `bestAvailableBasisPerShare`
   * below -- never left implicit. */
  readonly basisSource: BasisSource;
  /**
   * The reference actually used for this state's own calculations
   * (distance-to-basis, capital locked, etc.) -- the canonical figure when
   * available, otherwise the broker-recorded figure as an explicitly
   * lower-confidence reference (never silently presented as canonical),
   * otherwise `null`. Consumers needing to know WHICH kind of basis this
   * is must read `basisSource`, not assume.
   */
  readonly bestAvailableBasisPerShare: number | null;
  readonly currentStockPrice: number | null;
  readonly distanceToBasisFraction: number | null;
  readonly drawdownFraction: number | null;
  /** Always null in this module -- no realized/implied-vol feed is plumbed
   * into ManagementInputState for a position with no open option leg. */
  readonly realizedVolatility: number | null;
  readonly impliedVolatility: number | null;
  readonly eventRiskPresent: boolean;
  /** PERMANENTLY null -- no validated recovery model exists. Never
   * fabricated even as a placeholder. */
  readonly recoveryProbabilityEstimate: null;
  /** PERMANENTLY null -- see above. */
  readonly expectedRecoveryTimeDays: null;
  /** PERMANENTLY null -- see above. */
  readonly furtherDownsideEstimate: null;
  readonly coveredCallCandidateQualityKnown: boolean;
  readonly capitalDaysSoFar: number | null;
  readonly capitalOpportunityCostDollars: number | null;
  readonly portfolioBurdenDataPresent: boolean;
  readonly dataCompleteness: {
    readonly missingUpstreamFields: readonly string[];
    readonly requiresCallerInput: readonly string[];
  };
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function daysBetween(fromIso: string | null, toIso: string): number | null {
  if (fromIso === null) return null;
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, (to - from) / 86_400_000);
}

/**
 * `assignedAtObservedAt` and `annualOpportunityCostRate` are optional,
 * caller-supplied (and caller-justified, per the standing no-invented-
 * threshold rule) -- omitted, capital-days and opportunity cost stay
 * honestly UNKNOWN rather than defaulting to a fabricated rate.
 *
 * `wholeChainComponents` is the ONE canonical basis input -- when
 * supplied and complete, `effectiveBasisPerShare` comes from
 * `computeEffectiveStockBasis` (whole-chain-economics.ts), the SAME
 * formula whole-chain accounting itself uses, so recovery/SELL_STOCK/
 * SELL_CC economics can never silently disagree with whole-chain P&L
 * about what the basis is. `ManagementInputState` does not currently
 * carry the roll-history fields that formula needs
 * (initialPutPremium/rollCredits/rollCloseCosts), so most callers today
 * will omit this and fall back to the broker-recorded
 * `economics.stockBasisPerShare` -- that fallback is reported honestly
 * via `dataCompleteness`, never silently presented as the canonical
 * figure.
 */
export function buildRecoveryState(
  state: ManagementInputState, assignedAtObservedAt: string | null = null, annualOpportunityCostRate: number | null = null,
  wholeChainComponents: WholeChainComponents | null = null,
): RecoveryState {
  const { stockBasisPerShare, stockMarkPerShare, openStockShares } = state.economics;
  const canonicalBasis = wholeChainComponents === null ? null : computeEffectiveStockBasis(wholeChainComponents);
  const canonicalEffectiveBasisPerShare = canonicalBasis?.complete === true ? canonicalBasis.effectiveStockBasisPerShare : null;
  const brokerRecordedBasisPerShare = stockBasisPerShare;
  const basisSource: BasisSource = canonicalEffectiveBasisPerShare !== null ? 'CANONICAL_WHOLE_CHAIN'
    : finite(brokerRecordedBasisPerShare) ? 'BROKER_RECORDED_REFERENCE' : 'UNKNOWN';
  const bestAvailableBasisPerShare = canonicalEffectiveBasisPerShare ?? brokerRecordedBasisPerShare;
  const distanceToBasisFraction = finite(stockMarkPerShare) && finite(bestAvailableBasisPerShare) && bestAvailableBasisPerShare !== 0
    ? (stockMarkPerShare - bestAvailableBasisPerShare) / bestAvailableBasisPerShare : null;
  const drawdownFraction = distanceToBasisFraction !== null && distanceToBasisFraction < 0 ? distanceToBasisFraction : null;
  const capitalDaysSoFar = daysBetween(assignedAtObservedAt, state.observedAt);
  const capitalLocked = finite(bestAvailableBasisPerShare) && openStockShares > 0 ? bestAvailableBasisPerShare * openStockShares : null;
  const capitalOpportunityCostDollars = capitalLocked !== null && capitalDaysSoFar !== null && annualOpportunityCostRate !== null
    ? capitalLocked * annualOpportunityCostRate * (capitalDaysSoFar / 365) : null;

  const requiresCallerInput: string[] = [];
  if (assignedAtObservedAt === null) requiresCallerInput.push('assignedAtObservedAt (for capitalDaysSoFar)');
  if (annualOpportunityCostRate === null) requiresCallerInput.push('annualOpportunityCostRate (for capitalOpportunityCostDollars)');
  if (wholeChainComponents === null) {
    requiresCallerInput.push(`wholeChainComponents (for the ONE canonical effective basis -- currently using ${basisSource} as a lower-confidence reference, never presented as canonical)`);
  } else if (canonicalBasis?.complete === false) {
    requiresCallerInput.push(`wholeChainComponents (incomplete -- missing: ${canonicalBasis.missingComponents.join(', ')}; currently using ${basisSource} as a lower-confidence reference, never presented as canonical)`);
  }

  return {
    contractVersion: recoveryStateVersion,
    canonicalEffectiveBasisPerShare, brokerRecordedBasisPerShare, basisSource, bestAvailableBasisPerShare,
    currentStockPrice: stockMarkPerShare,
    distanceToBasisFraction, drawdownFraction,
    realizedVolatility: null, impliedVolatility: state.market.iv,
    eventRiskPresent: state.context.eventState !== null,
    recoveryProbabilityEstimate: null, expectedRecoveryTimeDays: null, furtherDownsideEstimate: null,
    coveredCallCandidateQualityKnown: false, capitalDaysSoFar, capitalOpportunityCostDollars,
    portfolioBurdenDataPresent: state.context.concentration !== null,
    dataCompleteness: {
      missingUpstreamFields: ['realized_volatility_feed', 'covered_call_candidate_quality_scoring'],
      requiresCallerInput,
    },
  };
}
