import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignToBucket, buildCohortAnalysis, realDeltaBucketsFor,
  type DeltaCohortCandidate,
} from '../src/research/delta-cohort-research.js';

const BUCKETS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40];
const MAX_DISTANCE = 0.05;

function candidate(overrides: Partial<DeltaCohortCandidate> = {}): DeltaCohortCandidate {
  return {
    candidateId: 'c1', underlying: 'AAPL', delta: -0.22, dte: 30, regimeCohort: 'NEUTRAL',
    premium: 200, collateral: 19000, downsideCushion: 0.05, spreadPct: 0.02,
    laterWholeChainOutcome: null, laterWholeChainOutcomeProvenance: 'NOT_YET_AVAILABLE', ...overrides,
  };
}

test('realDeltaBucketsFor reads the REAL registry buckets for THETA_CONVENTIONAL, matching strategy-package.ts exactly', () => {
  assert.deepEqual(realDeltaBucketsFor('THETA_CONVENTIONAL'), BUCKETS);
});

test('realDeltaBucketsFor returns an empty array (never fabricated) for a branch with no configured buckets', () => {
  assert.deepEqual(realDeltaBucketsFor('THETA_HOLD_STRIKE'), []);
});

test('assignToBucket picks the nearest bucket by MAGNITUDE and preserves observedDelta unchanged', () => {
  const result = assignToBucket(candidate({ delta: -0.22 }), BUCKETS, MAX_DISTANCE);
  assert.equal(result.status, 'IN_BUCKET');
  assert.equal(result.bucketCenter, 0.20);
  assert.equal(result.observedDelta, -0.22);
});

test('REPAIR: assignToBucket reports OUTSIDE_CONFIGURED_RANGE (never silently forced into the nearest bucket) for a genuinely far-out delta', () => {
  const result = assignToBucket(candidate({ delta: -0.85 }), BUCKETS, MAX_DISTANCE);
  assert.equal(result.status, 'OUTSIDE_CONFIGURED_RANGE');
  assert.equal(result.bucketCenter, null); // never force-assigned to 0.40 just because it's nearest
  assert.equal(result.observedDelta, -0.85);
  assert.ok(result.distanceFromCenter !== null && result.distanceFromCenter > MAX_DISTANCE);
});

test('assignToBucket reports UNKNOWN_DELTA for a null delta, distinct from OUTSIDE_CONFIGURED_RANGE', () => {
  const result = assignToBucket(candidate({ delta: null }), BUCKETS, MAX_DISTANCE);
  assert.equal(result.status, 'UNKNOWN_DELTA');
  assert.equal(result.observedDelta, null);
});

test('assignToBucket reports NO_BUCKET_CONFIGURATION when the branch has no buckets, distinct from UNKNOWN_DELTA', () => {
  const result = assignToBucket(candidate({ delta: -0.22 }), [], MAX_DISTANCE);
  assert.equal(result.status, 'NO_BUCKET_CONFIGURATION');
  assert.equal(result.observedDelta, -0.22); // real delta preserved even though no cohort exists for it
});

test('assignToBucket at exactly the maxAssignmentDistance boundary is still IN_BUCKET', () => {
  const result = assignToBucket(candidate({ delta: -0.15 }), [0.10], 0.05); // distance exactly 0.05
  assert.equal(result.status, 'IN_BUCKET');
  assert.equal(result.bucketCenter, 0.10);
});

test('buildCohortAnalysis groups only IN_BUCKET candidates and reports purely descriptive stats, never a "best bucket" claim', () => {
  const candidates = [
    candidate({ candidateId: 'a', delta: -0.11, premium: 100, regimeCohort: 'LOW_IV' }),
    candidate({ candidateId: 'b', delta: -0.09, premium: 120, regimeCohort: 'LOW_IV' }),
    candidate({ candidateId: 'c', delta: -0.28, premium: 300, regimeCohort: 'HIGH_IV' }),
  ];
  const result = buildCohortAnalysis(candidates, BUCKETS, MAX_DISTANCE);
  assert.deepEqual(result.unassignedCountByStatus, { OUTSIDE_CONFIGURED_RANGE: 0, UNKNOWN_DELTA: 0, NO_BUCKET_CONFIGURATION: 0 });
  const lowIvCohort = result.cohorts.find((c) => c.bucketCenter === 0.10 && c.regimeCohort === 'LOW_IV');
  assert.equal(lowIvCohort?.candidateCount, 2);
  assert.equal(lowIvCohort?.averagePremium, 110);
  assert.ok(!('rank' in (lowIvCohort ?? {})) && !('isBest' in (lowIvCohort ?? {})));
});

test('REPAIR: buildCohortAnalysis counts an out-of-range delta separately from an unknown delta, never merging the two or silently dropping either', () => {
  const candidates = [
    candidate({ candidateId: 'known', delta: -0.11 }),
    candidate({ candidateId: 'unknown', delta: null }),
    candidate({ candidateId: 'far-out', delta: -0.85 }),
  ];
  const result = buildCohortAnalysis(candidates, BUCKETS, MAX_DISTANCE);
  assert.equal(result.unassignedCountByStatus.UNKNOWN_DELTA, 1);
  assert.equal(result.unassignedCountByStatus.OUTSIDE_CONFIGURED_RANGE, 1);
  const totalInCohorts = result.cohorts.reduce((sum, c) => sum + c.candidateCount, 0);
  assert.equal(totalInCohorts, 1);
});

test('buildCohortAnalysis averages outcomes only over OBSERVED candidates, reporting observedOutcomeCount distinctly from candidateCount', () => {
  const candidates = [
    candidate({ candidateId: 'x', delta: -0.11, laterWholeChainOutcome: 150, laterWholeChainOutcomeProvenance: 'OBSERVED' }),
    candidate({ candidateId: 'y', delta: -0.12, laterWholeChainOutcome: null, laterWholeChainOutcomeProvenance: 'NOT_YET_AVAILABLE' }),
  ];
  const result = buildCohortAnalysis(candidates, [0.10, 0.15], MAX_DISTANCE);
  const cohort = result.cohorts[0];
  assert.equal(cohort?.candidateCount, 2);
  assert.equal(cohort?.observedOutcomeCount, 1);
  assert.equal(cohort?.averageLaterWholeChainOutcome, 150);
});
