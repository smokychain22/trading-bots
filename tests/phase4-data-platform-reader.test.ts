// EvidenceReader: replay and research read one logical dataset over two physical tiers (PostgreSQL hot, archive cold).
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryArchiveBackend } from '../src/storage/data-platform/archive-backend.js';
import { archivePartition, closePartition, retirePartition } from '../src/storage/data-platform/archival-pipeline.js';
import { EvidenceReader, logicalDatasetViewSql, type HotEvidenceSource } from '../src/storage/data-platform/evidence-reader.js';
import { alwaysReplayable, gzipNdjsonCodec, makeHarness } from './helpers/data-platform-model.js';

test('EvidenceReader: the same row is returned from HOT before retirement and from COLD after it, identical; a corrupted archive can never answer; unknown keys are null', async () => {
  const harness = makeHarness({ backend: new InMemoryArchiveBackend() });
  const rows = Array.from({ length: 25 }, (_, index) => JSON.stringify({ fusion_snapshot_id: `snap-${index}`, session_date: '2026-10-05', blob: 'ab'.repeat(30 + index), n: index }));
  harness.db.write('cycle-evidence-blob', '2026-10-05', rows, 10 * 1024 * 1024);
  const hotSource: HotEvidenceSource = {
    async readRow(dataset, partition, keyColumn, key) {
      const part = harness.db.get(dataset, partition);
      if (part === undefined || part.dropped) return null;
      const line = part.rows.find((candidate) => (JSON.parse(candidate) as Record<string, unknown>)[keyColumn] === key);
      return line === undefined ? null : JSON.parse(line) as Record<string, unknown>;
    },
  };
  const reader = new EvidenceReader(hotSource, harness.store, harness.backend);
  const before = await reader.readRow('cycle-evidence-blob', '2026-10-05', 'fusion_snapshot_id', 'snap-7');
  assert.equal(before?.tier, 'HOT');
  const ctx = { botId: 'theta', sourceSha: 'a'.repeat(40), policyVersion: 'p', backend: harness.backend, store: harness.store, allowUnverifiedRetirement: true, ops: harness.db, codec: gzipNdjsonCodec, replay: alwaysReplayable, now: () => '2026-10-06T00:00:00Z' };
  await closePartition(ctx, 'cycle-evidence-blob', '2026-10-05');
  await archivePartition(ctx, 'cycle-evidence-blob', '2026-10-05');
  await retirePartition(ctx, 'cycle-evidence-blob', '2026-10-05');
  assert.equal(harness.db.get('cycle-evidence-blob', '2026-10-05')?.dropped, true);
  const after = await reader.readRow('cycle-evidence-blob', '2026-10-05', 'fusion_snapshot_id', 'snap-7');
  assert.equal(after?.tier, 'COLD');
  assert.deepEqual(after?.row, before?.row, 'cold read returns the original row exactly');
  assert.match(after?.archiveId ?? '', /^[0-9a-f]{40}$/);
  assert.equal(await reader.readRow('cycle-evidence-blob', '2026-10-05', 'fusion_snapshot_id', 'nope'), null);
  assert.equal(await reader.readRow('cycle-evidence-blob', '2026-10-09', 'fusion_snapshot_id', 'snap-1'), null);
  const scan = await reader.readPartition('cycle-evidence-blob', '2026-10-05', 'fusion_snapshot_id', async () => null);
  assert.equal(scan.tier, 'COLD');
  assert.equal(scan.rows.length, 25);
  // corrupt the archive object: a fresh reader refuses to answer
  const backend = harness.backend as InMemoryArchiveBackend;
  const key = [...backend.objects.keys()].find((name) => name.startsWith('data/')) as string;
  const damaged = Uint8Array.from(backend.objects.get(key) as Uint8Array);
  damaged[damaged.length - 9] = (damaged[damaged.length - 9] ?? 0) ^ 0xff;
  backend.objects.set(key, damaged);
  await assert.rejects(new EvidenceReader(hotSource, harness.store, harness.backend).readRow('cycle-evidence-blob', '2026-10-05', 'fusion_snapshot_id', 'snap-7'), /ARCHIVE_FILE_HASH_MISMATCH/);
});

test('logical dataset view SQL: one dataset over two tiers, hot wins on overlap; identifiers are validated', () => {
  const sql = logicalDatasetViewSql({ viewName: 'pit_candidate', keyColumn: 'candidate_id', hotRelation: "postgres_query('theta', 'SELECT * FROM dp.pit_candidate')", parquetGlob: 'C:/archive/parquet/candidate_detail/dp_session_date=*/*.parquet' });
  assert.match(sql, /UNION ALL BY NAME/);
  assert.match(sql, /'HOT' AS tier/);
  assert.match(sql, /NOT IN \(SELECT candidate_id FROM/);
  assert.match(logicalDatasetViewSql({ viewName: 'v', keyColumn: 'k', hotRelation: null, parquetGlob: 'x.parquet' }), /'COLD' AS tier/);
  assert.throws(() => logicalDatasetViewSql({ viewName: 'bad name;drop', keyColumn: 'k', hotRelation: null, parquetGlob: 'x' }), /INVALID_VIEW_IDENTIFIER/);
});
