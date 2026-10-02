#!/usr/bin/env node
// Phase 3 (broker / execution / live-session evidence / Paper activation) finite register.
// CURRENT_STATUS is exactly one of: PASS, CODE_SOLVABLE, PROVIDER_LIMITED, OWNER_POLICY, FUTURE_MARKET, FUTURE_PAPER, EMPIRICAL_ONLY, NOT_APPLICABLE.
// LIVE_SESSION_STATUS: OBSERVED_TODAY (reached by real cycles on 2026-10-02), NOT_REACHED_TODAY (needs an order or position), NOT_APPLICABLE.
// PAPER_STATUS: NOT_EXERCISED until an actual Paper order exists (none has ever been submitted).
// Phase 3 closes only when CODE_SOLVABLE_REMAINING is zero. Rows are data; counts are derived.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const T = 'tests/';
const row = (ID, CAPABILITY, SOURCE, TEST, RUNTIME_DEPENDENCY, DB_DEPENDENCY, CURRENT_STATUS, LIVE_SESSION_STATUS, BLOCKER, SOLVABILITY, NEXT_ACTION = 'none') =>
  ({ ID, CAPABILITY, SOURCE, TEST, RUNTIME_DEPENDENCY, DB_DEPENDENCY, CURRENT_STATUS, LIVE_SESSION_STATUS, PAPER_STATUS: 'NOT_EXERCISED', BLOCKER, SOLVABILITY, NEXT_ACTION });
const src = (...files) => files;
const none = 'none';

