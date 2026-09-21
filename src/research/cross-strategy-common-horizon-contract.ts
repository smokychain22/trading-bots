/**
 * R8 common-horizon cross-strategy comparison contract, v2 (hardened).
 * Research-only, `brokerAuthority: false`. Answers a real gap confirmed
 * by direct source reading: `dominates()` in `canonical-strategy-
 * frontier.ts` (Codex-owned, read-only here) never compares candidates
 * across different `branch`/`action` pairs, and ties fall through to
 * `candidateId.localeCompare`. This module does NOT replace or call into
 * that Production comparator.
 *
 * v2 hardening, per direct user review of v1's own claims:
 *  - v1's `COMPARABLE` state let a single known EV number stand in for
 *    "final risk-adjusted economic winner." v2 replaces it with a
 *    5-state maturity ladder (`STRUCTURAL_ONLY` -> `EV_COMPARABLE_ONLY`
 *    -> `RISK_ADJUSTED_NOT_READY` -> `FULL_RESEARCH_COMPARABLE`, plus
 *    `NOT_COMPARABLE`) and NEVER manufactures a single "winner" even at
 *    the most mature state -- it exposes `highestExpectedPnlCandidateId`
 *    (an EV-only observation, explicitly not a final verdict) and
 *    `nonDominatedCandidateIds` (a real Pareto set across EV/ES-or-CVaR/
 *    capitalDays/uncertainty, computed only once every candidate's risk
 *    data is complete) separately, so neither can be mistaken for the
 *    other.
 *  - Adds real common-horizon IDENTITY (`decisionTimestamp`,
 *    `comparisonHorizonStart`, `comparisonHorizonEnd`,
 *    `horizonDefinitionVersion`) -- candidates whose horizon identity
 *    differs are `NOT_COMPARABLE`, never silently compared as if the
 *    module's NAME alone made them comparable.
 *  - Adds explicit unit/basis (`basis`, `quantity`, `currency`) --
 *    candidates on different bases (e.g. per-contract vs. per-position)
 *    or currencies are `NOT_COMPARABLE`, never silently compared as
 *    though the numbers were the same unit.
 *  - Adds `structureClass` distinguishing `CASH_SECURED_SINGLE_LEG`
 *    (a bare CSP -- severe but FINITE downside, since the underlying
 *    floor is zero) from `STRUCTURALLY_DEFINED_RISK_SPREAD` (a real
 *    defined-risk structure) from `MARGIN_UNDEFINED_OR_UNBOUNDED_STRUCTURE`,
 *    plus `cashSecuredPutMaxLossAtZero` -- a real, computable maximum
 *    theoretical loss for a CSP, never conflated with "acceptable
 *    real-world tail risk," which stays a separate, empirical question.
 *  - Replaces the single `hasCompleteDeterministicEconomics` check with
 *    `validateDeterministicEconomicsForAction`, since WAIT genuinely has
 *    no option DTE/strikes and must not be forced to fabricate one just
 *    to pass validation.
 */

export const crossStrategyCommonHorizonContractVersion = 'theta-cross-strategy-common-horizon-v2' as const;

export type ComparisonBasis = 'PER_CONTRACT' | 'PER_POSITION' | 'PER_DOLLAR_CAPITAL' | 'PER_ACCOUNT';

/** The real horizon/comparability identity two candidates must SHARE
 * before any comparison is valid. Two candidates from the same decision
 * moment on paper but a different `horizonDefinitionVersion` (e.g. one
 * evaluated under a 60-day horizon protocol, one under a 90-day one) are
 * NOT comparable, regardless of how similar their numbers look. */
export interface ComparisonContext {
  readonly decisionTimestamp: string;
  readonly comparisonHorizonStart: string;
  readonly comparisonHorizonEnd: string;
  readonly horizonDefinitionVersion: string;
  readonly basis: ComparisonBasis;
  readonly currency: string;
}

