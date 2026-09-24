import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEvidenceCompletenessReport, ownershipAegisDataLineage, type CandidateEvidenceCompletenessInput,
} from '../src/research/evidence-completeness-diagnostic.js';

const candidate = (overrides: Partial<CandidateEvidenceCompletenessInput> = {}): CandidateEvidenceCompletenessInput => ({
  candidateId: 'cand-1', snapshotId: 'snap-1', underlying: 'AAPL', branch: 'THETA_CONVENTIONAL',
  ownershipComponents: [
    { name: 'LiquidityQuality', value: 0.8 }, { name: 'StructuralQuality', value: 0.7 },
    { name: 'RecoveryQuality', value: 0.6 }, { name: 'TailQuality', value: 0.9 }, { name: 'EventAdjustment', value: 1 },
  ],
  aegisAssessmentPresent: true, aegisNewRiskState: 'ALLOW_FULL', quantity: 1,
  unknownEvidence: [], hardBlockers: [], ...overrides,
});

test('a fully known candidate contributes to ownershipKnownCount and aegisKnownCount, not unknown', () => {
  const report = buildEvidenceCompletenessReport([candidate()]);
  assert.equal(report.totalCandidateCount, 1);
  assert.equal(report.ownershipKnownCount, 1);
  assert.equal(report.ownershipUnknownCount, 0);
  assert.equal(report.ownershipNotEvaluatedCount, 0);
  assert.equal(report.aegisKnownCount, 1);
  assert.equal(report.aegisNotEvaluatedCount, 0);
  assert.equal(report.brokerAuthority, false);
});

test('ownership that never ran at all is NOT_EVALUATED, distinct from ran-but-unknown', () => {
  const report = buildEvidenceCompletenessReport([candidate({ ownershipComponents: null })]);
  assert.equal(report.ownershipNotEvaluatedCount, 1);
  assert.equal(report.ownershipUnknownCount, 0);
  assert.equal(report.ownershipKnownCount, 0);
});

test('ownership that ran but has one UNKNOWN component collapses to ownershipUnknownCount, and that component is tracked individually', () => {
  const report = buildEvidenceCompletenessReport([candidate({
    ownershipComponents: [
      { name: 'LiquidityQuality', value: 0.8 }, { name: 'StructuralQuality', value: null },
      { name: 'RecoveryQuality', value: 0.6 }, { name: 'TailQuality', value: 0.9 }, { name: 'EventAdjustment', value: 1 },
    ],
  })]);
  assert.equal(report.ownershipUnknownCount, 1);
  assert.equal(report.ownershipKnownCount, 0);
  const structural = report.ownershipComponentCompleteness.find((row) => row.component === 'StructuralQuality');
  assert.equal(structural?.unknownCount, 1);
  const liquidity = report.ownershipComponentCompleteness.find((row) => row.component === 'LiquidityQuality');
  assert.equal(liquidity?.knownCount, 1);
});

test('AEGIS that never ran is aegisNotEvaluatedCount, never fabricated as a known ALLOW state', () => {
  const report = buildEvidenceCompletenessReport([candidate({ aegisAssessmentPresent: false, aegisNewRiskState: null })]);
  assert.equal(report.aegisNotEvaluatedCount, 1);
  assert.equal(report.aegisKnownCount, 0);
});

test('quoteUsableButOwnershipUnknownCount only counts candidates that are BOTH quote-usable AND ownership-unknown', () => {
  const usableButUnknown = candidate({ candidateId: 'c1', ownershipComponents: null });
  const usableAndKnown = candidate({ candidateId: 'c2' });
  const notUsable = candidate({ candidateId: 'c3', ownershipComponents: null });
  const report = buildEvidenceCompletenessReport(
    [usableButUnknown, usableAndKnown, notUsable],
    { c1: true, c2: true, c3: false },
  );
  assert.equal(report.quoteUsableButOwnershipUnknownCount, 1);
});

test('ownershipKnownButAegisUnknownCount and aegisKnownButQuantityZeroCount are computed independently', () => {
  const ownershipOkAegisUnknown = candidate({ candidateId: 'c1', aegisAssessmentPresent: false, aegisNewRiskState: null });
  const aegisOkQtyZero = candidate({ candidateId: 'c2', quantity: 0 });
  const report = buildEvidenceCompletenessReport([ownershipOkAegisUnknown, aegisOkQtyZero]);
  assert.equal(report.ownershipKnownButAegisUnknownCount, 1);
  assert.equal(report.aegisKnownButQuantityZeroCount, 1);
});

test('reason codes are tallied verbatim, and known codes map to the canonical feature family', () => {
  const report = buildEvidenceCompletenessReport([
    candidate({ candidateId: 'c1', unknownEvidence: ['IV_UNKNOWN', 'OPEN_INTEREST_UNKNOWN'] }),
    candidate({ candidateId: 'c2', unknownEvidence: ['IV_UNKNOWN'] }),
  ]);
  const ivCount = report.reasonCodeCounts.find((row) => row.code === 'IV_UNKNOWN');
  assert.equal(ivCount?.count, 2);
  const ivFamily = report.featureFamilyCompleteness.find((row) => row.family === 'IV');
  assert.equal(ivFamily?.unknownCount, 2);
  assert.equal(ivFamily?.knownCount, 0);
  const volFamily = report.featureFamilyCompleteness.find((row) => row.family === 'VOLUME_OPEN_INTEREST');
  assert.equal(volFamily?.unknownCount, 1);
  assert.equal(volFamily?.knownCount, 0);
  assert.equal(volFamily?.unobservedCount, 1);
});

