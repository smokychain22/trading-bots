// Research and replay consumers read evidence through ONE logical interface, never directly from a physical home that retires. Structural proof over the source tree:
//  - every consumer of the cycle blob uses cycleBlobSelectExpression (hot legacy column OR partitioned dp blob), or is a forensic/archive tool that names the legacy column on purpose;
//  - every consumer of point-in-time evidence reads the unchanged relation name `trade.candidate_point_in_time_evidence`, which the compatibility swap (070) turns into old + new rows;
//  - nothing outside the data platform reads dp.* partitions directly except through the platform modules (they are retired partitions, not an API).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function files(directory: string): string[] { return readdirSync(directory).flatMap((name) => { const path = join(directory, name); return statSync(path).isDirectory() ? files(path) : /\.(ts|mjs)$/.test(name) ? [path] : []; }); }
const normalize = (path: string): string => path.replaceAll('\\', '/');
const sources = [...files('src'), ...files('tools'), ...files('api')].map((path) => ({ path: normalize(path), text: readFileSync(path, 'utf8') }));

test('every reader of the cycle blob goes through cycleBlobSelectExpression, or is a named forensic/schema tool, or the writer itself', () => {
  const forensic = new Set(['tools/theta-storage-archive.ts', 'tools/theta-storage-amplification.ts', 'tools/theta-storage-measure.ts', 'tools/database-verify.mjs', 'tools/theta-post-migration-resume-preflight.ts', 'tools/theta-postgres-stability-soak.ts',
    'src/theta/postgres-theta-cycle-store.ts', 'tools/theta-writer-measure.ts']);
  const offenders = sources.filter((file) => file.text.includes('evidence_archive_gzip') && !file.path.startsWith('src/storage/data-platform/') && !forensic.has(file.path) && !file.text.includes('cycleBlobSelectExpression'));
  assert.deepEqual(offenders.map((file) => file.path), [], 'a new direct reader of the legacy blob column would break when the blob moves to a partition');
});

test('point-in-time evidence consumers use the stable relation name that the compatibility swap serves, never the renamed legacy table or a dp relation', () => {
  const direct = sources.filter((file) => /candidate_point_in_time_evidence_legacy|dp\.pit_candidate|dp\.candidate_point_in_time_evidence_v/.test(file.text) && !file.path.startsWith('src/storage/data-platform/') && !['tools/theta-pit-archive-parity.ts', 'tools/theta-pit-production-measure.ts', 'tools/theta-writer-measure.ts', 'tools/theta-cold-archive-measure.ts'].includes(file.path));
  assert.deepEqual(direct.map((file) => file.path), [], 'consumers must not name the physical homes');
  const consumers = sources.filter((file) => file.text.includes('trade.candidate_point_in_time_evidence') && !file.path.startsWith('src/storage/data-platform/'));
  assert.ok(consumers.length >= 6, `the known consumers are all on the stable name (${consumers.length})`);
});

test('only the data platform modules read dp.* partitions; research reads through EvidenceReader / the logical views', () => {
  const offenders = sources.filter((file) => /\bdp\.(cycle_evidence_blob|decision_context|payload_blob|payload_observation|rejection_histogram)\b/.test(file.text)
    && !file.path.startsWith('src/storage/data-platform/') && !['tools/theta-data-platform.ts', 'tools/theta-writer-measure.ts', 'tools/theta-pit-production-measure.ts', 'tools/theta-pit-archive-parity.ts', 'tools/theta-cold-archive-measure.ts', 'src/theta/postgres-theta-cycle-store.ts'].includes(file.path));
  assert.deepEqual(offenders.map((file) => file.path), []);
});
