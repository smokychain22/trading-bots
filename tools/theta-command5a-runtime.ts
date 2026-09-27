import { hostname } from 'node:os';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { AlpacaCommand5aObservationSource } from '../src/research/alpaca-command5a-observation-source.js';
import { alpacaCalendarToLearningSessions } from '../src/research/alpaca-learning-calendar.js';
import { runCommand5aLocalObservationWorker } from '../src/research/command5a-local-observation-worker.js';
import { matureCommand5aLocalObservations } from '../src/research/command5a-local-maturation.js';
import {
  resolveCommand5aFrontierUnderlying,
  scheduleCommand5aFromCanonicalFrontier,
} from '../src/research/command5a-local-scheduling.js';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';
import {
  classifyLocalSpoolWatermark, measureLocalResearchStorageBytes,
} from '../src/storage/local-research-archive-health.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';
import { fetchMarketCalendar } from '../src/theta/alpaca-provider.js';
import {
  buildCommand5aCalendarRange,
  command5aSafeFailureCode,
  processCommand5aPage,
} from '../src/research/command5a-runtime-planning.js';

type FrontierRow = {
  frontier_id: string;
  ready_at: Date | string;
  fusion_snapshot_id: string;
  snapshot_json: unknown;
  frontier_json: unknown;
  evidence_archive_gzip: Buffer | null;
  snapshot_content_hash: string;
  decision_id: string | null;
  receipt_json: unknown;
  risk_limit_version_id: string;
  cost_model_version_id: string;
  execution_version_id: string;
};

const argument = (prefix: string): string | undefined => process.argv.slice(2)
  .find((value) => value.startsWith(prefix))?.slice(prefix.length);
