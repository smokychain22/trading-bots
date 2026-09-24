/**
 * R8 common-horizon cross-strategy comparison contract, v3 (hardened).
 * Research-only, `brokerAuthority: false`. Answers a real gap confirmed
 * by direct source reading: `dominates()` in `canonical-strategy-
 * frontier.ts` (Codex-owned, read-only here) never compares candidates
 * across different `branch`/`action` pairs, and ties fall through to
 * `candidateId.localeCompare`. This module does NOT replace or call into
 * that Production comparator.
 *
 * v3 hardening, per direct user governance review of v2's own claims:
 *  - v2's `FULL_RESEARCH_COMPARABLE` state required exactly 4 hardcoded
 *    fields (EV, ES-or-CVaR, capitalDays, uncertainty), which silently
 *    implied those 4 are the WHOLE of "full" economic knowledge -- the
 *    contract also carries `probabilityAssignment`,
 *    `expectedAssignmentBurden`, `expectedRecoveryDuration`,
 *    `maxDrawdown`, `concentrationImpact`, `expectedTca`, which a
 *    specific comparison (e.g. CSP vs. a defined-risk spread, where
 *    assignment/recovery mechanics genuinely differ) may need to be
 *    "full" for THAT comparison. v3 replaces the hardcoded gate with a
 *    versioned `ComparisonProfile` the CALLER supplies -- never a
 *    silent default that could hide which dimensions were actually
 *    required for a given research question.
 *  - v2 silently treated `expectedShortfall ?? cvar` as interchangeable
 *    tail-risk figures. v3 declares ONE canonical tail-risk metric
 *    (`expectedShortfall`, per `canonicalTailRiskMetric`) for every
 *    profile/Pareto computation in this module; `cvar` remains a
 *    distinct field for provenance/observability only and is NEVER
 *    coalesced with `expectedShortfall` anywhere in this module, unless
 *    and until a committed metric catalog explicitly proves the two
 *    fields share the same definition for a given data source.
 *
 * v2 hardening (retained), per the prior review:
 *  - Replaced a single `COMPARABLE` state with a maturity ladder so an
 *    EV-only estimate can never masquerade as full risk-adjusted
 *    superiority -- `highestExpectedPnlCandidateId` (EV-only, explicitly
 *    non-final) and `nonDominatedCandidateIds` (a real Pareto set) are
 *    exposed separately, never collapsed into a single "winner".
 *  - Real common-horizon IDENTITY (`decisionTimestamp`,
 *    `comparisonHorizonStart`, `comparisonHorizonEnd`,
 *    `horizonDefinitionVersion`) plus explicit unit/basis (`basis`,
 *    `quantity`, `currency`) -- a mismatch on any of these is
 *    `NOT_COMPARABLE`, never silently compared as the same unit.
 *  - `structureClass` distinguishes `CASH_SECURED_SINGLE_LEG` (a bare
 *    CSP -- severe but FINITE downside, floor at underlying = 0) from
 *    `STRUCTURALLY_DEFINED_RISK_SPREAD` from
 *    `MARGIN_UNDEFINED_OR_UNBOUNDED_STRUCTURE`, plus
 *    `cashSecuredPutMaxLossAtZero` -- a real, computable maximum
 *    theoretical loss, never conflated with "acceptable real-world tail
 *    risk," which stays a separate, empirical question.
 *  - `validateDeterministicEconomicsForAction` replaces a single
 *    one-size-fits-all validator, since WAIT genuinely has no option
 *    DTE/strikes and must not be forced to fabricate one.
 *
 * v4 hardening, per direct user review of v3's own gaps:
 *  - `probabilityAssignment`/`expectedAssignmentBurden`/
 *    `expectedRecoveryDuration` were plain `number | null`, so `null`
 *    conflated two genuinely different facts: "not yet known" (a bare
 *    CSP's assignment probability that hasn't been modeled yet) and
 *    "this dimension does not apply to this candidate's structure" (a
 *    WAIT candidate, or a defined-risk lifecycle state where the
 *    question is structurally moot). These 3 lifecycle-specific fields
 *    now carry an `EmpiricalDatum<number>` (`KNOWN`/`UNKNOWN`/
 *    `NOT_APPLICABLE`, each with a required reason for the latter two)
 *    instead of a bare nullable number -- see `EmpiricalDatum`.
 *  - `validateComparisonProfile` now checks profile well-formedness
 *    beyond the pareto-subset-of-required rule: nonempty version, no
 *    duplicate dimensions within or across required/optional, every
 *    Pareto dimension has a registered direction, and the canonical
 *    tail metric (`expectedShortfall`) is never silently substituted by
 *    listing `cvar` in its place.
 */

