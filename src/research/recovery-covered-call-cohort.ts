import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import type { EventRiskState } from '../theta/event-risk-state.js';
import type { EffectiveStockBasisResult } from '../theta/whole-chain-economics.js';
import type {
  ManagementCounterfactualInput, ManagementOutcomeObservation,
} from './management-counterfactual-analysis.js';
import type { R6OutcomeLabelSet } from './r6-outcome-labels.js';

/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO recovery-decision, CC-management, or call-away authority of any
 * kind. THETA_RECOVERY and THETA_CC are canonical `SHADOW` strategy
 * branches (`strategy-package.ts`, `executionEnabled: false`) whose
 * allowed actions (`RECOVERY_WAIT`/`SELL_STOCK`/`SELL_CC` and
 * `HOLD_CC`/`CLOSE_CC`/`ROLL_CC`/`ALLOW_CALL_AWAY`/`RECOVERY_WAIT`
 * respectively) are already the canonical action vocabulary
 * (`thetaStrategyAction`) -- this module reuses those exact literal
 * action names and adds no synonym, no new action, and no "best
 * action"/"recommended action" verdict field anywhere.
 *
 * This module never re-derives economics that canonical code already
 * owns: stock/assignment basis comes from `computeEffectiveStockBasis`'s
 * `EffectiveStockBasisResult` (whole-chain-economics.ts, passed through
 * verbatim, never recomputed here), and every resolved economic outcome
 * comes from `R6OutcomeLabelSet` (r6-outcome-labels.ts). Paired
 * counterfactual analysis (actual action vs. an alternative) is not
 * reimplemented here either -- `buildLifecycleManagementCounterfactualInput`
 * only assembles the canonical `ManagementCounterfactualInput` shape from
 * a Recovery/CC observation's identity fields; all PIT/leakage/fill-model
 * validation still happens inside `analyzeManagementCounterfactuals`
 * (management-counterfactual-analysis.ts), called directly by the
 * caller, never duplicated here.
 *
 * Mirrors the identity/PIT/unit-discipline/dedup style already
 * established and Codex-reviewed in `hold-strike-empirical-cohort.ts`:
 * exact OCC contract identity validation, one resolved economic outcome
 * per chain (never per raw observation), independentN computed only from
 * resolved chains, and strict execution-kind/environment consistency.
 */
export const recoveryCoveredCallCohortVersion = 'theta-recovery-covered-call-cohort-v1' as const;

/** Mirrors `strategy-package.ts`'s canonical strategy lifecycle `status`
 * vocabulary, minus `RETIRED` (not meaningful for a single observation). */
export type LifecycleObservationEnvironment = 'RESEARCH_ONLY' | 'SHADOW' | 'PAPER' | 'LIVE_SMALL' | 'LIVE';
export type LifecycleExecutionKind = 'SHADOW_CANDIDATE' | 'PAPER_ACTUAL' | 'LIVE_ACTUAL';
export type LifecycleEvidenceState = 'KNOWN' | 'UNKNOWN';
export type LifecycleResolutionState = 'UNRESOLVED' | 'RESOLVED';
export type LifecycleSampleSizeState = 'SUFFICIENT' | 'INSUFFICIENT' | 'NOT_ASSESSED' | 'NONE';
export type LifecycleCohortDataQualityState = 'COMPLETE' | 'PARTIAL' | 'NO_ECONOMIC_METRICS';

export interface LifecycleMetricSummary {
  readonly knownCount: number;
  readonly missingCount: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly standardDeviation: number | null;
}

