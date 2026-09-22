import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalEventExportContract, canonicalExportHash, type CanonicalEventRow } from '../src/research/canonical-event-export.js';
import {
  fromCanonicalEventExportRow, loadCanonicalEventExport, runEventPitCanonicalExportStudy,
} from '../src/research/event-pit-canonical-export-runner.js';

const REAL_MAIN_SHA = 'a0e69e1184f975c43a46c18bf55fe7d5cd8a6ca9'; // the real canonicalSourceSha documented in
// docs/operations/THETA_R7_CRITICAL_EVIDENCE_2026-09-21.md for Codex's first real canonical event export.

/**
 * These six rows reconstruct the STRUCTURE and the REAL documented
 * scheduled/known dates and event kinds from the R7 receipt's own
 * summary table -- they are a fixture, not the actual captured export
 * (this session has no access to the real Aiven evidenceId/payloadHash/
 * providerEventIdHash values or the real research_exports/ artifact
 * file, which is gitignored and requires Production worker credentials
 * this research branch does not have). Never claim this fixture IS the
 * real export; it only proves the conversion/classification PATH is
 * structurally sound against the real documented shape and values.
 */
function sixRowFixture(): readonly CanonicalEventRow[] {
  const specs = [
    { evidenceId: 'evid-4af6fac1', kind: 'fed', scheduledAt: '2026-10-28T18:00:00.000000Z', knownAt: '2026-08-07T14:15:00.000000Z' },
    { evidenceId: 'evid-188e761b', kind: 'macro', scheduledAt: '2026-09-30T12:30:00.000000Z', knownAt: '2026-08-31T04:15:00.000000Z' },
    { evidenceId: 'evid-d21d8bcb', kind: 'macro', scheduledAt: '2026-10-15T12:30:00.000000Z', knownAt: '2026-09-15T04:15:00.000000Z' },
    { evidenceId: 'evid-7f796edd', kind: 'macro', scheduledAt: '2026-10-15T12:30:00.000000Z', knownAt: '2026-09-15T04:15:00.000000Z' },
    { evidenceId: 'evid-ce9640d9', kind: 'macro', scheduledAt: '2026-10-14T12:30:00.000000Z', knownAt: '2026-09-14T04:15:00.000000Z' },
    { evidenceId: 'evid-be834592', kind: 'macro', scheduledAt: '2026-10-02T12:30:00.000000Z', knownAt: '2026-09-02T04:15:00.000000Z' },
  ];
  return specs.map((spec, i) => ({
    evidenceId: spec.evidenceId, sourceRawObservationId: `raw-${i}`, sourceFusionSnapshotId: `snap-${i}`,
    authority: 'OPTIONOMICS_SESSION_RESEARCH' as const, providerEventIdHash: spec.evidenceId.replace('evid-', ''),
    payloadHash: `payload-${i}`, eventKind: spec.kind, ticker: null, scheduledAt: spec.scheduledAt,
    providerKnownAt: spec.knownAt, thetaFirstObservedAt: '2026-09-21T14:00:24.787Z', decisionTime: '2026-09-21T14:00:25.325Z',
    pitTimingState: 'TIMING_VALID', forwardEvidence: null,
  }));
}

function validExport(rows: readonly CanonicalEventRow[] = sixRowFixture()) {
  const sorted = [...rows].sort((a, b) => a.thetaFirstObservedAt.localeCompare(b.thetaFirstObservedAt) || a.evidenceId.localeCompare(b.evidenceId));
  return {
    exportContractVersion: canonicalEventExportContract, generatedAt: '2026-09-21T14:00:25.400Z',
    sanitized: true, sourceDescription: 'Immutable Aiven Optionomics event revision observations, no account or credential fields',
    provider: 'OPTIONOMICS', sourceWindowStart: sorted[0]?.thetaFirstObservedAt ?? '2026-09-21T14:00:24.787Z',
    sourceWindowEnd: sorted[sorted.length - 1]?.thetaFirstObservedAt ?? '2026-09-21T14:00:24.787Z',
    scope: 'MARKET_WIDE' as const, symbolCount: 0, canonicalSourceSha: REAL_MAIN_SHA,
    releaseEvidence: {
      canonicalSourceSha: REAL_MAIN_SHA, deploymentUrl: 'trading-bots-abc123-skillswap7.vercel.app',
      deploymentEnvironment: 'production' as const, source: 'VERCEL_BUILD_METADATA' as const,
    },
    evidenceIds: sorted.map((row) => row.evidenceId), contentHash: canonicalExportHash(sorted),
    rowCount: sorted.length, rows: sorted,
  };
}