export function sameComparisonContext(a: ComparisonContext, b: ComparisonContext): boolean {
  return a.decisionTimestamp === b.decisionTimestamp && a.comparisonHorizonStart === b.comparisonHorizonStart
    && a.comparisonHorizonEnd === b.comparisonHorizonEnd && a.horizonDefinitionVersion === b.horizonDefinitionVersion
    && a.basis === b.basis && a.currency === b.currency;
}

export type StructureClass =
  | 'STRUCTURALLY_DEFINED_RISK_SPREAD' | 'CASH_SECURED_SINGLE_LEG' | 'MARGIN_UNDEFINED_OR_UNBOUNDED_STRUCTURE'
  /** No position at all -- WAIT. Deliberately distinct from
   * `MARGIN_UNDEFINED_OR_UNBOUNDED_STRUCTURE`: WAIT's risk is not
   * "unbounded and unknown," it is a real, known, provably zero. */
  | 'NO_STRUCTURE';

/**
 * The theoretical maximum dollar loss for a cash-secured put if the
 * underlying fell to exactly zero: `(strike - premiumReceivedPerShare) *
 * multiplier * quantity`. This is a real, finite, computable number for
 * a genuinely cash-secured structure -- NEVER a claim about the
 * probability or acceptability of that outcome, which remains a
 * completely separate empirical question this function makes no
 * statement about. Returns `null` (never a fabricated figure) if any
 * input is missing or non-finite.
 */
export function cashSecuredPutMaxLossAtZero(
  strike: number | null, premiumReceivedPerShare: number | null, multiplier: number | null, quantity: number | null,
): number | null {
  if (strike === null || premiumReceivedPerShare === null || multiplier === null || quantity === null) return null;
  if (!Number.isFinite(strike) || !Number.isFinite(premiumReceivedPerShare) || !Number.isFinite(multiplier) || !Number.isFinite(quantity)) return null;
  return Math.max(0, strike - premiumReceivedPerShare) * multiplier * quantity;
}

/**
 * Every field here is a KNOWN fact at decision time or an honestly-null
 * UNKNOWN -- never a forecast, never fabricated. `maxLoss` is now
 * ALLOWED to be populated for a `CASH_SECURED_SINGLE_LEG` structure
 * (via `cashSecuredPutMaxLossAtZero` or an equivalent real computation
 * the caller supplies) -- it is no longer forced `null` merely because
 * the structure is single-leg. It remains `null` for a genuinely
 * `MARGIN_UNDEFINED_OR_UNBOUNDED_STRUCTURE` structure, since no finite
 * figure exists to report there.
 */
export interface DeterministicEntryEconomics {
  readonly action: string;
  readonly strategy: string;
  readonly underlying: string;
  readonly structureClass: StructureClass;
  readonly contractIdentities: readonly string[];
  readonly dte: number | null;
  readonly strikes: readonly number[];
  readonly executableOpenCreditDebit: number | null;
  readonly multiplier: number | null;
  readonly collateral: number | null;
  readonly buyingPowerImpact: number | null;
  readonly maxLoss: number | null;
  readonly breakEven: number | null;
  readonly downsideCushion: number | null;
  /** Strike-width of a defined-risk spread; `null` for a single-leg
   * structure (never `0` -- zero would falsely claim a real, measured
   * zero-width spread). */
  readonly width: number | null;
  readonly bidAskSpread: number | null;
  readonly estimatedEntryExecutionCost: number | null;
  readonly capitalRequirement: number | null;
}

/**
 * Every field defaults to `null` (UNKNOWN) and MUST remain `null` until
 * real, dated evidence populates it. `maxDrawdown`/`concentrationImpact`
 * added in v2 -- both directive-requested empirical dimensions this v1
 * contract omitted.
 */
