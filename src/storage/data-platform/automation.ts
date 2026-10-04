// The three scheduled data-platform tasks as plain, testable functions (the CLI in tools/theta-data-platform.ts is a thin shell around them):
//   preSession      READY | NEW_RISK_STORAGE_LOCK. Measures, repairs, pre-creates partitions, probes the archive, publishes the storage pressure state the writers read.
//   postSession     close, archive, verify, convert to Parquet, retire approved partitions, measure, compute the slope, write ONE receipt. Idempotent, restartable, bounded, yields.
//   weeklyIntegrity re-verifies sampled archives (hash, manifest), Parquet (hash, DuckDB open, row counts), and replays sampled cycle blobs. Corruption: an incident and NO deletion.
// Management of existing positions, closing, reconciliation and every operational write are never an input to, or an output of, these tasks.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { sha256Hex } from './archive-manifest.js';
import type { ProductionArchiveBackend } from './archive-remote.js';
import { archiveQueueState } from './retention-manager.js';
import { DataControlPlane } from './control-plane.js';
import type { ReplayVerifier } from './archival-pipeline.js';
import type { DatasetPolicy } from './dataset-registry.js';
import type { DurabilityCheck } from './durability.js';
import { incident, type PlatformIncident } from './incidents.js';
import { ndjsonGzipCodec } from './ndjson-codec.js';
import type { ParquetRunner } from './parquet-runner.js';
import type { PartitionRecord } from './partition-lifecycle.js';
import { catalogFor, partitionKeyOf, partitionRange, platformCatalog } from './platform-catalog.js';
import { PostgresPartitionOps, PostgresPartitionStateStore, childTableName, databaseBytes, defaultPartitionRowCounts, repairDefaultPartition, type PartitionedDataset } from './postgres-partitions.js';
import { cycleBlobReplayVerifier } from './replay-verifier.js';
import { PIT_DATASET, readLedger } from './pit-writer.js';
import { addDays, planFuturePartitions, sessionsBetweenCount, type SessionCalendar } from './session-calendar.js';
import { assessCapacity, preSessionGate, type ArchiveQueueState, type GovernorAssessment, type NewRiskGate } from './storage-governor.js';
import type { StorageReceipt } from './platform-board.js';
import { buildRuntimeSessionAggregateFromPostgres, persistRuntimeSessionAggregate } from './runtime-session-aggregate-store.js';

const GIB = 1024 ** 3;
/** opaque compressed bytes: the NDJSON archive IS their cold form, Parquet would only wrap a hex string */
const PARQUET_EXEMPT = new Set(['cycle-evidence-blob', 'optionomics-payload-blob']);
const PARQUET_COLUMNS: Readonly<Record<string, { readonly time: string; readonly key: string }>> = {
  'decision-context': { time: 'decided_at', key: 'decision_context_id' },
  'candidate-hot-detail': { time: 'decision_time', key: 'candidate_id' },
  'candidate-ordinary-rejected': { time: 'created_at', key: 'decision_id' },
  'optionomics-raw-observation': { time: 'observed_at', key: 'observation_id' },
};

export interface AutomationContext {
  readonly pool: Pool;
  readonly backend: ProductionArchiveBackend;
  readonly datasets: readonly PartitionedDataset[];
  readonly registry: readonly DatasetPolicy[];
  readonly planBytes: number;
  readonly sourceSha: string;
  readonly policyVersion: string;
  readonly calendar: SessionCalendar | null;
  readonly parquet: ParquetRunner | null;
  readonly parquetRoot: string;
  readonly durabilityCheck: DurabilityCheck | undefined;
  readonly allowUnverifiedRetirement?: boolean;
  readonly now: () => Date;
  readonly yieldToOperations?: () => boolean;
  readonly sessionsAhead?: number;
  /** bytes PostgreSQL must keep free for operational transactions (default 5% of the plan) */
  readonly requiredReserveBytes?: number;
  readonly replaySampleSize?: number;
  /** dataset replay verification; defaults to the real cycle-blob replay (decode, content hash, canonical frontier replay) */
  readonly replayFor?: (dataset: string) => ReplayVerifier;
}

