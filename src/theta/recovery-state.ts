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
export interface RecoveryState {
  readonly contractVersion: typeof recoveryStateVersion;
  readonly effectiveBasisPerShare: number | null;
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
  const effectiveBasisPerShare = canonicalBasis?.complete === true ? canonicalBasis.effectiveStockBasisPerShare : stockBasisPerShare;
  const distanceToBasisFraction = finite(stockMarkPerShare) && finite(effectiveBasisPerShare) && effectiveBasisPerShare !== 0
    ? (stockMarkPerShare - effectiveBasisPerShare) / effectiveBasisPerShare : null;
  const drawdownFraction = distanceToBasisFraction !== null && distanceToBasisFraction < 0 ? distanceToBasisFraction : null;
  const capitalDaysSoFar = daysBetween(assignedAtObservedAt, state.observedAt);
  const capitalLocked = finite(effectiveBasisPerShare) && openStockShares > 0 ? effectiveBasisPerShare * openStockShares : null;
  const capitalOpportunityCostDollars = capitalLocked !== null && capitalDaysSoFar !== null && annualOpportunityCostRate !== null
    ? capitalLocked * annualOpportunityCostRate * (capitalDaysSoFar / 365) : null;

  const requiresCallerInput: string[] = [];
  if (assignedAtObservedAt === null) requiresCallerInput.push('assignedAtObservedAt (for capitalDaysSoFar)');
  if (annualOpportunityCostRate === null) requiresCallerInput.push('annualOpportunityCostRate (for capitalOpportunityCostDollars)');
  if (wholeChainComponents === null) {
    requiresCallerInput.push('wholeChainComponents (for the ONE canonical effective basis -- currently falling back to broker-recorded stockBasisPerShare)');
  } else if (canonicalBasis?.complete === false) {
    requiresCallerInput.push(`wholeChainComponents (incomplete -- missing: ${canonicalBasis.missingComponents.join(', ')}; falling back to broker-recorded stockBasisPerShare)`);
  }

  return {
    contractVersion: recoveryStateVersion,
    effectiveBasisPerShare, currentStockPrice: stockMarkPerShare,
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