export interface EmpiricalForwardEconomics {
  readonly expectedAfterCostWholeChainPnl: number | null;
  readonly probabilityProfitable: number | null;
  readonly probabilityAssignment: number | null;
  readonly expectedAssignmentBurden: number | null;
  readonly expectedRecoveryDuration: number | null;
  readonly expectedCapitalDays: number | null;
  readonly expectedShortfall: number | null;
  readonly cvar: number | null;
  readonly maxDrawdown: number | null;
  readonly concentrationImpact: number | null;
  readonly expectedTca: number | null;
  readonly calibratedUncertainty: number | null;
}

export interface CandidateComparisonInput {
  readonly candidateId: string;
  readonly context: ComparisonContext;
  readonly quantity: number;
  readonly deterministic: DeterministicEntryEconomics;
  readonly empirical: EmpiricalForwardEconomics;
}

export interface RiskBurdenView {
  readonly candidateId: string;
  readonly maxLoss: number | null;
  readonly downsideCushion: number | null;
  readonly probabilityAssignment: number | null;
  readonly expectedShortfall: number | null;
  readonly cvar: number | null;
  readonly maxDrawdown: number | null;
}
export function riskBurdenView(input: CandidateComparisonInput): RiskBurdenView {
  return {
    candidateId: input.candidateId, maxLoss: input.deterministic.maxLoss,
    downsideCushion: input.deterministic.downsideCushion,
    probabilityAssignment: input.empirical.probabilityAssignment,
    expectedShortfall: input.empirical.expectedShortfall, cvar: input.empirical.cvar,
    maxDrawdown: input.empirical.maxDrawdown,
  };
}

export interface CapitalBurdenView {
  readonly candidateId: string;
  readonly collateral: number | null;
  readonly buyingPowerImpact: number | null;
  readonly capitalRequirement: number | null;
  readonly expectedCapitalDays: number | null;
  readonly expectedRecoveryDuration: number | null;
}
export function capitalBurdenView(input: CandidateComparisonInput): CapitalBurdenView {
  return {
    candidateId: input.candidateId, collateral: input.deterministic.collateral,
    buyingPowerImpact: input.deterministic.buyingPowerImpact,
    capitalRequirement: input.deterministic.capitalRequirement,
    expectedCapitalDays: input.empirical.expectedCapitalDays,
    expectedRecoveryDuration: input.empirical.expectedRecoveryDuration,
  };
}

export interface ExecutionBurdenView {
  readonly candidateId: string;
  readonly bidAskSpread: number | null;
  readonly estimatedEntryExecutionCost: number | null;
  readonly expectedTca: number | null;
}
export function executionBurdenView(input: CandidateComparisonInput): ExecutionBurdenView {
  return {
    candidateId: input.candidateId, bidAskSpread: input.deterministic.bidAskSpread,
    estimatedEntryExecutionCost: input.deterministic.estimatedEntryExecutionCost,
    expectedTca: input.empirical.expectedTca,
  };
}

export interface UncertaintyView {
  readonly candidateId: string;
  readonly calibratedUncertainty: number | null;
  readonly probabilityProfitable: number | null;
}
export function uncertaintyView(input: CandidateComparisonInput): UncertaintyView {
  return {
    candidateId: input.candidateId, calibratedUncertainty: input.empirical.calibratedUncertainty,
    probabilityProfitable: input.empirical.probabilityProfitable,
  };
}

export type ComparisonState =
  | 'NOT_COMPARABLE' | 'STRUCTURAL_ONLY' | 'EV_COMPARABLE_ONLY' | 'RISK_ADJUSTED_NOT_READY' | 'FULL_RESEARCH_COMPARABLE';

