/**
 * R8 common-horizon cross-strategy comparison contract (directive
 * priority #1). Research-only, `brokerAuthority: false`. Answers a real
 * gap confirmed this session by direct source reading: `dominates()` in
 * `canonical-strategy-frontier.ts` (Codex-owned, read-only here) never
 * compares candidates across different `branch`/`action` pairs, and ties
 * fall through to `candidateId.localeCompare` -- alphabetical branch-name
 * ordering deciding "economic superiority" that was never actually
 * computed. This module does NOT replace or call into that Production
 * comparator; it is a separate, versioned research contract for when
 * real empirical evidence exists to compare across strategies honestly.
 *
 * The directive's six requested categories (DETERMINISTIC_ENTRY_ECONOMICS,
 * EMPIRICAL_FORWARD_ECONOMICS, RISK_BURDEN, CAPITAL_BURDEN,
 * EXECUTION_BURDEN, UNCERTAINTY) are represented as: two SOURCE-OF-TRUTH
 * interfaces (`DeterministicEntryEconomics`, `EmpiricalForwardEconomics`)
 * holding every real field exactly once, plus four DERIVED VIEW
 * functions (`riskBurdenView`, `capitalBurdenView`, `executionBurdenView`,
 * `uncertaintyView`) that project a subset of those same fields into each
 * named lens -- never a duplicated field with two independent values for
 * the same fact.
 */

export const crossStrategyCommonHorizonContractVersion = 'theta-cross-strategy-common-horizon-v1' as const;

/**
 * Every field here is a KNOWN fact at decision time or an honestly-null
 * UNKNOWN -- never a forecast, never a probability, never fabricated.
 * `maxLoss` stays `null` for an undefined-risk structure (a bare CSP) --
 * this module never invents a "collateral minus premium" max-loss figure
 * internally; if a caller wants that reported, it supplies it explicitly
 * and labeled as such. `contractIdentities`/`strikes` are arrays because
 * a multi-leg structure (Defined Risk) has more than one.
 */
export interface DeterministicEntryEconomics {
  readonly action: string;
  readonly strategy: string;
  readonly underlying: string;
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
 * real, dated evidence populates it -- this module never invents a
 * placeholder EV to break a tie. `calibratedUncertainty` is a generic
 * dispersion/interval-width figure (e.g. a standard error or CI half-
 * width on `expectedAfterCostWholeChainPnl`); its exact statistical
 * definition is the caller's responsibility to document per use, this
 * contract only reserves the field.
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
  readonly expectedTca: number | null;
  readonly calibratedUncertainty: number | null;
}