const mode = argument('--mode=');
const environmentFile = argument('--environment-file=') ?? '.env.local';
const schedulerPath = argument('--scheduler=') ?? '.theta-local-worker/research-spool/theta-observation-jobs.sqlite';
const spoolPath = argument('--spool=') ?? '.theta-local-worker/research-spool/theta-research.sqlite';
const parquetRoot = argument('--parquet-root=') ?? 'C:\\ProjectBackups\\trading-bots\\research-archives';
const environment = loadEnvironmentFile(environmentFile);
const readOnlyFetch: typeof fetch = (input, init) => {
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') throw new Error('COMMAND5A_NON_GET_REJECTED');
  return fetch(input, init);
};
function alpacaConfig() {
  if (!environment.ALPACA_API_KEY || !environment.ALPACA_SECRET_KEY || !environment.ALPACA_BASE_URL) {
    throw new Error('COMMAND5A_ALPACA_CONFIGURATION_REQUIRED');
  }
  return { tradingApiBase: environment.ALPACA_BASE_URL,
    marketDataApiBase: 'https://data.alpaca.markets', apiKey: environment.ALPACA_API_KEY,
    apiSecret: environment.ALPACA_SECRET_KEY, fetchImpl: readOnlyFetch };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function releaseIdentity(receipt: unknown): { sourceSha: string; workerSha: string } | null {
  const identity = record(record(receipt).releaseIdentity);
  const sourceSha = typeof identity.sourceSha === 'string' ? identity.sourceSha : '';
  const workerSha = typeof identity.workerSha === 'string' ? identity.workerSha : '';
  return /^[0-9a-f]{40}$/.test(sourceSha) && /^[0-9a-f]{40}$/.test(workerSha)
    ? { sourceSha, workerSha } : null;
}

function fullFrontier(row: FrontierRow): { frontier: CanonicalStrategyFrontier | null; reasonCode: string | null } {
  try {
    const raw = row.evidence_archive_gzip === null ? row.frontier_json
      : decodeCycleEvidenceArchive(row.evidence_archive_gzip).strategyFrontier;
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? { frontier: raw as unknown as CanonicalStrategyFrontier, reasonCode: null }
      : { frontier: null, reasonCode: 'FRONTIER_ARCHIVE_MISSING' };
  } catch {
    return { frontier: null, reasonCode: 'FRONTIER_ARCHIVE_INVALID' };
  }
}

async function schedule(): Promise<void> {
  const localStorageBytes = measureLocalResearchStorageBytes([schedulerPath, spoolPath, parquetRoot]);
  const localStorageWatermark = classifyLocalSpoolWatermark(localStorageBytes);
  if (localStorageWatermark === 'HIGH' || localStorageWatermark === 'CRITICAL') {
    process.stdout.write(`${JSON.stringify({ state: 'PAUSED_STORAGE_WATERMARK', localStorageBytes,
      localStorageWatermark, brokerAuthority: false, orderSubmissions: 0, brokerMutations: 0 })}\n`);
    return;
  }
  const alpaca = alpacaConfig();
  if (!environment.DATABASE_URL) throw new Error('COMMAND5A_DATABASE_URL_REQUIRED');
  const since = argument('--since=');
  if (since === undefined || !Number.isFinite(Date.parse(since))) throw new Error('COMMAND5A_SINCE_REQUIRED');
  const limit = Number(argument('--limit=') ?? '250');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('COMMAND5A_LIMIT_INVALID');
  const pool = createRuntimePostgresPool(environment.DATABASE_URL);
  const scheduler = new LocalObservationJobScheduler(schedulerPath);
  try {
    const cursor = scheduler.sourceCursor();
    const cursorReadyAt = cursor?.readyAt ?? new Date(since).toISOString();
    const cursorFrontierId = cursor?.frontierId ?? '00000000-0000-0000-0000-000000000000';
    const query = await pool.query<FrontierRow>(`SELECT f.frontier_id::text,
      GREATEST(f.created_at,d.decided_at) AS ready_at,
      f.fusion_snapshot_id::text,
      s.snapshot_json,f.frontier_json,s.evidence_archive_gzip,s.content_hash AS snapshot_content_hash,
      d.decision_id::text,d.receipt_json,s.risk_limit_version_id::text,s.cost_model_version_id::text,
      s.execution_version_id::text
      FROM trade.canonical_strategy_frontier f
      JOIN trade.fusion_snapshot s USING(fusion_snapshot_id)
      JOIN LATERAL (SELECT decision_id,receipt_json,decided_at FROM trade.decision
        WHERE fusion_snapshot_id=f.fusion_snapshot_id
        ORDER BY decided_at DESC,decision_id DESC LIMIT 1) d ON true
      WHERE (GREATEST(f.created_at,d.decided_at),f.frontier_id) > ($1::timestamptz,$2::uuid)
      ORDER BY GREATEST(f.created_at,d.decided_at),f.frontier_id LIMIT $3`,
    [cursorReadyAt, cursorFrontierId, limit]);
    const decoded = query.rows.map((row) => ({ row, ...fullFrontier(row) }));
    if (decoded.length === 0) {
      process.stdout.write(`${JSON.stringify({ state: 'COMMAND5A_SCHEDULE_CURRENT', frontiersRead: query.rows.length,
        subjects: 0, existingSubjects: 0, jobsScheduled: 0, existingJobs: 0, skipped: 0,
        reasonCounts: {}, sessions: 0, brokerAuthority: false, orderSubmissions: 0, brokerMutations: 0 })}\n`);
      return;
    }
    const calendarRange = buildCommand5aCalendarRange(decoded.flatMap(({ frontier }) => frontier === null ? [] : [{
      decisionAt: frontier.timestamp,
      expirations: frontier.branches.flatMap((branch) => branch.candidates
        .flatMap((candidate) => candidate.legs.map((leg) => leg.expiration))),
    }]));
    if (calendarRange === null) {
      const last = query.rows.at(-1);
      if (last !== undefined) scheduler.advanceSourceCursor({
        readyAt: new Date(last.ready_at).toISOString(), frontierId: last.frontier_id,
      });
      process.stdout.write(`${JSON.stringify({ state: 'COMMAND5A_SCHEDULE_COMPLETE',
        frontiersRead: query.rows.length, subjects: 0, existingSubjects: 0, jobsScheduled: 0,
        existingJobs: 0, skipped: query.rows.length,
        reasonCounts: Object.fromEntries(decoded.reduce((counts, item) => {
          const reason = item.reasonCode ?? 'FRONTIER_TIMESTAMP_INVALID';
          counts.set(reason, (counts.get(reason) ?? 0) + 1);
          return counts;
        }, new Map<string, number>())), sessions: 0,
        brokerAuthority: false, orderSubmissions: 0, brokerMutations: 0 })}\n`);
      return;
    }
    const sessions = alpacaCalendarToLearningSessions(await fetchMarketCalendar(
      alpaca, calendarRange.start, calendarRange.end,
    ));
    let scheduled = 0, existingJobs = 0, subjects = 0, existingSubjects = 0, skipped = 0;
    let t0OnlySubjects = 0;
    const reasonCounts = new Map<string, number>();
    const skip = (reason: string): void => {
      skipped += 1;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    };
    const outcomes = processCommand5aPage(decoded, ({ row, frontier, reasonCode }) => {
      const identity = releaseIdentity(row.receipt_json);
      const underlying = frontier === null ? null
        : resolveCommand5aFrontierUnderlying(frontier, row.snapshot_json);
      if (frontier === null) throw new Error(reasonCode ?? 'FRONTIER_ARCHIVE_MISSING');
      if (identity === null) throw new Error('RELEASE_IDENTITY_MISSING');
      if (row.decision_id === null) throw new Error('DECISION_ID_MISSING');
      if (underlying === null) throw new Error('UNDERLYING_IDENTITY_AMBIGUOUS');
      const receipt = scheduleCommand5aFromCanonicalFrontier({ scheduler, frontier,
        decisionCycleId: row.fusion_snapshot_id, decisionId: row.decision_id, underlying,
        featureSnapshotHash: row.snapshot_content_hash, riskVersion: row.risk_limit_version_id,
        costVersion: row.cost_model_version_id, executionModelVersion: row.execution_version_id,
        sourceSha: identity.sourceSha, workerSha: identity.workerSha, sessions,
        horizonPolicy: { version: 'theta-strategy-learning-horizons-v1',
          primaryCommonHorizon: '1_TRADING_DAY', tradingDayTarget: 'SESSION_CLOSE' } });
      scheduled += receipt.scheduledJobCount;
      existingJobs += receipt.existingJobCount;
      subjects += receipt.subjectCount;
      existingSubjects += receipt.existingSubjectCount;
      t0OnlySubjects += receipt.t0OnlySubjectCount;
      return receipt;
    });
    for (const outcome of outcomes) {
      if (outcome.state === 'SKIPPED') skip(outcome.reasonCode);
    }
    const last = query.rows.at(-1);
    if (last !== undefined) scheduler.advanceSourceCursor({
      readyAt: new Date(last.ready_at).toISOString(), frontierId: last.frontier_id,
    });
    process.stdout.write(`${JSON.stringify({ state: 'COMMAND5A_SCHEDULE_COMPLETE', frontiersRead: query.rows.length,
      subjects, existingSubjects, jobsScheduled: scheduled, skipped,
      existingJobs,
      t0OnlySubjects,
      reasonCounts: Object.fromEntries(reasonCounts), sessions: sessions.length,
      brokerAuthority: false, orderSubmissions: 0, brokerMutations: 0 })}\n`);
  } finally {
    scheduler.close();
    await pool.end();
  }
}

async function observe(): Promise<void> {
  const alpaca = alpacaConfig();
  const scheduler = new LocalObservationJobScheduler(schedulerPath);
  try {
    const source = new AlpacaCommand5aObservationSource(alpaca, {
      optionFeed: argument('--option-feed=') === 'opra' ? 'opra' : 'indicative',
      stockFeed: argument('--stock-feed=') === 'sip' ? 'sip' : 'iex',
      maximumResearchQuoteAgeSeconds: Number(argument('--max-research-quote-age-seconds=') ?? '900'),
    });
    const report = await runCommand5aLocalObservationWorker({ scheduler, source, spoolPath,
      claimedBy: `command5a:${hostname().replace(/[^A-Za-z0-9_.-]/g, '_')}:${process.pid}`,
      asOf: new Date().toISOString(), claimTtlSeconds: 180, limit: 16,
      allowClosedSessionLatestMark: true, maximumAttempts: 3 });
    process.stdout.write(`${JSON.stringify({ state: 'COMMAND5A_OBSERVATION_COMPLETE', ...report })}\n`);
  } finally { scheduler.close(); }
}

function mature(): void {
  const scheduler = new LocalObservationJobScheduler(schedulerPath);
  try {
    const report = matureCommand5aLocalObservations({
      scheduler,
      spoolPath,
      asOf: new Date().toISOString(),
      limit: Number(argument('--limit=') ?? '64'),
    });
    process.stdout.write(`${JSON.stringify({ state: 'COMMAND5A_MATURATION_COMPLETE', ...report })}\n`);
  } finally { scheduler.close(); }
}

function health(): void {
  const scheduler = new LocalObservationJobScheduler(schedulerPath);
  try {
    const report = scheduler.health({ asOf: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify({ state: 'COMMAND5A_HEALTH_COMPLETE', ...report,
      orderSubmissions: 0, brokerMutations: 0 })}\n`);
  } finally { scheduler.close(); }
}

try {
  if (mode === 'schedule') await schedule();
  else if (mode === 'observe') await observe();
  else if (mode === 'mature') mature();
  else if (mode === 'health') health();
  else throw new Error('COMMAND5A_MODE_REQUIRED');
} catch (error) {
  process.stdout.write(`${JSON.stringify({ state: 'COMMAND5A_FAILED', mode: mode ?? null,
    errorCode: command5aSafeFailureCode(error), brokerAuthority: false, orderSubmissions: 0, brokerMutations: 0 })}\n`);
  process.exitCode = 1;
}
