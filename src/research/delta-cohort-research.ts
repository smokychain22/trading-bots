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
 * v2 hardening: the prior nearest-bucket logic would silently assign a
 * genuinely far-out-of-range delta (e.g. 0.85, when the widest configured
 * bucket is 0.40) to that nearest bucket anyway -- misleadingly
 * implying it belongs there. Four honest states replace that single
 * silent assignment:
 *  - `IN_BUCKET`: within `maxAssignmentDistance` of its nearest bucket.
 *  - `OUTSIDE_CONFIGURED_RANGE`: a real, known delta exists, but it is
 *    farther from every configured bucket than `maxAssignmentDistance`
 *    allows -- never silently forced into the nearest one anyway.
 *  - `UNKNOWN_DELTA`: the candidate's own delta is `null`.
 *  - `NO_BUCKET_CONFIGURATION`: the branch has no buckets configured at
 *    all (every branch except `THETA_CONVENTIONAL` today).
 */
export type DeltaAssignmentStatus = 'IN_BUCKET' | 'OUTSIDE_CONFIGURED_RANGE' | 'UNKNOWN_DELTA' | 'NO_BUCKET_CONFIGURATION';

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
  /** The candidate's own real observed delta, preserved unchanged --
   * never overwritten or discarded, even when the assignment status is
   * `OUTSIDE_CONFIGURED_RANGE` or `UNKNOWN_DELTA`. */
  readonly observedDelta: number | null;
  /** `null` whenever `status !== 'IN_BUCKET'` -- an out-of-range or
   * unknown delta is NEVER force-assigned to the nearest bucket anyway. */
  readonly bucketCenter: number | null;
  readonly distanceFromCenter: number | null;
  readonly status: DeltaAssignmentStatus;
}

/**
 * Assigns ONE candidate to its nearest configured bucket by delta
 * MAGNITUDE (a short put's delta is negative; the buckets are defined as
 * positive magnitudes, matching the registry's own `min(0).max(1)`
 * schema constraint) -- never a signed-value comparison that would
 * silently mismatch puts against the bucket list. `maxAssignmentDistance`
 * is REQUIRED and caller-supplied -- this module never invents a
 * tolerance; a candidate farther than this from every configured bucket
 * is `OUTSIDE_CONFIGURED_RANGE`, never silently forced into the nearest
 * one regardless of how far away it actually is.
 */
export function assignToBucket(
  candidate: DeltaCohortCandidate, buckets: readonly number[], maxAssignmentDistance: number,
): DeltaBucketAssignment {
  const observedDelta = candidate.delta;
  if (buckets.length === 0) {
    return { candidateId: candidate.candidateId, observedDelta, bucketCenter: null, distanceFromCenter: null, status: 'NO_BUCKET_CONFIGURATION' };
  }
  if (observedDelta === null) {
    return { candidateId: candidate.candidateId, observedDelta, bucketCenter: null, distanceFromCenter: null, status: 'UNKNOWN_DELTA' };
  }
  const magnitude = Math.abs(observedDelta);
  let nearestBucket = buckets[0] as number;
  let distanceFromCenter = Math.abs(magnitude - nearestBucket);
  for (const bucket of buckets.slice(1)) {
    const distance = Math.abs(magnitude - bucket);
    if (distance < distanceFromCenter) { nearestBucket = bucket; distanceFromCenter = distance; }
  }
  if (distanceFromCenter > maxAssignmentDistance) {
    return { candidateId: candidate.candidateId, observedDelta, bucketCenter: null, distanceFromCenter, status: 'OUTSIDE_CONFIGURED_RANGE' };
  }
  return { candidateId: candidate.candidateId, observedDelta, bucketCenter: nearestBucket, distanceFromCenter, status: 'IN_BUCKET' };
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
 * conclusion, no selection recommendation. Only `IN_BUCKET` candidates
 * enter a cohort; `OUTSIDE_CONFIGURED_RANGE`/`UNKNOWN_DELTA`/
 * `NO_BUCKET_CONFIGURATION` candidates are counted separately by status,
 * never silently dropped without being counted anywhere and never
 * force-assigned to a nearest cohort they do not actually belong to.
 */
export interface CohortAnalysisResult {
  readonly cohorts: readonly CohortDescriptiveSummary[];
  readonly unassignedCountByStatus: Readonly<Record<Exclude<DeltaAssignmentStatus, 'IN_BUCKET'>, number>>;
}

export function buildCohortAnalysis(
  candidates: readonly DeltaCohortCandidate[], buckets: readonly number[], maxAssignmentDistance: number,
): CohortAnalysisResult {
  const assignments = new Map<string, DeltaBucketAssignment>();
  for (const candidate of candidates) assignments.set(candidate.candidateId, assignToBucket(candidate, buckets, maxAssignmentDistance));

  const groups = new Map<string, DeltaCohortCandidate[]>();
  const unassignedCountByStatus: Record<Exclude<DeltaAssignmentStatus, 'IN_BUCKET'>, number> = {
    OUTSIDE_CONFIGURED_RANGE: 0, UNKNOWN_DELTA: 0, NO_BUCKET_CONFIGURATION: 0,
  };
  for (const candidate of candidates) {
    const assignment = assignments.get(candidate.candidateId);
    if (assignment === undefined || assignment.status !== 'IN_BUCKET' || assignment.bucketCenter === null) {
      if (assignment !== undefined && assignment.status !== 'IN_BUCKET') unassignedCountByStatus[assignment.status] += 1;
      continue;
    }
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

  return { cohorts, unassignedCountByStatus };
}