export const crossStrategyCommonHorizonContractVersion = 'theta-cross-strategy-common-horizon-v4' as const;

/**
 * Distinguishes three genuinely different evidence states for a
 * lifecycle-specific dimension -- a bare `null` cannot represent all
 * three without conflating them:
 *  - `KNOWN`: a real, dated value exists.
 *  - `UNKNOWN`: the dimension applies to this candidate, but no
 *    evidence has been gathered/modeled for it yet (a real evidence
 *    gap -- `reason` names why, e.g. `'NOT_YET_MODELED'`).
 *  - `NOT_APPLICABLE`: the dimension does not apply to this candidate's
 *    structure at all (e.g. WAIT has no assignment concept) -- this is
 *    a real, resolved fact, never a data gap.
 */
export type EmpiricalDatum<T> =
  | { readonly status: 'KNOWN'; readonly value: T }
  | { readonly status: 'UNKNOWN'; readonly reason: string }
  | { readonly status: 'NOT_APPLICABLE'; readonly reason: string };

export function knownDatum<T>(value: T): EmpiricalDatum<T> { return { status: 'KNOWN', value }; }
export function unknownDatum<T>(reason: string): EmpiricalDatum<T> { return { status: 'UNKNOWN', reason }; }
export function notApplicableDatum<T>(reason: string): EmpiricalDatum<T> { return { status: 'NOT_APPLICABLE', reason }; }
export function datumValueOrNull<T>(datum: EmpiricalDatum<T>): T | null { return datum.status === 'KNOWN' ? datum.value : null; }

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
 * UNKNOWN -- never a forecast, never fabricated. `maxLoss` is ALLOWED to
 * be populated for a `CASH_SECURED_SINGLE_LEG` structure (via
 * `cashSecuredPutMaxLossAtZero` or an equivalent real computation the
 * caller supplies). It remains `null` for a genuinely
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
 * real, dated evidence populates it. `expectedShortfall` is the ONE
 * canonical tail-risk figure this module compares/ranks on (see
 * `canonicalTailRiskMetric`). `cvar` is retained purely for provenance/
 * observability -- e.g. a canonical export may carry a CVaR figure from
 * an upstream model -- and MUST NEVER be coalesced with
 * `expectedShortfall` (`expectedShortfall ?? cvar`) anywhere in this
 * module or a consumer of it, unless a committed metric catalog entry
 * explicitly proves the two are the same definition for that data
 * source.
 */
export interface EmpiricalForwardEconomics {
  readonly expectedAfterCostWholeChainPnl: number | null;
  readonly probabilityProfitable: number | null;
  /** `EmpiricalDatum`, not a bare nullable number -- see the v4 doc
   * comment above. `NOT_APPLICABLE` for e.g. WAIT (no position exists to
   * be assigned); `UNKNOWN` for a real candidate whose assignment
   * probability has not yet been modeled. */
  readonly probabilityAssignment: EmpiricalDatum<number>;
  readonly expectedAssignmentBurden: EmpiricalDatum<number>;
  readonly expectedRecoveryDuration: EmpiricalDatum<number>;
  readonly expectedCapitalDays: number | null;
  readonly expectedShortfall: number | null;
  readonly cvar: number | null;
  readonly maxDrawdown: number | null;
  readonly concentrationImpact: number | null;
  readonly expectedTca: number | null;
  readonly calibratedUncertainty: number | null;
}

export type EmpiricalDimensionKey = keyof EmpiricalForwardEconomics;

export type TailRiskMetric = 'EXPECTED_SHORTFALL';
/** The ONE canonical tail-risk convention every `ComparisonProfile` and
 * Pareto computation in this module uses. `cvar` is a separate,
 * non-canonical field -- see the doc comment on `EmpiricalForwardEconomics`. */
export const canonicalTailRiskMetric: TailRiskMetric = 'EXPECTED_SHORTFALL';

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
  readonly probabilityAssignment: EmpiricalDatum<number>;
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
  readonly expectedRecoveryDuration: EmpiricalDatum<number>;
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

/**
 * A versioned declaration of which `EmpiricalForwardEconomics`
 * dimensions a SPECIFIC research comparison actually needs, so
 * `FULL_RESEARCH_COMPARABLE`/`PROFILE_COMPARABLE` never silently implies
 * universally complete economic knowledge -- it means "complete for
 * THIS named, versioned profile." `paretoDimensions` MUST be a subset of
 * `requiredDimensions` (enforced by `validateComparisonProfile`): the
 * Pareto set is never computed over a dimension whose completeness was
 * never actually required.
 */
