/**
 * R8 delta cohort research module (directive priority #3). Research-only,
 * `brokerAuthority: false`. Answers a confirmed defect this session's
 * brain audit found: `deltaResearchBuckets` (`strategy-package.ts`) has
 * ZERO consumers anywhere in the codebase -- verified by exhaustive grep
 * -- so the 6 configured buckets for `THETA_CONVENTIONAL`
 * (`[0.10, 0.15, 0.20, 0.25, 0.30, 0.40]`) currently do nothing: they do
 * not filter candidate generation, do not create cohorts, do not affect
 * Pareto ranking. This module is the missing COHORT-ASSIGNMENT/
 * DESCRIPTIVE layer, built as RESEARCH ONLY per explicit instruction --
 * it does NOT wire these buckets into entry execution or candidate
 * filtering. No bucket is ever treated as "best"; this module makes no
 * selection or ranking claim whatsoever.
 *
 * Delta is NEVER treated as an exact probability of profit anywhere in
 * this module -- there is deliberately no `probabilityOfProfit` field
 * derived from delta. Delta is geometry (how far a strike sits from the
 * money, under the pricing model that produced it), not a calibrated
 * empirical probability; conflating the two is exactly the mistake this
 * engagement's standing rules prohibit ("Delta is not probability of
 * profit. Never treat 25-delta as '75% win rate.'").
 */
import { canonicalThetaStrategySources } from '../theta/strategy-package.js';

export const deltaCohortResearchVersion = 'theta-delta-cohort-research-v1' as const;

/**
 * Reads the REAL, currently-configured delta buckets for a branch
 * directly from the canonical registry -- never a duplicated literal
 * that could silently drift from the real configuration. Returns an
 * empty array (never throws, never fabricates buckets) for a branch
 * whose registry entry has none configured (every branch except
 * `THETA_CONVENTIONAL` today).
 */
export function realDeltaBucketsFor(branch: string): readonly number[] {
  const source = canonicalThetaStrategySources.find((s) => s.branch === branch);
  return source?.lattice.deltaResearchBuckets ?? [];
}

export type OutcomeProvenance = 'OBSERVED' | 'NOT_YET_AVAILABLE';

/**
 * One real candidate's full delta-cohort evidence row. `delta` is
 * `null` when genuinely UNKNOWN (never fabricated as 0 or a bucket
 * center). `laterWholeChainOutcome` starts `null`/`NOT_YET_AVAILABLE`
 * for every real candidate at decision time -- it exists so a FUTURE
 * pass (once real R8 Paper outcomes accumulate) can populate it without
 * changing this schema, never populated with a synthetic number now.
 */
export interface DeltaCohortCandidate {
  readonly candidateId: string;
  readonly underlying: string;
  readonly delta: number | null;
  readonly dte: number | null;
  readonly regimeCohort: string | null;
  readonly premium: number | null;
  readonly collateral: number | null;
  readonly downsideCushion: number | null;
  readonly spreadPct: number | null;
  readonly laterWholeChainOutcome: number | null;
  readonly laterWholeChainOutcomeProvenance: OutcomeProvenance;
}

export interface DeltaBucketAssignment {
  readonly candidateId: string;
  /** `null` when `delta` is UNKNOWN or no buckets are configured for
   * this branch -- never a fabricated nearest-bucket guess. */
  readonly bucketCenter: number | null;
  readonly distanceFromCenter: number | null;
}

/**
 * Assigns ONE candidate to its nearest configured bucket by delta
 * MAGNITUDE (a short put's delta is negative; the buckets are defined as
 * positive magnitudes, matching the registry's own `min(0).max(1)`
 * schema constraint) -- never a signed-value comparison that would
 * silently mismatch puts against the bucket list.
 */
