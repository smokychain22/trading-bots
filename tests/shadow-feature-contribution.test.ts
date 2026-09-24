import assert from 'node:assert/strict';
import test from 'node:test';
import { computeShadowFeatureContribution, type ShadowRankedCandidate } from '../src/research/shadow-feature-contribution.js';
import { buildQualifiedSoftFeatureEvidence } from '../src/research/qualified-soft-feature-evidence.js';

const OBSERVED = '2026-09-22T14:00:00Z';

function vrp(value: number | null): ReturnType<typeof buildQualifiedSoftFeatureEvidence> {
  return buildQualifiedSoftFeatureEvidence({
    featureId: 'VRP20', value, observedAt: OBSERVED, validThrough: '2026-09-22T14:01:00Z', requestedDate: null, servedDate: null,
  });
}

test('CORE CLAIM: shadow rank never overwrites currentProductionRank -- both are preserved independently', () => {
  const candidates: ShadowRankedCandidate[] = [
    { candidateId: 'c1', currentProductionRank: 1, decisionAt: OBSERVED, featureEvidence: [vrp(0.01)] },
    { candidateId: 'c2', currentProductionRank: 2, decisionAt: OBSERVED, featureEvidence: [vrp(0.10)] },
  ];
  const result = computeShadowFeatureContribution(candidates);
  const c1 = result.find((r) => r.candidateId === 'c1');
  const c2 = result.find((r) => r.candidateId === 'c2');
  assert.equal(c1?.currentProductionRank, 1);
  assert.equal(c2?.currentProductionRank, 2);
  // c2 has richer VRP -> shadow-ranks first (rank 1), despite production rank 2.
  assert.equal(c2?.shadowFeatureRank, 1);
  assert.equal(c1?.shadowFeatureRank, 2);
});

test('every computed score is labeled BOOTSTRAP_NON_EMPIRICAL, never presented as validated', () => {
  const candidates: ShadowRankedCandidate[] = [
    { candidateId: 'c1', currentProductionRank: 1, decisionAt: OBSERVED, featureEvidence: [vrp(0.05)] },
  ];
  const result = computeShadowFeatureContribution(candidates);
  assert.equal(result[0]?.bootstrapContributionStatus, 'BOOTSTRAP_NON_EMPIRICAL');
});

test('a candidate with no known feature value gets shadowFeatureRank=null, never a fabricated rank', () => {
  const candidates: ShadowRankedCandidate[] = [
    { candidateId: 'c1', currentProductionRank: 1, decisionAt: OBSERVED, featureEvidence: [vrp(null)] },
    { candidateId: 'c2', currentProductionRank: 2, decisionAt: OBSERVED, featureEvidence: [vrp(0.05)] },
  ];
  const result = computeShadowFeatureContribution(candidates);
  const c1 = result.find((r) => r.candidateId === 'c1');
  assert.equal(c1?.shadowFeatureRank, null);
  assert.equal(c1?.rankDelta, null);
  assert.equal(c1?.bootstrapContributionStatus, 'INSUFFICIENT_FEATURE_EVIDENCE');
});

test('rankDelta is real and computed from actual production vs. shadow rank, not estimated', () => {
  const candidates: ShadowRankedCandidate[] = [
    { candidateId: 'c1', currentProductionRank: 3, decisionAt: OBSERVED, featureEvidence: [vrp(0.20)] },
    { candidateId: 'c2', currentProductionRank: 1, decisionAt: OBSERVED, featureEvidence: [vrp(0.01)] },
  ];
  const result = computeShadowFeatureContribution(candidates);
  const c1 = result.find((r) => r.candidateId === 'c1');
  // c1 has richer VRP -> shadow rank 1, but production rank was 3 -> delta = 1 - 3 = -2
  assert.equal(c1?.shadowFeatureRank, 1);
  assert.equal(c1?.rankDelta, -2);
});

test('unqualified, stale, future, zero-weight and duplicate feature inputs cannot invent contributions', () => {
  const candidate: ShadowRankedCandidate = { candidateId: 'a', currentProductionRank: 1, decisionAt: OBSERVED, featureEvidence: [] };
  for (const feature of [
    { ...vrp(1), qualityState: 'QUARANTINED' as const },
    { ...vrp(1), pitState: 'UNKNOWN_PIT' as const },
    { ...vrp(1), validThrough: '2026-09-22T13:59:59Z' },
    { ...vrp(1), observedAt: '2026-09-22T14:00:01Z' },
    { ...vrp(1), featureId: 'ATM_IV' as const },
  ]) assert.equal(computeShadowFeatureContribution([{ ...candidate, featureEvidence: [feature] }])[0]?.bootstrapContribution, null);
  assert.throws(() => computeShadowFeatureContribution([{ ...candidate, featureEvidence: [vrp(1), vrp(1)] }]), /DUPLICATE_FEATURE/);
  assert.throws(() => computeShadowFeatureContribution([candidate, candidate]), /DUPLICATE_CANDIDATE/);
});

test('ties share rank independent of input ordering and a real zero VRP remains known', () => {
  const candidates: ShadowRankedCandidate[] = ['b', 'a'].map((candidateId) => ({ candidateId,
    currentProductionRank: 1, decisionAt: OBSERVED, featureEvidence: [vrp(0)] }));
  for (const order of [candidates, [...candidates].reverse()]) {
    const results = computeShadowFeatureContribution(order);
    assert.deepEqual(results.map((r) => r.shadowFeatureRank), [1, 1]);
    assert.deepEqual(results.map((r) => r.bootstrapContribution), [0, 0]);
  }
});