// ---------------------------------------------------------------------
// Shared pure helpers (private -- duplicated in hold-strike-empirical-
// cohort.ts since no shared statistics/validation utility module exists
// yet anywhere in the codebase; this is pure math/validation, not a
// decision authority, so the duplication is not a competing authority).
// ---------------------------------------------------------------------

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}
function finiteMatchingOrNull(value: number | null, predicate: (candidate: number) => boolean): number | null {
  const finiteValue = finiteOrNull(value);
  return finiteValue !== null && predicate(finiteValue) ? finiteValue : null;
}
function requireNonBlank(value: string, code: string): void {
  if (value.trim().length === 0) throw new Error(code);
}
function requireNonBlankIfPresent(value: string | null, code: string): void {
  if (value !== null && value.trim().length === 0) throw new Error(code);
}
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let runningMean = 0;
  values.forEach((value, index) => { runningMean += (value - runningMean) / (index + 1); });
  return Number.isFinite(runningMean) ? runningMean : null;
}
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  const lower = sorted[middle - 1] as number;
  const upper = sorted[middle] as number;
  return lower + (upper - lower) / 2;
}
function sampleStandardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  let runningMean = 0;
  let sumSquaredDeviations = 0;
  values.forEach((value, index) => {
    const count = index + 1;
    const delta = value - runningMean;
    runningMean += delta / count;
    sumSquaredDeviations += delta * (value - runningMean);
  });
  const result = Math.sqrt(sumSquaredDeviations / (values.length - 1));
  return Number.isFinite(result) ? result : null;
}
function summarize(values: readonly (number | null)[], resolvedCount: number): LifecycleMetricSummary {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return { knownCount: known.length, missingCount: resolvedCount - known.length, mean: mean(known), median: median(known), standardDeviation: sampleStandardDeviation(known) };
}
function labelValue<T>(labels: R6OutcomeLabelSet | null, pick: (labels: R6OutcomeLabelSet) => { readonly value: T | null; readonly state: string }): T | null {
  if (labels === null) return null;
  const label = pick(labels);
  return label.state === 'KNOWN' ? label.value : null;
}
function validateExecutionEnvironmentConsistency(
  executionKind: LifecycleExecutionKind, environment: LifecycleObservationEnvironment, codePrefix: string,
): void {
  if (executionKind === 'PAPER_ACTUAL' && environment !== 'PAPER') throw new Error(`${codePrefix}_PAPER_ACTUAL_ENVIRONMENT_MISMATCH`);
  if (executionKind === 'LIVE_ACTUAL' && environment !== 'LIVE_SMALL' && environment !== 'LIVE') {
    throw new Error(`${codePrefix}_LIVE_ACTUAL_ENVIRONMENT_MISMATCH`);
  }
}
function validateResolvedLabels(
  resolvedLabels: R6OutcomeLabelSet | null, chainId: string | null, decidedAtMs: number, codePrefix: string,
): void {
  if (resolvedLabels === null) return;
  if (chainId === null) throw new Error(`${codePrefix}_RESOLVED_REQUIRES_CHAIN_ID`);
  if (resolvedLabels.chainId !== chainId) throw new Error(`${codePrefix}_RESOLVED_CHAIN_ID_MISMATCH`);
  const resolvedAtMs = Date.parse(resolvedLabels.asOf);
  if (!Number.isFinite(resolvedAtMs)) throw new Error(`${codePrefix}_RESOLVED_TIMESTAMP_INVALID`);
  if (resolvedAtMs <= decidedAtMs) throw new Error(`${codePrefix}_RESOLVED_LABEL_TIME_LEAKAGE`);
}

// ---------------------------------------------------------------------
// Recovery cohort
// ---------------------------------------------------------------------

/** Exact members of the canonical `thetaStrategyAction` enum
 * (`strategy-package.ts`) that THETA_RECOVERY's `allowedActions` lists. */
export type RecoveryAction = 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC';

export interface RecoveryObservationInput {
  readonly snapshotId: string;
  readonly decisionId: string;
  readonly chainId: string;
  readonly episodeId: string | null;
  readonly independentUnitId: string | null;
  readonly strategyVersion: string;
  readonly environment: LifecycleObservationEnvironment;
  readonly executionKind: LifecycleExecutionKind;
  readonly asOf: string;

  readonly underlying: string;
  readonly selectedAction: RecoveryAction;
  readonly assignedAt: string | null;
  /** Caller-computed via `computeEffectiveStockBasis` -- never recomputed
   * here. `null` while no basis evidence has been assembled yet. */
  readonly basis: EffectiveStockBasisResult | null;
  readonly currentStockPriceAtDecision: number | null;
  readonly stockSharesHeld: number | null;
  readonly capitalAmount: number | null;

  readonly ownershipScore: number | null;
  readonly eventRisk: EventRiskState;
  readonly impliedVolatility: number | null;
  readonly realizedVolatility: number | null;
  readonly ivMinusRv: number | null;

  readonly resolvedLabels: R6OutcomeLabelSet | null;
}

export interface RecoveryStockGeometry {
  /** `currentStockPriceAtDecision - basis.effectiveStockBasisPerShare`.
   * Positive means the stock is currently above its effective cost basis. */
  readonly stockPriceMinusBasisPerShare: number | null;
  readonly stockReturnSinceAssignmentPercent: number | null;
}

export interface RecoveryObservation extends Omit<RecoveryObservationInput, 'ownershipScore'> {
  readonly contractVersion: typeof recoveryCoveredCallCohortVersion;
  readonly ownershipScore: number | null;
  readonly ownershipEvidenceState: LifecycleEvidenceState;
  readonly basisEvidenceState: LifecycleEvidenceState;
  readonly geometry: RecoveryStockGeometry;
  readonly resolutionState: LifecycleResolutionState;
  readonly brokerAuthority: false;
}

/**
 * Builds one Recovery research observation. Throws on structural
 * identity/PIT violations (blank identity, an invalid timestamp, a
 * resolved outcome missing/mismatching `chainId`, or a resolved label
 * timestamped at or before the decision) -- these represent an evidence-
 * feed defect. Implausible individual fields (out-of-range ownership
 * score, non-finite prices) are treated as UNKNOWN, never fabricated.
 */
