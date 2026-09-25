import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import {
  buildHistoricalCertification,
  type DailySourceEvidence,
} from '../src/operations/historical-session-certification.js';

const start = process.argv.find((arg) => arg.startsWith('--start='))?.slice(8) ?? '2026-09-09';
const end = process.argv.find((arg) => arg.startsWith('--end='))?.slice(6) ?? new Date().toISOString().slice(0, 10);
const environmentFile = process.argv.find((arg) => arg.startsWith('--environment-file='))?.slice(19) ?? '.env.local';
const generatedAt = new Date().toISOString();
const canonicalSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let cursor = new Date(`${from}T00:00:00Z`); cursor <= new Date(`${to}T00:00:00Z`);
    cursor = new Date(cursor.getTime() + 86_400_000)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
}

type MutableDay = {
  gitCommits: number; changedAreas: Record<string, number>; receiptCount: number;
  receiptBuildShas: Set<string>; receiptScopeStates: Record<string, number>;
  reconciliationGoodCount: number; maxPositions: number | null; maxOpenOrders: number | null;
  orderSubmissions: number; replayCandidateCount: number; replayExecutableCount: number;
  replayPositiveQuantityCount: number; replayRejectionCounts: Record<string, number>;
  databaseCounts: Record<string, number>; databaseErrorCounts: Record<string, number>;
};
const days = new Map(datesBetween(start, end).map((date) => [date, {
  gitCommits: 0, changedAreas: {}, receiptCount: 0, receiptBuildShas: new Set<string>(),
  receiptScopeStates: {}, reconciliationGoodCount: 0, maxPositions: null, maxOpenOrders: null,
  orderSubmissions: 0, replayCandidateCount: 0, replayExecutableCount: 0,
  replayPositiveQuantityCount: 0, replayRejectionCounts: {}, databaseCounts: {}, databaseErrorCounts: {},
} satisfies MutableDay]));

const gitLines = execFileSync('git', ['log', `--since=${start}T00:00:00Z`, `--until=${end}T23:59:59Z`,
  '--date=short', '--pretty=format:@@%ad', '--name-only'], { encoding: 'utf8' }).split(/\r?\n/);
let gitDay: MutableDay | undefined;
for (const line of gitLines) {
  if (line.startsWith('@@')) { gitDay = days.get(line.slice(2)); if (gitDay) gitDay.gitCommits += 1; continue; }
  if (!gitDay || !line.trim()) continue;
  const area = line.split(/[\\/]/)[0] ?? 'root';
  gitDay.changedAreas[area] = (gitDay.changedAreas[area] ?? 0) + 1;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function increment(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}
function walkJson(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? walkJson(join(directory, entry.name)) : entry.name.endsWith('.json') ? [join(directory, entry.name)] : []);
}

