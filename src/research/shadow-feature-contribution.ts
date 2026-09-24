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

export const shadowFeatureContributionVersion = 'theta-shadow-feature-contribution-v2' as const;

export interface ShadowRankedCandidate {
  readonly candidateId: string;
  readonly currentProductionRank: number;
  readonly decisionAt: string;
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

function bootstrapScore(evidence: readonly QualifiedSoftFeatureEvidence[], decisionAt: string): number | null {
  const decisionMs = Date.parse(decisionAt);
  const featureIds = new Set<string>();
  for (const e of evidence) {
    if (featureIds.has(e.featureId)) throw new Error('DUPLICATE_FEATURE_EVIDENCE');
    featureIds.add(e.featureId);
  }
  const knownValues = evidence.filter((e) => e.value !== null && Number.isFinite(e.value)
    && e.qualityState === 'PROVIDER_QUALIFIED' && e.empiricalStatus !== 'REJECTED'
    && (e.pitState === 'CURRENT_ONLY' || (e.pitState === 'PIT_SAFE'
      && e.pitEvidence !== null && Date.parse(e.pitEvidence.decisionAt) === decisionMs))
    && Date.parse(e.observedAt) <= decisionMs && e.validThrough !== null
    && decisionMs <= Date.parse(e.validThrough)
    && BOOTSTRAP_WEIGHTS[e.featureId] !== undefined && BOOTSTRAP_WEIGHTS[e.featureId] !== 0);
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
  const ids = new Set<string>();
  for (const c of candidates) {
    if (!c.candidateId.trim() || ids.has(c.candidateId)) throw new Error('INVALID_OR_DUPLICATE_CANDIDATE_ID');
    if (!Number.isFinite(Date.parse(c.decisionAt))) throw new Error('INVALID_DECISION_AT');
    if (!Number.isInteger(c.currentProductionRank) || c.currentProductionRank < 1) throw new Error('INVALID_PRODUCTION_RANK');
    ids.add(c.candidateId);
  }
  const withScores = candidates.map((c) => ({ ...c, score: bootstrapScore(c.featureEvidence, c.decisionAt) }));
  const rankable = withScores.filter((c) => c.score !== null)
    .toSorted((a, b) => (b.score as number) - (a.score as number) || a.candidateId.localeCompare(b.candidateId));
  const shadowRankById = new Map<string, number>();
  let rank = 0;
  rankable.forEach((c, index) => {
    if (index === 0 || c.score !== rankable[index - 1]?.score) rank = index + 1;
    shadowRankById.set(c.candidateId, rank);
  });

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