export interface CrossStrategyComparisonResult {
  readonly state: ComparisonState;
  readonly reason: string;
  readonly candidateIds: readonly string[];
  /** The candidate with the highest `expectedAfterCostWholeChainPnl`
   * among those with a KNOWN EV -- an EV-ONLY observation, populated
   * whenever `state` is `EV_COMPARABLE_ONLY` or more mature. NEVER a
   * final risk-adjusted verdict; callers must not treat this as "the
   * winner." */
  readonly highestExpectedPnlCandidateId: string | null;
  /** Candidates not dominated by any other candidate across EV (max),
   * ES-or-CVaR (max, i.e. least negative), capitalDays (min), and
   * calibratedUncertainty (min) -- computed ONLY at
   * `FULL_RESEARCH_COMPARABLE` (every candidate's risk data complete).
   * Multiple non-dominated candidates, or all of them, is a real,
   * honest research finding, never collapsed into one winner. */
  readonly nonDominatedCandidateIds: readonly string[];
  readonly missingComparisonDimensions: readonly string[];
}

/**
 * WAIT has no option DTE, strikes, or contract identity -- it must not
 * be forced to fabricate `dte = 0`/`strikes = []` merely to satisfy a
 * one-size-fits-all validator. Each action declares what IT semantically
 * requires; a caller adding a new action type must extend this function
 * explicitly rather than fall through to an unvalidated default.
 */
export function validateDeterministicEconomicsForAction(action: string, d: DeterministicEntryEconomics): boolean {
  if (action === 'WAIT') {
    return d.executableOpenCreditDebit === 0 && d.collateral === 0 && d.capitalRequirement === 0;
  }
  const hasCoreFields = d.executableOpenCreditDebit !== null && d.collateral !== null
    && d.capitalRequirement !== null && d.dte !== null && d.contractIdentities.length > 0;
  if (action === 'OPEN_DEFINED_RISK') return hasCoreFields && d.width !== null;
  return hasCoreFields; // OPEN_CSP and other single-leg option-entry actions
}

const RISK_FIELD_NAMES = ['expectedShortfall', 'cvar', 'expectedCapitalDays', 'calibratedUncertainty'] as const;

function hasAnyEmpiricalField(e: EmpiricalForwardEconomics): boolean {
  return e.expectedAfterCostWholeChainPnl !== null || RISK_FIELD_NAMES.some((f) => e[f] !== null)
    || e.probabilityProfitable !== null || e.probabilityAssignment !== null || e.expectedAssignmentBurden !== null
    || e.expectedRecoveryDuration !== null || e.maxDrawdown !== null || e.concentrationImpact !== null || e.expectedTca !== null;
}

function hasFullRiskAdjustedEconomics(e: EmpiricalForwardEconomics): boolean {
  const hasEsOrCvar = e.expectedShortfall !== null || e.cvar !== null;
  return e.expectedAfterCostWholeChainPnl !== null && hasEsOrCvar
    && e.expectedCapitalDays !== null && e.calibratedUncertainty !== null;
}

function missingRiskDimensions(e: EmpiricalForwardEconomics): readonly string[] {
  const missing: string[] = [];
  if (e.expectedAfterCostWholeChainPnl === null) missing.push('expectedAfterCostWholeChainPnl');
  if (e.expectedShortfall === null && e.cvar === null) missing.push('expectedShortfall_or_cvar');
  if (e.expectedCapitalDays === null) missing.push('expectedCapitalDays');
  if (e.calibratedUncertainty === null) missing.push('calibratedUncertainty');
  return missing;
}

/** Higher-is-better direction for every dimension the Pareto set uses:
 * EV higher is better; ES/CVaR less-negative (higher) is better;
 * capitalDays LOWER is better (negated here); uncertainty LOWER is
 * better (negated here) -- so every value below is oriented "higher = better"
 * before comparison. */
function paretoVector(e: EmpiricalForwardEconomics): readonly number[] {
  const esOrCvar = (e.expectedShortfall ?? e.cvar) as number;
  return [e.expectedAfterCostWholeChainPnl as number, esOrCvar, -(e.expectedCapitalDays as number), -(e.calibratedUncertainty as number)];
}

function dominatesAllDimensions(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, i) => value >= (b[i] as number)) && a.some((value, i) => value > (b[i] as number));
}