export type PreSessionStatus = 'READY' | 'NEW_RISK_STORAGE_LOCK';
export interface PreSessionCheck { readonly name: string; readonly ok: boolean; readonly detail: string }
export interface PreSessionResult {
  readonly state: 'PRE_SESSION';
  readonly status: PreSessionStatus;
  readonly newRiskGate: NewRiskGate;
  /** always true: management, closing, rolling-out and reconciliation do not depend on this task */
  readonly managementAllowed: true;
  readonly reasons: readonly string[];
  readonly checks: readonly PreSessionCheck[];
  readonly assessment: GovernorAssessment;
  readonly queue: ArchiveQueueState;
  readonly partitionPlan: { readonly source: string; readonly created: number; readonly missing: readonly string[]; readonly horizonEnd: string };
  readonly defaultPartitions: { readonly rowsBefore: Readonly<Record<string, number>>; readonly repaired: number; readonly lateIntoRetired: number };
  readonly archiveHealth: { readonly healthy: boolean; readonly detail: string };
  readonly projectedNextSessionPeakBytes: number;
  readonly pressureStateWritten: boolean;
}

const stamp = (context: AutomationContext): string => context.now().toISOString();
const today = (context: AutomationContext): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(context.now());

export async function schemaPresent(pool: Pool): Promise<boolean> {
  const row = (await pool.query(`SELECT to_regclass('dp.partition_state') IS NOT NULL AND to_regclass('dp.storage_pressure_state') IS NOT NULL AS ok`)).rows[0] as { ok: boolean };
  return row.ok;
}

async function existingParents(context: AutomationContext): Promise<readonly PartitionedDataset[]> {
  const present: PartitionedDataset[] = [];
  for (const dataset of context.datasets) if ((await context.pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [dataset.parent])).rows[0].ok === true) present.push(dataset);
  return present;
}

/** An archive probe that proves the backend can write, read back and verify RIGHT NOW (a canary object), without trusting a stale success. */
export async function probeArchiveHealth(backend: ProductionArchiveBackend, now: Date): Promise<{ readonly healthy: boolean; readonly detail: string }> {
  const key = `health/canary/${now.toISOString().slice(0, 10)}.json`;
  const bytes = new TextEncoder().encode(JSON.stringify({ canary: now.toISOString().slice(0, 10) }));
  try {
    await backend.put(key, bytes);
    const verified = await backend.verify(key, sha256Hex(bytes));
    return verified.ok ? { healthy: true, detail: `${backend.identity()}:OK` } : { healthy: false, detail: `${backend.identity()}:${verified.reason}` };
  } catch (error) { return { healthy: false, detail: `${backend.identity()}:${error instanceof Error ? error.message.slice(0, 120) : 'ERROR'}` }; }
}

