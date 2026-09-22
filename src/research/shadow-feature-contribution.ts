/**
 * Shadow feature-contribution framework (Wave 13 Batch 3). Research-only,
 * `brokerAuthority: false`. Measures whether qualified soft features
 * (`qualified-soft-feature-evidence.ts`) WOULD change candidate ordering
 * if they contributed to ranking -- without giving them any real
 * Production weight. `bootstrapContribution` is explicitly a temporary,
 * non-empirical research score; it never overwrites
 * `currentProductionRank`, and any weight used to compute it is a
 * disclosed constant, not an empirically-derived one. R8 later decides
 * whether shadow ranking actually correlates with better real outcomes
 * (whole-chain net PnL, Expected Shortfall, drawdown, CapitalDays, RPCD,
 * false-reject rate) -- this module only produces the comparison inputs
 * for that future evaluation, it never claims the shadow rank is better.
 */
import type { QualifiedSoftFeatureEvidence } from './qualified-soft-feature-evidence.js';

export const shadowFeatureContributionVersion = 'theta-shadow-feature-contribution-v1' as const;

export interface ShadowRankedCandidate {
  readonly candidateId: string;
  readonly currentProductionRank: number;
  readonly featureEvidence: readonly QualifiedSoftFeatureEvidence[];
}

export interface ShadowFeatureContributionResult {
  readonly candidateId: string;
  readonly currentProductionRank: number;
  readonly shadowFeatureRank: number | null;
  readonly rankDelta: number | null;
  readonly featureEvidence: readonly QualifiedSoftFeatureEvidence[];
  /** A disclosed, non-empirical research score -- BOOTSTRAP_NON_EMPIRICAL
   * per this wave's explicit instruction. Never null when
   * shadowFeatureRank is non-null (they are derived together). */
  readonly bootstrapContribution: number | null;
  readonly bootstrapContributionStatus: 'BOOTSTRAP_NON_EMPIRICAL' | 'INSUFFICIENT_FEATURE_EVIDENCE';
}

/**
 * A fixed, disclosed bootstrap weight -- NOT an empirically-derived
 * coefficient. Higher VRP (richer premium) and higher RV20-relative IV
 * richness rank more favorably; this is a plausible research prior, not
 * a claim of correctness. Every score computed with it is labeled
 * `BOOTSTRAP_NON_EMPIRICAL` so no downstream consumer can mistake it for
 * a validated model.
 */
const BOOTSTRAP_WEIGHTS: Readonly<Record<string, number>> = { ATM_IV: 0.0, RV20: 0.0, VRP20: 1.0 };

function bootstrapScore(evidence: readonly QualifiedSoftFeatureEvidence[]): number | null {
  const knownValues = evidence.filter((e) => e.value !== null);
  if (knownValues.length === 0) return null;
  let score = 0;
  for (const e of knownValues) score += (BOOTSTRAP_WEIGHTS[e.featureId] ?? 0) * (e.value as number);
  return score;
}

/**
 * Ranks a real set of candidates by their `bootstrapContribution` (higher
 * score = rank 1) and compares against `currentProductionRank`. A
 * candidate with no known qualified-feature value gets
 * `shadowFeatureRank: null` and is excluded from the delta comparison --
 * never assigned a fabricated rank.
 */
export function computeShadowFeatureContribution(
  candidates: readonly ShadowRankedCandidate[],
): readonly ShadowFeatureContributionResult[] {
  const withScores = candidates.map((c) => ({ ...c, score: bootstrapScore(c.featureEvidence) }));
  const rankable = withScores.filter((c) => c.score !== null)
    .toSorted((a, b) => (b.score as number) - (a.score as number));
  const shadowRankById = new Map(rankable.map((c, index) => [c.candidateId, index + 1]));

  return withScores.map((c) => {
    const shadowFeatureRank = shadowRankById.get(c.candidateId) ?? null;
    return {
      candidateId: c.candidateId, currentProductionRank: c.currentProductionRank, shadowFeatureRank,
      rankDelta: shadowFeatureRank === null ? null : shadowFeatureRank - c.currentProductionRank,
      featureEvidence: c.featureEvidence, bootstrapContribution: c.score,
      bootstrapContributionStatus: c.score === null ? 'INSUFFICIENT_FEATURE_EVIDENCE' : 'BOOTSTRAP_NON_EMPIRICAL',
    };
  });
}
