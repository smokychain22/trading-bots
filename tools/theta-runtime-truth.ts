import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { deriveRuntimeMismatches } from '../src/theta/runtime-system-truth.js';
import { canonicalSystemTruthRegister } from '../src/theta/canonical-system-truth.js';

const observedAt = new Date().toISOString();
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
const environmentFile = process.argv.find((arg) => arg.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const environment = loadEnvironmentFile(environmentFile);
const brokerHost = environment.ALPACA_BASE_URL ? new URL(environment.ALPACA_BASE_URL).hostname : null;
const paperBrokerConfigured = brokerHost === 'paper-api.alpaca.markets'
  && Boolean(environment.ALPACA_API_KEY && environment.ALPACA_SECRET_KEY);
const broker = {
  host: brokerHost, auth: 'NOT_PROBED' as string, accountHttpStatus: null as number | null,
  clockHttpStatus: null as number | null, positionsHttpStatus: null as number | null,
  ordersHttpStatus: null as number | null, calendarHttpStatus: null as number | null,
  positions: null as number | null, openOrders: null as number | null,
};

async function brokerGet(path: string): Promise<{ status: number | null; body: unknown }> {
  if (!paperBrokerConfigured) return { status: null, body: null };
  try {
    const response = await fetch(`https://paper-api.alpaca.markets${path}`, {
      method: 'GET', headers: {
        'APCA-API-KEY-ID': environment.ALPACA_API_KEY!,
        'APCA-API-SECRET-KEY': environment.ALPACA_SECRET_KEY!,
      }, signal: AbortSignal.timeout(7_000),
    });
    return { status: response.status, body: response.ok ? await response.json() : null };
  } catch { return { status: null, body: null }; }
}

const pool = environment.DATABASE_URL ? new Pool({ connectionString: environment.DATABASE_URL,
  max: 1, connectionTimeoutMillis: 5_000, options: '-c statement_timeout=5000',
  application_name: 'theta-runtime-truth-read-only' }) : null;
let databaseConnectionFailed = false;
pool?.on('error', () => { databaseConnectionFailed = true; });
let databaseReachable = false;
let databaseReadOnlyState: string | null = null;
let migrationHead: string | null = null;
let requiredMigrationPresent: boolean | null = null;
let activeWorkerLeases: number | null = null;
let workerLeaseId: string | null = null;
let workerLeaseState: string | null = null;
let workerSha: string | null = null;
let workerHeartbeat: string | null = null;
let workerMode: string | null = null;
let executionGate: string | null = null;
let workerState: string | null = null;
let workerProviderHealth: { alpaca: string; optionomics: string; database: string } | null = null;
let latestReconciliation: { at: string | null; dataQuality: string | null;
  positions: number | null; openOrders: number | null; blockingFacts: number | null } | null = null;
let latestEvidenceCycle: string | null = null;
let latestCandidateCycle: string | null = null;
let latestManagementCycle: string | null = null;
let lastOrderSubmissionObserved: string | null = null;
let latestFailedRuntimeCycle: { at: string | null; code: string | null } | null = null;
let recentFunnel: readonly Record<string, unknown>[] | null = null;
let currentUtcDaySeed: Record<string, unknown> | null = null;
let eventRevisionEvidence: Record<string, unknown> | null = null;
let corporateActionEvidence: Record<string, unknown> | null = null;
const iso = (value: unknown): string | null => value instanceof Date ? value.toISOString()
  : typeof value === 'string' ? value : null;

if (pool) {
  try {
    const state = await pool.query(`SELECT current_setting('default_transaction_read_only') AS read_only,
      (SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1) AS migration_head,
      EXISTS(SELECT 1 FROM core.schema_migration WHERE version='064_alpaca_corporate_action_observation') AS schema_064`);
    databaseReachable = true;
    databaseReadOnlyState = String(state.rows[0]?.read_only ?? 'UNKNOWN');
    migrationHead = state.rows[0]?.migration_head == null ? null : String(state.rows[0].migration_head);
    requiredMigrationPresent = state.rows[0]?.schema_064 === true;
    const leases = await pool.query(`SELECT count(*)::int AS active_count FROM ops.runtime_worker_lease WHERE expires_at>now()`);
    activeWorkerLeases = Number(leases.rows[0]?.active_count ?? 0);
    const worker = await pool.query(`SELECT s.worker_id,s.build_sha,s.runtime_mode,s.execution_gate,s.state,
      s.last_heartbeat,s.alpaca_health,s.optionomics_health,s.database_health,l.expires_at
      FROM ops.runtime_worker_status s LEFT JOIN ops.runtime_worker_lease l
        ON l.lease_key=s.lease_key AND l.worker_id=s.worker_id
      ORDER BY (l.expires_at>now()) DESC NULLS LAST,s.last_heartbeat DESC LIMIT 1`);
    const row = worker.rows[0];
    if (row) {
      workerLeaseId = createHash('sha256').update(String(row.worker_id)).digest('hex').slice(0, 12);
      workerLeaseState = row.expires_at instanceof Date && row.expires_at.getTime() > Date.now()
        ? 'ACTIVE' : 'EXPIRED_OR_ABSENT';
      workerSha = String(row.build_sha); workerHeartbeat = iso(row.last_heartbeat);
      workerMode = String(row.runtime_mode); executionGate = String(row.execution_gate);
      workerState = String(row.state);
      workerProviderHealth = { alpaca: String(row.alpaca_health),
        optionomics: String(row.optionomics_health), database: String(row.database_health) };
    }
    const rec = await pool.query(`SELECT observed_at,data_quality,position_count,open_order_count,
      detail_json #>> '{brokerFactImpactSummary,entryBlockingFactCount}' AS blocking_facts
      FROM trade.broker_reconciliation_snapshot ORDER BY observed_at DESC LIMIT 1`);
    if (rec.rows[0]) latestReconciliation = { at: iso(rec.rows[0].observed_at),
      dataQuality: String(rec.rows[0].data_quality), positions: rec.rows[0].position_count,
      openOrders: rec.rows[0].open_order_count,
      blockingFacts: /^\d+$/.test(String(rec.rows[0].blocking_facts ?? ''))
        ? Number(rec.rows[0].blocking_facts) : null };
    const cycles = await pool.query(`SELECT
      (SELECT max(decision_time) FROM trade.fusion_snapshot) AS evidence,
      (SELECT max(generated_at) FROM trade.candidate_set) AS candidate,
      (SELECT max(decided_at) FROM trade.management_decision) AS management,
      (SELECT max(submitted_at) FROM trade.broker_order) AS submitted`);
    latestEvidenceCycle = iso(cycles.rows[0]?.evidence);
    latestCandidateCycle = iso(cycles.rows[0]?.candidate);
    latestManagementCycle = iso(cycles.rows[0]?.management);
    lastOrderSubmissionObserved = iso(cycles.rows[0]?.submitted);
    const failed = await pool.query(`SELECT invoked_at,error_code FROM ops.runtime_worker_cycle
      WHERE status IN ('FAILED','DEGRADED') ORDER BY invoked_at DESC LIMIT 1`);
    if (failed.rows[0]) {
      const rawCode: unknown = failed.rows[0].error_code;
      latestFailedRuntimeCycle = { at: iso(failed.rows[0].invoked_at),
        code: typeof rawCode === 'string' && /^[A-Z0-9_]{3,140}$/.test(rawCode) ? rawCode : null };
    }
    const funnel = await pool.query(`SELECT observed_at,wait_classification,candidate_count,
      feasible_candidate_count,selected_candidate_count,hard_rejected_count,
      data_insufficient_count,quantity_zero_count,aegis_veto_count,near_miss_count,
      action_plans_ready,reason_codes_json,diagnostic_json FROM research.theta_runtime_behavior_diagnostic
      ORDER BY observed_at DESC LIMIT 5`);
    const safeCodes = (value: unknown): readonly string[] => Array.isArray(value)
      ? value.filter((code): code is string => typeof code === 'string'
        && /^[A-Z0-9_.:-]{1,140}$/.test(code)).slice(0, 30) : [];
    recentFunnel = funnel.rows.map((item) => ({ observedAt: iso(item.observed_at),
      waitClassification: item.wait_classification, candidateCount: item.candidate_count,
      feasibleCandidateCount: item.feasible_candidate_count,
      selectedCandidateCount: item.selected_candidate_count,
      hardRejectedCount: item.hard_rejected_count,
      dataInsufficientCount: item.data_insufficient_count,
      quantityZeroCount: item.quantity_zero_count, aegisVetoCount: item.aegis_veto_count,
      nearMissCount: item.near_miss_count, actionPlansReady: item.action_plans_ready,
      reasonCodes: safeCodes(item.reason_codes_json),
      strategyReachability: Array.isArray(item.diagnostic_json?.strategyDiagnostics)
        ? item.diagnostic_json.strategyDiagnostics.slice(0, 8).map((strategy: Record<string, unknown>) => ({
          branch: typeof strategy.branch === 'string' && /^[A-Z_]{1,40}$/.test(strategy.branch)
            ? strategy.branch : 'UNKNOWN',
          consideredCount: strategy.consideredCount, applicableCount: strategy.applicableCount,
          candidateCount: strategy.candidateCount, reachabilityState: strategy.reachabilityState,
        })) : [],
      bestRejected: Array.isArray(item.diagnostic_json?.bestRejectedCandidates)
        ? item.diagnostic_json.bestRejectedCandidates.slice(0, 3).map((candidate: Record<string, unknown>) => ({
          symbol: typeof candidate.symbol === 'string' && /^[A-Z.]{1,12}$/.test(candidate.symbol)
            ? candidate.symbol : 'UNKNOWN',
          branch: candidate.branch, hardBlockers: safeCodes(candidate.hardBlockers),
          unknownEvidence: safeCodes(candidate.unknownEvidence),
        })) : [],
    }));
    const utcDay = observedAt.slice(0, 10);
    const seed = await pool.query(`SELECT count(*)::int AS total_rows,
      count(DISTINCT contract_json->>'contractSymbol')::int AS distinct_contracts,
      count(*) FILTER (WHERE volatility_json->>'ivSource'='ALPACA'
        AND volatility_json->>'ivEvidenceAuthority'='ALPACA_OPTION_SNAPSHOT_CONTRACT_IV'
        AND jsonb_typeof(volatility_json->'iv')='number')::int AS alpaca_iv_lineage_rows,
      count(*) FILTER (WHERE jsonb_typeof(volatility_json->'iv')='number'
        AND volatility_json->>'ivSource' IS DISTINCT FROM 'ALPACA')::int AS iv_other_source_rows,
      count(*) FILTER (WHERE market_json->>'quoteSource'='ALPACA'
        AND jsonb_typeof(market_json->'bid')='number'
        AND jsonb_typeof(market_json->'ask')='number'
        AND market_json->>'quoteTimestamp' IS NOT NULL)::int AS bbo_lineage_rows,
      count(*) FILTER (WHERE market_json->>'underlyingQuoteSource'='ALPACA_IEX'
        AND jsonb_typeof(market_json->'underlyingReferencePrice')='number'
        AND jsonb_typeof(contract_json->'moneyness')='number')::int AS moneyness_lineage_rows
      FROM trade.candidate_point_in_time_evidence WHERE decision_time >= $1::timestamptz`,
    [`${utcDay}T00:00:00.000Z`]);
    currentUtcDaySeed = { utcDay, ...seed.rows[0], qualification: 'LINEAGE_FIELDS_ONLY_NOT_FULL_DETECTOR_QUALIFICATION' };
    const events = await pool.query(`SELECT count(*)::int AS revision_rows,
      count(*) FILTER (WHERE scheduled_at > $1::timestamptz)::int AS future_scheduled_rows,
      count(*) FILTER (WHERE scheduled_at > $1::timestamptz
        AND pit_timing_state='TIMING_VALID')::int AS future_timing_valid_rows
      FROM market.optionomics_event_first_observation`, [observedAt]);
    eventRevisionEvidence = { ...events.rows[0],
      qualification: 'POSITIVE_REVISIONS_ONLY_NOT_COMPLETE_FUTURE_EVENT_COVERAGE' };
    const eventRows = await pool.query(`SELECT event_kind,ticker,event_date::text AS event_date,
      scheduled_at,provider_known_at,first_observed_at,pit_timing_state
      FROM market.optionomics_event_first_observation
      WHERE scheduled_at > $1::timestamptz
      ORDER BY scheduled_at,first_observed_at LIMIT 20`, [observedAt]);
    eventRevisionEvidence.futureRowsSample = eventRows.rows.map((row) => ({
      kind: typeof row.event_kind === 'string' && /^[a-zA-Z_]{1,80}$/.test(row.event_kind)
        ? row.event_kind : 'UNCLASSIFIED',
      ticker: typeof row.ticker === 'string' && /^[A-Z.]{1,12}$/.test(row.ticker) ? row.ticker : null,
      eventDate: row.event_date, scheduledAt: iso(row.scheduled_at),
      providerKnownAt: iso(row.provider_known_at), firstObservedAt: iso(row.first_observed_at),
      pitTimingState: row.pit_timing_state,
    }));
    const corporate = await pool.query(`SELECT observed_at,start_date::text AS start_date,
      end_date::text AS end_date,pages_read,
      pagination_complete,negative_coverage_qualified,observation_count
      FROM market.alpaca_corporate_action_query ORDER BY observed_at DESC LIMIT 1`);
    if (corporate.rows[0]) corporateActionEvidence = {
      observedAt: iso(corporate.rows[0].observed_at), start: corporate.rows[0].start_date,
      end: corporate.rows[0].end_date, pagesRead: corporate.rows[0].pages_read,
      paginationComplete: corporate.rows[0].pagination_complete,
      negativeCoverageQualified: corporate.rows[0].negative_coverage_qualified,
      observationCount: corporate.rows[0].observation_count,
      qualification: 'QUERY_RECEIPT_ONLY_NOT_NEGATIVE_ASSURANCE',
    };
  } catch { databaseConnectionFailed = true; }
  finally { await pool.end().catch(() => { databaseConnectionFailed = true; }); }
}

if (paperBrokerConfigured) {
  const [account, clock, positions, orders, calendar] = await Promise.all([
    brokerGet('/v2/account'), brokerGet('/v2/clock'), brokerGet('/v2/positions'),
    brokerGet('/v2/orders?status=open&limit=100'), brokerGet('/v2/calendar?start=2026-09-23&end=2026-09-23'),
  ]);
  broker.accountHttpStatus = account.status; broker.clockHttpStatus = clock.status;
  broker.positionsHttpStatus = positions.status; broker.ordersHttpStatus = orders.status;
  broker.calendarHttpStatus = calendar.status;
  broker.auth = account.status === 200 ? 'PASS' : account.status === 401 ? 'UNAUTHORIZED'
    : account.status === null ? 'UNAVAILABLE' : 'OTHER_HTTP_STATUS';
  broker.positions = Array.isArray(positions.body) ? positions.body.length : null;
  broker.openOrders = Array.isArray(orders.body) ? orders.body.length : null;
}

const mismatches = deriveRuntimeMismatches({ sourceSha, sourceDirty, workerSha, activeWorkerLeases,
  workerHeartbeat, workerMode, executionGate, migrationHead, requiredMigrationPresent, observedAt });
if (databaseConnectionFailed) mismatches.push('RUNTIME_EVIDENCE_UNAVAILABLE');
const receipt = {
  schemaVersion: 'theta-runtime-system-truth-v1', observedAt, sourceSha, sourceDirty,
  workerSha, workerLeaseId, workerLeaseState, activeWorkerLeases, workerHeartbeat,
  workerMode, workerState, executionGate,
  followerGate: environment.FOLLOWER_PAPER_EXECUTION_ENABLED ? 'ENABLED_LOCAL_CONFIG_UNSAFE' : 'LOCKED_LOCAL_CONFIG',
  liveMoney: 'NOT_AUTHORIZED', masterPaperExecutionLocalConfig: environment.MASTER_PAPER_EXECUTION_ENABLED,
  paperPauseNewOrdersLocalConfig: environment.PAPER_PAUSE_NEW_ORDERS,
  databaseMigrationHead: migrationHead, databaseSchema064Present: requiredMigrationPresent,
  databaseReadOnlyState, databaseReachable: databaseReachable && !databaseConnectionFailed,
  alpacaAuth: broker.auth, optionomicsAuth: 'NOT_PROBED_IN_THIS_RECEIPT',
  workerProviderHealth, broker,
  latestReconciliationState: latestReconciliation, latestEvidenceCycle, latestCandidateCycle,
  latestAegisCycle: 'NOT_QUERIED', latestManagementCycle, lastOrderSubmissionObserved,
  latestFailedRuntimeCycle,
  recentFunnel,
  currentUtcDaySeed,
  eventRevisionEvidence,
  corporateActionEvidence,
  unknownAuditState: canonicalSystemTruthRegister.auditCoverage,
  mismatches: [...new Set(mismatches)],
};
console.log(JSON.stringify(receipt));
if (receipt.mismatches.length || receipt.alpacaAuth !== 'PASS'
  || receipt.paperPauseNewOrdersLocalConfig !== true
  || receipt.followerGate !== 'LOCKED_LOCAL_CONFIG') process.exitCode = 1;