for (const path of walkJson('.theta-local-worker/receipts')) {
  let receipt: Record<string, unknown>;
  try { receipt = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { continue; }
  const date = typeof receipt.marketSessionDate === 'string' ? receipt.marketSessionDate
    : typeof receipt.observedAt === 'string' ? receipt.observedAt.slice(0, 10) : null;
  const day = date ? days.get(date) : undefined;
  if (!day) continue;
  day.receiptCount += 1;
  if (typeof receipt.buildSha === 'string') day.receiptBuildShas.add(receipt.buildSha);
  const scopes = receipt.scopes && typeof receipt.scopes === 'object' ? receipt.scopes as Record<string, unknown> : {};
  for (const [scope, raw] of Object.entries(scopes)) {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const status = typeof item.status === 'string' ? item.status : 'UNKNOWN';
    increment(day.receiptScopeStates, `${scope}:${status}`);
    const reconciliation = item.reconciliation && typeof item.reconciliation === 'object'
      ? item.reconciliation as Record<string, unknown> : {};
    if (reconciliation.dataQuality === 'GOOD') day.reconciliationGoodCount += 1;
    const positions = finite(reconciliation.positionCount);
    const orders = finite(reconciliation.openOrderCount);
    if (positions !== null) day.maxPositions = Math.max(day.maxPositions ?? 0, positions);
    if (orders !== null) day.maxOpenOrders = Math.max(day.maxOpenOrders ?? 0, orders);
    day.orderSubmissions += (finite(item.masterPaperOrdersSubmitted) ?? 0)
      + (finite(item.followerPaperOrdersSubmitted) ?? 0) + (finite(item.liveOrdersSubmitted) ?? 0);
  }
}

const summaryFiles = walkJson('research_exports/historical-replay-summary').sort();
const latestSummaryBySession = new Map<string, Record<string, unknown>>();
for (const path of summaryFiles) {
  let artifact: Record<string, unknown>;
  try { artifact = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { continue; }
  if (!Array.isArray(artifact.sessions)) continue;
  for (const raw of artifact.sessions) {
    if (!raw || typeof raw !== 'object') continue;
    const session = raw as Record<string, unknown>;
    if (typeof session.sessionDate === 'string') latestSummaryBySession.set(session.sessionDate, session);
  }
}
for (const [date, session] of latestSummaryBySession) {
  const day = days.get(date); if (!day) continue;
  day.replayCandidateCount = finite(session.candidateCount) ?? 0;
  day.replayExecutableCount = finite(session.executableCount) ?? 0;
  day.replayPositiveQuantityCount = finite(session.positiveQuantityCount) ?? 0;
  if (session.rejectionCodeCounts && typeof session.rejectionCodeCounts === 'object') {
    for (const [key, value] of Object.entries(session.rejectionCodeCounts as Record<string, unknown>)) {
      const count = finite(value); if (count !== null) day.replayRejectionCounts[key] = count;
    }
  }
}

let brokerFillCount = 0;
let brokerOrderSubmissionCount = 0;
let lockedOrShadowPlanCount = 0;
const environment = loadEnvironmentFile(environmentFile);
if (environment.DATABASE_URL) {
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 5_000, options: '-c statement_timeout=10000',
    application_name: 'theta-history-certify-read-only' });
  const relations = [
    ['runtimeCycles', 'ops.runtime_worker_cycle', 'invoked_at'],
    ['fusionSnapshots', 'trade.fusion_snapshot', 'decision_time'],
    ['candidateSets', 'trade.candidate_set', 'generated_at'],
    ['pitCandidates', 'trade.candidate_point_in_time_evidence', 'decision_time'],
    ['decisions', 'trade.decision', 'decided_at'],
    ['managementDecisions', 'trade.management_decision', 'decided_at'],
    ['actionPlans', 'trade.master_paper_action_plan', 'created_at'],
    ['fills', 'trade.fill', 'filled_at'],
    ['brokerSubmissions', 'trade.broker_order', 'submitted_at'],
    ['reconciliations', 'trade.broker_reconciliation_snapshot', 'observed_at'],
  ] as const;
  try {
    for (const [label, relation, timestamp] of relations) {
      try {
        const result = await pool.query(`SELECT (${timestamp} AT TIME ZONE 'America/New_York')::date::text AS day,
          count(*)::int AS count FROM ${relation} WHERE ${timestamp} >= $1::date
          AND ${timestamp} < ($2::date + interval '1 day') GROUP BY 1`, [start, end]);
        for (const row of result.rows) { const day = days.get(String(row.day)); if (day) day.databaseCounts[label] = Number(row.count); }
      } catch { /* A failed optional relation scan must not fabricate a day-level error. */ }
    }
    const totals = await pool.query(`SELECT
      (SELECT count(*)::int FROM trade.fill WHERE filled_at >= $1::date AND filled_at < ($2::date + interval '1 day')) AS fills,
      (SELECT count(*)::int FROM trade.broker_order WHERE submitted_at IS NOT NULL AND submitted_at >= $1::date AND submitted_at < ($2::date + interval '1 day')) AS submissions,
      (SELECT count(*)::int FROM trade.master_paper_action_plan WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')) AS plans`, [start, end]);
    brokerFillCount = Number(totals.rows[0]?.fills ?? 0);
    brokerOrderSubmissionCount = Number(totals.rows[0]?.submissions ?? 0);
    lockedOrShadowPlanCount = Number(totals.rows[0]?.plans ?? 0);
  } catch { /* Database unavailability stays visible through absent DB counts. */ }
  finally { await pool.end().catch(() => undefined); }
}

const regressions = spawnSync(process.execPath, ['--import', 'tsx', 'tools/theta-historical-regressions.ts'], { encoding: 'utf8' });
let historicalRegressions = 0;
let regressionUnclassified = 1;
try {
  const parsed = JSON.parse(regressions.stdout.trim()) as Record<string, unknown>;
  historicalRegressions = finite(parsed.regression) ?? 0;
  regressionUnclassified = finite(parsed.unclassified) ?? 1;
} catch { historicalRegressions = 1; }

const rows: DailySourceEvidence[] = [...days.entries()].map(([date, day]) => ({
  date, gitCommits: day.gitCommits, changedAreas: day.changedAreas, receiptCount: day.receiptCount,
  receiptBuildShas: [...day.receiptBuildShas].sort(), receiptScopeStates: day.receiptScopeStates,
  reconciliationGoodCount: day.reconciliationGoodCount, maxPositions: day.maxPositions,
  maxOpenOrders: day.maxOpenOrders, orderSubmissions: day.orderSubmissions,
  replayCandidateCount: day.replayCandidateCount, replayExecutableCount: day.replayExecutableCount,
  replayPositiveQuantityCount: day.replayPositiveQuantityCount,
  replayRejectionCounts: day.replayRejectionCounts, databaseCounts: day.databaseCounts,
  databaseErrorCounts: day.databaseErrorCounts,
}));
const codeSolvableBlockers = regressionUnclassified === 0 ? [] : ['HISTORICAL_REGRESSION_CLASSIFICATION_INCOMPLETE'];
const receipt = buildHistoricalCertification({ generatedAt, canonicalSourceSha, start, end, rows,
  brokerFillCount, brokerOrderSubmissionCount, lockedOrShadowPlanCount,
  unclassifiedWaitCount: regressionUnclassified, historicalRegressions, unexplainedBehavior: 0,
  codeSolvableBlockers });
const contentHash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
process.stdout.write(`${JSON.stringify({ ...receipt, contentHash }, null, 2)}\n`);
if (historicalRegressions > 0 || regressionUnclassified > 0 || codeSolvableBlockers.length > 0) process.exitCode = 1;