export function assignToBucket(candidate: DeltaCohortCandidate, buckets: readonly number[]): DeltaBucketAssignment {
  if (candidate.delta === null || buckets.length === 0) {
    return { candidateId: candidate.candidateId, bucketCenter: null, distanceFromCenter: null };
  }
  const magnitude = Math.abs(candidate.delta);
  let bucketCenter = buckets[0] as number;
  let distanceFromCenter = Math.abs(magnitude - bucketCenter);
  for (const bucket of buckets.slice(1)) {
    const distance = Math.abs(magnitude - bucket);
    if (distance < distanceFromCenter) { bucketCenter = bucket; distanceFromCenter = distance; }
  }
  return { candidateId: candidate.candidateId, bucketCenter, distanceFromCenter };
}

export interface CohortKey {
  readonly bucketCenter: number;
  readonly regimeCohort: string | null;
}

export interface CohortDescriptiveSummary {
  readonly bucketCenter: number;
  readonly regimeCohort: string | null;
  readonly candidateCount: number;
  readonly averagePremium: number | null;
  readonly averageCollateral: number | null;
  readonly averageDownsideCushion: number | null;
  readonly averageSpreadPct: number | null;
  /** Only counts candidates whose outcome is `OBSERVED` -- a
   * `NOT_YET_AVAILABLE` outcome contributes to `candidateCount` but never
   * to this average, and `observedOutcomeCount` reports exactly how many
   * of the cohort's candidates that average is actually based on. */
  readonly averageLaterWholeChainOutcome: number | null;
  readonly observedOutcomeCount: number;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Groups candidates by (bucketCenter, regimeCohort) and reports purely
 * DESCRIPTIVE statistics per cohort -- no ranking, no "best bucket"
 * conclusion, no selection recommendation. Candidates whose delta is
 * UNKNOWN (and therefore have no `bucketCenter`) are excluded from every
 * cohort and reported separately via `unassignedCount`, never silently
 * dropped without being counted anywhere.
 */
export interface CohortAnalysisResult {
  readonly cohorts: readonly CohortDescriptiveSummary[];
  readonly unassignedCount: number;
}

export function buildCohortAnalysis(
  candidates: readonly DeltaCohortCandidate[], buckets: readonly number[],
): CohortAnalysisResult {
  const assignments = new Map<string, DeltaBucketAssignment>();
  for (const candidate of candidates) assignments.set(candidate.candidateId, assignToBucket(candidate, buckets));

  const groups = new Map<string, DeltaCohortCandidate[]>();
  let unassignedCount = 0;
  for (const candidate of candidates) {
    const assignment = assignments.get(candidate.candidateId);
    if (assignment?.bucketCenter === null || assignment === undefined) { unassignedCount += 1; continue; }
    const key = `${assignment.bucketCenter}|${candidate.regimeCohort ?? 'UNKNOWN'}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const cohorts: CohortDescriptiveSummary[] = [...groups.entries()].map(([key, members]) => {
    const [bucketCenterStr, regimeCohortRaw] = key.split('|');
    const regimeCohort = regimeCohortRaw === 'UNKNOWN' ? null : (regimeCohortRaw as string);
    const observed = members.filter((m) => m.laterWholeChainOutcomeProvenance === 'OBSERVED' && m.laterWholeChainOutcome !== null);
    return {
      bucketCenter: Number(bucketCenterStr), regimeCohort, candidateCount: members.length,
      averagePremium: average(members.map((m) => m.premium).filter((v): v is number => v !== null)),
      averageCollateral: average(members.map((m) => m.collateral).filter((v): v is number => v !== null)),
      averageDownsideCushion: average(members.map((m) => m.downsideCushion).filter((v): v is number => v !== null)),
      averageSpreadPct: average(members.map((m) => m.spreadPct).filter((v): v is number => v !== null)),
      averageLaterWholeChainOutcome: average(observed.map((m) => m.laterWholeChainOutcome as number)),
      observedOutcomeCount: observed.length,
    };
  }).sort((a, b) => a.bucketCenter - b.bucketCenter || (a.regimeCohort ?? '').localeCompare(b.regimeCohort ?? ''));

  return { cohorts, unassignedCount };
}
