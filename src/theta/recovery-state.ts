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
export type BasisSource = 'CANONICAL_WHOLE_CHAIN' | 'RECORDED_LOT_REFERENCE' | 'UNKNOWN';
export type BasisConfidence = 'CANONICAL_COMPLETE' | 'NON_CANONICAL_REFERENCE' | 'UNKNOWN';

export interface RecoveryState {
  readonly contractVersion: typeof recoveryStateVersion;
  /**
   * The ONE canonical basis (computeEffectiveStockBasis, whole-chain-
   * economics.ts) -- STRICTLY only populated when the full chain-history
   * components (initial put premium, roll credits/close costs, fees,
   * slippage) are supplied and complete. `null` otherwise -- this field
   * NEVER silently falls back to anything else, and NOTHING in this
   * module (or its consumers) may treat any other value as equivalent to
   * this one.
   */
  readonly canonicalEffectiveBasisPerShare: number | null;
  /**
   * The runtime-recorded stock LOT basis reference (`economics.stockBasisPerShare`).
   * Named deliberately to avoid implying it is broker-verified truth --
   * the canonical runtime this ManagementInputState is drawn from
   * currently sources this from `trade.stock_lot.economic_basis_per_share`,
   * which is initially written as the assignment strike and may or may not
   * ever be adjusted for the original put premium, roll debits/credits,
   * fees, or slippage. It is exposed here purely as a REFERENCE value,
   * never as a substitute for `canonicalEffectiveBasisPerShare`.
   */
  readonly recordedLotBasisReferencePerShare: number | null;
  /** Which of the two above is the more authoritative one available --
   * never left implicit. */
  readonly basisSource: BasisSource;
  /** Whether that source is the strict canonical formula or a lower-
   * confidence reference -- a second, explicit label so a consumer
   * cannot mistake `basisSource` alone for a confidence claim. */
  readonly basisConfidence: BasisConfidence;
  /**
   * CANONICAL-BASIS-DEPENDENT economics -- these claim to represent the
   * position's TRUE economic state relative to its whole-chain-adjusted
   * basis, and are therefore `null` (UNKNOWN, never substituted) whenever
   * `canonicalEffectiveBasisPerShare` itself is null.
   */
  readonly canonicalDistanceToBasisFraction: number | null;
  readonly canonicalDrawdownFraction: number | null;
  /**
   * REFERENCE-ONLY economics -- computed from `recordedLotBasisReferencePerShare`
   * whenever that is available, explicitly labeled as non-canonical. These
   * exist so a reviewer/policy can still see SOMETHING when canonical
   * history is incomplete, without ever presenting it as the canonical
   * figure. Consumers must not silently prefer these over the canonical
   * fields when making a whole-chain P&L or below/above-effective-basis
   * claim -- only the canonical fields may back those specific claims.
   */
  readonly referenceDistanceToBasisFraction: number | null;
  readonly currentStockPrice: number | null;
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
  /**
   * Capital opportunity cost is treated as BASIS-INDEPENDENT-ish evidence
   * (per the standing directive: THETA may still evaluate this even when
   * canonical basis is UNKNOWN) -- it uses whichever basis reference is
   * actually available (canonical when known, the recorded-lot reference
   * otherwise) purely to size "how much capital is tied up," not to make
   * a whole-chain P&L claim. `capitalBasisSource` names which one backed
   * it, so this is never silently conflated with a canonical P&L figure.
   */
  readonly capitalOpportunityCostDollars: number | null;
  readonly capitalBasisSource: BasisSource;
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

function fraction(mark: number | null, basis: number | null): number | null {
  return finite(mark) && finite(basis) && basis !== 0 ? (mark - basis) / basis : null;
}

/**
 * `assignedAtObservedAt` and `annualOpportunityCostRate` are optional,
 * caller-supplied (and caller-justified, per the standing no-invented-
 * threshold rule) -- omitted, capital-days and opportunity cost stay
 * honestly UNKNOWN rather than defaulting to a fabricated rate.
 *
 * `wholeChainComponents` is the ONE canonical basis input -- when
 * supplied and complete, `canonicalEffectiveBasisPerShare` comes from
 * `computeEffectiveStockBasis` (whole-chain-economics.ts), the SAME
 * formula whole-chain accounting itself uses. When absent or incomplete,
 * `canonicalEffectiveBasisPerShare` is `null` -- STRICTLY never
 * substituted with the recorded-lot reference, spot, zero, or any prior
 * value. The recorded-lot reference remains separately visible via
 * `recordedLotBasisReferencePerShare` for informational/degraded use,
 * but every field whose name says "canonical" only ever comes from the
 * canonical formula.
 */
export function buildRecoveryState(
  state: ManagementInputState, assignedAtObservedAt: string | null = null, annualOpportunityCostRate: number | null = null,
  wholeChainComponents: WholeChainComponents | null = null,
): RecoveryState {
  const { stockBasisPerShare, stockMarkPerShare, openStockShares } = state.economics;
  const canonicalBasis = wholeChainComponents === null ? null : computeEffectiveStockBasis(wholeChainComponents);
  const canonicalEffectiveBasisPerShare = canonicalBasis?.complete === true ? canonicalBasis.effectiveStockBasisPerShare : null;
  const recordedLotBasisReferencePerShare = stockBasisPerShare;
  const basisSource: BasisSource = canonicalEffectiveBasisPerShare !== null ? 'CANONICAL_WHOLE_CHAIN'
    : finite(recordedLotBasisReferencePerShare) ? 'RECORDED_LOT_REFERENCE' : 'UNKNOWN';
  const basisConfidence: BasisConfidence = canonicalEffectiveBasisPerShare !== null ? 'CANONICAL_COMPLETE'
    : finite(recordedLotBasisReferencePerShare) ? 'NON_CANONICAL_REFERENCE' : 'UNKNOWN';

  // CANONICAL-DEPENDENT: null whenever canonicalEffectiveBasisPerShare is
  // null -- never substituted with the reference value.
  const canonicalDistanceToBasisFraction = fraction(stockMarkPerShare, canonicalEffectiveBasisPerShare);
  const canonicalDrawdownFraction = canonicalDistanceToBasisFraction !== null && canonicalDistanceToBasisFraction < 0
    ? canonicalDistanceToBasisFraction : null;
  // REFERENCE-ONLY: always computed from the recorded-lot reference when
  // available, explicitly a SEPARATE, non-canonical field.
  const referenceDistanceToBasisFraction = fraction(stockMarkPerShare, recordedLotBasisReferencePerShare);

  const capitalDaysSoFar = daysBetween(assignedAtObservedAt, state.observedAt);
  // Capital opportunity cost is basis-independent-ish evidence -- it may
  // use whichever basis is actually available (canonical preferred, the
  // recorded-lot reference otherwise) purely to size capital locked, and
  // `capitalBasisSource` names which one, so it is never silently
  // conflated with a canonical whole-chain P&L claim.
  const capitalBasisReference = canonicalEffectiveBasisPerShare ?? recordedLotBasisReferencePerShare;
  const capitalLocked = finite(capitalBasisReference) && openStockShares > 0 ? capitalBasisReference * openStockShares : null;
  const capitalOpportunityCostDollars = capitalLocked !== null && capitalDaysSoFar !== null && annualOpportunityCostRate !== null
    ? capitalLocked * annualOpportunityCostRate * (capitalDaysSoFar / 365) : null;

  const requiresCallerInput: string[] = [];
  if (assignedAtObservedAt === null) requiresCallerInput.push('assignedAtObservedAt (for capitalDaysSoFar)');
  if (annualOpportunityCostRate === null) requiresCallerInput.push('annualOpportunityCostRate (for capitalOpportunityCostDollars)');
  if (wholeChainComponents === null) {
    requiresCallerInput.push(`wholeChainComponents (for the ONE canonical effective basis -- canonicalEffectiveBasisPerShare stays UNKNOWN; basisSource=${basisSource} is a lower-confidence reference only, never presented as canonical)`);
  } else if (canonicalBasis?.complete === false) {
    requiresCallerInput.push(`wholeChainComponents (incomplete -- missing: ${canonicalBasis.missingComponents.join(', ')}; canonicalEffectiveBasisPerShare stays UNKNOWN; basisSource=${basisSource} is a lower-confidence reference only, never presented as canonical)`);
  }

  return {
    contractVersion: recoveryStateVersion,
    canonicalEffectiveBasisPerShare, recordedLotBasisReferencePerShare, basisSource, basisConfidence,
    canonicalDistanceToBasisFraction, canonicalDrawdownFraction, referenceDistanceToBasisFraction,
    currentStockPrice: stockMarkPerShare,
    realizedVolatility: null, impliedVolatility: state.market.iv,
    eventRiskPresent: state.context.eventState !== null,
    recoveryProbabilityEstimate: null, expectedRecoveryTimeDays: null, furtherDownsideEstimate: null,
    coveredCallCandidateQualityKnown: false, capitalDaysSoFar, capitalOpportunityCostDollars,
    capitalBasisSource: finite(capitalBasisReference) ? basisSource : 'UNKNOWN',
    portfolioBurdenDataPresent: state.context.concentration !== null,
    dataCompleteness: {
      missingUpstreamFields: ['realized_volatility_feed', 'covered_call_candidate_quality_scoring'],
      requiresCallerInput,
    },
  };
}