async function partitionSizes(context: AutomationContext, records: readonly PartitionRecord[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (const record of records) {
    const dataset = context.datasets.find((entry) => entry.dataset === record.dataset);
    if (dataset === undefined) continue;
    try {
      const row = (await context.pool.query('SELECT CASE WHEN to_regclass($1) IS NULL THEN 0 ELSE pg_total_relation_size($1::regclass) END::bigint AS n', [childTableName(dataset.parent, record.partition)])).rows[0] as { n: string };
      sizes.set(`${record.dataset}/${record.partition}`, Number(row.n));
    } catch { sizes.set(`${record.dataset}/${record.partition}`, 0); }
  }
  return sizes;
}

async function loadHistory(pool: Pool): Promise<readonly StorageReceipt[]> {
  const rows = (await pool.query('SELECT receipt_json FROM dp.storage_receipt ORDER BY session_date DESC LIMIT 60')).rows as Array<{ receipt_json: StorageReceipt }>;
  return rows.map((row) => row.receipt_json).reverse();
}

function buildPlane(context: AutomationContext, sizes: ReadonlyMap<string, number>, datasets: readonly PartitionedDataset[]): { plane: DataControlPlane; store: PostgresPartitionStateStore; ops: PostgresPartitionOps } {
  const ops = new PostgresPartitionOps(context.pool, datasets);
  const store = new PostgresPartitionStateStore(context.pool);
  const plane = new DataControlPlane({
    botId: 'theta', sourceSha: context.sourceSha, policyVersion: context.policyVersion, backend: context.backend, store, opsFor: () => ops, codecFor: () => ndjsonGzipCodec,
    replayFor: context.replayFor ?? (() => cycleBlobReplayVerifier(context.sourceSha, context.replaySampleSize ?? 3)), now: () => stamp(context),
    measure: async () => ({ dbBytes: await databaseBytes(context.pool), planBytes: context.planBytes }),
    partitionBytes: (record) => sizes.get(`${record.dataset}/${record.partition}`) ?? 0, registry: context.registry,
    ...(context.durabilityCheck === undefined ? {} : { durabilityCheck: context.durabilityCheck }), ...(context.allowUnverifiedRetirement === true ? { allowUnverifiedRetirement: true } : {}),
    ...(context.yieldToOperations === undefined ? {} : { yieldToOperations: context.yieldToOperations }),
    retirementEligible: async (dataset, partition) => {
      if (dataset !== 'decision-audit') return { eligible: true, reason: 'DATASET_TERMINAL_BY_CONSTRUCTION' };
      const range = partitionRange(partition);
      const unresolved = Number((await context.pool.query(
        `SELECT count(*)::int AS n FROM dp.recent_decision_audit d
          WHERE d.session_date >= $1::date AND d.session_date < $2::date AND NOT d.archival_terminal
            AND NOT EXISTS (SELECT 1 FROM dp.final_chain_receipt r WHERE r.chain_id = d.chain_id AND r.archive_eligible)`,
        [range.from, range.to],
      )).rows[0].n);
      return unresolved === 0 ? { eligible: true, reason: 'ALL_DECISIONS_TERMINAL' } : { eligible: false, reason: `${unresolved}_DECISIONS_HAVE_UNRESOLVED_CHAINS` };
    },
    maintenance: async () => { for (const dataset of datasets) { try { await context.pool.query(`ANALYZE ${dataset.parent}`); } catch { /* maintenance only */ } } },
  });
  return { plane, store, ops };
}

async function sessionsPresent(context: AutomationContext, datasets: readonly PartitionedDataset[]): Promise<string[]> {
  const found = new Set<string>();
  for (const dataset of datasets) for (const row of (await context.pool.query(`SELECT DISTINCT ${dataset.keyColumn}::text AS d FROM ${dataset.parent}`)).rows as Array<{ d: string }>) found.add(row.d.slice(0, 10));
  return [...found].sort();
}

export async function writePressureState(pool: Pool, input: { readonly assessment: GovernorAssessment; readonly dbBytes: number; readonly planBytes: number; readonly queue: ArchiveQueueState; readonly archiveHealthy: boolean; readonly now: Date }): Promise<void> {
  const sessionsToCritical = input.assessment.growthPerSessionBytes > 0 ? Math.max(0, (0.825 * input.planBytes - input.dbBytes) / input.assessment.growthPerSessionBytes) : null;
  await pool.query(`INSERT INTO dp.storage_pressure_state(singleton, band, database_bytes, plan_bytes, archive_queue_bytes, archive_lag_sessions, archive_backend_healthy, projected_sessions_to_critical, evaluated_at)
    VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
    ON CONFLICT (singleton) DO UPDATE SET band = EXCLUDED.band, database_bytes = EXCLUDED.database_bytes, plan_bytes = EXCLUDED.plan_bytes, archive_queue_bytes = EXCLUDED.archive_queue_bytes,
      archive_lag_sessions = EXCLUDED.archive_lag_sessions, archive_backend_healthy = EXCLUDED.archive_backend_healthy, projected_sessions_to_critical = EXCLUDED.projected_sessions_to_critical, evaluated_at = EXCLUDED.evaluated_at`,
  [input.assessment.state, Math.round(input.dbBytes), Math.round(input.planBytes), Math.round(input.queue.queueBytes), input.queue.lagSessions, input.archiveHealthy, sessionsToCritical, input.now.toISOString()]);
}

export async function persistIncidents(pool: Pool, incidents: readonly PlatformIncident[]): Promise<void> {
  for (const entry of incidents) {
    // one open incident per (kind, scope): a repeating condition is not a new row every run
    const open = (await pool.query(`SELECT 1 FROM dp.platform_incident WHERE kind = $1 AND COALESCE(dataset, '') = $2 AND COALESCE(partition_key, '') = $3 AND detail = $4 AND resolved_at IS NULL LIMIT 1`, [entry.kind, entry.scope.dataset ?? '', entry.scope.partition ?? '', entry.detail])).rowCount;
    if (open === 0) await pool.query('INSERT INTO dp.platform_incident(kind, severity, dataset, partition_key, detail, observed_at) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)', [entry.kind, entry.severity, entry.scope.dataset ?? null, entry.scope.partition ?? null, entry.detail, entry.observedAt]);
  }
}

// ---- pre-session -------------------------------------------------------------------------------------------------------------------------------------------------

export async function runPreSession(context: AutomationContext): Promise<PreSessionResult> {
  const now = context.now(); const observedAt = now.toISOString(); const day = today(context);
  const datasets = await existingParents(context);
  const checks: PreSessionCheck[] = []; const incidents: PlatformIncident[] = [];
  const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

  // 1. database bytes and the provider allocation (an unknown or absurd allocation can not be trusted to bound anything)
  const dbBytes = await databaseBytes(context.pool);
  const planValid = Number.isFinite(context.planBytes) && context.planBytes >= 1 * GIB;
  check('PROVIDER_ALLOCATION_KNOWN', planValid, `planBytes=${context.planBytes}`);
  check('DATABASE_BYTES_MEASURED', Number.isFinite(dbBytes) && dbBytes > 0, `dbBytes=${dbBytes}`);

  // 2. default partitions: late writers and missing partitions are repaired, never tolerated; rows into a retired partition are an incident
  const store = new PostgresPartitionStateStore(context.pool);
  // the state column is authoritative (the JSON record is the lifecycle detail)
  const retired = new Set(((await context.pool.query(`SELECT dataset, partition_key FROM dp.partition_state WHERE state IN ('DETACHED','DROPPED')`)).rows as Array<{ dataset: string; partition_key: string }>).map((row) => `${row.dataset}/${row.partition_key}`));
  const rowsBefore = await defaultPartitionRowCounts(context.pool, datasets.map((entry) => entry.parent));
  let repairedRows = 0; let lateRows = 0;
  for (const dataset of datasets) {
    if ((rowsBefore[dataset.parent] ?? 0) === 0) continue;
    const retiredKeys = new Set([...retired].filter((entry) => entry.startsWith(`${dataset.dataset}/`)).map((entry) => entry.slice(dataset.dataset.length + 1)));
    const repair = await repairDefaultPartition(context.pool, dataset, (date) => partitionKeyOf(dataset.dataset, date), retiredKeys);
    repairedRows += repair.moved;
    incidents.push(incident('DEFAULT_PARTITION_ROWS', 'WARNING', { dataset: dataset.dataset }, `${rowsBefore[dataset.parent]} rows found in the default partition (${repair.moved} moved into ${repair.repairedKeys.join(',') || 'no partition'})`, observedAt));
    for (const late of repair.lateIntoRetired) { lateRows += late.rows; incidents.push(incident('LATE_WRITE_INTO_RETIRED_PARTITION', 'CRITICAL', { dataset: dataset.dataset, partition: late.key }, `${late.rows} late rows for an already archived partition remain in the default partition`, observedAt)); }
  }
  check('DEFAULT_PARTITIONS_EMPTY', lateRows === 0, `moved=${repairedRows} lateIntoRetired=${lateRows}`);

  // 2b. the dual-write window is bounded by construction: a window that outlived its deadline already fell back to the legacy writer, and a human must decide (cutover or restart)
  const ledger = await readLedger(context.pool);
  const windowExpired = ledger !== null && ledger.mode === 'DUAL_WRITE_VALIDATE' && ledger.dualWriteDeadline !== null && Date.parse(ledger.dualWriteDeadline) <= now.getTime();
  check('DUAL_WRITE_WINDOW_BOUNDED', !windowExpired, ledger === null ? 'NO_DUAL_WRITE_ACTIVE' : `mode=${ledger.mode} deadline=${ledger.dualWriteDeadline ?? 'none'} parityDecisions=${ledger.parityDecisions} mismatches=${ledger.mismatchCount}`);
  if (windowExpired) incidents.push(incident('DUAL_WRITE_WINDOW_EXPIRED', 'WARNING', { dataset: PIT_DATASET }, `dual-write deadline ${ledger?.dualWriteDeadline ?? ''} passed; the writer is on the legacy path until cutover or a new window`, observedAt));

  // 3. partitions for every date through the planned horizon (provider calendar), created idempotently
  const plan = await planFuturePartitions(context.calendar, day, context.sessionsAhead ?? 7);
  const ops = new PostgresPartitionOps(context.pool, datasets);
  let created = 0; const missing: string[] = [];
  for (const dataset of datasets) {
    const keys = [...new Set(plan.dates.map((date) => partitionKeyOf(dataset.dataset, date)))];
    for (const key of keys) {
      if (retired.has(`${dataset.dataset}/${key}`)) continue;
      const before = await ops.exists(dataset.dataset, key);
      await ops.ensurePartition(dataset.dataset, key);
      if (!before) created += 1;
      if (!(await ops.exists(dataset.dataset, key))) missing.push(`${dataset.dataset}/${key}`);
    }
  }
  check('FUTURE_PARTITIONS_PRESENT', missing.length === 0, `source=${plan.source} horizonEnd=${plan.horizonEnd} created=${created} missing=${missing.length}`);

  // 4. archive health (a live canary) and the backlog
  const archive = await probeArchiveHealth(context.backend, now);
  check('ARCHIVE_BACKEND_HEALTHY', archive.healthy, archive.detail);
  if (!archive.healthy) incidents.push(incident('ARCHIVE_BACKEND_UNHEALTHY', 'WARNING', {}, archive.detail, observedAt));
  const records = await store.list();
  const sizes = await partitionSizes(context, records);
  const sessions = await sessionsPresent(context, datasets);
  const queueBase = archiveQueueState(records, (record) => sizes.get(`${record.dataset}/${record.partition}`) ?? 0, sessions);
  const oldestPending = records.filter((record) => record.state === 'CLOSED_HOT' || record.state === 'ARCHIVE_PENDING').map((record) => record.partition).sort()[0];
  const calendarLag = oldestPending === undefined ? 0 : await sessionsBetweenCount(context.calendar, oldestPending.slice(0, 10), day);
  const queue: ArchiveQueueState = { ...queueBase, lagSessions: Math.max(queueBase.lagSessions, calendarLag ?? 0) };
  const retirableBytes = records.filter((record) => record.state === 'ARCHIVED_VERIFIED' || record.state === 'DETACH_ELIGIBLE').reduce((sum, record) => sum + (sizes.get(`${record.dataset}/${record.partition}`) ?? 0), 0);

  // 5. the last post-session receipt (a session whose maintenance never ran is unfinished business, not a clean slate)
  const history = await loadHistory(context.pool);
  const lastReceipt = history.at(-1);
  const completed = lastReceipt !== undefined && Date.parse(`${lastReceipt.sessionDate}T00:00:00Z`) >= Date.parse(`${addDays(day, -5)}T00:00:00Z`);
  check('LAST_POST_SESSION_RECEIPT', completed || history.length === 0, lastReceipt === undefined ? 'NO_RECEIPT_YET(first run)' : `last=${lastReceipt.sessionDate}`);

  // 6. capacity: measured growth, projected next-session peak, operational reserve
  const growth = history.map((receipt) => Math.max(0, receipt.sessionPeakBytes - receipt.preSessionBytes)).slice(-20);
  const sorted = [...growth].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const volumeFactor = median > 0 ? Math.min(3, Math.max(1, (sorted.at(-1) ?? median) / median)) : 1;
  const assessment = assessCapacity({ currentBytes: dbBytes, planBytes: planValid ? context.planBytes : 8 * GIB, recentSessionGrowthBytes: growth, archiveRetireBytesPerSession: archive.healthy ? Math.min(2 * GIB, retirableBytes + queue.queueBytes) : 0, retirableBytesNow: retirableBytes, queue, expectedVolumeFactor: volumeFactor });
  const reserve = Math.max(0, context.planBytes - dbBytes - assessment.growthPerSessionBytes * volumeFactor);
  const requiredReserve = context.requiredReserveBytes ?? context.planBytes * 0.05;
  check('OPERATIONAL_RESERVE', reserve >= requiredReserve, `reserveBytes=${Math.round(reserve)} required=${Math.round(requiredReserve)}`);
  check('PROJECTED_NEXT_SESSION_PEAK', assessment.forecasts.next.peakUtilization < 0.825, `peakUtilization=${assessment.forecasts.next.peakUtilization.toFixed(3)}`);

  // 7. the verdict: the new-risk gate is the governor's, tightened by every failed hard check; management is never an input
  const gate = preSessionGate(assessment, { archiveHealthy: archive.healthy, previousMaintenanceCompleted: completed || history.length === 0, transactionalReserveBytes: reserve, requiredTransactionalReserveBytes: requiredReserve });
  let newRisk: NewRiskGate = gate.newRisk;
  const reasons = [...gate.reasons];
  if (!planValid) { newRisk = 'LOCKED'; reasons.push('PROVIDER_ALLOCATION_UNKNOWN'); }
  if (missing.length > 0 && newRisk === 'OPEN') { newRisk = 'RESTRICTED'; reasons.push('FUTURE_PARTITIONS_MISSING'); }
  if (lateRows > 0 && newRisk === 'OPEN') { newRisk = 'RESTRICTED'; reasons.push('LATE_WRITES_INTO_RETIRED_PARTITIONS'); }

  // 8. publish the pressure state the bulk writers consult (an unwritable state is itself UNKNOWN for them, which is conservative)
  let written = false;
  try { await writePressureState(context.pool, { assessment, dbBytes, planBytes: planValid ? context.planBytes : 8 * GIB, queue, archiveHealthy: archive.healthy, now }); written = true; } catch (error) { incidents.push(incident('STORAGE_PRESSURE_STATE_UNAVAILABLE', 'CRITICAL', {}, error instanceof Error ? error.message.slice(0, 160) : 'WRITE_FAILED', observedAt)); }
  check('PRESSURE_STATE_PUBLISHED', written, written ? 'dp.storage_pressure_state' : 'WRITE_FAILED');
  await persistIncidents(context.pool, incidents);
  return { state: 'PRE_SESSION', status: newRisk === 'LOCKED' ? 'NEW_RISK_STORAGE_LOCK' : 'READY', newRiskGate: newRisk, managementAllowed: true, reasons, checks, assessment, queue,
    partitionPlan: { source: plan.source, created, missing, horizonEnd: plan.horizonEnd }, defaultPartitions: { rowsBefore, repaired: repairedRows, lateIntoRetired: lateRows },
    archiveHealth: archive, projectedNextSessionPeakBytes: assessment.forecasts.next.peakBytes, pressureStateWritten: written };
}

// ---- post-session ------------------------------------------------------------------------------------------------------------------------------------------------

export interface ParquetOutcome { readonly dataset: string; readonly partition: string; readonly state: 'CONVERTED_VERIFIED' | 'FAILED' | 'EXEMPT' | 'SKIPPED_EXISTING'; readonly detail: string }
export interface PostSessionResult {
  readonly state: 'POST_SESSION';
  readonly receipt: StorageReceipt;
  readonly incidents: readonly PlatformIncident[];
  readonly yielded: boolean;
  readonly parquet: readonly ParquetOutcome[];
  readonly sloState: string;
  readonly postArchiveBytes: number;
  readonly pressureStateWritten: boolean;
}

function archiveChunkKey(record: PartitionRecord): string | null { return record.uploaded?.key ?? null; }

async function convertToParquet(context: AutomationContext, records: readonly PartitionRecord[], archivedNow: readonly string[]): Promise<{ outcomes: ParquetOutcome[]; incidents: PlatformIncident[] }> {
  const outcomes: ParquetOutcome[] = []; const incidents: PlatformIncident[] = []; const observedAt = stamp(context);
  for (const label of archivedNow) {
    const [dataset, partition] = label.split('/') as [string, string];
    if (PARQUET_EXEMPT.has(dataset) || PARQUET_COLUMNS[dataset] === undefined) { outcomes.push({ dataset, partition, state: 'EXEMPT', detail: 'opaque payload: the verified NDJSON archive is the cold form' }); continue; }
    if (context.parquet === null) continue;
    const record = records.find((entry) => entry.dataset === dataset && entry.partition === partition);
    const key = record === undefined ? null : archiveChunkKey(record);
    if (record === undefined || key === null || record.manifest === null) continue;
    const outDir = join(context.parquetRoot, dataset, partition);
    const scratch = mkdtempSync(join(tmpdir(), 'theta-dp-parquet-'));
    try {
      try { if (statSync(join(outDir, dataset, 'parquet-manifest.json')).isFile()) { outcomes.push({ dataset, partition, state: 'SKIPPED_EXISTING', detail: 'already converted and verified' }); continue; } } catch { /* not converted yet */ }
      const bytes = await context.backend.get(key);
      if (bytes === null) throw new Error('ARCHIVE_OBJECT_MISSING');
      const chunk = join(scratch, `${dataset}-${partition}.ndjson.gz`); writeFileSync(chunk, bytes);
      mkdirSync(outDir, { recursive: true });
      const columns = PARQUET_COLUMNS[dataset] as { time: string; key: string };
      const converted = await context.parquet.convert({ chunks: [chunk], outDir, dataset, timeColumn: columns.time, keyColumn: columns.key, digest: record.manifest.contentHash, producerSha: context.sourceSha });
      if (!converted.ok) throw new Error(`PARQUET_CONVERT_FAILED:${JSON.stringify(converted.detail).slice(0, 160)}`);
      const manifestPath = join(outDir, dataset, 'parquet-manifest.json');
      const verified = await context.parquet.verify(manifestPath);
      if (!verified.ok) throw new Error(`PARQUET_VERIFY_FAILED:${JSON.stringify(verified.detail).slice(0, 160)}`);
      // the converted files are cold data too: they go to the same backend under a stable, immutable key
      for (const file of walkFiles(join(outDir, dataset))) await context.backend.put(`parquet/${dataset}/${partition}/${file.relative}`, readFileSync(file.full));
      outcomes.push({ dataset, partition, state: 'CONVERTED_VERIFIED', detail: `rows=${String((converted.detail as { rowCount?: unknown }).rowCount ?? '?')}` });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      outcomes.push({ dataset, partition, state: 'FAILED', detail });
      incidents.push(incident('PARQUET_VERIFICATION_FAILURE', 'WARNING', { dataset, partition }, detail, observedAt));
      rmSync(outDir, { recursive: true, force: true });
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  return { outcomes, incidents };
}

function walkFiles(root: string, relative = ''): Array<{ full: string; relative: string }> {
  const out: Array<{ full: string; relative: string }> = [];
  for (const name of readdirSync(join(root, relative))) {
    const rel = relative === '' ? name : `${relative}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walkFiles(root, rel)); else out.push({ full: join(root, rel), relative: rel });
  }
  return out;
}

export async function runPostSession(context: AutomationContext): Promise<PostSessionResult> {
  const now = context.now(); const observedAt = now.toISOString(); const day = today(context);
  const datasets = await existingParents(context);
  const store = new PostgresPartitionStateStore(context.pool);
  const before = await store.list();
  const sizes = await partitionSizes(context, before);
  const { plane } = buildPlane(context, sizes, datasets);
  const history = (await loadHistory(context.pool)).filter((receipt) => receipt.sessionDate !== day);
  for (const receipt of history) { plane.recentSessionGrowth.push(Math.max(0, receipt.sessionPeakBytes - receipt.preSessionBytes)); plane.postArchiveHistory.push(receipt.postArchiveBytes); }
  // the session's opening size is what the pre-session task published (today's pressure row), else the size now
  const pressure = (await context.pool.query('SELECT database_bytes, evaluated_at FROM dp.storage_pressure_state WHERE singleton')).rows[0] as { database_bytes: string; evaluated_at: Date } | undefined;
  const nowBytes = await databaseBytes(context.pool);
  const preSessionBytes = pressure !== undefined && pressure.evaluated_at.toISOString().slice(0, 10) >= addDays(day, -1) ? Number(pressure.database_bytes) : nowBytes;
  const sessions = await sessionsPresent(context, datasets);
  const result = await plane.postSession(day, sessions, { preSessionBytes, sessionPeakBytes: Math.max(preSessionBytes, nowBytes) });
  const after = await store.list();
  const parquet = await convertToParquet(context, after, result.receipt.archivedPartitions);
  const incidents = [...result.incidents, ...parquet.incidents];

  // a repeated run of the same session replaces its receipt; the receipt, not memory, is the history the next run's slope is computed from
  await context.pool.query(`INSERT INTO dp.storage_receipt(session_date, receipt_json) VALUES ($1::date, $2::jsonb) ON CONFLICT (session_date) DO UPDATE SET receipt_json = EXCLUDED.receipt_json`, [day, JSON.stringify({ ...result.receipt, parquet: parquet.outcomes })]);
  const records = await store.list();
  const sizesAfter = await partitionSizes(context, records);
  const sessionsAfter = await sessionsPresent(context, datasets);
  const queue = archiveQueueState(records, (record) => sizesAfter.get(`${record.dataset}/${record.partition}`) ?? 0, sessionsAfter);
  const postBytes = await databaseBytes(context.pool);
  if ((await context.pool.query(`SELECT to_regclass('dp.runtime_session_aggregate') IS NOT NULL AS ok`)).rows[0].ok === true) {
    await persistRuntimeSessionAggregate(context.pool, await buildRuntimeSessionAggregateFromPostgres(context.pool, day, { peakBytes: result.receipt.sessionPeakBytes, postArchiveBytes: postBytes }));
  }
  const archive = await probeArchiveHealth(context.backend, now);
  const retirable = records.filter((record) => record.state === 'ARCHIVED_VERIFIED' || record.state === 'DETACH_ELIGIBLE').reduce((sum, record) => sum + (sizesAfter.get(`${record.dataset}/${record.partition}`) ?? 0), 0);
  const assessment = assessCapacity({ currentBytes: postBytes, planBytes: context.planBytes, recentSessionGrowthBytes: plane.recentSessionGrowth.slice(-20), archiveRetireBytesPerSession: archive.healthy ? Math.min(2 * GIB, retirable + queue.queueBytes) : 0, retirableBytesNow: retirable, queue });
  let written = false;
  try { await writePressureState(context.pool, { assessment, dbBytes: postBytes, planBytes: context.planBytes, queue, archiveHealthy: archive.healthy, now: context.now() }); written = true; } catch (error) { incidents.push(incident('STORAGE_PRESSURE_STATE_UNAVAILABLE', 'CRITICAL', {}, error instanceof Error ? error.message.slice(0, 160) : 'WRITE_FAILED', observedAt)); }
  await persistIncidents(context.pool, incidents);
  const slo = plane.postArchiveHistory.length >= plane.warmupSessions ? 'EVALUATED' : `WARMING_UP(${plane.postArchiveHistory.length}/${plane.warmupSessions})`;
  return { state: 'POST_SESSION', receipt: result.receipt, incidents, yielded: result.yielded, parquet: parquet.outcomes, sloState: slo, postArchiveBytes: postBytes, pressureStateWritten: written };
}

// ---- weekly integrity --------------------------------------------------------------------------------------------------------------------------------------------

export interface WeeklyResult {
  readonly state: 'WEEKLY_INTEGRITY';
  readonly incidents: readonly PlatformIncident[];
  readonly archivesVerified: number;
  readonly parquetVerified: number;
  readonly parquetRowsChecked: number;
  readonly deletionPerformed: false;
}

export async function runWeeklyIntegrity(context: AutomationContext, sample: number): Promise<WeeklyResult> {
  const observedAt = stamp(context);
  const datasets = await existingParents(context);
  const store = new PostgresPartitionStateStore(context.pool);
  const { plane } = buildPlane(context, new Map(), datasets);
  const incidents: PlatformIncident[] = [...(await plane.weeklyIntegrity(sample))];
  const records = (await store.list()).filter((record) => record.manifest !== null);
  let parquetVerified = 0; let parquetRows = 0;
  if (context.parquet !== null) {
    const candidates = records.filter((record) => !PARQUET_EXEMPT.has(record.dataset) && PARQUET_COLUMNS[record.dataset] !== undefined);
    const stride = Math.max(1, Math.floor(candidates.length / Math.max(1, sample)));
    for (let index = 0; index < candidates.length && parquetVerified < sample; index += stride) {
      const record = candidates[index] as PartitionRecord;
      const manifestPath = join(context.parquetRoot, record.dataset, record.partition, record.dataset, 'parquet-manifest.json');
      try { statSync(manifestPath); } catch { incidents.push(incident('PARQUET_VERIFICATION_FAILURE', 'WARNING', { dataset: record.dataset, partition: record.partition }, 'PARQUET_MANIFEST_MISSING', observedAt)); continue; }
      const verified = await context.parquet.verify(manifestPath);
      const opened = verified.ok ? await context.parquet.openCheck(manifestPath) : verified;
      if (!verified.ok || !opened.ok) { incidents.push(incident('PARQUET_VERIFICATION_FAILURE', 'CRITICAL', { dataset: record.dataset, partition: record.partition }, JSON.stringify(verified.ok ? opened.detail : verified.detail).slice(0, 200), observedAt)); continue; }
      const rows = Number((verified.detail as { rows?: unknown }).rows ?? 0);
      if (record.manifest !== null && rows !== record.manifest.rowCount) { incidents.push(incident('PARQUET_VERIFICATION_FAILURE', 'CRITICAL', { dataset: record.dataset, partition: record.partition }, `PARQUET_ROW_COUNT_DIFFERS_FROM_ARCHIVE:${rows}/${record.manifest.rowCount}`, observedAt)); continue; }
      parquetVerified += 1; parquetRows += rows;
    }
  }
  await persistIncidents(context.pool, incidents);
  return { state: 'WEEKLY_INTEGRITY', incidents, archivesVerified: Math.min(sample, records.length), parquetVerified, parquetRowsChecked: parquetRows, deletionPerformed: false };
}

export { catalogFor, platformCatalog };