function computeNonDominated(candidates: readonly CandidateComparisonInput[]): readonly string[] {
  const vectors = candidates.map((c) => ({ id: c.candidateId, vector: paretoVector(c.empirical) }));
  return vectors.filter((candidate) => !vectors.some((other) => other.id !== candidate.id && dominatesAllDimensions(other.vector, candidate.vector)))
    .map((c) => c.id);
}

/**
 * Compares 0..N candidates that MUST share the same `ComparisonContext`
 * (horizon identity, basis, currency) -- a mismatch is `NOT_COMPARABLE`
 * before anything else is even inspected, per the v2 hardening.
 */
export function compareCrossStrategy(candidates: readonly CandidateComparisonInput[]): CrossStrategyComparisonResult {
  const candidateIds = candidates.map((c) => c.candidateId);
  const empty = { highestExpectedPnlCandidateId: null, nonDominatedCandidateIds: [], missingComparisonDimensions: [] };

  if (candidates.length === 0) {
    return { state: 'NOT_COMPARABLE', reason: 'NO_CANDIDATES', candidateIds, ...empty };
  }
  const firstContext = candidates[0]?.context as ComparisonContext;
  if (!candidates.every((c) => sameComparisonContext(c.context, firstContext))) {
    return { state: 'NOT_COMPARABLE', reason: 'COMPARISON_CONTEXT_MISMATCH', candidateIds, ...empty };
  }
  if (!candidates.every((c) => validateDeterministicEconomicsForAction(c.deterministic.action, c.deterministic))) {
    return { state: 'NOT_COMPARABLE', reason: 'DETERMINISTIC_ECONOMICS_INCOMPLETE', candidateIds, ...empty };
  }
  if (candidates.length === 1) {
    return { state: 'STRUCTURAL_ONLY', reason: 'SINGLE_CANDIDATE_NO_PEER', candidateIds, ...empty };
  }
  if (!candidates.some((c) => hasAnyEmpiricalField(c.empirical))) {
    return { state: 'STRUCTURAL_ONLY', reason: 'NO_EMPIRICAL_EVIDENCE_FOR_ANY_CANDIDATE', candidateIds, ...empty };
  }

  const allHaveEv = candidates.every((c) => c.empirical.expectedAfterCostWholeChainPnl !== null);
  const evCandidates = candidates.filter((c) => c.empirical.expectedAfterCostWholeChainPnl !== null);
  const highestExpectedPnlCandidateId = evCandidates.length === 0 ? null
    : evCandidates.reduce((best, c) => (c.empirical.expectedAfterCostWholeChainPnl as number) > (best.empirical.expectedAfterCostWholeChainPnl as number) ? c : best).candidateId;

  if (!allHaveEv) {
    const missing = [...new Set(candidates.flatMap((c) => missingRiskDimensions(c.empirical)))];
    return { state: 'EV_COMPARABLE_ONLY', reason: 'MISSING_EMPIRICAL_ECONOMICS', candidateIds, highestExpectedPnlCandidateId, nonDominatedCandidateIds: [], missingComparisonDimensions: missing };
  }

  const allHaveFullRisk = candidates.every((c) => hasFullRiskAdjustedEconomics(c.empirical));
  if (!allHaveFullRisk) {
    const missing = [...new Set(candidates.flatMap((c) => missingRiskDimensions(c.empirical)))];
    return { state: 'RISK_ADJUSTED_NOT_READY', reason: 'PARTIAL_RISK_ECONOMICS', candidateIds, highestExpectedPnlCandidateId, nonDominatedCandidateIds: [], missingComparisonDimensions: missing };
  }

  return {
    state: 'FULL_RESEARCH_COMPARABLE', reason: 'FULL_EMPIRICAL_ECONOMICS_AVAILABLE', candidateIds,
    highestExpectedPnlCandidateId, nonDominatedCandidateIds: computeNonDominated(candidates), missingComparisonDimensions: [],
  };
}