export const register = [
  // ---- order state machine and idempotency
  row('P3-001', 'Order intent state machine: reviewed legal-transition table, exhaustive pair test, restart recovery per state', src('src/theta/order-intent-state.ts', 'src/execution/paper-order-coordinator.ts'),
    [T + 'phase3-exec-state-machine.test.ts', T + 'order-intent-state.test.ts', T + 'order-intent-transition-invariants.test.ts'], 'worker PENDING_ORDER_MANAGEMENT job', 'trade.order_intent (status enum)', 'PASS', 'NOT_REACHED_TODAY', none, 'ALREADY_CORRECT_VERIFIED'),
  row('P3-002', 'Deterministic idempotent client order id with database uniqueness', src('src/theta/order-intent-state.ts', 'src/execution/postgres-paper-order-store.ts'),
    [T + 'order-intent-state.test.ts', T + 'db/order-intent-client-order-id-unique.test.ts', T + 'phase3-exec-unknown-submit.test.ts'], 'none', 'order_intent unique client_order_id', 'PASS', 'NOT_REACHED_TODAY', none, 'ALREADY_CORRECT_VERIFIED'),
  row('P3-003', 'PaperOrderCoordinator is the single broker-mutation authority', src('src/execution/paper-order-coordinator.ts', 'src/execution/broker.ts'),
    [T + 'architecture-authority-guards.test.ts', T + 'paper-order-coordinator.test.ts'], 'none', 'none', 'PASS', 'NOT_REACHED_TODAY', none, 'ALREADY_CORRECT_VERIFIED'),
  row('P3-004', 'Unknown-submit safety: lost POST, timeout, reset, 5xx after acceptance, malformed body, restart, concurrent submit', src('src/execution/paper-order-coordinator.ts', 'src/execution/broker.ts'),
    [T + 'phase3-exec-unknown-submit.test.ts'], 'none (fake broker)', 'trade.order_intent, execution_attempt', 'PASS', 'NOT_REACHED_TODAY', none, 'VERIFIED_AND_TIGHTENED_THIS_PHASE'),
  row('P3-005', 'Broker fault-injection campaign (operation x fault matrix) with no duplicate economic order', src('src/execution/broker.ts', 'src/execution/paper-order-coordinator.ts'),
    [T + 'phase3-exec-fault-injection.test.ts'], 'none (stateful fake Alpaca)', 'none', 'PASS', 'NOT_REACHED_TODAY', none, 'BUILT_THIS_PHASE'),
  row('P3-006', 'Rate-limit policy: bounded read retry with Retry-After, shared budget and cooldown; mutations never retried', src('src/execution/broker.ts', 'src/theta/alpaca-provider.ts'),
    [T + 'phase3-exec-rate-limit.test.ts'], 'Alpaca rate limits (exact quota not published to us)', 'none', 'PASS', 'NOT_REACHED_TODAY', none, 'BUILT_THIS_PHASE'),
  row('P3-007', 'Partial-fill safety at the order level (option and stock), late fill during cancel, no replacement of part-filled stock exits', src('src/execution/paper-order-coordinator.ts', 'src/execution/broker-order-state.ts'),
    [T + 'phase3-exec-partial-fills.test.ts'], 'none', 'order_intent', 'PASS', 'NOT_REACHED_TODAY', none, 'BUILT_THIS_PHASE'),
  row('P3-008', 'Terminal partial stock exit freeze (owner Paper policy P-A): typed state, no fabricated lot P&L, clears only on share reconciliation', src('src/execution/management-chain-inflight.ts', 'src/execution/management-paper-plan-assembly.ts', 'src/theta/autonomous-runtime.ts'),
    [T + 'db/phase3-sweep-and-freeze.test.ts', T + 'management-paper-plan-assembly.test.ts'], 'worker scan', 'order_intent, fill, stock_lot', 'PASS', 'NOT_REACHED_TODAY', none, 'BUILT_THIS_PHASE'),
  row('P3-009', 'Whole-position covered calls (owner Paper policy P-B): all contracts covering the whole position, or zero', src('src/theta/canonical-strategy-frontier.ts', 'src/execution/management-paper-plan-assembly.ts'),
    [T + 'phase2-hdac-mechanics.test.ts', T + 'management-paper-plan-assembly.test.ts'], 'none', 'none', 'PASS', 'OBSERVED_TODAY', none, 'BUILT_THIS_PHASE'),
  row('P3-010', 'Cross-session working-order sweep: finished plans closed with typed reasons, chain released, nothing resubmitted', src('src/execution/management-order-repricing.ts', 'src/theta/autonomous-runtime.ts'),
    [T + 'db/phase3-sweep-and-freeze.test.ts'], 'worker PENDING_ORDER_MANAGEMENT job', 'master_paper_action_plan(+event)', 'PASS', 'NOT_REACHED_TODAY', none, 'BUILT_THIS_PHASE'),
  row('P3-011', 'Entry order duplicate guard (resting DAY entry order cannot be duplicated; releases when terminal)', src('src/execution/postgres-master-paper-action-plan-store.ts'),
    [T + 'db/phase3-entry-guard.test.ts'], 'production shadow scan enqueue', 'master_paper_action_plan, order_intent', 'PASS', 'NOT_REACHED_TODAY', none, 'BUILT_THIS_PHASE'),
  // ---- repricing, freshness, reconciliation
  row('P3-012', 'Management repricing driver (persisted attempts, bounded concessions)', src('src/execution/management-order-repricing.ts'),
    [T + 'phase2-repricing-driver.test.ts', T + 'db/management-reprice-store.test.ts'], 'worker PENDING_ORDER_MANAGEMENT job', 'order_intent, price events', 'PASS', 'NOT_REACHED_TODAY', none, 'REVIEWED_BY_MAIN_PROCESS'),
  row('P3-013', 'Floor liveness: cancel at the economic boundary, plan closed, next scan makes a new decision', src('src/execution/management-order-repricing.ts', 'src/execution/adaptive-limit-policy.ts'),
    [T + 'phase2-repricing-driver.test.ts', T + 'adaptive-limit-policy.test.ts'], 'worker', 'plan table', 'PASS', 'NOT_REACHED_TODAY', none, 'REVIEWED_BY_MAIN_PROCESS'),
  row('P3-014', 'Named quote-freshness contract (decision, plan window, pre-submit cap)', src('src/theta/paper-bootstrap-runtime-policy.ts', 'src/execution/master-paper-action-handoff.ts'),
    [T + 'master-paper-action-handoff.test.ts', T + 'phase2-repricing-driver.test.ts'], 'Alpaca quotes', 'none', 'PASS', 'NOT_REACHED_TODAY', none, 'REVIEWED_BY_MAIN_PROCESS'),
  row('P3-015', 'Broker/ledger share reconciliation, free sellable shares, fresh pre-submit inventory read', src('src/theta/stock-share-reconciliation.ts', 'src/execution/alpaca-stock-inventory-source.ts'),
    [T + 'phase2-share-reconciliation.test.ts', T + 'phase2-stock-inventory-source.test.ts'], 'Alpaca positions and orders (read-only)', 'broker_position_snapshot', 'PASS', 'NOT_REACHED_TODAY', none, 'REVIEWED_BY_MAIN_PROCESS'),
  row('P3-016', 'Short-call commitment guard fed by CURRENT-impact blocking facts (not settled historical activity)', src('src/execution/management-chain-inflight.ts', 'src/theta/account-exposure.ts', 'src/theta/autonomous-runtime.ts'),
    [T + 'phase2-short-call-commitments.test.ts', T + 'db/management-chain-inflight.test.ts', T + 'architecture-authority-guards.test.ts'], 'reconciliation snapshot', 'positions, order_intent, plans', 'PASS', 'OBSERVED_TODAY', none, 'DEFECT_FOUND_AND_FIXED_THIS_PHASE'),
  row('P3-017', 'Plan integrity: sealed payload verified at claim and before submit; database trigger and pre-submit uniqueness (migration 068)', src('src/execution/action-plan-integrity.ts', 'migrations/068_action_plan_integrity.sql'),
    [T + 'phase2-plan-integrity.test.ts', T + 'db/plan-integrity.test.ts'], 'worker claim path', 'master_paper_action_plan', 'CODE_SOLVABLE', 'NOT_REACHED_TODAY', 'governed Production run in progress (backup phase)', 'GOVERNED_RUN_IN_PROGRESS', 'verify trigger and index in Production after the governed run'),
  row('P3-018', 'Plan-order-fill lineage', src('src/execution/postgres-master-paper-action-plan-store.ts', 'src/execution/postgres-execution-evidence-store.ts'),
    [T + 'phase2-repricing-driver.test.ts', T + 'db/management-reprice-store.test.ts'], 'worker', 'plan, order_intent, fill', 'PASS', 'NOT_REACHED_TODAY', none, 'REVIEWED_BY_MAIN_PROCESS'),
  row('P3-019', 'Recovery races: restart, duplicate trigger, replace race, late fill during cancel', src('src/execution/paper-order-coordinator.ts', 'src/execution/management-order-repricing.ts'),
    [T + 'phase3-exec-unknown-submit.test.ts', T + 'phase3-exec-fault-injection.test.ts', T + 'phase2-repricing-driver.test.ts'], 'worker restart', 'order_intent', 'PASS', 'NOT_REACHED_TODAY', none, 'ALREADY_CORRECT_VERIFIED'),
  row('P3-020', 'SELL_STOCK limit policy: floor equals the bid, limit inside the BBO, sub-tick cancels', src('src/execution/adaptive-limit-policy.ts', 'src/execution/master-paper-command-assembly.ts'),
    [T + 'adaptive-limit-policy.test.ts', T + 'phase2-fixpass-management-execution.test.ts'], 'fresh Alpaca stock quote', 'none', 'PASS', 'NOT_REACHED_TODAY', none, 'REVIEWED_BY_MAIN_PROCESS'),
  row('P3-021', 'Multi-lot full-position disposal allocation', src('src/execution/stock-lot-allocation.ts', 'src/theta/postgres-lifecycle-application-store.ts'),
    [T + 'phase2-chain-stock-disposal.test.ts', T + 'db/stock-disposal-lots.test.ts'], 'fill ingestion', 'stock_lot', 'PASS', 'NOT_REACHED_TODAY', none, 'REVIEWED_BY_MAIN_PROCESS'),
  row('P3-022', 'First Paper path is technically reachable: natural candidate -> canary cap 1 -> plan -> handoff -> coordinator -> broker; quantity zero is no order', src('src/execution/master-paper-action-handoff.ts', 'src/execution/execution-authorization-tier.ts'),
    [T + 'phase3-first-paper-path.test.ts', T + 'master-paper-action-handoff.test.ts'], 'owner gates (LOCKED today)', 'ops.paper_execution_control', 'PASS', 'NOT_REACHED_TODAY', 'no legitimate candidate exists (account scale vs concentration limits)', 'BUILT_THIS_PHASE'),
  // ---- live-session defects found and fixed
  row('P3-023', 'Queryable frontier projection bounded independent of chain size (production incident: 32 evidence cycles failed with HTTP 503)', src('src/theta/postgres-cycle-evidence-storage.ts'),
    [T + 'phase3-frontier-projection-bound.test.ts', T + 'postgres-cycle-evidence-storage.test.ts'], 'Vercel runtime', 'trade.fusion_snapshot / decision receipts', 'PASS', 'OBSERVED_TODAY', none, 'DEFECT_FOUND_IN_LIVE_SESSION_AND_FIXED_a5d8711'),
  row('P3-024', 'Evidence cycle succeeds on a full SPY chain after the fix (3 complete scans, v7 diagnostics persisted)', src('src/research/production-shadow-runtime.ts'),
    ['docs/operations/THETA_LIVE_BOARD_20261002.json'], 'Vercel runtime, Alpaca', 'research.theta_shadow_scan_run', 'PASS', 'OBSERVED_TODAY', none, 'RUNTIME_OBSERVED'),
  row('P3-025', 'Command-5A marks ticker fires, fresh jobs are observed with bounded lateness, no fresh-job starvation', src('tools/windows/ThetaProcess.Common.ps1', 'src/research/production-shadow-runtime.ts'),
    ['docs/operations/THETA_LIVE_BOARD_20261002.json', T + 'observation-retry.test.ts'], 'Windows worker thread job, Alpaca snapshots', 'research.theta_execution_observation_job', 'PASS', 'OBSERVED_TODAY', none, 'RUNTIME_OBSERVED'),
  row('P3-026', 'Command-5A completeness for illiquid contracts (PROVIDER_UNAVAILABLE misses where the indicative snapshot has no usable quote)', src('src/research/production-shadow-runtime.ts'),
    ['docs/operations/THETA_LIVE_BOARD_20261002.json'], 'Alpaca indicative snapshots', 'job table', 'PROVIDER_LIMITED', 'OBSERVED_TODAY', 'contracts without a current indicative quote cannot be observed', 'PROVIDER_LIMITED', 'optional: label the miss reason NO_USABLE_QUOTE instead of PROVIDER_UNAVAILABLE'),
  row('P3-027', 'Universe discovery ranks before bounding (13,514 assets -> 100 ranked -> 3 analyzed)', src('src/theta/universe-discovery.ts'),
    ['docs/operations/THETA_LIVE_BOARD_20261002.json', T + 'universe-discovery.test.ts'], 'Alpaca assets and snapshots', 'none', 'PASS', 'OBSERVED_TODAY', none, 'RUNTIME_OBSERVED'),
  row('P3-028', 'Q funnel, AEGIS NOT_REACHED semantics, sizing-zero causes and v7 WAIT classification on real data', src('src/theta/q-entry-funnel.ts', 'src/theta/runtime-behavior-diagnostic.ts'),
    ['docs/operations/THETA_LIVE_BOARD_20261002.json', T + 'phase2-q-funnel.test.ts', T + 'runtime-behavior-sizing-zero.test.ts'], 'production shadow scan', 'research.theta_runtime_behavior_diagnostic', 'PASS', 'OBSERVED_TODAY', none, 'RUNTIME_OBSERVED'),
  row('P3-029', 'H and D shadow isolation, A and C applicability (NOT_APPLICABLE while flat) on real data', src('src/theta/canonical-strategy-frontier.ts'),
    ['docs/operations/THETA_LIVE_BOARD_20261002.json', T + 'phase2-hdac-mechanics.test.ts'], 'production shadow scan', 'none', 'PASS', 'OBSERVED_TODAY', none, 'RUNTIME_OBSERVED'),
  row('P3-030', 'Account-policy incompatibility classification on real data (1642 of 1869 candidates)', src('src/theta/canonical-strategy-frontier.ts', 'src/theta/account-capacity-zero.ts'),
    ['docs/operations/THETA_LIVE_BOARD_20261002.json', T + 'phase2-sizing-zero-label.test.ts'], 'production shadow scan', 'none', 'PASS', 'OBSERVED_TODAY', none, 'RUNTIME_OBSERVED'),
  row('P3-031', 'Executable quote authority is Alpaca; research providers never set executable BBO', src('src/execution/alpaca-execution-quote-source.ts'),
    [T + 'phase2-q-economics-source.test.ts', T + 'master-paper-action-handoff.test.ts'], 'Alpaca', 'none', 'PASS', 'OBSERVED_TODAY', none, 'ALREADY_CORRECT_VERIFIED'),
  // ---- gates and operations
  row('P3-032', 'Execution gate, followers and live money stay locked/unauthorized; no broker mutation', src('src/execution/execution-control.ts', 'src/execution/paper-execution-authorization.ts'),
    [T + 'paper-execution-authorization.test.ts', T + 'phase3-first-paper-path.test.ts'], 'owner flags', 'ops.paper_execution_control', 'PASS', 'OBSERVED_TODAY', none, 'RUNTIME_OBSERVED'),
  row('P3-033', 'Gate transition LOCKED -> FIRST_CANARY_ARMED requires migration 068 verified, zero code-solvable blockers, a Vercel Production flag change and the owner-authorized activation', src('src/execution/paper-execution-authorization.ts'),
    [T + 'paper-execution-authorization.test.ts'], 'Vercel Production env (flags are sensitive/hidden), activation endpoint', 'ops.paper_execution_control', 'FUTURE_PAPER', 'NOT_REACHED_TODAY', 'see the receipt for the arming decision', 'OPERATIONAL_STEP', 'arm only after the exit gate is met'),
  row('P3-034', 'First Paper canary submitted and reconciled (max 1 contract) when a legitimate candidate exists', src('src/execution/first-canary-acceptance.ts'),
    [T + 'phase3-first-paper-path.test.ts', T + 'db/autonomous-paper-transition.test.ts'], 'market, account scale', 'order_intent, broker_order', 'FUTURE_PAPER', 'NOT_REACHED_TODAY', 'no SPY contract fits the account concentration limits', 'FUTURE_PAPER', 'wait for a legitimate natural candidate'),
  // ---- classified, not built
  row('P3-035', 'Entry-order (OPEN_CSP) repricing as a fill-rate enhancement', src('src/execution/management-order-repricing.ts'), [], 'n/a', 'n/a', 'EMPIRICAL_ONLY', 'NOT_REACHED_TODAY', 'needs Paper fill-rate evidence; safety (duplicates, expiry) is covered by P3-011 and P3-010', 'EMPIRICAL', 'decide after the first Paper fills'),
  row('P3-036', 'Lot-split accounting (single-lot partial sale)', src('docs/operations/THETA_PHASE3_LOT_SPLIT_ANALYSIS_20261002.md'), [], 'n/a', 'schema additions', 'FUTURE_PAPER', 'NOT_REACHED_TODAY', 'needed only once a real partial stock fill occurs', 'FUTURE_PAPER', 'build after the first Paper position'),
  row('P3-037', 'Multi-lot partial stock sale lot-selection policy', src('src/execution/stock-lot-allocation.ts'), [T + 'phase2-chain-stock-disposal.test.ts'], 'n/a', 'n/a', 'OWNER_POLICY', 'NOT_REACHED_TODAY', 'owner selects FIFO/LIFO/specific/pro-rata', 'OWNER_POLICY', 'owner decision'),
  row('P3-038', 'Per-fill fees', src('src/theta/whole-chain-economics.ts'), [T + 'phase2-q-economics-source.test.ts'], 'Alpaca does not supply fees', 'n/a', 'PROVIDER_LIMITED', 'NOT_REACHED_TODAY', 'owner-attested fee schedule needed', 'PROVIDER_LIMITED', 'owner attestation'),
  row('P3-039', 'Dividends', src('src/theta/whole-chain-economics.ts'), [], 'n/a', 'n/a', 'FUTURE_PAPER', 'NOT_REACHED_TODAY', 'needs a stock lot', 'FUTURE_PAPER', 'after assignment'),
  row('P3-040', 'Per-stage latency and memory persistence', src('src/theta/theta-shadow-cycle.ts'), [], 'n/a', 'n/a', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'performance instrumentation belongs to the owner Phase 4 plan', 'DEFERRED_TO_PHASE_4', 'Phase 4'),
  row('P3-041', 'Streaming trade-update ingestion', src('src/execution/trade-updates.ts'), [], 'n/a', 'n/a', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'Paper uses polling reconciliation every cycle; the legacy store is quarantined', 'NOT_REQUIRED', 'none'),
  row('P3-042', 'Instrument approval expansion, relative-strength definition, account concentration policy', src('docs/operations/THETA_STRATEGY_PHASE2_REGISTER_20261002.json'), [], 'n/a', 'n/a', 'OWNER_POLICY', 'OBSERVED_TODAY', 'the only reason SPY cannot trade at this equity', 'OWNER_POLICY', 'owner decision'),
  row('P3-043', 'Real management of a live Paper position, assignment, call-away, profitability', src('n/a'), [], 'market', 'n/a', 'FUTURE_PAPER', 'NOT_REACHED_TODAY', 'no position exists', 'FUTURE_PAPER', 'after the first position'),
  row('P3-044', 'Fill rate, slippage and concession-schedule quality', src('n/a'), [], 'market', 'n/a', 'EMPIRICAL_ONLY', 'NOT_REACHED_TODAY', 'no Paper fills exist', 'EMPIRICAL', 'after Paper fills'),
  row('P3-045', 'Operational backup freshness: the verified daily backup is stale since 2026-09-29 (disk space)', src('tools/windows/dr/Backup-Theta.ps1'), [], 'Windows scheduled backup', 'n/a', 'NOT_APPLICABLE', 'OBSERVED_TODAY', 'space was reclaimed; the pre-migration verified backup is running', 'FIXED_OPERATIONALLY_THIS_PHASE', 'confirm the next scheduled backup completes'),
];