export interface ComparisonProfile {
  readonly profileVersion: string;
  readonly requiredDimensions: readonly EmpiricalDimensionKey[];
  readonly optionalDimensions: readonly EmpiricalDimensionKey[];
  readonly paretoDimensions: readonly EmpiricalDimensionKey[];
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * A9/A10 hardening: beyond "Pareto dimensions are a subset of required
 * dimensions," a well-formed profile also needs a nonempty version, no
 * duplicate entries within or across `requiredDimensions`/
 * `optionalDimensions`, a registered Pareto direction for every Pareto
 * dimension, and must never list `cvar` where the canonical tail metric
 * (`expectedShortfall`) belongs -- a profile author swapping the two
 * would silently reintroduce the v2 `es ?? cvar` conflation this
 * contract was hardened against.
 */
export function validateComparisonProfile(profile: ComparisonProfile): boolean {
  if (profile.profileVersion.trim().length === 0) return false;
  if (hasDuplicates(profile.requiredDimensions) || hasDuplicates(profile.optionalDimensions)) return false;
  if (profile.requiredDimensions.some((d) => profile.optionalDimensions.includes(d))) return false;
  if (!profile.paretoDimensions.every((d) => profile.requiredDimensions.includes(d))) return false;
  if (!profile.paretoDimensions.every((d) => DIMENSION_DIRECTION[d] !== undefined)) return false;
  if (profile.paretoDimensions.includes('cvar')) return false;
  return true;
}

/**
 * The core risk-adjusted profile: EV, the one canonical tail-risk
 * figure, capital-days burden, and calibrated uncertainty. Suitable for
 * a same-structure-family comparison where assignment/recovery
 * mechanics are not expected to differ materially between candidates.
 */
export const ENTRY_CORE_RISK_V1: ComparisonProfile = {
  profileVersion: 'theta-comparison-profile-entry-core-risk-v1',
  requiredDimensions: ['expectedAfterCostWholeChainPnl', 'expectedShortfall', 'expectedCapitalDays', 'calibratedUncertainty'],
  optionalDimensions: [
    'probabilityProfitable', 'maxDrawdown', 'concentrationImpact',
    'probabilityAssignment', 'expectedAssignmentBurden', 'expectedRecoveryDuration', 'expectedTca',
  ],
  paretoDimensions: ['expectedAfterCostWholeChainPnl', 'expectedShortfall', 'expectedCapitalDays', 'calibratedUncertainty'],
};

/**
 * The whole-chain profile: everything `ENTRY_CORE_RISK_V1` requires,
 * PLUS assignment probability/burden, recovery duration, and execution
 * cost -- dimensions that a cross-STRUCTURE comparison (e.g. a bare CSP
 * vs. a defined-risk spread, whose assignment/recovery mechanics
 * genuinely differ) needs known before it can honestly claim to be
 * "full" for that comparison. `probabilityAssignment` and
 * `expectedAssignmentBurden` are required EVIDENCE here, not Pareto
 * dimensions -- this module makes no claim that lower assignment
 * probability is "better" (assignment is a modeled lifecycle
 * transition, not automatic failure), so they are deliberately excluded
 * from `paretoDimensions`.
 */
export const ENTRY_WHOLE_CHAIN_V1: ComparisonProfile = {
  profileVersion: 'theta-comparison-profile-entry-whole-chain-v1',
  requiredDimensions: [
    'expectedAfterCostWholeChainPnl', 'expectedShortfall', 'expectedCapitalDays', 'calibratedUncertainty',
    'probabilityAssignment', 'expectedAssignmentBurden', 'expectedRecoveryDuration', 'expectedTca',
  ],
  optionalDimensions: ['probabilityProfitable', 'maxDrawdown', 'concentrationImpact'],
  paretoDimensions: ['expectedAfterCostWholeChainPnl', 'expectedShortfall', 'expectedCapitalDays', 'calibratedUncertainty', 'expectedTca'],
};

export type ComparisonState =
  | 'NOT_COMPARABLE' | 'STRUCTURAL_ONLY' | 'EV_COMPARABLE_ONLY' | 'PROFILE_NOT_READY' | 'FULL_RESEARCH_COMPARABLE';

export type ProfileReadiness = 'NOT_EVALUATED' | 'PROFILE_COMPARABLE' | 'PROFILE_NOT_READY';

export interface CrossStrategyComparisonResult {
  readonly state: ComparisonState;
  readonly reason: string;
  readonly candidateIds: readonly string[];
  readonly profileVersion: string;
  readonly profileReadiness: ProfileReadiness;
  /** The candidate with the highest `expectedAfterCostWholeChainPnl`
   * among those with a KNOWN EV -- an EV-ONLY observation, populated
   * whenever `state` is `EV_COMPARABLE_ONLY` or more mature. NEVER a
   * final risk-adjusted verdict; callers must not treat this as "the
   * winner." */
  readonly highestExpectedPnlCandidateId: string | null;
  /** Candidates not dominated by any other candidate across the
   * SUPPLIED profile's `paretoDimensions` -- computed ONLY at
   * `FULL_RESEARCH_COMPARABLE` (every candidate satisfies every
   * `requiredDimensions` entry of the supplied profile). Multiple
   * non-dominated candidates, or all of them, is a real, honest research
   * finding, never collapsed into one winner. */
  readonly nonDominatedCandidateIds: readonly string[];
  readonly missingRequiredDimensions: readonly EmpiricalDimensionKey[];
  readonly availableOptionalDimensions: readonly EmpiricalDimensionKey[];
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

/** True for a plain known number, or a datum whose status is `KNOWN`
 * or `NOT_APPLICABLE` -- both are real, resolved facts. `UNKNOWN`
 * (a real evidence gap) and bare `null` are the only "not satisfied"
 * states. */
function isDimensionSatisfied(value: number | EmpiricalDatum<number> | null): boolean {
  if (value === null) return false;
  if (typeof value === 'object') return value.status === 'NOT_APPLICABLE'
    ? value.reason.trim().length > 0 : value.status === 'KNOWN' && Number.isFinite(value.value);
  return Number.isFinite(value);
}

function hasAnyEmpiricalField(e: EmpiricalForwardEconomics): boolean {
  const keys = Object.keys(e) as EmpiricalDimensionKey[];
  return keys.some((k) => isDimensionSatisfied(e[k]));
}

/** Every dimension the Pareto set is EVER allowed to use must have a
 * known, defensible direction here. A profile whose `paretoDimensions`
 * names a field without a registered direction fails loudly (see
 * `paretoVectorForProfile`) rather than silently guessing a direction --
 * e.g. this module deliberately registers no direction for
 * `probabilityAssignment`, since assignment is not automatic failure. */
const DIMENSION_DIRECTION: Partial<Record<EmpiricalDimensionKey, 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER'>> = {
  expectedAfterCostWholeChainPnl: 'HIGHER_IS_BETTER',
  expectedShortfall: 'HIGHER_IS_BETTER', // less-negative shortfall is better
  expectedCapitalDays: 'LOWER_IS_BETTER',
  calibratedUncertainty: 'LOWER_IS_BETTER',
  expectedTca: 'LOWER_IS_BETTER',
};

function evaluateProfileReadiness(
  candidates: readonly CandidateComparisonInput[], profile: ComparisonProfile,
): { readiness: 'PROFILE_COMPARABLE' | 'PROFILE_NOT_READY'; missingRequiredDimensions: readonly EmpiricalDimensionKey[]; availableOptionalDimensions: readonly EmpiricalDimensionKey[] } {
  const missing = new Set<EmpiricalDimensionKey>();
  for (const dim of profile.requiredDimensions) {
    if (candidates.some((c) => !isDimensionSatisfied(c.empirical[dim]))) missing.add(dim);
  }
  const availableOptionalDimensions = profile.optionalDimensions.filter((dim) => candidates.every((c) => isDimensionSatisfied(c.empirical[dim])));
  return {
    readiness: missing.size === 0 ? 'PROFILE_COMPARABLE' : 'PROFILE_NOT_READY',
    missingRequiredDimensions: [...missing], availableOptionalDimensions,
  };
}

function paretoVectorForProfile(e: EmpiricalForwardEconomics, dims: readonly EmpiricalDimensionKey[]): readonly number[] {
  return dims.map((dim) => {
    const direction = DIMENSION_DIRECTION[dim];
    if (direction === undefined) throw new Error(`COMPARISON_PROFILE_DIMENSION_DIRECTION_UNDEFINED:${dim}`);
    const value = e[dim] as number; // caller (compareCrossStrategy) only invokes this once every required dim is confirmed non-null
    return direction === 'HIGHER_IS_BETTER' ? value : -value;
  });
}

function dominatesAllDimensions(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, i) => value >= (b[i] as number)) && a.some((value, i) => value > (b[i] as number));
}

