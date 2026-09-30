import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import { replayCycleArchive } from '../src/theta/cycle-archive-replay.js';
import { postgresCycleEvidenceStorageVersion } from '../src/theta/postgres-cycle-evidence-storage.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';

const sourceSha = 'a'.repeat(40);
const currentSha = 'b'.repeat(40);
const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const input: CanonicalStrategyFrontierInput = {
  snapshotId: 'replay-test', timestamp: '2026-09-29T15:00:00.000Z', strategyVersion: 'test',
  contracts: [], routing: null, stock: null, assignmentCapacityQty: null,
  aegisNewRiskState: null, eventState: null, unmanagedBrokerPositionCount: 0,
  unevaluatedUnderlyingCount: 0, optionomicsContext: null,
};

function fixture(changedExpectedHash = false, replayInput: CanonicalStrategyFrontierInput = input,
  methodInputProvenance?: unknown) {
  const frontier = buildCanonicalStrategyFrontier(replayInput);
  const decoded = { contractVersion: postgresCycleEvidenceStorageVersion, canonicalFrontierInput: replayInput,
    strategyFrontier: changedExpectedHash ? { ...frontier, contentHash: 'c'.repeat(64) } : frontier,
    ...(methodInputProvenance === undefined ? {} : { methodInputProvenance }) };
  const archive = gzipSync(Buffer.from(canonicalJson(decoded)));
  return { archive, identity: { cycleId: 'replay-test', sourceSha, archiveSha256: hash(archive),
    archiveContentHash: hash(Buffer.from(canonicalJson(decoded))) } };
}

test('persisted complete cycle archive replays through canonical frontier without a provider call', () => {
  const { archive, identity } = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_DURING_REPLAY'); };
  try {
    const result = replayCycleArchive(archive, identity, sourceSha);
    assert.equal(result.state, 'SAME_SOURCE_REPRODUCED');
    assert.equal(result.inputContractCount, 0);
    assert.equal(result.providerRequests, 0);
    assert.equal(result.brokerMutations, 0);
    assert.equal(result.methodProvenanceState, 'MISSING_LEGACY');
    assert.deepEqual(result.realInputEligibleMethodIds, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('replay reports real-input eligibility without granting L7 to manual or partial methods', () => {
  const provenance = [
    { methodId: 'AEGIS_RISK_PERMISSION', executed: true, inputRealness: 'REAL',
      decisiveInputs: [{ name: 'risk', origin: 'DERIVED_FROM_REAL' }] },
    { methodId: 'CANONICAL_ENTRY_SELECTION', executed: true, inputRealness: 'PARTIAL_REAL',
      decisiveInputs: [{ name: 'risk', origin: 'CALLER_MANUAL' }] },
    { methodId: 'STRATEGY_APPLICABILITY_ROUTER', executed: true, inputRealness: 'MANUAL',
      decisiveInputs: [{ name: 'state', origin: 'CALLER_MANUAL' }] },
    { methodId: 'UNREACHED', executed: false, inputRealness: 'REAL',
      decisiveInputs: [{ name: 'market', origin: 'REAL_PROVIDER' }] },
  ];
  const { archive, identity } = fixture(false, input, provenance);
  const result = replayCycleArchive(archive, identity, sourceSha);
  assert.equal(result.methodProvenanceState, 'PRESENT');
  assert.deepEqual(result.realInputEligibleMethodIds, ['AEGIS_RISK_PERMISSION']);
  assert.deepEqual(result.nonRealExecutedMethodIds,
    ['CANONICAL_ENTRY_SELECTION', 'STRATEGY_APPLICABILITY_ROUTER']);
  assert.ok(!result.realInputEligibleMethodIds.includes('UNREACHED'));
});

test('malformed or duplicate method provenance fails closed after archive hash verification', () => {
  for (const provenance of [null, {}, [{ methodId: 'A', executed: true, inputRealness: 'REAL',
    decisiveInputs: [{ name: 'market', origin: 'REAL_PROVIDER' }] },
  { methodId: 'A', executed: true, inputRealness: 'REAL',
    decisiveInputs: [{ name: 'market', origin: 'REAL_PROVIDER' }] }],
  [{ methodId: 'A', executed: true, inputRealness: 'FAKE' }]]) {
    const { archive, identity } = fixture(false, input, provenance);
    if (provenance === null) {
      assert.equal(replayCycleArchive(archive, identity, sourceSha).methodProvenanceState, 'MISSING_LEGACY');
    } else {
      assert.throws(() => replayCycleArchive(archive, identity, sourceSha), /METHOD_PROVENANCE_INVALID/);
    }
  }
  const contradiction = fixture(false, input, [{ methodId: 'A', executed: true, inputRealness: 'REAL',
    decisiveInputs: [{ name: 'manual', origin: 'CALLER_MANUAL' }] }]);
  assert.throws(() => replayCycleArchive(contradiction.archive, contradiction.identity, sourceSha),
    /METHOD_PROVENANCE_CONTRADICTORY/);
});

test('a changed source is labeled a counterfactual even when output is unchanged', () => {
  const { archive, identity } = fixture();
  assert.equal(replayCycleArchive(archive, identity, currentSha).state, 'CROSS_SOURCE_SAME_RESULT');
});

test('a compressed cycle archive replays a T0 larger than the optional 4 MiB spool cap', () => {
  const largeInput = { ...input, optionomicsContext: { rawResearchContext: 'R'.repeat(5 * 1024 * 1024) } };
  const { archive, identity } = fixture(false, largeInput);
  assert.ok(Buffer.byteLength(canonicalJson(largeInput)) > 4 * 1024 * 1024);
  assert.ok(archive.byteLength < 4 * 1024 * 1024);
  assert.equal(replayCycleArchive(archive, identity, sourceSha).state, 'SAME_SOURCE_REPRODUCED');
});

test('historical hash disagreement is never called a same-source reproduction', () => {
  const { archive, identity } = fixture(true);
  assert.equal(replayCycleArchive(archive, identity, sourceSha).state, 'SAME_SOURCE_MISMATCH');
  assert.equal(replayCycleArchive(archive, identity, currentSha).state, 'CROSS_SOURCE_CHANGED_RESULT');
});

test('tampered or incomplete archives fail closed before replay', () => {
  const { archive, identity } = fixture();
  assert.throws(() => replayCycleArchive(Buffer.concat([archive, Buffer.from('tamper')]), identity, sourceSha),
    /BYTES_HASH_MISMATCH/);
  const incomplete = gzipSync(Buffer.from(canonicalJson({ contractVersion: postgresCycleEvidenceStorageVersion,
    canonicalFrontierInput: null, strategyFrontier: null })));
  const missing = { ...identity, archiveSha256: hash(incomplete),
    archiveContentHash: hash(Buffer.from(canonicalJson({ contractVersion: postgresCycleEvidenceStorageVersion,
      canonicalFrontierInput: null, strategyFrontier: null }))) };
  assert.throws(() => replayCycleArchive(incomplete, missing, sourceSha), /T0_OR_FRONTIER_MISSING/);
});