test('loadCanonicalEventExport reports AWAITING_REAL_EXPORT for no export', () => {
  assert.equal(loadCanonicalEventExport(null).status, 'AWAITING_REAL_EXPORT');
});

test('loadCanonicalEventExport rejects a contract-version mismatch (Codex uses the generic v3 envelope tag)', () => {
  const result = loadCanonicalEventExport({ ...validExport(), exportContractVersion: 'wrong' });
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_CONTRACT_VERSION_MISMATCH');
});

test('loadCanonicalEventExport rejects malformed release evidence', () => {
  const result = loadCanonicalEventExport({
    ...validExport(), releaseEvidence: { canonicalSourceSha: 'not-a-sha', deploymentUrl: 'x', deploymentEnvironment: 'production', source: 'VERCEL_BUILD_METADATA' },
  });
  assert.equal(result.status, 'EXPORT_RELEASE_EVIDENCE_INVALID');
});

test('loadCanonicalEventExport rejects a canonicalSourceSha that disagrees with its own releaseEvidence', () => {
  const result = loadCanonicalEventExport({ ...validExport(), canonicalSourceSha: 'b'.repeat(40) });
  assert.equal(result.reason, 'EXPORT_CANONICAL_SHA_RELEASE_EVIDENCE_MISMATCH');
});

test('loadCanonicalEventExport rejects a content hash that does not match Codex\'s own recomputed hash', () => {
  const result = loadCanonicalEventExport({ ...validExport(), contentHash: '0'.repeat(64) });
  assert.equal(result.status, 'EXPORT_CONTENT_HASH_MISMATCH');
});

test('loadCanonicalEventExport accepts a fully valid export matching Codex\'s real producer shape', () => {
  const result = loadCanonicalEventExport(validExport());
  assert.equal(result.status, 'LOADED');
  assert.equal(result.export?.rowCount, 6);
  assert.equal(result.export?.scope, 'MARKET_WIDE');
  assert.equal(result.export?.symbolCount, 0);
});

test('fromCanonicalEventExportRow maps ticker=null to underlying=null, never a fabricated symbol', () => {
  const row = sixRowFixture()[0] as CanonicalEventRow;
  const mapped = fromCanonicalEventExportRow(row);
  assert.equal(mapped.underlying, null);
  assert.equal(mapped.identityKey, row.providerEventIdHash);
  assert.equal(mapped.providerKnownAt, row.providerKnownAt);
  assert.equal(mapped.thetaFirstObservedAt, row.thetaFirstObservedAt);
  assert.equal(mapped.providerTimestampIndependentlyVerified, false);
});

test('runEventPitCanonicalExportStudy reports AWAITING_REAL_EXPORT with no export', () => {
  const result = runEventPitCanonicalExportStudy(null);
  assert.equal(result.status, 'AWAITING_REAL_EXPORT');
  assert.equal(result.classifications, null);
});

test('runEventPitCanonicalExportStudy classifies every row individually -- all six fixture rows earn PIT_SAFE_THETA_FIRST_OBSERVED, the strongest tier, because Codex\'s real thetaFirstObservedAt is a genuinely persisted first-observation timestamp', () => {
  const result = runEventPitCanonicalExportStudy(validExport());
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.rowCount, 6);
  assert.equal(result.scope, 'MARKET_WIDE');
  assert.equal(result.symbolCount, 0);
  assert.equal(result.classifications?.length, 6);
  // This is the whole point of consuming a real Codex export over direct MCP research: Codex's
  // thetaFirstObservedAt is Aiven-persisted, not merely a provider self-report, so it satisfies
  // classifyHistoricalEventPit's strongest tier -- unlike the AMBIGUOUS/HISTORICAL_NOT_PIT_SAFE
  // results this module produced against direct-MCP-only evidence with no persisted first-observed store.
  for (const row of result.classifications ?? []) {
    assert.equal(row.classification.classification, 'PIT_SAFE_THETA_FIRST_OBSERVED');
    assert.equal(row.ticker, null);
  }
});