function computeNonDominated(candidates: readonly CandidateComparisonInput[], paretoDimensions: readonly EmpiricalDimensionKey[]): readonly string[] {
  const vectors = candidates.map((c) => ({ id: c.candidateId, vector: paretoVectorForProfile(c.empirical, paretoDimensions) }));
  return vectors.filter((candidate) => !vectors.some((other) => other.id !== candidate.id && dominatesAllDimensions(other.vector, candidate.vector)))
    .map((c) => c.id);
}

/**
 * Compares 0..N candidates that MUST share the same `ComparisonContext`
 * (horizon identity, basis, currency) -- a mismatch is `NOT_COMPARABLE`
 * before anything else is even inspected. `profile` is REQUIRED and
 * caller-supplied -- this module never defaults to one profile silently,
 * since which dimensions are "required for full comparability" is
 * itself a research decision the caller must make explicitly (see
 * `ENTRY_CORE_RISK_V1`/`ENTRY_WHOLE_CHAIN_V1`).
 */
export function compareCrossStrategy(
  candidates: readonly CandidateComparisonInput[], profile: ComparisonProfile,
): CrossStrategyComparisonResult {
  if (!validateComparisonProfile(profile)) {
    throw new Error(`COMPARISON_PROFILE_INVALID_PARETO_DIMENSIONS_NOT_SUBSET_OF_REQUIRED:${profile.profileVersion}`);
  }
  const candidateIds = candidates.map((c) => c.candidateId);
  const empty = {
    profileVersion: profile.profileVersion, profileReadiness: 'NOT_EVALUATED' as const,
    highestExpectedPnlCandidateId: null, nonDominatedCandidateIds: [] as const,
    missingRequiredDimensions: [] as const, availableOptionalDimensions: [] as const,
  };

  if (candidates.length === 0) {
    return { state: 'NOT_COMPARABLE', reason: 'NO_CANDIDATES', candidateIds, ...empty };
  }
  if (new Set(candidateIds).size !== candidateIds.length || candidates.some((c) => !c.candidateId.trim()
    || !Number.isFinite(c.quantity) || (c.deterministic.action === 'WAIT' ? c.quantity !== 0 : c.quantity <= 0))) {
    return { state: 'NOT_COMPARABLE', reason: 'INVALID_CANDIDATE_IDENTITY_OR_QUANTITY', candidateIds, ...empty };
  }
  const positionedCandidates = candidates.filter((c) => c.deterministic.action !== 'WAIT');
  if (positionedCandidates.some((c) => c.quantity !== positionedCandidates[0]?.quantity)) {
    return { state: 'NOT_COMPARABLE', reason: 'COMPARISON_QUANTITY_MISMATCH', candidateIds, ...empty };
  }
  if (candidates.some((c) => Object.values(c.deterministic).some((v) => typeof v === 'number' && !Number.isFinite(v))
    || Object.values(c.empirical).some((v) => typeof v === 'number' && !Number.isFinite(v)
      || v !== null && typeof v === 'object' && v.status === 'KNOWN' && !Number.isFinite(v.value)))) {
    return { state: 'NOT_COMPARABLE', reason: 'NON_FINITE_ECONOMICS', candidateIds, ...empty };
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
    const { missingRequiredDimensions, availableOptionalDimensions } = evaluateProfileReadiness(candidates, profile);
    return {
      state: 'EV_COMPARABLE_ONLY', reason: 'MISSING_EMPIRICAL_ECONOMICS', candidateIds,
      profileVersion: profile.profileVersion, profileReadiness: 'PROFILE_NOT_READY',
      highestExpectedPnlCandidateId, nonDominatedCandidateIds: [], missingRequiredDimensions, availableOptionalDimensions,
    };
  }

  const { readiness, missingRequiredDimensions, availableOptionalDimensions } = evaluateProfileReadiness(candidates, profile);
  if (readiness === 'PROFILE_NOT_READY') {
    return {
      state: 'PROFILE_NOT_READY', reason: 'PROFILE_REQUIRED_DIMENSIONS_INCOMPLETE', candidateIds,
      profileVersion: profile.profileVersion, profileReadiness: readiness,
      highestExpectedPnlCandidateId, nonDominatedCandidateIds: [], missingRequiredDimensions, availableOptionalDimensions,
    };
  }

  return {
    state: 'FULL_RESEARCH_COMPARABLE', reason: 'PROFILE_REQUIRED_DIMENSIONS_SATISFIED', candidateIds,
    profileVersion: profile.profileVersion, profileReadiness: readiness,
    highestExpectedPnlCandidateId, nonDominatedCandidateIds: computeNonDominated(candidates, profile.paretoDimensions),
    missingRequiredDimensions: [], availableOptionalDimensions,
  };
}
