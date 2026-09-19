export const underlyingSelectionShadowVersion = 'theta-underlying-selection-shadow-v1' as const;

/**
 * Research/shadow only. `brokerAuthority: false` always. Answers "why is
 * symbol A ranked above symbol B" using a Pareto/vector comparison over
 * whatever underlying-level evidence is already known, instead of the
 * single `avgDollarVolume`-only placeholder `rankEligibleUnderlyings`
 * (`universe-policy.ts`) uses today and self-labels a "v1 placeholder."
 *
 * This module NEVER selects the live universe, NEVER changes
 * `universe-policy.ts`'s own ranking, and NEVER collapses its dimensions
 * into one opaque score -- per the standing directive against "a giant
 * Boolean conjunction" or a single unexplained number, every comparison
 * carries the named dimension(s) that actually decided it.
 *
 * UNKNOWN-safe by construction, mirroring the exact pattern already used
 * twice in this codebase (`canonical-strategy-frontier.ts`'s
 * `dominates()`/`objectives()`, `strategy-quality-shadow-diagnostics.ts`'s
 * `economicallyDominates()`): a dimension unknown on either side of a pair
 * is skipped for that pair, never assumed to favor either symbol.
 */
export interface UnderlyingSelectionEvidence {
  readonly symbol: string;
  /** Existing v1 ranking feature (`universe-policy.ts`), reused, never
   * recomputed here. */
  readonly avgDollarVolume: number | null;
  /** From `strategy_router.py`'s ownership evaluation, when available --
   * a graded acceptability score, never a binary bullish screen. */
  readonly ownershipAcceptabilityScore: number | null;
  /** Positive number = known event proximity in days; `null` = UNKNOWN,
   * never assumed absent. Lower is treated as worse (closer event risk). */
  readonly daysToNextKnownEvent: number | null;
  /** From `computeRealizedVolatility` (`underlying-features.ts`) or
   * `buildVolatilityAccelerationEvidence` -- annualized decimal. Neither
   * "high" nor "low" is asserted better; this module does not know a
   * strategy's own preferred regime, it only reports the value so a
   * caller-supplied preference (not invented here) can use it. */
  readonly realizedVolatility: number | null;
  /** Option-chain quality proxy: fraction of enumerated contracts with a
   * usable (non-crossed, both-sided) quote, in [0,1]. `null` = UNKNOWN. */
  readonly optionChainQuoteUsableFraction: number | null;
  /** Known portfolio concentration this underlying would add if traded,
   * as a fraction of the account (0 = none known added). `null` = UNKNOWN. */
  readonly portfolioConcentrationImpact: number | null;
}

interface Dimension {
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly value: number | null;
}

function dimensions(evidence: UnderlyingSelectionEvidence): readonly Dimension[] {
  return [
    { label: 'avgDollarVolume', higherIsBetter: true, value: evidence.avgDollarVolume },
    { label: 'ownershipAcceptabilityScore', higherIsBetter: true, value: evidence.ownershipAcceptabilityScore },
    { label: 'daysToNextKnownEvent', higherIsBetter: true, value: evidence.daysToNextKnownEvent },
    { label: 'optionChainQuoteUsableFraction', higherIsBetter: true, value: evidence.optionChainQuoteUsableFraction },
    { label: 'portfolioConcentrationImpact', higherIsBetter: false, value: evidence.portfolioConcentrationImpact },
  ];
}

export interface UnderlyingComparisonReason {
  readonly dimension: string;
  readonly aValue: number;
  readonly bValue: number;
}

/**
 * Returns the NAMED dimensions on which `a` is strictly better than `b`
 * (only among dimensions BOTH know) -- never a boolean alone. An empty
 * array means either nothing distinguishes them on known evidence, or `a`
 * is worse/tied on every known-shared dimension.
 */
export function compareUnderlyings(
  a: UnderlyingSelectionEvidence, b: UnderlyingSelectionEvidence,
): readonly UnderlyingComparisonReason[] {
  const dimsA = dimensions(a), dimsB = dimensions(b);
  const reasons: UnderlyingComparisonReason[] = [];
  for (let index = 0; index < dimsA.length; index += 1) {
    const dimA = dimsA[index] as Dimension, dimB = dimsB[index] as Dimension;
    if (dimA.value === null || dimB.value === null) continue;
    const better = dimA.higherIsBetter ? dimA.value > dimB.value : dimA.value < dimB.value;
    if (better) reasons.push({ dimension: dimA.label, aValue: dimA.value, bValue: dimB.value });
  }
  return reasons;
}

function dominates(a: UnderlyingSelectionEvidence, b: UnderlyingSelectionEvidence): boolean {
  const dimsA = dimensions(a), dimsB = dimensions(b);
  let comparedAny = false, strictlyBetterSomewhere = false;
  for (let index = 0; index < dimsA.length; index += 1) {
    const dimA = dimsA[index] as Dimension, dimB = dimsB[index] as Dimension;
    if (dimA.value === null || dimB.value === null) continue;
    comparedAny = true;
    const normA = dimA.higherIsBetter ? dimA.value : -dimA.value;
    const normB = dimB.higherIsBetter ? dimB.value : -dimB.value;
    if (normA < normB) return false;
    if (normA > normB) strictlyBetterSomewhere = true;
  }
  return comparedAny && strictlyBetterSomewhere;
}

export interface UnderlyingShadowAssessment {
  readonly symbol: string;
  readonly dominatedBy: readonly string[];
  readonly nondominated: boolean;
  readonly knownDimensionCount: number;
}

export interface UnderlyingSelectionShadowResult {
  readonly contractVersion: typeof underlyingSelectionShadowVersion;
  readonly asOf: string;
  readonly assessments: readonly UnderlyingShadowAssessment[];
  readonly nondominatedSymbols: readonly string[];
  /** The existing v1 (`avgDollarVolume`-only) winner, reused unchanged --
   * this module never overrides it, only reports whether it would also be
   * the Pareto-nondominated choice under richer evidence. */
  readonly existingV1Winner: string | null;
  readonly existingV1WinnerIsNondominated: boolean;
  readonly brokerAuthority: false;
}

/**
 * The PARETO / NONDOMINATED stage over underlying-level evidence -- never
 * removes a symbol merely for scoring lower on one dimension; dominance
 * requires being worse-or-equal on every known-shared dimension and
 * strictly worse on at least one, exactly like the contract-level Pareto
 * stages this module deliberately mirrors.
 */
export function buildUnderlyingSelectionShadow(input: {
  readonly asOf: string;
  readonly candidates: readonly UnderlyingSelectionEvidence[];
  readonly existingV1Winner: string | null;
}): UnderlyingSelectionShadowResult {
  const assessments = input.candidates.map((candidate): UnderlyingShadowAssessment => {
    const dominatedBy = input.candidates
      .filter((other) => other.symbol !== candidate.symbol && dominates(other, candidate))
      .map((other) => other.symbol).toSorted();
    return {
      symbol: candidate.symbol, dominatedBy, nondominated: dominatedBy.length === 0,
      knownDimensionCount: dimensions(candidate).filter((dimension) => dimension.value !== null).length,
    };
  });
  const nondominatedSymbols = assessments.filter((assessment) => assessment.nondominated).map((assessment) => assessment.symbol);
  return {
    contractVersion: underlyingSelectionShadowVersion, asOf: input.asOf, assessments, nondominatedSymbols,
    existingV1Winner: input.existingV1Winner,
    existingV1WinnerIsNondominated: input.existingV1Winner !== null && nondominatedSymbols.includes(input.existingV1Winner),
    brokerAuthority: false,
  };
}