const STATUSES = ['PASS', 'CODE_SOLVABLE', 'PROVIDER_LIMITED', 'OWNER_POLICY', 'FUTURE_MARKET', 'FUTURE_PAPER', 'EMPIRICAL_ONLY', 'NOT_APPLICABLE'];
export { STATUSES };
export function computeRegister() {
  const n = (status) => register.filter((r) => r.CURRENT_STATUS === status).length;
  return { PHASE3_TOTAL: register.length, PASS: n('PASS'), PROVIDER_LIMITED: n('PROVIDER_LIMITED'), OWNER_POLICY: n('OWNER_POLICY'), FUTURE_MARKET: n('FUTURE_MARKET'),
    FUTURE_PAPER: n('FUTURE_PAPER'), EMPIRICAL_ONLY: n('EMPIRICAL_ONLY'), NOT_APPLICABLE: n('NOT_APPLICABLE'), CODE_SOLVABLE_REMAINING: n('CODE_SOLVABLE'),
    OBSERVED_TODAY: register.filter((r) => r.LIVE_SESSION_STATUS === 'OBSERVED_TODAY').length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = { computed: computeRegister(), rows: register };
  if (process.argv.includes('--write')) writeFileSync(new URL('../docs/operations/THETA_PHASE3_REGISTER_20261002.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.computed, null, 2));
}