export function buildRecoveryObservation(input: RecoveryObservationInput): RecoveryObservation {
  requireNonBlank(input.snapshotId, 'RECOVERY_SNAPSHOT_ID_REQUIRED');
  requireNonBlank(input.decisionId, 'RECOVERY_DECISION_ID_REQUIRED');
  requireNonBlank(input.chainId, 'RECOVERY_CHAIN_ID_REQUIRED');
  requireNonBlank(input.strategyVersion, 'RECOVERY_STRATEGY_VERSION_REQUIRED');
  requireNonBlank(input.underlying, 'RECOVERY_UNDERLYING_REQUIRED');
  requireNonBlankIfPresent(input.episodeId, 'RECOVERY_EPISODE_ID_INVALID');
  requireNonBlankIfPresent(input.independentUnitId, 'RECOVERY_INDEPENDENT_UNIT_ID_INVALID');
  const decidedAtMs = Date.parse(input.asOf);
  if (!Number.isFinite(decidedAtMs)) throw new Error('RECOVERY_TIMESTAMP_INVALID');
  if (input.assignedAt !== null) {
    const assignedAtMs = Date.parse(input.assignedAt);
    if (!Number.isFinite(assignedAtMs)) throw new Error('RECOVERY_ASSIGNED_AT_INVALID');
    if (assignedAtMs > decidedAtMs) throw new Error('RECOVERY_ASSIGNED_AT_AFTER_DECISION');
  }
  validateExecutionEnvironmentConsistency(input.executionKind, input.environment, 'RECOVERY');
  validateResolvedLabels(input.resolvedLabels, input.chainId, decidedAtMs, 'RECOVERY');

  const ownershipScore = input.ownershipScore !== null && Number.isFinite(input.ownershipScore)
    && input.ownershipScore >= 0 && input.ownershipScore <= 1 ? input.ownershipScore : null;
  const currentStockPriceAtDecision = finiteMatchingOrNull(input.currentStockPriceAtDecision, (value) => value > 0);
  const basisPerShare = input.basis?.effectiveStockBasisPerShare ?? null;
  const stockPriceMinusBasisPerShare = currentStockPriceAtDecision !== null && basisPerShare !== null
    ? currentStockPriceAtDecision - basisPerShare : null;
  const stockReturnSinceAssignmentPercent = stockPriceMinusBasisPerShare !== null && basisPerShare !== null && basisPerShare > 0
    ? stockPriceMinusBasisPerShare / basisPerShare : null;

  return {
    ...input,
    contractVersion: recoveryCoveredCallCohortVersion,
    currentStockPriceAtDecision,
    stockSharesHeld: finiteMatchingOrNull(input.stockSharesHeld, (value) => value >= 0),
    capitalAmount: finiteMatchingOrNull(input.capitalAmount, (value) => value >= 0),
    ownershipScore, ownershipEvidenceState: ownershipScore !== null ? 'KNOWN' : 'UNKNOWN',
    basisEvidenceState: basisPerShare !== null ? 'KNOWN' : 'UNKNOWN',
    impliedVolatility: finiteMatchingOrNull(input.impliedVolatility, (value) => value >= 0),
    realizedVolatility: finiteMatchingOrNull(input.realizedVolatility, (value) => value >= 0),
    ivMinusRv: finiteOrNull(input.ivMinusRv),
    geometry: { stockPriceMinusBasisPerShare, stockReturnSinceAssignmentPercent },
    resolutionState: input.resolvedLabels !== null ? 'RESOLVED' : 'UNRESOLVED',
    brokerAuthority: false,
  };
}

export interface RecoveryCohortObservation {
  readonly observation: RecoveryObservation;
}

export interface RecoveryActionCohortStatistic {
  readonly action: RecoveryAction;
  readonly rawObservationCount: number;
  readonly resolvedChainCount: number;
  readonly independentN: number | null;
  readonly wholeChainAfterCostPnl: LifecycleMetricSummary;
  readonly stockPnlContribution: LifecycleMetricSummary;
  readonly coveredCallPremiumContribution: LifecycleMetricSummary;
  readonly capitalDays: LifecycleMetricSummary;
  readonly returnPerCapitalDay: LifecycleMetricSummary;
  readonly recoveryDurationDays: LifecycleMetricSummary;
  readonly mfe: LifecycleMetricSummary;
  readonly mae: LifecycleMetricSummary;
  readonly maxDrawdown: LifecycleMetricSummary;
  readonly recoverySuccessKnownCount: number;
  readonly recoverySuccessTrueCount: number;
  readonly dataQualityState: LifecycleCohortDataQualityState;
  readonly sampleSizeState: LifecycleSampleSizeState;
}

export interface RecoveryCohortReport {
  readonly contractVersion: typeof recoveryCoveredCallCohortVersion;
  readonly cohortKey: Readonly<Record<string, string>> | null;
  readonly rawObservationCount: number;
  readonly distinctChainCount: number;
  readonly distinctEpisodeCount: number | null;
  readonly resolvedObservationCount: number;
  readonly unresolvedObservationCount: number;
  readonly minimumIndependentSample: number;
  readonly actionBreakdown: readonly RecoveryActionCohortStatistic[];
  readonly uncertaintyState: 'DESCRIPTIVE_ONLY';
  readonly brokerAuthority: false;
}

