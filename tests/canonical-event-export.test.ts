import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCanonicalEventExport, canonicalExportHash } from '../src/research/canonical-event-export.js';
import type { SanitizedOptionomicsEventRevision } from '../src/database/optionomics-event-inspection.js';

const release = { canonicalSourceSha: 'a'.repeat(40), deploymentUrl: 'trading-bots-abc123-skillswap7.vercel.app',
  deploymentEnvironment: 'production' as const, source: 'VERCEL_BUILD_METADATA' as const };
const row: SanitizedOptionomicsEventRevision = {
  observationId: 'e1', sourceRawObservationId: 'r1', sourceFusionSnapshotId: 'f1', provider: 'OPTIONOMICS',
  providerEventIdHash: 'b'.repeat(64), revisionOrdinal: 1, payloadHash: 'c'.repeat(64),
  eventKind: 'fed', ticker: null, eventDate: '2026-10-28', scheduledAt: '2026-10-28T18:00:00Z',
  providerKnownAt: '2026-08-07T14:15:19Z', thetaFirstObservedAt: '2026-09-21T14:00:24Z',
  providerResponseAt: null, ingestionAt: '2026-09-21T14:00:24Z', decisionTime: '2026-09-21T14:00:25Z',
  sourceOperation: 'optionomics.list_events', sourceQuality: 'GOOD', sourceResponseHash: 'd'.repeat(64),
  pitTimingState: 'TIMING_VALID', forwardEvidence: 'THETA_OBSERVED_BEFORE_DECISION',
};

test('canonical hash ignores object insertion order recursively', () => {
  assert.equal(canonicalExportHash([{ b: { y: 2, x: 1 }, a: 0 }]),
    canonicalExportHash([{ a: 0, b: { x: 1, y: 2 } }]));
});
test('market-wide event export has zero symbols, immutable IDs and release binding', () => {
  const artifact = buildCanonicalEventExport({ rows: [row], generatedAt: '2026-09-21T15:00:00Z', release });
  assert.equal(artifact.scope, 'MARKET_WIDE');
  assert.equal(artifact.symbolCount, 0);
  assert.deepEqual(artifact.evidenceIds, ['e1']);
  assert.equal(artifact.canonicalSourceSha, release.canonicalSourceSha);
  assert.equal(artifact.rows[0]?.authority, 'OPTIONOMICS_SESSION_RESEARCH');
  assert.equal(artifact.contentHash, canonicalExportHash(artifact.rows));
});
test('duplicate evidence and non-production release facts are rejected', () => {
  assert.throws(() => buildCanonicalEventExport({ rows: [row, row], generatedAt: '2026-09-21T15:00:00Z', release }), /DUPLICATE/);
  assert.throws(() => buildCanonicalEventExport({ rows: [row], generatedAt: '2026-09-21T15:00:00Z',
    release: { ...release, deploymentUrl: 'unverified.example.com' } }), /RELEASE_EVIDENCE_INVALID/);
});
