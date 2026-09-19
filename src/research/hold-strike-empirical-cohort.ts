import type { EventRiskState } from '../theta/event-risk-state.js';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import type { R6OutcomeLabelSet } from './r6-outcome-labels.js';

/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO applicability, eligibility, routing, sizing, or AEGIS authority of
 * any kind. THETA_HOLD_STRIKE remains `RESEARCH_ONLY` per
 * `strategy-package.ts`; canonical strategy-readiness/applicability
 * authority already lives in `branch-research-readiness.ts`
 * (`assessBranchResearchReadiness`). This module never recreates that
 * decision -- it only ANALYZES already-recorded Hold-Strike candidate
 * observations and, where available, their later-resolved canonical R6
 * outcomes (`r6-outcome-labels.ts`'s `R6OutcomeLabelSet`).
 *
 * The earlier `hold-the-strike-applicability.ts` (commit 321b29b) was
 * REJECTED by canonical review for creating a second Hold-Strike
 * applicability authority and was never merged into main -- it is not
 * imported here, and none of its ownership-threshold or APPLICABLE/
 * NOT_APPLICABLE judgment logic is reused. Only the general shape idea of
 * "a Hold-Strike candidate has these structural facts" carries over,
 * reimplemented here as pure, unjudged evidence fields with a real
 * identity (`snapshotId`/`candidateId`), which the rejected module never
 * had.
 *
 * No canonical persisted Hold-Strike candidate record exists yet on main
 * (confirmed by direct inspection before writing this file) -- this
 * module defines the input shape such an evidence source would need to
 * supply, and is the analysis layer over it once one exists. It does not
 * fabricate, generate, or persist candidates itself.
 */
export const holdStrikeEmpiricalCohortVersion = 'theta-hold-strike-empirical-cohort-v1' as const;

/**
 * Mirrors `strategy-package.ts`'s canonical strategy lifecycle `status`
 * vocabulary (`RESEARCH_ONLY | SHADOW | PAPER | LIVE_SMALL | LIVE |
 * RETIRED`), minus `RETIRED` (not meaningful for a single observation).
 * No canonical `HISTORICAL` member exists anywhere in the codebase today;
 * this module deliberately does not invent one.
 */
export type HoldStrikeObservationEnvironment = 'RESEARCH_ONLY' | 'SHADOW' | 'PAPER' | 'LIVE_SMALL' | 'LIVE';

/**
 * Whether this observation was an actually-opened position or a shadow-
 * only candidate that was never opened. A `SHADOW_CANDIDATE` outcome, even
 * when `resolvedLabels` is present (e.g. from a versioned replay), must
 * never be silently compared as if it were an actual broker fill.
 */
export type HoldStrikeExecutionKind = 'SHADOW_CANDIDATE' | 'PAPER_ACTUAL' | 'LIVE_ACTUAL';

export type HoldStrikeResolutionState = 'UNRESOLVED' | 'RESOLVED';
export type HoldStrikeEvidenceState = 'KNOWN' | 'UNKNOWN';

export interface HoldStrikeCandidateObservationInput {
  readonly snapshotId: string;
  readonly candidateId: string;
  readonly decisionId: string | null;
  /** Non-null only once this candidate was actually opened into a chain. */
  readonly chainId: string | null;
  readonly episodeId: string | null;
  /** A caller-supplied, versioned research grouping key. A chain ID alone
   * is never proof of statistical independence (per the standing rule
   * already enforced by `management-counterfactual-cohort.ts`). */
  readonly independentUnitId: string | null;
  readonly strategyVersion: string;
  readonly environment: HoldStrikeObservationEnvironment;
  readonly executionKind: HoldStrikeExecutionKind;
  /** The decision/candidate timestamp T. Features below must describe
   * only what was knowable at or before this instant; anything in
   * `resolvedLabels` must be knowable only after it. */
  readonly asOf: string;

  readonly underlying: string;
  readonly optionSymbol: string;
  readonly expiration: string;
  readonly dte: number | null;
  readonly delta: number | null;
  readonly strike: number;
  readonly underlyingPriceAtDecision: number | null;
  /** Caller-computed fact (e.g. `strike - premiumPerShare` for a short
   * put) -- never recomputed by this module. */
  readonly breakEven: number | null;
  readonly expectedMoveDollars: number | null;

  readonly premiumPerShare: number | null;
  readonly premiumPerContract: number | null;
  readonly positionPremium: number | null;
  readonly multiplier: number | null;
  readonly quantity: number | null;
  readonly capitalAmount: number | null;

  /** Raw [0,1] ownership score, mirroring `ownership-contract.ts`'s
   * `ownability` field. This module never applies a threshold to it. */
  readonly ownershipScore: number | null;
  readonly eventRisk: EventRiskState;

  readonly bid: number | null;
  readonly ask: number | null;
  readonly spreadPct: number | null;
  readonly openInterest: number | null;
  readonly volume: number | null;

  readonly impliedVolatility: number | null;
  readonly ivRank: number | null;
  readonly ivPercentile: number | null;
  readonly realizedVolatility: number | null;
  readonly ivMinusRv: number | null;
  readonly skew25Delta: number | null;
  readonly termSlope: number | null;

  /** Passthrough of a recorded AEGIS state string, if any. Never
   * recomputed, re-derived, or overridden by this module. */
  readonly recordedAegisState: string | null;

  /** The canonical resolved outcome for this observation's chain, once
   * one exists. `null` while unresolved. */
  readonly resolvedLabels: R6OutcomeLabelSet | null;
}

export interface HoldStrikeStrikeGeometry {
  readonly strikeMinusSpot: number | null;
  readonly breakEvenMinusSpot: number | null;
  readonly strikeDistancePercent: number | null;
  readonly breakEvenDistancePercent: number | null;
  /** `|strikeMinusSpot| / expectedMoveDollars` -- how many expected-move
   * units away the strike sits. A plain ratio, not a safety judgment. */
  readonly strikeDistanceFromExpectedMove: number | null;
}

export interface HoldStrikeCandidateObservation extends Omit<HoldStrikeCandidateObservationInput, 'ownershipScore'> {
  readonly contractVersion: typeof holdStrikeEmpiricalCohortVersion;
  readonly ownershipScore: number | null;
  readonly ownershipEvidenceState: HoldStrikeEvidenceState;
  readonly liquidityEvidenceState: HoldStrikeEvidenceState;
  readonly geometry: HoldStrikeStrikeGeometry;
  readonly resolutionState: HoldStrikeResolutionState;
  readonly brokerAuthority: false;
}

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

/**
 * Builds one Hold-Strike candidate research observation. Throws on
 * structural identity/PIT violations (blank required identity, a
 * non-positive strike, an invalid timestamp, a resolved outcome missing
 * `chainId` or naming a different `chainId`, or a resolved label
 * timestamped before the decision) rather than silently accepting them --
 * these represent an evidence-feed defect, not a modeled research state.
 * Implausible individual evidence values (non-finite ownership score
 * outside [0,1], non-finite IV/liquidity figures, etc.) are treated as
 * UNKNOWN, never coerced to a fabricated number.
 */
export function buildHoldStrikeCandidateObservation(input: HoldStrikeCandidateObservationInput): HoldStrikeCandidateObservation {
  requireNonBlank(input.snapshotId, 'HOLD_STRIKE_SNAPSHOT_ID_REQUIRED');
  requireNonBlank(input.candidateId, 'HOLD_STRIKE_CANDIDATE_ID_REQUIRED');
  requireNonBlank(input.strategyVersion, 'HOLD_STRIKE_STRATEGY_VERSION_REQUIRED');
  requireNonBlank(input.underlying, 'HOLD_STRIKE_UNDERLYING_REQUIRED');
  requireNonBlank(input.optionSymbol, 'HOLD_STRIKE_OPTION_SYMBOL_REQUIRED');
  requireNonBlank(input.expiration, 'HOLD_STRIKE_EXPIRATION_REQUIRED');
  for (const [value, code] of [
    [input.decisionId, 'HOLD_STRIKE_DECISION_ID_INVALID'],
    [input.chainId, 'HOLD_STRIKE_CHAIN_ID_INVALID'],
    [input.episodeId, 'HOLD_STRIKE_EPISODE_ID_INVALID'],
    [input.independentUnitId, 'HOLD_STRIKE_INDEPENDENT_UNIT_ID_INVALID'],
  ] as const) if (value !== null && value.trim().length === 0) throw new Error(code);
  if (!Number.isFinite(input.strike) || input.strike <= 0) throw new Error('HOLD_STRIKE_STRIKE_INVALID');
  const decidedAtMs = Date.parse(input.asOf);
  if (!Number.isFinite(decidedAtMs)) throw new Error('HOLD_STRIKE_TIMESTAMP_INVALID');
  const parsedContract = parseOccOptionSymbol(input.optionSymbol);
  if (parsedContract === null) throw new Error('HOLD_STRIKE_OPTION_SYMBOL_INVALID');
  if (parsedContract.underlying !== input.underlying) throw new Error('HOLD_STRIKE_CONTRACT_UNDERLYING_MISMATCH');
  if (parsedContract.optionType !== 'PUT') throw new Error('HOLD_STRIKE_CONTRACT_NOT_PUT');
  if (parsedContract.expiration !== input.expiration) throw new Error('HOLD_STRIKE_CONTRACT_EXPIRATION_MISMATCH');
  if (Math.abs(parsedContract.strike - input.strike) > 1e-9) throw new Error('HOLD_STRIKE_CONTRACT_STRIKE_MISMATCH');
  if (input.executionKind !== 'SHADOW_CANDIDATE' && input.chainId === null) {
    throw new Error('HOLD_STRIKE_ACTUAL_REQUIRES_CHAIN_ID');
  }
  if (input.executionKind === 'PAPER_ACTUAL' && input.environment !== 'PAPER') {
    throw new Error('HOLD_STRIKE_PAPER_ACTUAL_ENVIRONMENT_MISMATCH');
  }
  if (input.executionKind === 'LIVE_ACTUAL' && !['LIVE_SMALL', 'LIVE'].includes(input.environment)) {
    throw new Error('HOLD_STRIKE_LIVE_ACTUAL_ENVIRONMENT_MISMATCH');
  }

  if (input.resolvedLabels !== null) {
    if (input.chainId === null) throw new Error('HOLD_STRIKE_RESOLVED_REQUIRES_CHAIN_ID');
    if (input.resolvedLabels.chainId !== input.chainId) throw new Error('HOLD_STRIKE_RESOLVED_CHAIN_ID_MISMATCH');
    const resolvedAtMs = Date.parse(input.resolvedLabels.asOf);
    if (!Number.isFinite(resolvedAtMs)) throw new Error('HOLD_STRIKE_RESOLVED_TIMESTAMP_INVALID');
    if (resolvedAtMs <= decidedAtMs) throw new Error('HOLD_STRIKE_RESOLVED_LABEL_TIME_LEAKAGE');
  }

  const ownershipScore = input.ownershipScore !== null && Number.isFinite(input.ownershipScore)
    && input.ownershipScore >= 0 && input.ownershipScore <= 1 ? input.ownershipScore : null;
  const underlyingPriceAtDecision = finiteMatchingOrNull(input.underlyingPriceAtDecision, (value) => value > 0);
  const breakEven = finiteMatchingOrNull(input.breakEven, (value) => value > 0);
  const expectedMoveDollars = finiteMatchingOrNull(input.expectedMoveDollars, (value) => value >= 0);
  const bid = finiteMatchingOrNull(input.bid, (value) => value >= 0);
  const ask = finiteMatchingOrNull(input.ask, (value) => value >= 0);
  const premiumPerShare = finiteMatchingOrNull(input.premiumPerShare, (value) => value >= 0);
  const premiumPerContract = finiteMatchingOrNull(input.premiumPerContract, (value) => value >= 0);
  const positionPremium = finiteMatchingOrNull(input.positionPremium, (value) => value >= 0);
  const multiplier = finiteMatchingOrNull(input.multiplier, (value) => Number.isInteger(value) && value > 0);
  const quantity = finiteMatchingOrNull(input.quantity, (value) => Number.isInteger(value) && value > 0);
  if (premiumPerShare !== null && premiumPerContract !== null && multiplier !== null
    && Math.abs(premiumPerShare * multiplier - premiumPerContract) > 1e-8) {
    throw new Error('HOLD_STRIKE_PREMIUM_PER_CONTRACT_UNIT_MISMATCH');
  }
  if (premiumPerContract !== null && positionPremium !== null && quantity !== null
    && Math.abs(premiumPerContract * quantity - positionPremium) > 1e-8) {
    throw new Error('HOLD_STRIKE_POSITION_PREMIUM_UNIT_MISMATCH');
  }

  const strikeMinusSpot = underlyingPriceAtDecision !== null ? input.strike - underlyingPriceAtDecision : null;
  const breakEvenMinusSpot = breakEven !== null && underlyingPriceAtDecision !== null ? breakEven - underlyingPriceAtDecision : null;
  const strikeDistancePercent = strikeMinusSpot !== null && underlyingPriceAtDecision !== null && underlyingPriceAtDecision > 0
    ? strikeMinusSpot / underlyingPriceAtDecision : null;
  const breakEvenDistancePercent = breakEvenMinusSpot !== null && underlyingPriceAtDecision !== null && underlyingPriceAtDecision > 0
    ? breakEvenMinusSpot / underlyingPriceAtDecision : null;
  const strikeDistanceFromExpectedMove = strikeMinusSpot !== null && expectedMoveDollars !== null && expectedMoveDollars > 0
    ? Math.abs(strikeMinusSpot) / expectedMoveDollars : null;

  const liquidityEvidenceState: HoldStrikeEvidenceState = bid !== null && ask !== null && ask >= bid ? 'KNOWN' : 'UNKNOWN';

  return {
    ...input,
    contractVersion: holdStrikeEmpiricalCohortVersion,
    dte: finiteMatchingOrNull(input.dte, (value) => Number.isInteger(value) && value >= 0),
    delta: finiteMatchingOrNull(input.delta, (value) => value >= -1 && value <= 0),
    underlyingPriceAtDecision, breakEven, expectedMoveDollars,
    premiumPerShare, premiumPerContract, positionPremium, multiplier, quantity,
    capitalAmount: finiteMatchingOrNull(input.capitalAmount, (value) => value >= 0),
    ownershipScore, ownershipEvidenceState: ownershipScore !== null ? 'KNOWN' : 'UNKNOWN',
    bid, ask, spreadPct: finiteMatchingOrNull(input.spreadPct, (value) => value >= 0),
    openInterest: finiteMatchingOrNull(input.openInterest, (value) => Number.isInteger(value) && value >= 0),
    volume: finiteMatchingOrNull(input.volume, (value) => Number.isInteger(value) && value >= 0), liquidityEvidenceState,
    impliedVolatility: finiteMatchingOrNull(input.impliedVolatility, (value) => value >= 0), ivRank: finiteOrNull(input.ivRank),
    ivPercentile: finiteOrNull(input.ivPercentile),
    realizedVolatility: finiteMatchingOrNull(input.realizedVolatility, (value) => value >= 0),
    ivMinusRv: finiteOrNull(input.ivMinusRv), skew25Delta: finiteOrNull(input.skew25Delta), termSlope: finiteOrNull(input.termSlope),
    geometry: { strikeMinusSpot, breakEvenMinusSpot, strikeDistancePercent, breakEvenDistancePercent, strikeDistanceFromExpectedMove },
    resolutionState: input.resolvedLabels !== null ? 'RESOLVED' : 'UNRESOLVED',
    brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Cohort aggregation
// ---------------------------------------------------------------------

export interface HoldStrikeCohortObservation {
  readonly observation: HoldStrikeCandidateObservation;
}

export type HoldStrikeSampleSizeState = 'SUFFICIENT' | 'INSUFFICIENT' | 'NOT_ASSESSED' | 'NONE';
export type HoldStrikeCohortDataQualityState = 'COMPLETE' | 'PARTIAL' | 'NO_ECONOMIC_METRICS';

export interface HoldStrikeMetricSummary {
  readonly knownCount: number;
  readonly missingCount: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly standardDeviation: number | null;
}

export interface HoldStrikeCohortReport {
  readonly contractVersion: typeof holdStrikeEmpiricalCohortVersion;
  readonly cohortKey: Readonly<Record<string, string>> | null;
  readonly rawObservationCount: number;
  readonly distinctChainCount: number;
  /** One resolved economic result per chain. Repeated candidate snapshots
   * for the same chain never duplicate that chain's outcome in statistics. */
  readonly resolvedChainCount: number;
  /** `null` when no observation in the cohort carries an `episodeId` at
   * all -- absence of evidence, not a computed zero. */
  readonly distinctEpisodeCount: number | null;
  readonly resolvedObservationCount: number;
  readonly unresolvedObservationCount: number;
  /** Independent resolved economic units only. Unresolved candidates can
   * never inflate empirical sample size. `0` when there are no resolved
   * chains and `null` when any resolved chain lacks a justified unit ID. */
  readonly independentN: number | null;
  readonly executionKind: HoldStrikeExecutionKind | null;
  readonly strategyVersions: readonly string[];
  readonly environments: readonly HoldStrikeObservationEnvironment[];
  readonly minimumIndependentSample: number;
  readonly sampleSizeState: HoldStrikeSampleSizeState;
  readonly dataQualityState: HoldStrikeCohortDataQualityState;
  readonly uncertaintyState: 'DESCRIPTIVE_ONLY';

  readonly wholeChainAfterCostPnl: HoldStrikeMetricSummary;
  readonly capitalDays: HoldStrikeMetricSummary;
  readonly returnPerCapitalDay: HoldStrikeMetricSummary;
  readonly mfe: HoldStrikeMetricSummary;
  readonly mae: HoldStrikeMetricSummary;
  readonly maxDrawdown: HoldStrikeMetricSummary;

  readonly assignmentKnownCount: number;
  readonly assignmentUnknownCount: number;
  readonly assignmentOccurredCount: number;
  readonly assignmentNotOccurredCount: number;

  readonly brokerAuthority: false;
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
  const result = lower + (upper - lower) / 2;
  return Number.isFinite(result) ? result : null;
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
function summarize(values: readonly (number | null)[], resolvedCount: number): HoldStrikeMetricSummary {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return { knownCount: known.length, missingCount: resolvedCount - known.length, mean: mean(known), median: median(known), standardDeviation: sampleStandardDeviation(known) };
}

/**
 * Aggregates already-built Hold-Strike candidate observations into
 * descriptive cohort statistics. Mirrors the naming/semantics style of
 * `management-counterfactual-cohort.ts` (raw count vs. distinct-chain
 * count vs. independent N vs. dispersion vs. data-quality-state) since no
 * shared statistics utility module exists yet to import from.
 */
export function buildHoldStrikeCohortReport(
  observations: readonly HoldStrikeCohortObservation[],
  minimumIndependentSample: number,
  cohortKey: Readonly<Record<string, string>> | null = null,
): HoldStrikeCohortReport {
  if (!Number.isInteger(minimumIndependentSample) || minimumIndependentSample <= 0) {
    throw new Error('HOLD_STRIKE_COHORT_MINIMUM_SAMPLE_INVALID');
  }
  const seenIdentity = new Set<string>();
  const executionKinds = new Set<HoldStrikeExecutionKind>();
  const independentUnitsByChain = new Map<string, Set<string>>();
  for (const { observation } of observations) {
    if (observation.contractVersion !== holdStrikeEmpiricalCohortVersion || observation.brokerAuthority !== false) {
      throw new Error('HOLD_STRIKE_COHORT_OBSERVATION_CONTRACT_INVALID');
    }
    if (observation.resolutionState === 'RESOLVED'
      && (observation.resolvedLabels === null || observation.chainId === null
        || observation.resolvedLabels.chainId !== observation.chainId)) {
      throw new Error('HOLD_STRIKE_COHORT_RESOLVED_OBSERVATION_INVALID');
    }
    if (observation.resolutionState === 'UNRESOLVED' && observation.resolvedLabels !== null) {
      throw new Error('HOLD_STRIKE_COHORT_UNRESOLVED_OBSERVATION_HAS_LABELS');
    }
    const identity = `${observation.snapshotId}|${observation.candidateId}`;
    if (seenIdentity.has(identity)) throw new Error(`HOLD_STRIKE_COHORT_DUPLICATE_OBSERVATION_IDENTITY: ${identity}`);
    seenIdentity.add(identity);
    executionKinds.add(observation.executionKind);
    if (observation.chainId !== null && observation.independentUnitId !== null) {
      const units = independentUnitsByChain.get(observation.chainId) ?? new Set<string>();
      units.add(observation.independentUnitId);
      independentUnitsByChain.set(observation.chainId, units);
    }
  }
  if (executionKinds.size > 1) throw new Error('HOLD_STRIKE_COHORT_MIXED_EXECUTION_KIND');
  for (const [chainId, units] of independentUnitsByChain) {
    if (units.size > 1) throw new Error(`HOLD_STRIKE_COHORT_CHAIN_INDEPENDENCE_CONFLICT: ${chainId}`);
  }

  const chainIds = observations.map((row) => row.observation.chainId).filter((id): id is string => id !== null);
  const distinctChainCount = new Set(chainIds).size;
  const episodeIds = observations.map((row) => row.observation.episodeId).filter((id): id is string => id !== null);
  const distinctEpisodeCount = episodeIds.length > 0 ? new Set(episodeIds).size : null;

  const resolved = observations.filter((row) => row.observation.resolutionState === 'RESOLVED');
  const resolvedObservationCount = resolved.length;
  const unresolvedObservationCount = observations.length - resolvedObservationCount;

  const resolvedByChain = new Map<string, HoldStrikeCohortObservation>();
  for (const row of resolved) {
    const chainId = row.observation.chainId as string;
    const existing = resolvedByChain.get(chainId);
    if (existing !== undefined
      && row.observation.resolvedLabels?.asOf === existing.observation.resolvedLabels?.asOf
      && JSON.stringify(row.observation.resolvedLabels) !== JSON.stringify(existing.observation.resolvedLabels)) {
      throw new Error(`HOLD_STRIKE_COHORT_CONFLICTING_CHAIN_OUTCOME: ${chainId}`);
    }
    if (existing === undefined
      || Date.parse(row.observation.resolvedLabels?.asOf ?? '') > Date.parse(existing.observation.resolvedLabels?.asOf ?? '')
      || (row.observation.resolvedLabels?.asOf === existing.observation.resolvedLabels?.asOf
        && `${row.observation.snapshotId}|${row.observation.candidateId}` < `${existing.observation.snapshotId}|${existing.observation.candidateId}`)) {
      resolvedByChain.set(chainId, row);
    }
  }
  const resolvedChains = [...resolvedByChain.values()].sort((left, right) =>
    (left.observation.chainId as string).localeCompare(right.observation.chainId as string));
  const resolvedChainCount = resolvedChains.length;
  const resolvedIndependentUnitIds = resolvedChains.map((row) => row.observation.independentUnitId);
  const independentN = resolvedChainCount === 0 ? 0
    : resolvedIndependentUnitIds.every((id) => id !== null)
      ? new Set(resolvedIndependentUnitIds as string[]).size : null;

  const labelValue = <T,>(row: HoldStrikeCohortObservation, pick: (labels: R6OutcomeLabelSet) => { readonly value: T | null; readonly state: string }): T | null => {
    const labels = row.observation.resolvedLabels;
    if (labels === null) return null;
    const label = pick(labels);
    return label.state === 'KNOWN' ? label.value : null;
  };

  const wholeChainAfterCostPnl = summarize(resolvedChains.map((row) => labelValue(row, (l) => l.wholeChainAfterCostPnl)), resolvedChainCount);
  const capitalDays = summarize(resolvedChains.map((row) => labelValue(row, (l) => l.capitalDays)), resolvedChainCount);
  const returnPerCapitalDay = summarize(resolvedChains.map((row) => labelValue(row, (l) => l.returnPerCapitalDay)), resolvedChainCount);
  const mfe = summarize(resolvedChains.map((row) => labelValue(row, (l) => l.mfe)), resolvedChainCount);
  const mae = summarize(resolvedChains.map((row) => labelValue(row, (l) => l.mae)), resolvedChainCount);
  const maxDrawdown = summarize(resolvedChains.map((row) => labelValue(row, (l) => l.maxDrawdown)), resolvedChainCount);

  const assignmentValues = resolvedChains.map((row) => labelValue(row, (l) => l.assignmentOccurred));
  const assignmentKnownCount = assignmentValues.filter((value) => value !== null).length;
  const assignmentUnknownCount = resolvedChainCount - assignmentKnownCount;
  const assignmentOccurredCount = assignmentValues.filter((value) => value === true).length;
  const assignmentNotOccurredCount = assignmentValues.filter((value) => value === false).length;

  const metrics = [wholeChainAfterCostPnl, capitalDays, returnPerCapitalDay, mfe, mae, maxDrawdown];
  const dataQualityState: HoldStrikeCohortDataQualityState = resolvedChainCount === 0
    ? 'NO_ECONOMIC_METRICS'
    : metrics.every((metric) => metric.missingCount === 0) ? 'COMPLETE' : 'PARTIAL';

  const sampleSizeState: HoldStrikeSampleSizeState = observations.length === 0 || resolvedChainCount === 0
    ? 'NONE'
    : independentN === null ? 'NOT_ASSESSED'
    : independentN >= minimumIndependentSample ? 'SUFFICIENT' : 'INSUFFICIENT';

  return {
    contractVersion: holdStrikeEmpiricalCohortVersion, cohortKey,
    rawObservationCount: observations.length, distinctChainCount, resolvedChainCount, distinctEpisodeCount,
    resolvedObservationCount, unresolvedObservationCount, independentN, minimumIndependentSample,
    executionKind: observations[0]?.observation.executionKind ?? null,
    strategyVersions: [...new Set(observations.map((row) => row.observation.strategyVersion))].sort(),
    environments: [...new Set(observations.map((row) => row.observation.environment))].sort(),
    sampleSizeState, dataQualityState, uncertaintyState: 'DESCRIPTIVE_ONLY',
    wholeChainAfterCostPnl, capitalDays, returnPerCapitalDay, mfe, mae, maxDrawdown,
    assignmentKnownCount, assignmentUnknownCount, assignmentOccurredCount, assignmentNotOccurredCount,
    brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Optional Hold-Strike vs Conventional pairing (descriptive only)
// ---------------------------------------------------------------------

export interface HoldStrikeConventionalCandidateFacts {
  readonly snapshotId: string;
  readonly candidateId: string;
  readonly asOf: string;
  readonly executionKind: HoldStrikeExecutionKind;
  readonly underlying: string;
  readonly strike: number;
  readonly breakEven: number | null;
  readonly premiumPerShare: number | null;
  readonly dte: number | null;
  readonly delta: number | null;
  readonly capitalAmount: number | null;
}

export type HoldStrikePairDimension = 'strike' | 'breakEven' | 'premiumPerShare' | 'dte' | 'delta' | 'capitalAmount';

export interface HoldStrikePairDimensionalDifference {
  readonly dimension: HoldStrikePairDimension;
  readonly holdStrikeValue: number;
  readonly conventionalValue: number;
  readonly difference: number;
}

export interface HoldStrikeConventionalPairResult {
  readonly pairable: boolean;
  readonly unpairableReason: 'SNAPSHOT_MISMATCH' | 'AS_OF_MISMATCH' | 'UNDERLYING_MISMATCH' | 'EXECUTION_KIND_MISMATCH' | null;
  readonly differences: readonly HoldStrikePairDimensionalDifference[];
  readonly brokerAuthority: false;
}

/**
 * Compares a Hold-Strike candidate to a Conventional candidate recorded at
 * the SAME snapshot, timestamp, execution evidence class, and underlying
 * only. Reports signed per-dimension differences, never a winner,
 * preference, recommendation, or trading action.
 */
export function pairHoldStrikeWithConventional(
  holdStrike: HoldStrikeCandidateObservation, conventional: HoldStrikeConventionalCandidateFacts,
): HoldStrikeConventionalPairResult {
  if (holdStrike.snapshotId !== conventional.snapshotId) {
    return { pairable: false, unpairableReason: 'SNAPSHOT_MISMATCH', differences: [], brokerAuthority: false };
  }
  if (holdStrike.asOf !== conventional.asOf) {
    return { pairable: false, unpairableReason: 'AS_OF_MISMATCH', differences: [], brokerAuthority: false };
  }
  if (holdStrike.underlying !== conventional.underlying) {
    return { pairable: false, unpairableReason: 'UNDERLYING_MISMATCH', differences: [], brokerAuthority: false };
  }
  if (holdStrike.executionKind !== conventional.executionKind) {
    return { pairable: false, unpairableReason: 'EXECUTION_KIND_MISMATCH', differences: [], brokerAuthority: false };
  }
  const dims: readonly [HoldStrikePairDimension, number | null, number | null][] = [
    ['strike', holdStrike.strike, conventional.strike],
    ['breakEven', holdStrike.breakEven, conventional.breakEven],
    ['premiumPerShare', holdStrike.premiumPerShare, conventional.premiumPerShare],
    ['dte', holdStrike.dte, conventional.dte],
    ['delta', holdStrike.delta, conventional.delta],
    ['capitalAmount', holdStrike.capitalAmount, conventional.capitalAmount],
  ];
  const differences: HoldStrikePairDimensionalDifference[] = [];
  for (const [dimension, holdStrikeValue, conventionalValue] of dims) {
    if (holdStrikeValue === null || conventionalValue === null || !Number.isFinite(holdStrikeValue) || !Number.isFinite(conventionalValue)) continue;
    const difference = holdStrikeValue - conventionalValue;
    if (Number.isFinite(difference)) differences.push({ dimension, holdStrikeValue, conventionalValue, difference });
  }
  return { pairable: true, unpairableReason: null, differences, brokerAuthority: false };
}