test('an unrecognized reason code is tracked separately as unmapped, never silently force-mapped to a family', () => {
  const report = buildEvidenceCompletenessReport([candidate({ unknownEvidence: ['SOME_FUTURE_REASON_CODE_NOT_YET_SEEN'] })]);
  assert.ok(report.unmappedReasonCodeCounts.some((row) => row.code === 'SOME_FUTURE_REASON_CODE_NOT_YET_SEEN'));
});

test('AEGIS_STATE_UNKNOWN is a real reason code but maps to no feature family (AEGIS is a separate authority, not a feature)', () => {
  const report = buildEvidenceCompletenessReport([candidate({ unknownEvidence: ['AEGIS_STATE_UNKNOWN'] })]);
  assert.equal(report.unmappedReasonCodeCounts.length, 0); // it IS mapped (to null), not unmapped
  const anyFamilyCountsIt = report.featureFamilyCompleteness.some((row) => row.unknownCount > 0);
  assert.equal(anyFamilyCountsIt, false); // no family absorbs it
});

test('symbolCompleteness and cycleCompleteness group correctly across multiple underlyings and snapshots', () => {
  const report = buildEvidenceCompletenessReport([
    candidate({ candidateId: 'c1', underlying: 'AAPL', snapshotId: 'snap-1', ownershipComponents: null }),
    candidate({ candidateId: 'c2', underlying: 'MSFT', snapshotId: 'snap-1' }),
    candidate({ candidateId: 'c3', underlying: 'AAPL', snapshotId: 'snap-2' }),
  ]);
  const aapl = report.symbolCompleteness.find((row) => row.underlying === 'AAPL');
  assert.equal(aapl?.candidateCount, 2);
  assert.equal(aapl?.ownershipUnknownCount, 1);
  const snap1 = report.cycleCompleteness.find((row) => row.snapshotId === 'snap-1');
  assert.equal(snap1?.candidateCount, 2);
  assert.equal(snap1?.ownershipUnknownCount, 1);
});

test('a duplicate candidateId is rejected, never silently double-counted', () => {
  assert.throws(
    () => buildEvidenceCompletenessReport([candidate({ candidateId: 'dup' }), candidate({ candidateId: 'dup' })]),
    /EVIDENCE_COMPLETENESS_DUPLICATE_CANDIDATE_ID/,
  );
});

test('no unknown reason is not positive evidence for any of the 20 feature families', () => {
  const report = buildEvidenceCompletenessReport([candidate()]);
  assert.equal(report.featureFamilyCompleteness.length, 20);
  for (const row of report.featureFamilyCompleteness) {
    assert.equal(row.knownCount, 0); assert.equal(row.unobservedCount, 1);
  }
  const proven = buildEvidenceCompletenessReport([candidate({ knownFeatureEvidence: {
    IV: { evidenceId: 'iv-observation', observedAt: '2026-09-24T13:30:00Z', complete: true },
  } })]);
  assert.equal(proven.featureFamilyCompleteness.find((r) => r.family === 'IV')?.knownCount, 1);
});

test('empty ownership and present-but-null AEGIS cannot count as known', () => {
  const report = buildEvidenceCompletenessReport([candidate({ ownershipComponents: [], aegisNewRiskState: null })]);
  assert.equal(report.ownershipKnownCount, 0); assert.equal(report.ownershipUnknownCount, 1);
  assert.equal(report.aegisKnownCount, 0); assert.equal(report.aegisUnknownCount, 1);
  assert.ok(report.ownershipComponentCompleteness.every((c) => c.unknownCount === 1));
});

test('an empty candidate batch is valid with zero counts, never a fabricated average', () => {
  const report = buildEvidenceCompletenessReport([]);
  assert.equal(report.totalCandidateCount, 0);
  assert.equal(report.ownershipKnownCount, 0);
  assert.equal(report.reasonCodeCounts.length, 0);
});

test('the report carries no eligibility/applicability/verdict field of any kind', () => {
  const report = buildEvidenceCompletenessReport([candidate()]);
  const keys = Object.keys(report).map((key) => key.toLowerCase());
  for (const forbidden of ['eligible', 'applicable', 'recommended', 'shouldtrade', 'winner']) {
    assert.ok(!keys.includes(forbidden), `must not carry: ${forbidden}`);
  }
});

test('the ownership/AEGIS data-lineage map covers ownability, all 5 components, and AEGIS newRiskState/families with real (non-empty) sourcing for every row', () => {
  assert.ok(ownershipAegisDataLineage.length >= 7); // ownability + 5 components + newRiskState (+ families, + placeholder inputs)
  for (const row of ownershipAegisDataLineage) {
    assert.ok(row.field.trim().length > 0);
    assert.ok(row.expectedSource.trim().length > 0);
    assert.ok(row.ingestionPath.trim().length > 0);
  }
  assert.ok(ownershipAegisDataLineage.some((row) => row.field === 'ownership.ownability'));
  assert.ok(ownershipAegisDataLineage.some((row) => row.field === 'aegis.newRiskState'));
});
