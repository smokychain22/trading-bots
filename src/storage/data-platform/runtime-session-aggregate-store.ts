import type { Pool } from 'pg';
import { canonicalJson, sha256Hex } from './archive-manifest.js';
import { buildRuntimeSessionAggregate, type RuntimeSessionAggregate } from './historical-compaction.js';

const countMap = (rows: Array<{ key: string | null; n: number | string }>, fallback: string): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key ?? fallback;
    counts[key] = (counts[key] ?? 0) + Number(row.n);
  }
  return counts;
};

type FrontierAggregateRow = {
  readonly key: string | null;
  readonly n: number | string;
  readonly waits: number | string;
  readonly frontier_json: unknown;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const strings = (value: unknown): readonly string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];

function increment(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

/**
 * Aggregate only decision-level facts that remain exact in the bounded
 * queryable frontier projection. The selected candidate is always retained by
 * projectCanonicalFrontierForPostgres. Counts for every enumerated candidate
 * belong in the cold cycle archive and are deliberately not inferred here.
 */
export function aggregateProjectedFrontiers(rows: readonly FrontierAggregateRow[]): {
  readonly waitReasonCounts: Readonly<Record<string, number>>;
  readonly aegisCounts: Readonly<Record<string, number>>;
  readonly sizingCounts: Readonly<Record<string, number>>;
} {
  const waitReasonCounts: Record<string, number> = {};
  const aegisCounts: Record<string, number> = {};
  const sizingCounts: Record<string, number> = {};
  for (const row of rows) {
    const frontier = record(row.frontier_json);
    if (frontier === null) {
      increment(aegisCounts, 'INVALID_FRONTIER_PROJECTION');
      increment(sizingCounts, 'INVALID_FRONTIER_PROJECTION');
      continue;
    }
    for (const reason of strings(frontier.globalWaitReasons)) increment(waitReasonCounts, reason);
    const selectedCandidateId = typeof frontier.selectedCandidateId === 'string' ? frontier.selectedCandidateId : null;
    if (selectedCandidateId === null) {
      increment(aegisCounts, 'NOT_APPLICABLE_NO_SELECTED_CANDIDATE');
      increment(sizingCounts, 'NOT_APPLICABLE_NO_SELECTED_CANDIDATE');
      continue;
    }
    const branches = Array.isArray(frontier.branches) ? frontier.branches : [];
    const selected = branches.flatMap((branch) => {
      const candidates = record(branch)?.candidates;
      return Array.isArray(candidates) ? candidates : [];
    }).map(record).find((candidate) => candidate?.candidateId === selectedCandidateId) ?? null;
    if (selected === null) {
      increment(aegisCounts, 'SELECTED_CANDIDATE_MISSING_FROM_PROJECTION');
      increment(sizingCounts, 'SELECTED_CANDIDATE_MISSING_FROM_PROJECTION');
      continue;
    }
    increment(aegisCounts, typeof selected.aegisState === 'string' ? selected.aegisState : 'UNKNOWN');
    const sizing = record(selected.sizing);
    increment(sizingCounts, typeof sizing?.bindingConstraint === 'string' ? sizing.bindingConstraint : 'UNKNOWN');
  }
  return { waitReasonCounts, aegisCounts, sizingCounts };
}

export async function buildRuntimeSessionAggregateFromPostgres(pool: Pool, sessionDate: string, storage: RuntimeSessionAggregate['storage']): Promise<RuntimeSessionAggregate> {
  const [frontier, cycles, providers, submissions] = await Promise.all([
    pool.query(`SELECT selected_branch AS key, 1::int AS n, CASE WHEN global_wait_earned THEN 1 ELSE 0 END::int AS waits, frontier_json
      FROM trade.canonical_strategy_frontier
      WHERE observed_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
        AND observed_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/New_York')`, [sessionDate]),
    pool.query(`SELECT status AS key, 1::int AS n,
      extract(epoch FROM (completed_at-invoked_at))*1000 AS latency_ms, error_code
      FROM ops.runtime_worker_cycle
      WHERE invoked_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
        AND invoked_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/New_York')`, [sessionDate]),
    pool.query(`SELECT COALESCE(error_code, CASE WHEN status_code >= 400 THEN 'HTTP_'||status_code::text ELSE 'OK' END) AS key, count(*)::int AS n
      FROM core.provider_request
      WHERE requested_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
        AND requested_at < (($1::date + 1)::timestamp AT TIME ZONE 'America/New_York') GROUP BY 1`, [sessionDate]),
    pool.query(`SELECT count(DISTINCT action_plan_id)::int AS n FROM trade.master_paper_action_plan_event
      WHERE state='SUBMITTED' AND event_time >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
        AND event_time < (($1::date + 1)::timestamp AT TIME ZONE 'America/New_York')`, [sessionDate]),
  ]);
  const frontierRows = frontier.rows as FrontierAggregateRow[];
  const cycleRows = cycles.rows as Array<{ key: string; n: number; latency_ms: string | null; error_code: string | null }>;
  const providerRows = providers.rows as Array<{ key: string | null; n: number }>;
  const decisionCount = frontierRows.reduce((sum, row) => sum + Number(row.n), 0);
  const projected = aggregateProjectedFrontiers(frontierRows);
  return buildRuntimeSessionAggregate({
    sessionDate,
    decisionCount,
    tradeCount: Number((submissions.rows[0] as { n: number } | undefined)?.n ?? 0),
    waitReasonCounts: projected.waitReasonCounts,
    strategyCounts: countMap(frontierRows.map((row) => ({ key: row.key, n: row.n })), 'NO_SELECTED_BRANCH'),
    aegisCounts: projected.aegisCounts,
    sizingCounts: projected.sizingCounts,
    providerIncidentCounts: countMap(providerRows.filter((row) => row.key !== 'OK'), 'PROVIDER_ERROR_UNCLASSIFIED'),
    errorCounts: countMap(cycleRows.filter((row) => row.error_code !== null).map((row) => ({ key: row.error_code, n: row.n })), 'RUNTIME_ERROR_UNCLASSIFIED'),
    latenciesMs: cycleRows.flatMap((row) => row.latency_ms === null ? [] : [Number(row.latency_ms)]).filter(Number.isFinite),
    storage,
  });
}

export async function persistRuntimeSessionAggregate(pool: Pool, aggregate: RuntimeSessionAggregate): Promise<'PERSISTED' | 'IDEMPOTENT'> {
  const body = canonicalJson(aggregate);
  const contentHash = sha256Hex(body);
  const result = await pool.query(
    `INSERT INTO dp.runtime_session_aggregate(session_date, decision_count, trade_count, wait_reason_counts, strategy_counts,
       aegis_counts, sizing_counts, provider_incident_counts, error_counts, latency_percentiles_json, storage_json, content_hash)
     VALUES ($1::date,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12)
     ON CONFLICT (session_date) DO NOTHING`,
    [aggregate.sessionDate, aggregate.decisionCount, aggregate.tradeCount, canonicalJson(aggregate.waitReasonCounts),
      canonicalJson(aggregate.strategyCounts), canonicalJson(aggregate.aegisCounts), canonicalJson(aggregate.sizingCounts),
      canonicalJson(aggregate.providerIncidentCounts), canonicalJson(aggregate.errorCounts), canonicalJson(aggregate.latencyMs),
      canonicalJson(aggregate.storage), contentHash],
  );
  if ((result.rowCount ?? 0) === 0) {
    const existing = (await pool.query('SELECT content_hash FROM dp.runtime_session_aggregate WHERE session_date=$1::date', [aggregate.sessionDate])).rows[0] as { content_hash: string } | undefined;
    if (existing?.content_hash !== contentHash) throw new Error('RUNTIME_SESSION_AGGREGATE_LATE_DATA_CONFLICT');
    return 'IDEMPOTENT';
  }
  return 'PERSISTED';
}
