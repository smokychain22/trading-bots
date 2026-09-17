import type { ManagementInputState } from './management-input-state.js';

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
 */
export function buildRecoveryState(
  state: ManagementInputState, assignedAtObservedAt: string | null = null, annualOpportunityCostRate: number | null = null,
): RecoveryState {
  const { stockBasisPerShare, stockMarkPerShare, openStockShares } = state.economics;
  const distanceToBasisFraction = finite(stockMarkPerShare) && finite(stockBasisPerShare) && stockBasisPerShare !== 0
    ? (stockMarkPerShare - stockBasisPerShare) / stockBasisPerShare : null;
  const drawdownFraction = distanceToBasisFraction !== null && distanceToBasisFraction < 0 ? distanceToBasisFraction : null;
  const capitalDaysSoFar = daysBetween(assignedAtObservedAt, state.observedAt);
  const capitalLocked = finite(stockBasisPerShare) && openStockShares > 0 ? stockBasisPerShare * openStockShares : null;
  const capitalOpportunityCostDollars = capitalLocked !== null && capitalDaysSoFar !== null && annualOpportunityCostRate !== null
    ? capitalLocked * annualOpportunityCostRate * (capitalDaysSoFar / 365) : null;

  const requiresCallerInput: string[] = [];
  if (assignedAtObservedAt === null) requiresCallerInput.push('assignedAtObservedAt (for capitalDaysSoFar)');
  if (annualOpportunityCostRate === null) requiresCallerInput.push('annualOpportunityCostRate (for capitalOpportunityCostDollars)');

  return {
    contractVersion: recoveryStateVersion,
    effectiveBasisPerShare: stockBasisPerShare, currentStockPrice: stockMarkPerShare,
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
