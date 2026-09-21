import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignToBucket, buildCohortAnalysis, realDeltaBucketsFor,
  type DeltaCohortCandidate,
} from '../src/research/delta-cohort-research.js';

function candidate(overrides: Partial<DeltaCohortCandidate> = {}): DeltaCohortCandidate {
  return {
    candidateId: 'c1', underlying: 'AAPL', delta: -0.22, dte: 30, regimeCohort: 'NEUTRAL',
    premium: 200, collateral: 19000, downsideCushion: 0.05, spreadPct: 0.02,
    laterWholeChainOutcome: null, laterWholeChainOutcomeProvenance: 'NOT_YET_AVAILABLE', ...overrides,
  };
}

test('realDeltaBucketsFor reads the REAL registry buckets for THETA_CONVENTIONAL, matching strategy-package.ts exactly', () => {
  const buckets = realDeltaBucketsFor('THETA_CONVENTIONAL');
  assert.deepEqual(buckets, [0.10, 0.15, 0.20, 0.25, 0.30, 0.40]);
});

test('realDeltaBucketsFor returns an empty array (never fabricated) for a branch with no configured buckets', () => {
  assert.deepEqual(realDeltaBucketsFor('THETA_HOLD_STRIKE'), []);
  assert.deepEqual(realDeltaBucketsFor('THETA_DEFINED_RISK'), []);
});

test('realDeltaBucketsFor returns an empty array for an unrecognized branch name, never throws', () => {
  assert.deepEqual(realDeltaBucketsFor('NOT_A_REAL_BRANCH'), []);
});

test('assignToBucket picks the nearest bucket by MAGNITUDE, correctly handling a negative (put) delta', () => {
  const result = assignToBucket(candidate({ delta: -0.22 }), [0.10, 0.15, 0.20, 0.25, 0.30, 0.40]);
  assert.equal(result.bucketCenter, 0.20);
  assert.ok(result.distanceFromCenter !== null && result.distanceFromCenter < 0.03);
});

test('assignToBucket returns null bucketCenter for an UNKNOWN delta, never a fabricated nearest guess', () => {
  const result = assignToBucket(candidate({ delta: null }), [0.10, 0.15, 0.20]);
  assert.equal(result.bucketCenter, null);
  assert.equal(result.distanceFromCenter, null);
});

test('assignToBucket returns null when no buckets are configured for the branch', () => {
  const result = assignToBucket(candidate(), []);
  assert.equal(result.bucketCenter, null);
});

test('buildCohortAnalysis groups by (bucket, regime) and reports purely descriptive stats, never a ranking or a "best bucket" claim', () => {
  const candidates = [
    candidate({ candidateId: 'a', delta: -0.11, premium: 100, regimeCohort: 'LOW_IV' }),
    candidate({ candidateId: 'b', delta: -0.09, premium: 120, regimeCohort: 'LOW_IV' }),
    candidate({ candidateId: 'c', delta: -0.28, premium: 300, regimeCohort: 'HIGH_IV' }),
  ];
  const result = buildCohortAnalysis(candidates, [0.10, 0.15, 0.20, 0.25, 0.30, 0.40]);
  assert.equal(result.unassignedCount, 0);
  const lowIvCohort = result.cohorts.find((c) => c.bucketCenter === 0.10 && c.regimeCohort === 'LOW_IV');
  assert.equal(lowIvCohort?.candidateCount, 2);
  assert.equal(lowIvCohort?.averagePremium, 110);
  const highIvCohort = result.cohorts.find((c) => c.bucketCenter === 0.30 && c.regimeCohort === 'HIGH_IV');
  assert.equal(highIvCohort?.candidateCount, 1);
  // Every cohort object exposes only descriptive fields -- confirm no ranking/selection field exists on the type.
  assert.ok(!('rank' in (lowIvCohort ?? {})) && !('isBest' in (lowIvCohort ?? {})));
});

test('buildCohortAnalysis counts UNKNOWN-delta candidates as unassigned, never silently dropped or forced into a cohort', () => {
  const candidates = [candidate({ candidateId: 'known', delta: -0.11 }), candidate({ candidateId: 'unknown', delta: null })];
  const result = buildCohortAnalysis(candidates, [0.10, 0.15]);
  assert.equal(result.unassignedCount, 1);
  const totalInCohorts = result.cohorts.reduce((sum, c) => sum + c.candidateCount, 0);
  assert.equal(totalInCohorts, 1);
});

test('buildCohortAnalysis averages outcomes only over OBSERVED candidates, reporting observedOutcomeCount distinctly from candidateCount', () => {
  const candidates = [
    candidate({ candidateId: 'x', delta: -0.11, laterWholeChainOutcome: 150, laterWholeChainOutcomeProvenance: 'OBSERVED' }),
    candidate({ candidateId: 'y', delta: -0.12, laterWholeChainOutcome: null, laterWholeChainOutcomeProvenance: 'NOT_YET_AVAILABLE' }),
  ];
  const result = buildCohortAnalysis(candidates, [0.10, 0.15]);
  const cohort = result.cohorts[0];
  assert.equal(cohort?.candidateCount, 2);
  assert.equal(cohort?.observedOutcomeCount, 1);
  assert.equal(cohort?.averageLaterWholeChainOutcome, 150);
});
