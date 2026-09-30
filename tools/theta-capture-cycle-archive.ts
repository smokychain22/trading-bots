import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import type { CycleArchiveReplayIdentity } from '../src/theta/cycle-archive-replay.js';

const cycleId = process.argv.find((value) => value.startsWith('--cycle-id='))?.slice('--cycle-id='.length);
if (cycleId === undefined || !/^[0-9a-f-]{36}$/.test(cycleId)) throw new Error('CYCLE_ID_REQUIRED');
const environment = loadEnvironmentFile(resolve('.env.local'), {});
if (!environment.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
const outputDir = resolve('.theta-local-worker', 'replay-corpus');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000,
  application_name: 'theta_cycle_archive_read_only_capture' });
let archive: Buffer;
let sourceSha: string;
let storedContentHash: string;
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{ evidence_archive_gzip: Buffer | null; evidence_archive_hash: string | null;
      receipt_json: unknown }>(
      `SELECT s.evidence_archive_gzip,s.evidence_archive_hash,d.receipt_json FROM trade.fusion_snapshot s
       JOIN LATERAL (SELECT receipt_json FROM trade.decision WHERE fusion_snapshot_id=s.fusion_snapshot_id
         ORDER BY decided_at DESC,decision_id DESC LIMIT 1) d ON true
       WHERE s.fusion_snapshot_id=$1::uuid`, [cycleId]);
    await client.query('COMMIT');
    if (result.rows.length !== 1 || result.rows[0]?.evidence_archive_gzip === null) {
      throw new Error('CYCLE_ARCHIVE_NOT_FOUND');
    }
    archive = result.rows[0].evidence_archive_gzip;
    storedContentHash = result.rows[0].evidence_archive_hash ?? '';
    if (!/^[0-9a-f]{64}$/.test(storedContentHash)) throw new Error('CYCLE_ARCHIVE_STORED_HASH_MISSING');
    const receipt = result.rows[0].receipt_json as { releaseIdentity?: { sourceSha?: unknown } } | null;
    sourceSha = typeof receipt?.releaseIdentity?.sourceSha === 'string' ? receipt.releaseIdentity.sourceSha : '';
    if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('CYCLE_ARCHIVE_SOURCE_SHA_MISSING');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Original failure remains authoritative. */ }
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const identity: CycleArchiveReplayIdentity = {
  cycleId, sourceSha, archiveSha256: hash(archive),
  archiveContentHash: hash(Buffer.from(canonicalJson(decodeCycleEvidenceArchive(archive)))),
};
if (identity.archiveContentHash !== storedContentHash) throw new Error('CYCLE_ARCHIVE_DATABASE_HASH_MISMATCH');
await mkdir(outputDir, { recursive: true });
const basename = `${cycleId}-${identity.archiveSha256}`;
const archivePath = resolve(outputDir, `${basename}.bin`);
const manifestPath = resolve(outputDir, `${basename}.json`);
try { await writeFile(archivePath, archive, { flag: 'wx' }); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
    || hash(await readFile(archivePath)) !== identity.archiveSha256) throw error;
}
try { await writeFile(manifestPath, `${JSON.stringify(identity, null, 2)}\n`, { flag: 'wx' }); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
    || JSON.stringify(JSON.parse(await readFile(manifestPath, 'utf8'))) !== JSON.stringify(identity)) throw error;
}
process.stdout.write(`${JSON.stringify({ state: 'CAPTURED_READ_ONLY', cycleId, sourceSha, archiveBytes: archive.byteLength,
  archiveSha256: identity.archiveSha256, manifestPath, archivePath, brokerMutations: 0 })}\n`);
