// Archive-before-purge CLI (Phase 4 storage decision). Reads Production in READ ONLY transactions and writes lossless archive files OUTSIDE the database.
// There is NO delete, update or DDL statement anywhere in this file. Modes:
//   plan          measure each candidate population (rows, stored bytes, sampled uncompressed bytes, time range, foreign-key dependents)
//   export        stream a population into gzip NDJSON chunks + manifest (resumable, egress-bounded)
//   verify        re-read the archive from disk, compare with Production (row count, aggregate by day, sampled byte-exact row re-fetch), write a receipt
//   replay-sample archive and replay a sample of current-contract cycle archive blobs through the production replay code
//   dry-run       build THETA_STORAGE_PURGE_DRY_RUN from the manifests, receipts and live measurements (never deletes)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { replayCycleArchive } from '../src/theta/cycle-archive-replay.js';
import {
  ArchiveChunkWriter, buildManifest, evaluatePurgeEligibility, isOutsideDatabaseArchiveRoot, readArchiveRows, sha256, verifyArchiveOnDisk, writeManifest,
  type ArchiveManifest, type ArchivePopulation, type ArchiveVerification,
} from './storage/storage-archive-lib.js';
import { archivePopulations, defaultLegacyCutoff } from './storage/storage-populations.js';
import { assessStorageBudgetV2 } from './storage/storage-budget-v2.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = arg('mode') ?? 'plan';
const environment = loadEnvironmentFile(arg('environment-file') ?? '.env.local');
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const archiveRoot = resolve(arg('archive-root') ?? 'C:\\ProjectBackups\\trading-bots\\storage-archives\\theta-20261003');
const cutoff = arg('cutoff') ?? defaultLegacyCutoff;
const only = arg('population');
const maxMib = Number(arg('max-mib') ?? '6144');
const pauseMs = Number(arg('pause-ms') ?? '0');
const sampleSize = Number(arg('sample') ?? '300');
const releaseSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const databaseIdentityHash = (() => {
  const url = new URL(connectionString);
  return sha256(`${url.hostname}:${url.port}${url.pathname}`);
})();
const populations = archivePopulations.filter((population) => only === undefined || population.id === only);
if (populations.length === 0) throw new Error('NO_SUCH_POPULATION');
const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;
const relation = (population: ArchivePopulation): string => `${q(population.schema)}.${q(population.table)}`;
const populationDirectory = (population: ArchivePopulation): string => join(archiveRoot, population.id);
const manifestPath = (population: ArchivePopulation): string => join(populationDirectory(population), 'manifest.json');
const readManifest = (population: ArchivePopulation): ArchiveManifest | null => existsSync(manifestPath(population)) ? JSON.parse(readFileSync(manifestPath(population), 'utf8')) as ArchiveManifest : null;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-storage-archive', options: '-c statement_timeout=300000' });
// An idle pooled connection that the server or network drops emits 'error' on the pool; without a handler that is an uncaught exception that kills the run.
pool.on('error', () => undefined);
const transient = (error: unknown): boolean => /terminated|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|57P0[1-3]|08[0-9]{3}/i.test(`${(error as { code?: string }).code ?? ''} ${(error as Error).message}`);
/** Every database access here is an idempotent read, so a bounded retry on transient connection failures is safe. */
async function readOnly<T>(body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await readOnlyOnce(body); } catch (error) {
      if (attempt >= 6 || !transient(error)) throw error;
      await sleep(5_000 * attempt);
    }
  }
}
async function readOnlyOnce<T>(body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // a connection the network drops mid-query emits 'error' on the checked-out client; the in-flight query rejects too, so swallow the event and let the retry handle it
  client.on('error', () => undefined);
  let broken = false;
  try {
    await client.query('BEGIN READ ONLY');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { broken = true; await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(broken ? true : undefined); }
}

async function assertKey(client: pg.PoolClient, population: ArchivePopulation): Promise<void> {
  const keys = (await client.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid=$1::regclass AND i.indisprimary`, [relation(population)])).rows as Array<{ name: string; type: string }>;
  if (keys.length !== 1 || keys[0]?.name !== population.keyColumn || keys[0]?.type !== 'uuid') throw new Error(`POPULATION_KEY_MISMATCH:${population.id}:${JSON.stringify(keys)}`);
}

async function planPopulation(population: ArchivePopulation): Promise<Record<string, unknown>> {
  return readOnly(async (client) => {
    await assertKey(client, population);
    const name = relation(population);
    const stored = population.payloadColumns.map((column) => `COALESCE(sum(pg_column_size(t.${q(column)})),0)::bigint`).join('+');
    const selected = (await client.query(`SELECT count(*)::bigint AS rows, min(t.${q(population.timeColumn)})::text AS oldest, max(t.${q(population.timeColumn)})::text AS newest, (${stored})::bigint AS stored_payload_bytes
      FROM ${name} t WHERE ${population.where}`, [cutoff])).rows[0];
    const sample = (await client.query(`SELECT COALESCE(avg(octet_length(to_jsonb(s)::text)),0)::float AS avg_row_bytes FROM (SELECT t.* FROM ${name} t WHERE ${population.where} ORDER BY md5(t.${q(population.keyColumn)}::text) LIMIT 100) s`, [cutoff])).rows[0];
    const total = (await client.query(`SELECT pg_table_size($1::regclass)::bigint AS table_bytes, pg_indexes_size($1::regclass)::bigint AS index_bytes, pg_total_relation_size($1::regclass)::bigint AS total_bytes,
      (SELECT count(*) FROM ${name})::bigint AS all_rows`, [name])).rows[0];
    const dependents = (await client.query(`SELECT conrelid::regclass::text AS dependent, confdeltype::text AS on_delete FROM pg_constraint WHERE contype='f' AND confrelid=$1::regclass ORDER BY 1`, [name])).rows;
    const immutable = (await client.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal AND tgname='reject_immutable_mutation'`, [name])).rows[0];
    return { id: population.id, table: `${population.schema}.${population.table}`, tier: population.tier, purgeAction: population.purgeAction, cutoff, selectedRows: Number(selected.rows), allRows: Number(total.all_rows),
      oldest: selected.oldest, newest: selected.newest, storedPayloadBytes: Number(selected.stored_payload_bytes), sampledAvgRowBytes: Math.round(sample.avg_row_bytes),
      estimatedUncompressedBytes: Math.round(sample.avg_row_bytes * Number(selected.rows)), relationBytes: { table: Number(total.table_bytes), index: Number(total.index_bytes), total: Number(total.total_bytes) },
      foreignKeyDependents: dependents, immutabilityTriggerPresent: immutable.n > 0 };
  });
}

