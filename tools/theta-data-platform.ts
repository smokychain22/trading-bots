// THETA data platform automation entry point (run by scheduled tasks; the owner does nothing). Modes:
//   status        read-only: schema presence, partition states, capacity assessment, pressure state, dual-write ledger, board
//   pre-session   READY | NEW_RISK_STORAGE_LOCK: measure, repair default partitions, pre-create partitions (provider calendar), probe the archive, publish the pressure state
//   post-session  close / archive / verify / Parquet / retire (two-authority rule) / measure / slope / ONE receipt. Idempotent and restart-safe; yields to operations
//   weekly        integrity: archive hashes + manifests, Parquet hashes + DuckDB open + row counts, sampled cycle replay. Corruption: incident, never a deletion
//   slo           production SLO metrics (POST_ARCHIVE_DB_SIZE, HOT_BYTES_PER_DECISION, ARCHIVE_QUEUE_BYTES, ARCHIVE_LAG_SESSIONS, SESSIONS_TO_STORAGE_PRESSURE, slope verdict)
//   dual-write-start | dual-write-status | dual-write-cutover | dual-write-rollback   the bounded PIT dual-write protocol (see pit-writer.ts)
// Storage work is always lower priority than operations and it never touches broker, order, fill or reconciliation tables. If the dp schema (migration 069) is absent the tool
// reports DATA_PLATFORM_SCHEMA_ABSENT and exits 0: it is inert until the owner-approved cutover. Secrets are read from the environment file and never printed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { LocalFilesystemArchiveBackend } from '../src/storage/data-platform/archive-backend.js';
import { runPostSession, runPreSession, runWeeklyIntegrity, schemaPresent, type AutomationContext } from '../src/storage/data-platform/automation.js';
import { backupStartFromId } from '../src/storage/data-platform/durability.js';
import { purgeDurabilityCheck } from '../src/storage/data-platform/durability-policy.js';
import { catalogFor, registryFor } from '../src/storage/data-platform/platform-catalog.js';
import { SubprocessParquetRunner } from '../src/storage/data-platform/parquet-runner.js';
import { PostgresPartitionStateStore, databaseBytes } from '../src/storage/data-platform/postgres-partitions.js';
import { brokerSessionCalendar, type SessionCalendar } from '../src/storage/data-platform/session-calendar.js';
import { cutoverToNormalized, evaluateDualWriteExit, readLedger, rollbackToLegacy, startDualWrite } from '../src/storage/data-platform/pit-writer.js';
import { runSlo } from '../src/storage/data-platform/slo-task.js';
import { buildBoard } from '../src/storage/data-platform/platform-board.js';
import { assessCapacity } from '../src/storage/data-platform/storage-governor.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = arg('mode') ?? 'status';
// THETA_DATA_PLATFORM_DATABASE_URL names a database explicitly (disposable databases in tests); otherwise the canonical environment file is used
const explicitUrl = process.env.THETA_DATA_PLATFORM_DATABASE_URL;
const environment = (explicitUrl === undefined ? { ...process.env, ...loadEnvironmentFile(arg('environment-file') ?? '.env.local') } : { ...process.env }) as Record<string, string | undefined>;
const connectionString = explicitUrl ?? environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const archiveRoot = resolve(environment.THETA_ARCHIVE_ROOT ?? 'C:\\ProjectBackups\\trading-bots\\storage-archives\\platform');
const secondaryRoot = environment.THETA_ARCHIVE_SECONDARY_ROOT;
const parquetRoot = resolve(environment.THETA_PARQUET_ROOT ?? resolve(archiveRoot, '..', 'platform-parquet'));
const backupsRoot = resolve(environment.THETA_BACKUPS_ROOT ?? 'C:\\ProjectBackups\\trading-bots');
const planBytes = Number(environment.THETA_DB_PLAN_BYTES ?? String(8 * 1024 ** 3));
const allIds = [
  'cycle-evidence-blob',
  'decision-context',
  'candidate-hot-detail',
  'candidate-ordinary-rejected',
  'optionomics-raw-observation',
  'optionomics-payload-blob',
  'decision-audit',
  'finalized-execution-history',
  'final-chain-receipt',
  'session-integrity-manifest',
  'runtime-session-aggregate',
];
const activeIds = (environment.THETA_DATA_PLATFORM_DATASETS ?? allIds.join(',')).split(',').map((value) => value.trim()).filter((value) => value.length > 0);
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const offMachinePolicy = environment.THETA_ARCHIVE_OFF_MACHINE_POLICY === 'DEVELOPMENT_LOCAL_ONLY' ? 'DEVELOPMENT_LOCAL_ONLY' : 'REQUIRED';

const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 5_000, application_name: 'theta-data-platform', options: '-c statement_timeout=600000' });
pool.on('error', () => undefined);
const primary = new LocalFilesystemArchiveBackend(archiveRoot);
const secondary = secondaryRoot === undefined ? undefined : new LocalFilesystemArchiveBackend(secondaryRoot);
const objectKey = (manifest: { dataset: string; partition: string; fileHash: string }): string => `data/${manifest.dataset}/${manifest.partition}/${manifest.fileHash}.archive`;

async function latestVerifiedBackup(): Promise<{ startedAt: string; verifiedAt: string | null } | null> {
  const file = resolve(backupsRoot, 'latest', 'current.json');
  if (!existsSync(file)) return null;
  const current = JSON.parse(readFileSync(file, 'utf8')) as { backupId?: string; verifiedAt?: string };
  const startedAt = typeof current.backupId === 'string' ? backupStartFromId(current.backupId) : null;
  return startedAt === null ? null : { startedAt, verifiedAt: current.verifiedAt ?? null };
}