function resolvedChainDedup(observations: readonly { readonly chainId: string; readonly resolvedLabels: R6OutcomeLabelSet | null; readonly identity: string; readonly independentUnitId: string | null }[]) {
  const byChain = new Map<string, typeof observations[number]>();
  for (const row of observations) {
    if (row.resolvedLabels === null) continue;
    const existing = byChain.get(row.chainId);
    if (existing !== undefined && row.resolvedLabels.asOf === existing.resolvedLabels?.asOf
      && JSON.stringify(row.resolvedLabels) !== JSON.stringify(existing.resolvedLabels)) {
      throw new Error(`LIFECYCLE_COHORT_CONFLICTING_CHAIN_OUTCOME: ${row.chainId}`);
    }
    if (existing === undefined
      || Date.parse(row.resolvedLabels.asOf) > Date.parse(existing.resolvedLabels?.asOf ?? '')
      || (row.resolvedLabels.asOf === existing.resolvedLabels?.asOf && row.identity < existing.identity)) {
      byChain.set(row.chainId, row);
    }
  }
  return [...byChain.values()].sort((left, right) => left.chainId.localeCompare(right.chainId));
}

/**
 * Aggregates Recovery observations grouped by canonical `selectedAction`
 * (`RECOVERY_WAIT`/`SELL_STOCK`/`SELL_CC`). No overall winner: each
 * action's statistics are reported independently, and no field ranks or
 * recommends one over another.
 */