async function exportPopulation(population: ArchivePopulation): Promise<Record<string, unknown>> {
  const directory = populationDirectory(population);
  mkdirSync(directory, { recursive: true });
  const existing = readManifest(population);
  if (existing?.completed === true) return { id: population.id, state: 'ALREADY_COMPLETE', rows: existing.rows };
  const writer = new ArchiveChunkWriter(directory, population.id, 64 * 1024 * 1024, existing?.chunks ?? []);
  let afterKey: string | null = existing?.chunks.at(-1)?.lastKey ?? null;
  let egress = 0;
  const startedAt = new Date().toISOString();
  const name = relation(population);
  for (;;) {
    const page = await readOnly(async (client) => (await client.query(`SELECT t.${q(population.keyColumn)}::text AS k, t.${q(population.timeColumn)}::text AS ts, to_jsonb(t)::text AS j
      FROM ${name} t WHERE ${population.where} AND ($2::uuid IS NULL OR t.${q(population.keyColumn)} > $2::uuid) ORDER BY t.${q(population.keyColumn)} LIMIT ${population.pageRows}`, [cutoff, afterKey])).rows as Array<{ k: string; ts: string; j: string }>);
    if (page.length === 0) break;
    for (const row of page) { writer.add({ key: row.k, time: row.ts, json: row.j }); egress += Buffer.byteLength(row.j); }
    afterKey = page.at(-1)?.k ?? afterKey;
    if (egress / 1048576 > maxMib) {
      writer.flush();
      writeManifest(directory, buildManifest({ populationId: population.id, table: `${population.schema}.${population.table}`, cutoff, createdAt: startedAt, source: { databaseIdentityHash, releaseSha }, chunks: writer.chunks, completed: false }));
      return { id: population.id, state: 'PAUSED_EGRESS_BOUND', egressMib: Math.round(egress / 1048576), chunks: writer.chunks.length };
    }
    if (writer.chunks.length > 0 && page.length > 0) writeManifest(directory, buildManifest({ populationId: population.id, table: `${population.schema}.${population.table}`, cutoff, createdAt: startedAt, source: { databaseIdentityHash, releaseSha }, chunks: writer.chunks, completed: false }));
    if (pauseMs > 0) await sleep(pauseMs);
  }
  writer.flush();
  const manifest = buildManifest({ populationId: population.id, table: `${population.schema}.${population.table}`, cutoff, createdAt: startedAt, source: { databaseIdentityHash, releaseSha }, chunks: writer.chunks, completed: true });
  writeManifest(directory, manifest);
  return { id: population.id, state: 'COMPLETE', rows: manifest.rows, fileMib: Math.round(manifest.fileBytes / 1048576), uncompressedMib: Math.round(manifest.uncompressedBytes / 1048576), egressMib: Math.round(egress / 1048576) };
}