/** the provider calendar through the read-only broker surface (never a local weekday guess); null when no credentials are configured here */
async function providerCalendar(): Promise<SessionCalendar | null> {
  if (environment.THETA_SESSION_CALENDAR === 'DISABLED' || !environment.ALPACA_API_KEY || !environment.ALPACA_SECRET_KEY || !environment.ALPACA_BASE_URL) return null;
  try {
    const { AlpacaPaperBrokerAdapter } = await import('../src/execution/broker.js');
    const { asReadOnlyPaperBroker } = await import('../src/execution/read-only-paper-broker.js');
    const broker = asReadOnlyPaperBroker(new AlpacaPaperBrokerAdapter({ baseUrl: environment.ALPACA_BASE_URL, authentication: { kind: 'MASTER_API_KEY', apiKey: environment.ALPACA_API_KEY, apiSecret: environment.ALPACA_SECRET_KEY } }));
    return brokerSessionCalendar((start, end) => broker.getCalendar(start, end));
  } catch { return null; }
}

function operationsBusy(): boolean {
  // the worker publishes a heartbeat file while it is inside an operational critical section (risk, positions, reconciliation, orders)
  const file = environment.THETA_OPERATIONS_BUSY_FILE;
  return file !== undefined && existsSync(file);
}

async function buildContext(): Promise<AutomationContext> {
  const ids = activeIds;
  return {
    pool, backend: primary, datasets: catalogFor(ids), registry: registryFor(ids), planBytes, sourceSha, policyVersion: 'theta-storage-budget-v3', calendar: await providerCalendar(),
    parquet: environment.THETA_PARQUET_DISABLED === '1' ? null : new SubprocessParquetRunner(), parquetRoot, now: () => new Date(), yieldToOperations: operationsBusy,
    durabilityCheck: purgeDurabilityCheck({ primary, keyFor: objectKey, ...(secondary === undefined ? {} : { secondary, secondaryKeyFor: objectKey }), drBackup: latestVerifiedBackup, drBackupOffMachine: environment.THETA_DR_BACKUP_OFF_MACHINE === '1',
      policy: { requireOffMachineCopy: offMachinePolicy === 'REQUIRED' } }),
  };
}

async function main(): Promise<unknown> {
  if (!(await schemaPresent(pool))) return { state: 'DATA_PLATFORM_SCHEMA_ABSENT', note: 'inert until migration 069 and the owner-approved cutover', mode };
  if (mode === 'pre-session') return await runPreSession(await buildContext());
  if (mode === 'post-session') return await runPostSession(await buildContext());
  if (mode === 'weekly') return await runWeeklyIntegrity(await buildContext(), Number(arg('sample') ?? '10'));
  if (mode === 'slo') return await runSlo(await buildContext());
  if (mode === 'dual-write-start') return { state: 'DUAL_WRITE_STARTED', ledger: await startDualWrite(pool, Number(arg('days') ?? '14')) };
  if (mode === 'dual-write-status') return { state: 'DUAL_WRITE_STATUS', ledger: await readLedger(pool), exit: await evaluateDualWriteExit(pool, { minimumDecisions: Number(arg('min-decisions') ?? '200'), minimumRows: Number(arg('min-rows') ?? '1000') }) };
  if (mode === 'dual-write-cutover') { const result = await cutoverToNormalized(pool, { minimumDecisions: Number(arg('min-decisions') ?? '200'), minimumRows: Number(arg('min-rows') ?? '1000') }); return { state: result.cutover ? 'CUTOVER_RECORDED' : 'CUTOVER_REFUSED', ...result }; }
  if (mode === 'dual-write-rollback') { await rollbackToLegacy(pool); return { state: 'ROLLED_BACK_TO_LEGACY', ledger: await readLedger(pool) }; }

  const dbBytes = await databaseBytes(pool);
  const assessment = assessCapacity({ currentBytes: dbBytes, planBytes, recentSessionGrowthBytes: [], archiveRetireBytesPerSession: 0, retirableBytesNow: 0, queue: { queueBytes: 0, queuePartitions: 0, lagSessions: 0 } });
  const records = await new PostgresPartitionStateStore(pool).list();
  const pressure = (await pool.query('SELECT band, evaluated_at FROM dp.storage_pressure_state WHERE singleton')).rows[0] as { band: string; evaluated_at: Date } | undefined;
  return { state: 'STATUS', archiveRoot, secondaryConfigured: secondary !== undefined, offMachinePolicy, activeDatasets: activeIds, ledger: await readLedger(pool), pressureState: pressure === undefined ? 'MISSING' : { band: pressure.band, evaluatedAt: pressure.evaluated_at.toISOString() },
    partitions: records.map((record) => ({ dataset: record.dataset, partition: record.partition, state: record.state, lastError: record.lastError })), assessment,
    board: buildBoard({ observedAt: new Date().toISOString(), hotDbBytes: dbBytes, planBytes, sessionPeakBytes: null, postArchiveBytes: null, hotBytesPerDecisionP50: null, hotBytesPerDecisionP95: null, archiveQueueBytes: 0, archiveLagSessions: 0,
      lastArchiveAt: null, lastArchiveVerifyAt: null, lastCompactionAt: null, lastPartitionRetirementAt: null, archiveHealth: 'HEALTHY' }, assessment, []) };
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ state: 'FAILED', mode, code: (error as { code?: string }).code ?? (error as Error).message })}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
