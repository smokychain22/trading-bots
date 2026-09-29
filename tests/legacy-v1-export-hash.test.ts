import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, sha256 } from '../src/research/point-in-time-evidence.js';
import { inspectLegacyV1ExportHash } from '../src/research/legacy-v1-export-hash.js';

const raw = (includeExportedAt: boolean) => {
  const base = {
    schemaVersion: 'theta-r6-dataset-v1',
    sourceWindow: { start: '2026-09-14 13:30:00+00', end: '2026-09-14 14:30:00+00' },
    exportedAt: '2026-09-14T14:31:00Z', featureSetVersion: 'v1', strategyVersions: ['q1'],
    rows: { candidateSets: [{ candidateSetId: 'a', decisionTime: '2026-09-14T14:30:00Z', count: 1 }],
      candidates: [], shadowCandidates: [], strategyFrontiers: [], managementSnapshots: [],
      lifecycleOutcomes: [], wholeChainOutcomes: [], executionEvidence: [] },
    rowCounts: { candidateSets: 1, candidates: 0, shadowCandidates: 0, strategyFrontiers: 0,
      managementSnapshots: 0, lifecycleOutcomes: 0, wholeChainOutcomes: 0, executionEvidence: 0 },
  };
  const legacyRows = { ...base.rows, candidateSets: [{ ...base.rows.candidateSets[0], decisionTime: {} }] };
  const { exportedAt, ...identity } = { ...base, rows: legacyRows };
  return { ...base, datasetHash: sha256(canonicalJson(includeExportedAt ? { ...identity, exportedAt } : identity)) };
};

const firstSet = (artifact: ReturnType<typeof raw>) => {
  const set = artifact.rows.candidateSets[0];
  assert.ok(set);
  return set;
};

test('reproduces both historical v1 producer hash scopes without promoting the archive', () => {
  for (const includeExportedAt of [false, true]) {
    const verdict = inspectLegacyV1ExportHash(raw(includeExportedAt));
    assert.equal(verdict.state, 'PRODUCER_HASH_REPRODUCED');
    assert.equal(verdict.producerVariant, includeExportedAt
      ? 'DATE_ELISION_EXPORTED_AT_INCLUDED' : 'DATE_ELISION_EXPORTED_AT_EXCLUDED');
    assert.equal(verdict.timestampFieldsElided, 1);
    assert.equal(verdict.timestampIntegrityProtected, false);
    assert.equal(verdict.promotionGrade, false);
  }
});

test('historical date-elision bug means a changed timestamp can keep the same producer hash', () => {
  const artifact = raw(false);
  firstSet(artifact).decisionTime = '2026-09-14T15:30:00Z';
  assert.equal(inspectLegacyV1ExportHash(artifact).state, 'PRODUCER_HASH_REPRODUCED');
  firstSet(artifact).count = 2;
  assert.equal(inspectLegacyV1ExportHash(artifact).state, 'UNRESOLVED');
});

test('later date-aware v1 producer protects timestamp text without granting promotion', () => {
  const artifact = raw(false);
  const identity = { schemaVersion: artifact.schemaVersion, sourceWindow: artifact.sourceWindow,
    featureSetVersion: artifact.featureSetVersion, strategyVersions: artifact.strategyVersions,
    rows: artifact.rows, rowCounts: artifact.rowCounts };
  artifact.datasetHash = sha256(canonicalJson(identity));
  const verdict = inspectLegacyV1ExportHash(artifact);
  assert.equal(verdict.producerVariant, 'DATE_AWARE_EXPORTED_AT_EXCLUDED');
  assert.equal(verdict.timestampIntegrityProtected, true);
  assert.equal(verdict.promotionGrade, false);
  firstSet(artifact).decisionTime = '2026-09-14T15:30:00Z';
  assert.equal(inspectLegacyV1ExportHash(artifact).state, 'UNRESOLVED');
});

test('rejects malformed timestamp fields instead of erasing arbitrary data', () => {
  const artifact = raw(false);
  firstSet(artifact).decisionTime = 'not-a-timestamp';
  assert.throws(() => inspectLegacyV1ExportHash(artifact), /LEGACY_EXPORT_TIMESTAMP_INVALID/);
});