interface VerificationReceipt {
  readonly populationId: string; readonly verifiedAt: string; readonly disk: ArchiveVerification; readonly productionRowCount: number; readonly archiveRowCount: number;
  readonly aggregateByDayEqual: boolean; readonly aggregateDays: number; readonly sampleRestore: { readonly sampled: number; readonly matched: number; readonly mismatches: readonly string[] };
  readonly archiveRootOutsideDatabase: boolean; readonly populationDigest: string;
}

async function verifyPopulation(population: ArchivePopulation): Promise<VerificationReceipt> {
  const manifest = readManifest(population);
  if (manifest === null) throw new Error(`NO_MANIFEST:${population.id}`);
  const directory = populationDirectory(population);
  const disk = verifyArchiveOnDisk(directory, manifest);
  const name = relation(population);
  const production = await readOnly(async (client) => ({
    count: Number((await client.query(`SELECT count(*)::bigint AS n FROM ${name} t WHERE ${population.where}`, [cutoff])).rows[0].n),
    days: (await client.query(`SELECT (t.${q(population.timeColumn)} AT TIME ZONE 'UTC')::date::text AS d, count(*)::bigint AS n FROM ${name} t WHERE ${population.where} GROUP BY 1 ORDER BY 1`, [cutoff])).rows as Array<{ d: string; n: string }>,
  }));
  const archiveDays = new Map<string, number>();
  const sampled: string[] = [];
  const stride = Math.max(1, Math.floor(manifest.rows / Math.max(1, sampleSize)));
  let index = 0;
  for (const line of readArchiveRows(directory, manifest)) {
    const row = JSON.parse(line) as Record<string, unknown>;
    const day = new Date(String(row[population.timeColumn])).toISOString().slice(0, 10);
    archiveDays.set(day, (archiveDays.get(day) ?? 0) + 1);
    if (index % stride === 0 && sampled.length < sampleSize) sampled.push(line);
    index += 1;
  }
  const productionDays = new Map(production.days.map((row) => [row.d, Number(row.n)]));
  const aggregateByDayEqual = productionDays.size === archiveDays.size && [...productionDays].every(([day, count]) => archiveDays.get(day) === count);
  const mismatches: string[] = [];
  let matched = 0;
  for (const line of sampled) {
    const key = String((JSON.parse(line) as Record<string, unknown>)[population.keyColumn]);
    const fresh = await readOnly(async (client) => (await client.query(`SELECT to_jsonb(t)::text AS j FROM ${name} t WHERE t.${q(population.keyColumn)} = $1::uuid`, [key])).rows[0]?.j as string | undefined);
    if (fresh !== undefined && sha256(fresh) === sha256(line)) matched += 1; else mismatches.push(key);
  }
  const receipt: VerificationReceipt = { populationId: population.id, verifiedAt: new Date().toISOString(), disk, productionRowCount: production.count, archiveRowCount: manifest.rows, aggregateByDayEqual,
    aggregateDays: archiveDays.size, sampleRestore: { sampled: sampled.length, matched, mismatches: mismatches.slice(0, 10) }, archiveRootOutsideDatabase: isOutsideDatabaseArchiveRoot(directory, archiveRoot), populationDigest: manifest.populationDigest };
  writeFileSync(join(directory, 'verification.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function replaySample(): Promise<Record<string, unknown>> {
  const count = Number(arg('blobs') ?? '20');
  const directory = join(archiveRoot, 'replay-samples');
  mkdirSync(directory, { recursive: true });
  const rows = await readOnly(async (client) => (await client.query(`SELECT s.fusion_snapshot_id::text AS id, s.evidence_archive_gzip AS blob, s.evidence_archive_hash AS content_hash, s.decision_time::text AS decision_time,
      d.receipt_json->'releaseIdentity'->>'sourceSha' AS source_sha FROM trade.fusion_snapshot s LEFT JOIN trade.decision d ON d.fusion_snapshot_id=s.fusion_snapshot_id
      WHERE s.evidence_archive_gzip IS NOT NULL ORDER BY md5(s.fusion_snapshot_id::text) LIMIT $1`, [count])).rows as Array<{ id: string; blob: Buffer; content_hash: string; decision_time: string; source_sha: string | null }>);
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const archiveSha = sha256(row.blob);
    writeFileSync(join(directory, `${row.id}.bin`), row.blob);
    const sourceSha = row.source_sha !== null && /^[0-9a-f]{40}$/.test(row.source_sha) ? row.source_sha : null;
    try {
      const replay = replayCycleArchive(row.blob, { cycleId: row.id, sourceSha: sourceSha ?? releaseSha, archiveSha256: archiveSha, archiveContentHash: row.content_hash }, releaseSha);
      results.push({ id: row.id, decisionTime: row.decision_time, blobBytes: row.blob.length, archiveSha256: archiveSha, state: replay.state, contracts: replay.inputContractCount, sourceShaKnown: sourceSha !== null });
    } catch (error) { results.push({ id: row.id, blobBytes: row.blob.length, archiveSha256: archiveSha, state: 'REPLAY_ERROR', error: (error as Error).message }); }
  }
  const summary = { sampled: results.length, replayExecuted: results.filter((r) => r.state !== 'REPLAY_ERROR').length, errors: results.filter((r) => r.state === 'REPLAY_ERROR').length,
    states: results.reduce<Record<string, number>>((acc, r) => { const key = String(r.state); acc[key] = (acc[key] ?? 0) + 1; return acc; }, {}), blobBytes: results.reduce((sum, r) => sum + Number(r.blobBytes), 0) };
  const receipt = { replayedAt: new Date().toISOString(), replaySourceSha: releaseSha, directory, summary, results };
  writeFileSync(join(directory, 'replay-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return { ...summary, directory };
}

async function dryRun(): Promise<Record<string, unknown>> {
  const live = await readOnly(async (client) => {
    const database = Number((await client.query('SELECT pg_database_size(current_database())::bigint AS n')).rows[0].n);
    const top = (await client.query(`SELECT n.nspname||'.'||c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 2 DESC LIMIT 10`)).rows as Array<{ name: string; bytes: string }>;
    const contract = (await client.query(`SELECT count(*)::bigint AS rows, COALESCE(sum(pg_column_size(evidence_archive_gzip)),0)::bigint AS bytes FROM trade.fusion_snapshot WHERE evidence_archive_gzip IS NOT NULL`)).rows[0];
    const operational = (await client.query(`SELECT (SELECT count(*) FROM trade.order_intent)::bigint AS order_intent, (SELECT count(*) FROM trade.broker_order)::bigint AS broker_order,
      (SELECT count(*) FROM trade.fill)::bigint AS fill, (SELECT count(*) FROM trade.master_paper_action_plan)::bigint AS action_plan, (SELECT count(*) FROM trade.broker_activity_fact)::bigint AS broker_activity`)).rows[0];
    return { database, top, contract, operational };
  });
  const plans: Array<Record<string, any>> = [];
  const lines: Array<Record<string, unknown>> = [];
  let archiveRows = 0, archiveBytes = 0, reclaimLogical = 0, wouldDelete = 0, wouldReplace = 0, allEligible = true, physicalImmediate = 0, reuseOnly = 0;
  for (const population of populations) {
    const plan = await planPopulation(population) as Record<string, any>;
    plans.push(plan);
    const manifest = readManifest(population);
    const receiptPath = join(populationDirectory(population), 'verification.json');
    const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) as VerificationReceipt : null;
    const eligibility = evaluatePurgeEligibility({ population, manifest, diskVerification: receipt?.disk ?? null, productionRowCount: plan.selectedRows as number,
      sampleRestore: receipt === null ? null : { sampled: receipt.sampleRestore.sampled, matched: receipt.sampleRestore.matched }, replayVerified: 'NOT_APPLICABLE', aggregateEqual: receipt?.aggregateByDayEqual ?? false,
      archiveLocationOutsideDatabase: receipt?.archiveRootOutsideDatabase ?? false, hotWindowRespected: Date.parse(String(plan.newest ?? '1970-01-01')) < Date.parse(cutoff) });
    allEligible &&= eligibility.eligible;
    const rows = plan.selectedRows as number;
    // logical reclaim: DELETE_ROWS frees the selected share of the whole relation; payload replacement frees the stored payload bytes only
    const share = plan.allRows === 0 ? 0 : rows / (plan.allRows as number);
    const reclaim = population.purgeAction === 'DELETE_ROWS' ? Math.round(share * (plan.relationBytes.total as number)) : (plan.storedPayloadBytes as number);
    archiveRows += rows; archiveBytes += manifest?.fileBytes ?? 0; reclaimLogical += reclaim;
    // PHYSICAL reclaim: a FK-free table whose rows are ALL selected can be dropped whole (files returned at once); a FK-free table with a retained remainder can be rebuilt
    // (a new table holding the retained rows, swap, drop the old one); anything referenced by foreign keys, or payload replacement, only frees pages for reuse by new rows.
    const droppable = population.purgeAction === 'DELETE_ROWS' && (plan.foreignKeyDependents as unknown[]).length === 0;
    const physical = droppable ? (rows === plan.allRows ? plan.relationBytes.total : Math.round(share * plan.relationBytes.total)) : 0;
    physicalImmediate += physical; reuseOnly += reclaim - physical;
    if (population.purgeAction === 'DELETE_ROWS') wouldDelete += rows; else wouldReplace += rows;
    lines.push({ populationId: population.id, table: plan.table, tier: population.tier, purgeAction: population.purgeAction, candidateRows: rows, candidateStoredPayloadGiB: +(plan.storedPayloadBytes / 1024 ** 3).toFixed(3),
      expectedLogicalReclaimGiB: +(reclaim / 1024 ** 3).toFixed(3), archiveRows: manifest?.rows ?? 0, archiveComplete: manifest?.completed ?? false, archiveFileMiB: Math.round((manifest?.fileBytes ?? 0) / 1048576), archiveDigest: manifest?.populationDigest ?? null,
      archiveVerified: receipt?.disk.ok ?? false, rowCountProof: receipt === null ? null : `${receipt.archiveRowCount}/${receipt.productionRowCount}`, aggregateByDayEqual: receipt?.aggregateByDayEqual ?? false,
      sampleRestore: receipt === null ? null : `${receipt.sampleRestore.matched}/${receipt.sampleRestore.sampled}`, foreignKeyDependents: plan.foreignKeyDependents, immutabilityTriggerPresent: plan.immutabilityTriggerPresent,
      parquet: (() => { const path = join(archiveRoot, 'parquet', population.id, 'parquet-manifest.json'); if (!existsSync(path)) return null; const parquet = JSON.parse(readFileSync(path, 'utf8')) as { rowCount: number; totalBytes: number; fileCount: number; manifestSha256: string }; return { rows: parquet.rowCount, bytes: parquet.totalBytes, files: parquet.fileCount, manifestSha256: parquet.manifestSha256, rowsMatchArchive: parquet.rowCount === (manifest?.rows ?? -1) }; })(),
      physicalReclaimGiB: +(physical / 1024 ** 3).toFixed(3), physicalMethod: !droppable ? 'NONE_REUSE_ONLY' : rows === plan.allRows ? 'DROP_TABLE' : 'REBUILD_RETAINED_ROWS_THEN_DROP_OLD', purgeEligible: eligibility.eligible, blockers: eligibility.blockers });
  }
  const growthPerSession = Number(arg('growth-bytes-per-session') ?? '0') || null;
  const gib = (bytes: number): number => +(bytes / 1024 ** 3).toFixed(3);
  const budget = assessStorageBudgetV2({ currentBytes: live.database, growthBytesPerSession: growthPerSession, archivableBytes: reclaimLogical });
  const after = assessStorageBudgetV2({ currentBytes: live.database - 0, growthBytesPerSession: growthPerSession, archivableBytes: reclaimLogical });
  const reuse = growthPerSession === null ? null : +(reclaimLogical / growthPerSession).toFixed(1);
  return {
    THETA_STORAGE_PURGE_DRY_RUN: true, observedAt: new Date().toISOString(), cutoff, releaseSha, CURRENT_DB_GIB: gib(live.database),
    PROJECTED_8GIB_DATE: budget.sessionsToProviderLimit === null ? null : `${budget.sessionsToProviderLimit.toFixed(1)} active sessions from now`,
    TOP_10_STORAGE_OBJECTS: live.top.map((row) => ({ name: row.name, GiB: gib(Number(row.bytes)) })),
    ARCHIVE_CANDIDATE_ROWS: archiveRows, ARCHIVE_CANDIDATE_GIB_LOGICAL_RECLAIM: gib(reclaimLogical), ARCHIVE_DESTINATION: archiveRoot, ARCHIVE_FILE_GIB: gib(archiveBytes),
    ARCHIVE_COMPLETE_AND_VERIFIED_FOR_ALL: allEligible, populations: lines,
    WOULD_DELETE_ROWS: wouldDelete, WOULD_REPLACE_PAYLOAD_ROWS: wouldReplace, WOULD_RECLAIM_LOGICAL_GIB: gib(reclaimLogical),
    ESTIMATED_PHYSICAL_RECLAIM_GIB_IMMEDIATE: gib(physicalImmediate), REUSE_ONLY_GIB_NOT_RETURNED_TO_FILESYSTEM: gib(reuseOnly),
    PHYSICAL_RECLAIM_NOTE: 'DELETE or payload replacement alone never shrinks PostgreSQL files (freed pages are reused by NEW rows); immediate physical reclaim comes only from dropping a foreign-key-free table, or from rebuilding such a table with its retained rows and dropping the old one. Payload replacement in foreign-key-referenced tables is reuse only, until a table rewrite (pg_repack or dump and restore), which is disruptive and not part of this decision',
    FREED_SPACE_REUSE_SESSIONS_AT_MEASURED_GROWTH: reuse,
    OPERATIONAL_TABLES_TOUCHED: 'NO', ORDERS_TOUCHED: 0, FILLS_TOUCHED: 0, ACTION_PLANS_TOUCHED: 0, BROKER_EVENTS_TOUCHED: 0, WHOLE_CHAIN_TOUCHED: 0,
    OPERATIONAL_ROW_COUNTS_NOT_IN_ANY_POPULATION: live.operational,
    CURRENT_CONTRACT_EVIDENCE_ARCHIVE: { rows: Number(live.contract.rows), GiB: gib(Number(live.contract.bytes)), purgeCandidateNow: 0, reason: 'all contract-v3 archives are inside the hot window; they are the only raw replay source for the current release' },
    POST_PURGE_PROJECTED_LOGICAL_LIVE_DATA_GIB: gib(live.database - reclaimLogical), POST_PURGE_PROJECTED_PG_DATABASE_SIZE_GIB_IMMEDIATE: gib(live.database - physicalImmediate), POST_PURGE_PROJECTED_PG_DATABASE_SIZE_GIB_WITH_FULL_REWRITE: gib(live.database - reclaimLogical),
    BUDGET_BEFORE: budget, BUDGET_AFTER_NOTE: after.actionState,
    PRODUCTION_DELETE_EXECUTED: 'NO',
  };
}

try {
  let output: unknown;
  if (mode === 'plan') { const results = []; for (const population of populations) results.push(await planPopulation(population)); output = results; }
  else if (mode === 'export') { const results = []; for (const population of populations) results.push(await exportPopulation(population)); output = results; }
  else if (mode === 'verify') { const results = []; for (const population of populations) { const r = await verifyPopulation(population); results.push({ id: r.populationId, diskOk: r.disk.ok, rows: `${r.archiveRowCount}/${r.productionRowCount}`, aggregateByDayEqual: r.aggregateByDayEqual, sample: `${r.sampleRestore.matched}/${r.sampleRestore.sampled}`, problems: r.disk.problems }); } output = results; }
  else if (mode === 'replay-sample') output = await replaySample();
  else if (mode === 'dry-run') output = await dryRun();
  else throw new Error('UNKNOWN_MODE');
  const outFile = arg('output');
  if (outFile !== undefined) { mkdirSync(resolve(outFile, '..'), { recursive: true }); writeFileSync(resolve(outFile), `${JSON.stringify(output, null, 2)}\n`); }
  process.stdout.write(`${JSON.stringify(output).slice(0, mode === 'dry-run' ? 200 : 4000)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ state: 'FAILED', code: (error as { code?: string }).code ?? (error as Error).message })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
  void createHash;
}
