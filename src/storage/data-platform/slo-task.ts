// The production storage SLO, computed from what the platform itself recorded (receipts, the pressure state, the live hot-bytes sample) so it can be checked at any time without
// trusting an offline model:
//   POST_ARCHIVE_DB_SIZE            database size after each session's archive/retirement (the series whose slope matters)
//   HOT_BYTES_PER_DECISION_P50/P95  measured on the most recent real decisions (hot-bytes.ts: the same measurement the acceptance report quotes)
//   ARCHIVE_QUEUE_BYTES / ARCHIVE_LAG_SESSIONS / SESSIONS_TO_STORAGE_PRESSURE
//   verdict: a sustained positive post-archive slope is UNBOUNDED_POSTGRES_GROWTH (an incident), never "growth is fine because the plan is big"
import type { AutomationContext } from './automation.js';
import { persistIncidents } from './automation.js';
import { assessSteadyState, growthIncident, amplificationIncident, type SteadyStateAssessment } from './growth-slo.js';
import { defaultCapacityBands } from './storage-governor.js';
import { recentDecisionHotBytes } from './hot-bytes.js';
import type { PlatformIncident } from './incidents.js';
import type { StorageReceipt } from './platform-board.js';

export const HOT_BYTES_P95_TARGET = 250 * 1024;
export const CAPACITY_HORIZON_SESSIONS_WARNING = 3 * 252;
const incidentFor = (sessions: number, observedAt: string): PlatformIncident => ({ kind: 'DATABASE_CAPACITY_FORECAST_BREACH', severity: 'WARNING', scope: {}, detail: `the post-archive size reaches the critical band in about ${sessions} sessions at the measured slope`, observedAt });

export interface SloResult {
  readonly state: 'SLO';
  readonly observedAt: string;
  readonly POST_ARCHIVE_DB_SIZE_BYTES: number | null;
  readonly POST_ARCHIVE_SERIES_SESSIONS: number;
  readonly POST_ARCHIVE_SLOPE_BYTES_PER_SESSION: number;
  readonly STEADY_STATE: SteadyStateAssessment['state'];
  readonly HOT_BYTES_PER_DECISION_P50: number | null;
  readonly HOT_BYTES_PER_DECISION_P95: number | null;
  readonly HOT_BYTES_PER_DECISION_P95_WITHOUT_BLOB: number | null;
  readonly HOT_BYTES_P95_TARGET: number;
  readonly HOT_BYTES_P95_STATUS: 'MET' | 'NOT_MET' | 'NO_DATA';
  readonly ARCHIVE_QUEUE_BYTES: number | null;
  readonly ARCHIVE_LAG_SESSIONS: number | null;
  /** sessions until the post-archive size crosses the RESEARCH_THROTTLED band at the measured slope (the first band that changes behavior); null when the slope is not positive or history is short */
  readonly SESSIONS_TO_STORAGE_PRESSURE: number | null;
  readonly SESSIONS_TO_STORAGE_CRITICAL: number | null;
  /** a positive slope that is within the steady-state tolerance still means the allocation will be reached: flagged when that is closer than three years */
  readonly CAPACITY_HORIZON_SESSIONS_WARNING: number;
  readonly UNBOUNDED_POSTGRES_GROWTH: boolean;
  readonly incidents: readonly PlatformIncident[];
}

export async function runSlo(context: AutomationContext, options: { readonly sampleDecisions?: number; readonly baselineP95Bytes?: number } = {}): Promise<SloResult> {
  const observedAt = context.now().toISOString();
  const receipts = (await context.pool.query('SELECT receipt_json FROM dp.storage_receipt ORDER BY session_date ASC LIMIT 400')).rows.map((row) => row.receipt_json as StorageReceipt);
  const series = receipts.map((receipt) => receipt.postArchiveBytes);
  const steady = assessSteadyState(series);
  const incidents: PlatformIncident[] = [];
  const growth = growthIncident(steady, observedAt); if (growth !== null) incidents.push(growth);
  let hot: Awaited<ReturnType<typeof recentDecisionHotBytes>> | null = null;
  try { hot = await recentDecisionHotBytes(context.pool, options.sampleDecisions ?? 60); } catch { hot = null; }
  if (hot !== null && options.baselineP95Bytes !== undefined) { const regression = amplificationIncident(options.baselineP95Bytes, hot.p95, observedAt); if (regression !== null) incidents.push(regression); }
  // slope-based horizon: independent of the steady-state tolerance, a post-archive series that keeps rising reaches the allocation; say when
  const plan = context.planBytes;
  const latest = series.at(-1) ?? null;
  const horizonSessions = (limitFraction: number): number | null => (latest === null || series.length < 10 || !(steady.slopeBytesPerSession > 0) ? null : Math.max(0, Math.round((limitFraction * plan - latest) / steady.slopeBytesPerSession)));
  const toPressure = horizonSessions(defaultCapacityBands.researchThrottledAt); const toCritical = horizonSessions(defaultCapacityBands.criticalAt);
  if (toCritical !== null && toCritical < CAPACITY_HORIZON_SESSIONS_WARNING) incidents.push(incidentFor(toCritical, observedAt));
  const pressure = (await context.pool.query('SELECT database_bytes, archive_queue_bytes, archive_lag_sessions, projected_sessions_to_critical FROM dp.storage_pressure_state WHERE singleton')).rows[0] as
    { database_bytes: string; archive_queue_bytes: string; archive_lag_sessions: number; projected_sessions_to_critical: string | null } | undefined;
  await persistIncidents(context.pool, incidents);
  const sample = hot !== null && hot.decisions > 0 ? hot : null;
  return {
    state: 'SLO', observedAt, POST_ARCHIVE_DB_SIZE_BYTES: series.at(-1) ?? null, POST_ARCHIVE_SERIES_SESSIONS: series.length, POST_ARCHIVE_SLOPE_BYTES_PER_SESSION: steady.slopeBytesPerSession, STEADY_STATE: steady.state,
    HOT_BYTES_PER_DECISION_P50: sample === null ? null : sample.p50, HOT_BYTES_PER_DECISION_P95: sample === null ? null : sample.p95, HOT_BYTES_PER_DECISION_P95_WITHOUT_BLOB: sample === null ? null : sample.withoutBlobP95, HOT_BYTES_P95_TARGET: HOT_BYTES_P95_TARGET,
    HOT_BYTES_P95_STATUS: sample === null ? 'NO_DATA' : sample.p95 < HOT_BYTES_P95_TARGET ? 'MET' : 'NOT_MET',
    ARCHIVE_QUEUE_BYTES: pressure === undefined ? null : Number(pressure.archive_queue_bytes), ARCHIVE_LAG_SESSIONS: pressure === undefined ? null : pressure.archive_lag_sessions,
    SESSIONS_TO_STORAGE_PRESSURE: toPressure, SESSIONS_TO_STORAGE_CRITICAL: toCritical, CAPACITY_HORIZON_SESSIONS_WARNING,
    UNBOUNDED_POSTGRES_GROWTH: steady.linearGrowthDetected, incidents,
  };
}