export interface CandidateComparisonInput {
  readonly candidateId: string;
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
}
export function riskBurdenView(input: CandidateComparisonInput): RiskBurdenView {
  return {
    candidateId: input.candidateId, maxLoss: input.deterministic.maxLoss,
    downsideCushion: input.deterministic.downsideCushion,
    probabilityAssignment: input.empirical.probabilityAssignment,
    expectedShortfall: input.empirical.expectedShortfall, cvar: input.empirical.cvar,
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
  | 'COMPARABLE' | 'STRUCTURALLY_COMPARABLE_ONLY' | 'EMPIRICAL_ECONOMICS_UNKNOWN' | 'CROSS_STRATEGY_NOT_COMPARABLE';

export interface CrossStrategyComparisonResult {
  readonly state: ComparisonState;
  readonly reason: string;
  /** Set ONLY when `state === 'COMPARABLE'` -- a real economic winner was
   * determined from complete empirical evidence on every candidate. Every
   * other state leaves this `null`, regardless of how tempting a
   * structural (deterministic-only) difference might look. */
  readonly winner: string | null;
  readonly candidateIds: readonly string[];
}

function hasCompleteDeterministicEconomics(input: DeterministicEntryEconomics): boolean {
  return input.executableOpenCreditDebit !== null && input.collateral !== null
    && input.capitalRequirement !== null && input.dte !== null;
}

/**
 * Compares 0..N candidates (potentially from different strategy branches
 * and different actions) on a real common-horizon basis. `candidates`
 * may include a WAIT pseudo-candidate (see `wait-economic-contract.ts`
 * for how to project one into this shape) -- this function treats it
 * identically to any other candidate, never privileging or penalizing it
 * structurally.
 *
 * State transitions (never resolved by candidateId/branch-name/iteration
 * order -- see the dedicated test proving this):
 *  - 0 candidates -> CROSS_STRATEGY_NOT_COMPARABLE (NO_CANDIDATES)
 *  - any candidate missing REQUIRED deterministic fields -> CROSS_STRATEGY_NOT_COMPARABLE
 *    (DETERMINISTIC_ECONOMICS_INCOMPLETE) -- not even a structural
 *    comparison is trustworthy without a common deterministic basis
 *  - exactly 1 candidate with complete deterministic economics -> STRUCTURALLY_COMPARABLE_ONLY
 *    (SINGLE_CANDIDATE_NO_PEER) -- nothing to compare it against
 *  - 2+ candidates, deterministic economics complete for all, but
 *    `expectedAfterCostWholeChainPnl` is null for ANY candidate ->
 *    EMPIRICAL_ECONOMICS_UNKNOWN (MISSING_EMPIRICAL_ECONOMICS) -- winner
 *    stays null even if some candidates DO have a real number; comparing
 *    a known EV against an unknown one is not a fair comparison
 *  - 2+ candidates, deterministic AND empirical economics complete for
 *    all -> COMPARABLE, winner = the candidate with the highest
 *    `expectedAfterCostWholeChainPnl`
 */
export function compareCrossStrategy(candidates: readonly CandidateComparisonInput[]): CrossStrategyComparisonResult {
  const candidateIds = candidates.map((c) => c.candidateId);
  if (candidates.length === 0) {
    return { state: 'CROSS_STRATEGY_NOT_COMPARABLE', reason: 'NO_CANDIDATES', winner: null, candidateIds };
  }
  if (!candidates.every((c) => hasCompleteDeterministicEconomics(c.deterministic))) {
    return { state: 'CROSS_STRATEGY_NOT_COMPARABLE', reason: 'DETERMINISTIC_ECONOMICS_INCOMPLETE', winner: null, candidateIds };
  }
  if (candidates.length === 1) {
    return { state: 'STRUCTURALLY_COMPARABLE_ONLY', reason: 'SINGLE_CANDIDATE_NO_PEER', winner: null, candidateIds };
  }
  if (!candidates.every((c) => c.empirical.expectedAfterCostWholeChainPnl !== null)) {
    return { state: 'EMPIRICAL_ECONOMICS_UNKNOWN', reason: 'MISSING_EMPIRICAL_ECONOMICS', winner: null, candidateIds };
  }
  // Deterministic tie-break rule, stated explicitly and NEVER falling
  // through to candidateId/branch-name ordering: a true numeric tie on
  // expectedAfterCostWholeChainPnl is reported as CROSS_STRATEGY_NOT_COMPARABLE
  // rather than silently picking the first/last one in array order.
  const sorted = [...candidates].sort(
    (a, b) => (b.empirical.expectedAfterCostWholeChainPnl as number) - (a.empirical.expectedAfterCostWholeChainPnl as number));
  const best = sorted[0] as CandidateComparisonInput;
  const runnerUp = sorted[1];
  if (runnerUp !== undefined && runnerUp.empirical.expectedAfterCostWholeChainPnl === best.empirical.expectedAfterCostWholeChainPnl) {
    return { state: 'CROSS_STRATEGY_NOT_COMPARABLE', reason: 'TIED_EMPIRICAL_ECONOMICS', winner: null, candidateIds };
  }
  return { state: 'COMPARABLE', reason: 'HIGHEST_EXPECTED_AFTER_COST_WHOLE_CHAIN_PNL', winner: best.candidateId, candidateIds };
}