export function buildRecoveryCohortReport(
  observations: readonly RecoveryCohortObservation[], minimumIndependentSample: number,
  cohortKey: Readonly<Record<string, string>> | null = null,
): RecoveryCohortReport {
  if (!Number.isInteger(minimumIndependentSample) || minimumIndependentSample <= 0) {
    throw new Error('RECOVERY_COHORT_MINIMUM_SAMPLE_INVALID');
  }
  const seenIdentity = new Set<string>();
  for (const { observation } of observations) {
    const identity = `${observation.snapshotId}|${observation.decisionId}`;
    if (seenIdentity.has(identity)) throw new Error(`RECOVERY_COHORT_DUPLICATE_OBSERVATION_IDENTITY: ${identity}`);
    seenIdentity.add(identity);
  }

  const distinctChainCount = new Set(observations.map((row) => row.observation.chainId)).size;
  const episodeIds = observations.map((row) => row.observation.episodeId).filter((id): id is string => id !== null);
  const distinctEpisodeCount = episodeIds.length > 0 ? new Set(episodeIds).size : null;
  const resolvedObservationCount = observations.filter((row) => row.observation.resolutionState === 'RESOLVED').length;
  const unresolvedObservationCount = observations.length - resolvedObservationCount;

  const actions: readonly RecoveryAction[] = ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC'];
  const actionBreakdown = actions.map((action) => {
    const rows = observations.filter((row) => row.observation.selectedAction === action);
    const resolvedChains = resolvedChainDedup(rows.map((row) => ({
      chainId: row.observation.chainId, resolvedLabels: row.observation.resolvedLabels,
      identity: `${row.observation.snapshotId}|${row.observation.decisionId}`, independentUnitId: row.observation.independentUnitId,
    })));
    const resolvedChainCount = resolvedChains.length;
    const independentUnitIds = resolvedChains.map((row) => row.independentUnitId);
    const independentN = resolvedChainCount === 0 ? 0
      : independentUnitIds.every((id) => id !== null) ? new Set(independentUnitIds as string[]).size : null;

    const labels = resolvedChains.map((row) => row.resolvedLabels);
    const wholeChainAfterCostPnl = summarize(labels.map((l) => labelValue(l, (x) => x.wholeChainAfterCostPnl)), resolvedChainCount);
    const stockPnlContribution = summarize(labels.map((l) => labelValue(l, (x) => x.stockPnlContribution)), resolvedChainCount);
    const coveredCallPremiumContribution = summarize(labels.map((l) => labelValue(l, (x) => x.coveredCallPremiumContribution)), resolvedChainCount);
    const capitalDays = summarize(labels.map((l) => labelValue(l, (x) => x.capitalDays)), resolvedChainCount);
    const returnPerCapitalDay = summarize(labels.map((l) => labelValue(l, (x) => x.returnPerCapitalDay)), resolvedChainCount);
    const recoveryDurationDays = summarize(labels.map((l) => labelValue(l, (x) => x.recoveryDurationDays)), resolvedChainCount);
    const mfe = summarize(labels.map((l) => labelValue(l, (x) => x.mfe)), resolvedChainCount);
    const mae = summarize(labels.map((l) => labelValue(l, (x) => x.mae)), resolvedChainCount);
    const maxDrawdown = summarize(labels.map((l) => labelValue(l, (x) => x.maxDrawdown)), resolvedChainCount);
    const recoverySuccessValues = labels.map((l) => labelValue(l, (x) => x.recoverySuccess));
    const recoverySuccessKnownCount = recoverySuccessValues.filter((value) => value !== null).length;
    const recoverySuccessTrueCount = recoverySuccessValues.filter((value) => value === true).length;

    const metrics = [wholeChainAfterCostPnl, stockPnlContribution, coveredCallPremiumContribution, capitalDays, returnPerCapitalDay, recoveryDurationDays, mfe, mae, maxDrawdown];
    const dataQualityState: LifecycleCohortDataQualityState = resolvedChainCount === 0
      ? 'NO_ECONOMIC_METRICS' : metrics.every((metric) => metric.missingCount === 0) ? 'COMPLETE' : 'PARTIAL';
    const sampleSizeState: LifecycleSampleSizeState = rows.length === 0 || resolvedChainCount === 0
      ? 'NONE' : independentN === null ? 'NOT_ASSESSED' : independentN >= minimumIndependentSample ? 'SUFFICIENT' : 'INSUFFICIENT';

    return {
      action, rawObservationCount: rows.length, resolvedChainCount, independentN,
      wholeChainAfterCostPnl, stockPnlContribution, coveredCallPremiumContribution, capitalDays, returnPerCapitalDay,
      recoveryDurationDays, mfe, mae, maxDrawdown, recoverySuccessKnownCount, recoverySuccessTrueCount,
      dataQualityState, sampleSizeState,
    } satisfies RecoveryActionCohortStatistic;
  });

  return {
    contractVersion: recoveryCoveredCallCohortVersion, cohortKey,
    rawObservationCount: observations.length, distinctChainCount, distinctEpisodeCount,
    resolvedObservationCount, unresolvedObservationCount, minimumIndependentSample, actionBreakdown,
    uncertaintyState: 'DESCRIPTIVE_ONLY', brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Covered-Call / Call-Away cohort
// ---------------------------------------------------------------------

/** The canonical `thetaStrategyAction` members relevant to an OPEN
 * covered-call's lifecycle management (THETA_CC's `allowedActions`,
 * excluding `RECOVERY_WAIT` which belongs to the Recovery cohort above). */
export type CoveredCallManagementAction = 'SELL_CC' | 'HOLD_CC' | 'CLOSE_CC' | 'ROLL_CC' | 'ALLOW_CALL_AWAY';

export interface CoveredCallObservationInput {
  readonly snapshotId: string;
  readonly candidateId: string;
  readonly decisionId: string | null;
  readonly chainId: string;
  readonly episodeId: string | null;
  readonly independentUnitId: string | null;
  readonly strategyVersion: string;
  readonly environment: LifecycleObservationEnvironment;
  readonly executionKind: LifecycleExecutionKind;
  readonly asOf: string;

  readonly underlying: string;
  readonly optionSymbol: string;
  readonly expiration: string;
  readonly dte: number | null;
  readonly delta: number | null;
  readonly strike: number;
  readonly managementAction: CoveredCallManagementAction;

  readonly sharesHeld: number | null;
  readonly quantity: number | null;
  readonly multiplier: number | null;
  readonly premiumPerShare: number | null;
  readonly premiumPerContract: number | null;
  readonly positionPremium: number | null;

  readonly bid: number | null;
  readonly ask: number | null;
  readonly spreadPct: number | null;
  readonly openInterest: number | null;
  readonly volume: number | null;

  readonly stockPriceAtDecision: number | null;
  /** Caller-computed via `computeEffectiveStockBasis` -- never recomputed
   * here. */
  readonly basis: EffectiveStockBasisResult | null;
  readonly expectedMoveDollars: number | null;
  readonly impliedVolatility: number | null;
  readonly ivRank: number | null;
  readonly realizedVolatility: number | null;
  readonly ivMinusRv: number | null;
  readonly skew25Delta: number | null;
  readonly termSlope: number | null;
  readonly eventRisk: EventRiskState;
  readonly recordedAegisState: string | null;

  readonly resolvedLabels: R6OutcomeLabelSet | null;
}

export interface CoveredCallStrikeGeometry {
  readonly strikeMinusStockPrice: number | null;
  readonly strikeDistancePercent: number | null;
  /** `strike - basis.effectiveStockBasisPerShare` -- how far above cost
   * basis the call is struck, when both are known. */
  readonly strikeMinusBasisPerShare: number | null;
}

export interface CoveredCallObservation extends CoveredCallObservationInput {
  readonly contractVersion: typeof recoveryCoveredCallCohortVersion;
  readonly liquidityEvidenceState: LifecycleEvidenceState;
  readonly basisEvidenceState: LifecycleEvidenceState;
  readonly geometry: CoveredCallStrikeGeometry;
  readonly resolutionState: LifecycleResolutionState;
  readonly brokerAuthority: false;
}

/**
 * Builds one Covered-Call research observation. Validates OCC contract
 * identity (must parse as a CALL matching `underlying`/`expiration`/
 * `strike`), the share-coverage invariant (`quantity * multiplier` must
 * not exceed `sharesHeld` when both are known -- a research-record
 * consistency check, not a broker validity engine), premium unit
 * consistency, and PIT safety, mirroring
 * `hold-strike-empirical-cohort.ts`'s exact validation style.
 */
export function buildCoveredCallObservation(input: CoveredCallObservationInput): CoveredCallObservation {
  requireNonBlank(input.snapshotId, 'COVERED_CALL_SNAPSHOT_ID_REQUIRED');
  requireNonBlank(input.candidateId, 'COVERED_CALL_CANDIDATE_ID_REQUIRED');
  requireNonBlank(input.chainId, 'COVERED_CALL_CHAIN_ID_REQUIRED');
  requireNonBlank(input.strategyVersion, 'COVERED_CALL_STRATEGY_VERSION_REQUIRED');
  requireNonBlank(input.underlying, 'COVERED_CALL_UNDERLYING_REQUIRED');
  requireNonBlank(input.optionSymbol, 'COVERED_CALL_OPTION_SYMBOL_REQUIRED');
  requireNonBlank(input.expiration, 'COVERED_CALL_EXPIRATION_REQUIRED');
  requireNonBlankIfPresent(input.decisionId, 'COVERED_CALL_DECISION_ID_INVALID');
  requireNonBlankIfPresent(input.episodeId, 'COVERED_CALL_EPISODE_ID_INVALID');
  requireNonBlankIfPresent(input.independentUnitId, 'COVERED_CALL_INDEPENDENT_UNIT_ID_INVALID');
  if (!Number.isFinite(input.strike) || input.strike <= 0) throw new Error('COVERED_CALL_STRIKE_INVALID');
  const decidedAtMs = Date.parse(input.asOf);
  if (!Number.isFinite(decidedAtMs)) throw new Error('COVERED_CALL_TIMESTAMP_INVALID');

  const parsedContract = parseOccOptionSymbol(input.optionSymbol);
  if (parsedContract === null) throw new Error('COVERED_CALL_OPTION_SYMBOL_INVALID');
  if (parsedContract.underlying !== input.underlying) throw new Error('COVERED_CALL_CONTRACT_UNDERLYING_MISMATCH');
  if (parsedContract.optionType !== 'CALL') throw new Error('COVERED_CALL_CONTRACT_NOT_CALL');
  if (parsedContract.expiration !== input.expiration) throw new Error('COVERED_CALL_CONTRACT_EXPIRATION_MISMATCH');
  if (Math.abs(parsedContract.strike - input.strike) > 1e-9) throw new Error('COVERED_CALL_CONTRACT_STRIKE_MISMATCH');

  validateExecutionEnvironmentConsistency(input.executionKind, input.environment, 'COVERED_CALL');
  validateResolvedLabels(input.resolvedLabels, input.chainId, decidedAtMs, 'COVERED_CALL');

  const quantity = finiteMatchingOrNull(input.quantity, (value) => Number.isInteger(value) && value > 0);
  const multiplier = finiteMatchingOrNull(input.multiplier, (value) => Number.isInteger(value) && value > 0);
  const sharesHeld = finiteMatchingOrNull(input.sharesHeld, (value) => Number.isInteger(value) && value >= 0);
  if (quantity !== null && multiplier !== null && sharesHeld !== null) {
    const requiredShares = quantity * multiplier;
    if (requiredShares > sharesHeld) throw new Error('COVERED_CALL_INSUFFICIENT_SHARE_COVERAGE');
  }

  const premiumPerShare = finiteMatchingOrNull(input.premiumPerShare, (value) => value >= 0);
  const premiumPerContract = finiteMatchingOrNull(input.premiumPerContract, (value) => value >= 0);
  const positionPremium = finiteMatchingOrNull(input.positionPremium, (value) => value >= 0);
  if (premiumPerShare !== null && premiumPerContract !== null && multiplier !== null
    && Math.abs(premiumPerShare * multiplier - premiumPerContract) > 1e-8) {
    throw new Error('COVERED_CALL_PREMIUM_PER_CONTRACT_UNIT_MISMATCH');
  }
  if (premiumPerContract !== null && positionPremium !== null && quantity !== null
    && Math.abs(premiumPerContract * quantity - positionPremium) > 1e-8) {
    throw new Error('COVERED_CALL_POSITION_PREMIUM_UNIT_MISMATCH');
  }

  const bid = finiteMatchingOrNull(input.bid, (value) => value >= 0);
  const ask = finiteMatchingOrNull(input.ask, (value) => value >= 0);
  const liquidityEvidenceState: LifecycleEvidenceState = bid !== null && ask !== null && ask >= bid ? 'KNOWN' : 'UNKNOWN';

  const stockPriceAtDecision = finiteMatchingOrNull(input.stockPriceAtDecision, (value) => value > 0);
  const basisPerShare = input.basis?.effectiveStockBasisPerShare ?? null;
  const strikeMinusStockPrice = stockPriceAtDecision !== null ? input.strike - stockPriceAtDecision : null;
  const strikeDistancePercent = strikeMinusStockPrice !== null && stockPriceAtDecision !== null && stockPriceAtDecision > 0
    ? strikeMinusStockPrice / stockPriceAtDecision : null;
  const strikeMinusBasisPerShare = basisPerShare !== null ? input.strike - basisPerShare : null;

  return {
    ...input,
    contractVersion: recoveryCoveredCallCohortVersion,
    dte: finiteMatchingOrNull(input.dte, (value) => Number.isInteger(value) && value >= 0),
    delta: finiteMatchingOrNull(input.delta, (value) => value >= 0 && value <= 1),
    quantity, multiplier, sharesHeld, premiumPerShare, premiumPerContract, positionPremium, bid, ask,
    spreadPct: finiteMatchingOrNull(input.spreadPct, (value) => value >= 0),
    openInterest: finiteMatchingOrNull(input.openInterest, (value) => Number.isInteger(value) && value >= 0),
    volume: finiteMatchingOrNull(input.volume, (value) => Number.isInteger(value) && value >= 0),
    stockPriceAtDecision,
    expectedMoveDollars: finiteMatchingOrNull(input.expectedMoveDollars, (value) => value >= 0),
    impliedVolatility: finiteMatchingOrNull(input.impliedVolatility, (value) => value >= 0),
    ivRank: finiteOrNull(input.ivRank), realizedVolatility: finiteMatchingOrNull(input.realizedVolatility, (value) => value >= 0),
    ivMinusRv: finiteOrNull(input.ivMinusRv), skew25Delta: finiteOrNull(input.skew25Delta), termSlope: finiteOrNull(input.termSlope),
    liquidityEvidenceState, basisEvidenceState: basisPerShare !== null ? 'KNOWN' : 'UNKNOWN',
    geometry: { strikeMinusStockPrice, strikeDistancePercent, strikeMinusBasisPerShare },
    resolutionState: input.resolvedLabels !== null ? 'RESOLVED' : 'UNRESOLVED',
    brokerAuthority: false,
  };
}

export interface CoveredCallCohortObservation {
  readonly observation: CoveredCallObservation;
}

export interface CoveredCallActionCohortStatistic {
  readonly action: CoveredCallManagementAction;
  readonly rawObservationCount: number;
  readonly resolvedChainCount: number;
  readonly independentN: number | null;
  readonly wholeChainAfterCostPnl: LifecycleMetricSummary;
  readonly coveredCallPremiumContribution: LifecycleMetricSummary;
  readonly stockPnlContribution: LifecycleMetricSummary;
  readonly capitalDays: LifecycleMetricSummary;
  readonly returnPerCapitalDay: LifecycleMetricSummary;
  readonly mfe: LifecycleMetricSummary;
  readonly mae: LifecycleMetricSummary;
  readonly maxDrawdown: LifecycleMetricSummary;
  readonly calledAwayKnownCount: number;
  readonly calledAwayTrueCount: number;
  readonly dataQualityState: LifecycleCohortDataQualityState;
  readonly sampleSizeState: LifecycleSampleSizeState;
}

export interface CoveredCallCohortReport {
  readonly contractVersion: typeof recoveryCoveredCallCohortVersion;
  readonly cohortKey: Readonly<Record<string, string>> | null;
  readonly rawObservationCount: number;
  readonly distinctChainCount: number;
  readonly distinctEpisodeCount: number | null;
  readonly resolvedObservationCount: number;
  readonly unresolvedObservationCount: number;
  readonly minimumIndependentSample: number;
  readonly actionBreakdown: readonly CoveredCallActionCohortStatistic[];
  readonly uncertaintyState: 'DESCRIPTIVE_ONLY';
  readonly brokerAuthority: false;
}

/**
 * Aggregates Covered-Call observations grouped by canonical
 * `managementAction` (`SELL_CC`/`HOLD_CC`/`CLOSE_CC`/`ROLL_CC`/
 * `ALLOW_CALL_AWAY` -- the latter doubling as the Call-Away cohort per
 * the directive's minimum-coherent-structure guidance). A chain may
 * generate several CC episodes (e.g. roll after roll) before it finally
 * resolves; only ONE resolved economic outcome per chain ever enters the
 * statistics (mirroring `hold-strike-empirical-cohort.ts`'s dedup), so a
 * CLOSE_CC that does not end the chain is never mistaken for the whole
 * chain's final resolution.
 */
export function buildCoveredCallCohortReport(
  observations: readonly CoveredCallCohortObservation[], minimumIndependentSample: number,
  cohortKey: Readonly<Record<string, string>> | null = null,
): CoveredCallCohortReport {
  if (!Number.isInteger(minimumIndependentSample) || minimumIndependentSample <= 0) {
    throw new Error('COVERED_CALL_COHORT_MINIMUM_SAMPLE_INVALID');
  }
  const seenIdentity = new Set<string>();
  for (const { observation } of observations) {
    const identity = `${observation.snapshotId}|${observation.candidateId}`;
    if (seenIdentity.has(identity)) throw new Error(`COVERED_CALL_COHORT_DUPLICATE_OBSERVATION_IDENTITY: ${identity}`);
    seenIdentity.add(identity);
  }

  const distinctChainCount = new Set(observations.map((row) => row.observation.chainId)).size;
  const episodeIds = observations.map((row) => row.observation.episodeId).filter((id): id is string => id !== null);
  const distinctEpisodeCount = episodeIds.length > 0 ? new Set(episodeIds).size : null;
  const resolvedObservationCount = observations.filter((row) => row.observation.resolutionState === 'RESOLVED').length;
  const unresolvedObservationCount = observations.length - resolvedObservationCount;

  const actions: readonly CoveredCallManagementAction[] = ['SELL_CC', 'HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY'];
  const actionBreakdown = actions.map((action) => {
    const rows = observations.filter((row) => row.observation.managementAction === action);
    const resolvedChains = resolvedChainDedup(rows.map((row) => ({
      chainId: row.observation.chainId, resolvedLabels: row.observation.resolvedLabels,
      identity: `${row.observation.snapshotId}|${row.observation.candidateId}`, independentUnitId: row.observation.independentUnitId,
    })));
    const resolvedChainCount = resolvedChains.length;
    const independentUnitIds = resolvedChains.map((row) => row.independentUnitId);
    const independentN = resolvedChainCount === 0 ? 0
      : independentUnitIds.every((id) => id !== null) ? new Set(independentUnitIds as string[]).size : null;

    const labels = resolvedChains.map((row) => row.resolvedLabels);
    const wholeChainAfterCostPnl = summarize(labels.map((l) => labelValue(l, (x) => x.wholeChainAfterCostPnl)), resolvedChainCount);
    const coveredCallPremiumContribution = summarize(labels.map((l) => labelValue(l, (x) => x.coveredCallPremiumContribution)), resolvedChainCount);
    const stockPnlContribution = summarize(labels.map((l) => labelValue(l, (x) => x.stockPnlContribution)), resolvedChainCount);
    const capitalDays = summarize(labels.map((l) => labelValue(l, (x) => x.capitalDays)), resolvedChainCount);
    const returnPerCapitalDay = summarize(labels.map((l) => labelValue(l, (x) => x.returnPerCapitalDay)), resolvedChainCount);
    const mfe = summarize(labels.map((l) => labelValue(l, (x) => x.mfe)), resolvedChainCount);
    const mae = summarize(labels.map((l) => labelValue(l, (x) => x.mae)), resolvedChainCount);
    const maxDrawdown = summarize(labels.map((l) => labelValue(l, (x) => x.maxDrawdown)), resolvedChainCount);
    const calledAwayValues = labels.map((l) => labelValue(l, (x) => x.calledAwayOccurred));
    const calledAwayKnownCount = calledAwayValues.filter((value) => value !== null).length;
    const calledAwayTrueCount = calledAwayValues.filter((value) => value === true).length;

    const metrics = [wholeChainAfterCostPnl, coveredCallPremiumContribution, stockPnlContribution, capitalDays, returnPerCapitalDay, mfe, mae, maxDrawdown];
    const dataQualityState: LifecycleCohortDataQualityState = resolvedChainCount === 0
      ? 'NO_ECONOMIC_METRICS' : metrics.every((metric) => metric.missingCount === 0) ? 'COMPLETE' : 'PARTIAL';
    const sampleSizeState: LifecycleSampleSizeState = rows.length === 0 || resolvedChainCount === 0
      ? 'NONE' : independentN === null ? 'NOT_ASSESSED' : independentN >= minimumIndependentSample ? 'SUFFICIENT' : 'INSUFFICIENT';

    return {
      action, rawObservationCount: rows.length, resolvedChainCount, independentN,
      wholeChainAfterCostPnl, coveredCallPremiumContribution, stockPnlContribution, capitalDays, returnPerCapitalDay,
      mfe, mae, maxDrawdown, calledAwayKnownCount, calledAwayTrueCount, dataQualityState, sampleSizeState,
    } satisfies CoveredCallActionCohortStatistic;
  });

  return {
    contractVersion: recoveryCoveredCallCohortVersion, cohortKey,
    rawObservationCount: observations.length, distinctChainCount, distinctEpisodeCount,
    resolvedObservationCount, unresolvedObservationCount, minimumIndependentSample, actionBreakdown,
    uncertaintyState: 'DESCRIPTIVE_ONLY', brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Counterfactual adapter (structural mapping only -- ZERO new
// validation; `analyzeManagementCounterfactuals` remains the sole PIT/
// leakage/fill-model authority, called directly by the caller on the
// object this function returns).
// ---------------------------------------------------------------------

/**
 * Assembles the canonical `ManagementCounterfactualInput` shape
 * (`management-counterfactual-analysis.ts`) from a Recovery or
 * Covered-Call decision's identity plus the actual and alternative
 * outcome observations the caller already has. This function performs
 * NO validation of its own -- it is pure structural field assembly. The
 * caller must pass the result directly to `analyzeManagementCounterfactuals`,
 * which remains the sole authority for PIT/leakage/fill-model/NO_FILL
 * validation (per the standing "reuse canonical engine, never reimplement
 * its validation" rule).
 */
export function buildLifecycleManagementCounterfactualInput(input: {
  readonly decisionId: string;
  readonly chainId: string;
  readonly decidedAt: string;
  readonly featureCutoff: string;
  readonly selectedAction: RecoveryAction | CoveredCallManagementAction;
  readonly actualOutcome: ManagementOutcomeObservation;
  readonly alternativeOutcomes: readonly ManagementOutcomeObservation[];
}): ManagementCounterfactualInput {
  return {
    decisionId: input.decisionId, chainId: input.chainId, decidedAt: input.decidedAt, featureCutoff: input.featureCutoff,
    selectedAction: input.selectedAction, outcomes: [input.actualOutcome, ...input.alternativeOutcomes],
  };
}
