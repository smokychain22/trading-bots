// ACTION-READY LOSS REPORT (read-only). Every Paper action plan in a window and what happened to it: reached the broker, or the exact leaf
// reason it did not (handoff not reached, mutation fence lost, decision expired, integrity, gate). No secret is printed; no row is written.
//   node --import tsx tools/theta-action-ready-loss-report.ts --environment-file=process|<file> [--since=<ISO>]
// There is no default target: .env.local may point at a non-Production database.
import { loadEnvironment, loadEnvironmentFile } from '../src/config/environment.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const environmentFile = arg('environment-file');
if (environmentFile === undefined || environmentFile.trim() === '') throw new Error('REPORT_REQUIRES_EXPLICIT_ENVIRONMENT_FILE');
const environment = environmentFile === 'process' ? loadEnvironment() : loadEnvironmentFile(environmentFile);
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const since = arg('since') ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
if (!Number.isFinite(Date.parse(since))) throw new Error('SINCE_INVALID');
const pool = createRuntimePostgresPool(connectionString, undefined, { maximumConnections: 1, applicationName: 'theta-action-ready-loss-report' });
try {
  const client = await pool.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const plans = await client.query(`SELECT p.action_plan_id::text AS id, p.created_at, p.status, p.plan_json->>'action' AS action,
        COALESCE(p.plan_json->>'strategyBranch','THETA_CONVENTIONAL') AS branch, p.plan_json->>'symbol' AS symbol, p.last_blockers_json AS blockers,
        p.execution_order_intent_id::text AS order_intent_id,
        (SELECT min(e.event_time) FROM trade.master_paper_action_plan_event e WHERE e.action_plan_id=p.action_plan_id AND e.state='CLAIMED') AS first_claimed_at,
        (SELECT e.detail_json->'latency' FROM trade.master_paper_action_plan_event e WHERE e.action_plan_id=p.action_plan_id AND e.state='CLAIMED'
          ORDER BY e.event_time LIMIT 1) AS claim_latency,
        (SELECT b FROM trade.master_paper_action_plan_event e, jsonb_array_elements_text(COALESCE(e.detail_json->'blockers','[]'::jsonb)) b
          WHERE e.action_plan_id=p.action_plan_id AND b<>'DECISION_EXPIRED' ORDER BY e.event_time LIMIT 1) AS first_event_blocker
      FROM trade.master_paper_action_plan p WHERE p.created_at >= $1 ORDER BY p.created_at`, [since]);
    const rows = plans.rows as Array<{ id: string; created_at: Date; status: string; action: string; branch: string; symbol: string;
      blockers: unknown; order_intent_id: string | null; first_claimed_at: Date | null; claim_latency: unknown; first_event_blocker: string | null }>;
    const leaf = (row: (typeof rows)[number]): string => {
      if (row.order_intent_id !== null) return 'REACHED_BROKER_PATH';
      const blockers = Array.isArray(row.blockers) ? row.blockers.map(String) : [];
      // the first non-expiry reason in the plan's event history is the leaf (older rows only kept it there)
      if (row.first_event_blocker !== null) return row.first_event_blocker;
      return blockers.find((blocker) => blocker !== 'DECISION_EXPIRED') ?? blockers[0] ?? (row.first_claimed_at === null ? 'NOT_CLAIMED_NO_REASON_RECORDED' : 'CLAIMED_NO_REASON_RECORDED');
    };
    const byLeaf: Record<string, number> = {};
    for (const row of rows) byLeaf[leaf(row)] = (byLeaf[leaf(row)] ?? 0) + 1;
    const count = (pattern: RegExp) => rows.filter((row) => pattern.test(leaf(row))).length;
    process.stdout.write(`${JSON.stringify({
      contractVersion: 'theta-action-ready-loss-report-v1', since, plans: rows.length,
      reachedBrokerPath: count(/^REACHED_BROKER_PATH$/),
      actionReadyPlanExpiries: rows.filter((row) => Array.isArray(row.blockers) && row.blockers.map(String).includes('DECISION_EXPIRED')).length,
      mutationFenceLosses: count(/MUTATION_FENCE_LOST|REQUEST_MUTATION_WINDOW_EXPIRED/),
      handoffNotReached: count(/^HANDOFF_NOT_REACHED:/),
      unexplained: count(/NO_REASON_RECORDED$/),
      byLeafReason: byLeaf,
      plans_detail: rows.map((row) => ({ createdAt: row.created_at.toISOString(), branch: row.branch, action: row.action, symbol: row.symbol, status: row.status,
        leaf: leaf(row), claimedAfterMs: row.first_claimed_at === null ? null : row.first_claimed_at.getTime() - row.created_at.getTime(),
        claimLatency: row.claim_latency ?? null })),
    }, null, 2)}\n`);
  } finally { client.release(); }
} finally { await pool.end(); }
