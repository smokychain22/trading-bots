import pg from 'pg';
import { normalizeAivenConnectionString } from '../../database-connection.mjs';

const connectionString = process.env.THETA_BACKUP_SNAPSHOT_URL;
if (!connectionString) throw new Error('THETA_BACKUP_SNAPSHOT_URL_MISSING');

const normalizedConnectionString = normalizeAivenConnectionString(connectionString);
const exporter = new pg.Client({
  connectionString: normalizedConnectionString,
  application_name: 'theta-portable-backup-snapshot-exporter',
});
const collector = new pg.Client({
  connectionString: normalizedConnectionString,
  application_name: 'theta-portable-backup-snapshot-collector',
});

let closing = false;
let keepaliveBusy = false;
let keepalive = null;
let requestRelease;
const releaseRequested = new Promise((resolve) => { requestRelease = resolve; });
let requestBuffer = '';
let queryQueue = Promise.resolve();
let exporterAvailable = true;
let collectorAvailable = true;

async function closeSnapshot() {
  if (closing) return;
  closing = true;
  if (keepalive) clearInterval(keepalive);
  try { await collector.query('ROLLBACK'); } catch {}
  try { await collector.end(); } catch {}
  try { await exporter.query('ROLLBACK'); } catch {}
  try { await exporter.end(); } catch {}
}

await exporter.connect();
await exporter.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
const exported = await exporter.query(`
  SELECT pg_export_snapshot() AS snapshot_id,
         pg_database_size(current_database())::text AS database_size_bytes,
         current_setting('server_version_num') AS server_version_num
`);
const row = exported.rows[0];
if (!row || typeof row.snapshot_id !== 'string') {
  await closeSnapshot();
  throw new Error('POSTGRES_SNAPSHOT_EXPORT_FAILED');
}
if (!/^[0-9A-Fa-f:-]+$/.test(row.snapshot_id)) {
  await closeSnapshot();
  throw new Error('POSTGRES_SNAPSHOT_ID_INVALID');
}

// Import immediately into a second transaction. All source inventories are
// served from this collector, while pg_dump imports the exported identifier.
// Once each consumer has imported the snapshot, they remain consistent even
// if Aiven later terminates the exporter connection during the long archive.
await collector.connect();
await collector.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
await collector.query(`SET TRANSACTION SNAPSHOT '${row.snapshot_id}'`);

exporter.on('error', (error) => {
  exporterAvailable = false;
  process.stderr.write(`SNAPSHOT_EXPORTER_CONNECTION_FAILED:${error instanceof Error ? error.name : 'UNKNOWN'}\n`);
});
collector.on('error', (error) => {
  collectorAvailable = false;
  process.stderr.write(`SNAPSHOT_COLLECTOR_CONNECTION_FAILED:${error instanceof Error ? error.name : 'UNKNOWN'}\n`);
  requestRelease();
});

process.stdout.write(`${JSON.stringify({
  snapshotId: row.snapshot_id,
  databaseSizeBytes: row.database_size_bytes,
  serverVersionNum: row.server_version_num,
})}\n`);

keepalive = setInterval(async () => {
  if (closing || keepaliveBusy) return;
  keepaliveBusy = true;
  if (exporterAvailable) {
    try { await exporter.query('SELECT 1'); }
    catch (error) {
      exporterAvailable = false;
      process.stderr.write(`SNAPSHOT_EXPORTER_KEEPALIVE_FAILED:${error instanceof Error ? error.name : 'UNKNOWN'}\n`);
    }
  }
  if (collectorAvailable) {
    try { await collector.query('SELECT 1'); }
    catch (error) {
      collectorAvailable = false;
      process.stderr.write(`SNAPSHOT_COLLECTOR_KEEPALIVE_FAILED:${error instanceof Error ? error.name : 'UNKNOWN'}\n`);
      requestRelease();
      process.exitCode = 1;
    }
  }
  keepaliveBusy = false;
}, 30_000);
// Keep this timer referenced. Redirected stdin is not a reliable event-loop
// anchor on every Windows/PowerShell combination, and an early helper exit
// invalidates the exported PostgreSQL snapshot while the parent backup is
// still using it. The parent sends RELEASE and has a bounded kill fallback.

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  requestBuffer += String(chunk);
  while (requestBuffer.includes('\n')) {
    const newline = requestBuffer.indexOf('\n');
    const line = requestBuffer.slice(0, newline).trim();
    requestBuffer = requestBuffer.slice(newline + 1);
    if (!line) continue;
    if (line === 'RELEASE') {
      requestRelease();
      continue;
    }
    queryQueue = queryQueue.then(async () => {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ id: null, ok: false, error: 'SNAPSHOT_QUERY_REQUEST_INVALID' })}\n`);
        return;
      }
      if (request?.type !== 'QUERY' || typeof request.id !== 'string' || typeof request.sql !== 'string'
        || request.id.length > 80 || request.sql.length > 5_000_000) {
        process.stdout.write(`${JSON.stringify({ id: request?.id ?? null, ok: false, error: 'SNAPSHOT_QUERY_REQUEST_INVALID' })}\n`);
        return;
      }
      keepaliveBusy = true;
      try {
        const result = await collector.query(request.sql);
        if (result.rows.length !== 1 || Object.keys(result.rows[0] ?? {}).length !== 1) {
          throw new Error('SNAPSHOT_QUERY_RESULT_SHAPE_INVALID');
        }
        const value = Object.values(result.rows[0])[0];
        process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, value: value === null ? null : String(value) })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ id: request.id, ok: false,
          error: error instanceof Error ? error.name : 'SNAPSHOT_QUERY_FAILED' })}\n`);
        requestRelease();
      } finally {
        keepaliveBusy = false;
      }
    });
  }
});
// Redirected stdin can report EOF immediately on some Windows hosts. EOF is
// not an authorization to release the database snapshot. The referenced
// keepalive owns the lifetime instead.
process.once('SIGINT', requestRelease);
process.once('SIGTERM', requestRelease);
await releaseRequested;
await queryQueue;
await closeSnapshot();
