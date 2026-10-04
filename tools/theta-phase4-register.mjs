#!/usr/bin/env node
// Phase 4 (stress / chaos / performance / security / historical regression) finite register. The denominator is frozen at the number of rows below.
// CURRENT_STATUS is exactly one of: PASS, CODE_SOLVABLE, PROVIDER_LIMITED, OWNER_POLICY, FUTURE_MARKET, FUTURE_PAPER, EMPIRICAL_ONLY, NOT_APPLICABLE.
// Phase 4 closes only when CODE_SOLVABLE_REMAINING is zero. Rows are data; counts are derived.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const T = 'tests/';
const Q = 'bots/theta/tests/quant/';
const row = (ID, CAPABILITY, SOURCE, TEST, CURRENT_STATUS, SOLVABILITY, RISK, EVIDENCE, NEXT_ACTION = 'none') =>
  ({ ID, CAPABILITY, SOURCE, TEST, CURRENT_STATUS, SOLVABILITY, RISK, EVIDENCE, NEXT_ACTION });

export const STATUSES = ['PASS', 'CODE_SOLVABLE', 'PROVIDER_LIMITED', 'OWNER_POLICY', 'FUTURE_MARKET', 'FUTURE_PAPER', 'EMPIRICAL_ONLY', 'NOT_APPLICABLE'];

export const register = [
  row('P4-001', 'Large option-chain stress, 100 to 10,000 contracts: time, memory, scaling exponent and retained heap within evidence-based budgets', ['src/theta/canonical-strategy-frontier.ts', 'src/theta/option-chain-ingestion.ts'],
    [T + 'phase4-large-chain-stress.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'docs/operations/THETA_PHASE4_PERFORMANCE_BASELINE_20261003.json'),
  row('P4-002', 'Long soak, 500+ decision cycles: bounded heap, no leaked handles/timers, no state drift', ['src/theta/canonical-strategy-frontier.ts', 'src/execution/paper-order-coordinator.ts'],
    [T + 'phase4-long-soak.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'process.getActiveResourcesInfo and forced-GC retained-heap bound'),
  row('P4-003', 'Concurrency and overlap chaos: deterministic scheduler, simulated clock, fenced versus unfenced control', ['src/execution/paper-order-coordinator.ts', 'src/execution/mutation-fence.ts'],
    [T + 'phase4-concurrency-chaos.test.ts', T + 'phase3-mutation-fence.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'fenced run yields at most one broker mutation; the unfenced control reproduces the overlap'),
  row('P4-004', 'Execution model-based test: at most one POST, one non-replacement order, one live order; terminal stickiness; per-order fills monotone', ['src/execution/paper-order-coordinator.ts', 'src/theta/order-intent-state.ts'],
    [T + 'phase4-exec-model.test.ts', T + 'phase3-exec-state-machine.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'seeded random operation/fault sequences, invariants checked every step'),
  row('P4-005', 'Broker/provider chaos: transient and permanent faults, malformed bodies, only a real 404 means an order is absent (200/null is malformed)', ['src/execution/broker.ts', 'src/theta/alpaca-provider.ts'],
    [T + 'phase4-provider-chaos.test.ts', T + 'phase3-exec-fault-injection.test.ts', T + 'alpaca-failure-matrix.test.ts'], 'PASS', 'FIXED_THIS_PHASE', 'HIGH', 'commit 415d5eb'),
  row('P4-006', 'Database chaos: classifier matrix, reads retried for transient errors only, writes never replayed, commit-unknown surfaced, client destroy policy', ['src/theta/runtime-postgres-client.ts', 'src/theta/database-health-circuit.ts'],
    [T + 'phase4-db-chaos.test.ts', T + 'runtime-postgres-client.test.ts', T + 'database-health-circuit.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'tests/phase4-db-chaos.test.ts'),
  row('P4-007', 'Disaster recovery: snapshot keeper heartbeat, sequence parity, verified-backup digest, read-only guard (Windows)', ['tools/windows'],
    ['tests/windows/theta-snapshot-heartbeat.test.ps1', 'tests/windows/theta-sequence-parity.test.ps1', 'tests/windows/theta-backup-digest-v2.test.ps1', 'tests/windows/theta-backup-readonly-guard.test.ps1'], 'PASS', 'VERIFIED', 'HIGH', 'Windows PowerShell suites run in CI (heartbeat, parity and quoting added to the CI list in Phase 4)'),
  row('P4-008', 'Replay determinism and tamper detection: whole-bundle integrity hash and an exhaustive single-leaf tamper sweep (25 silent leaves found and closed)', ['src/theta/t0-replay-bundle.ts'],
    [T + 'phase4-replay-tamper.test.ts', T + 't0-replay-bundle.test.ts'], 'PASS', 'FIXED_THIS_PHASE', 'HIGH', 'commit 54e542e'),
  row('P4-009', 'Deterministic identity: unambiguous client order id and order-intent id (no colon aliasing), identical under every restart', ['src/theta/order-intent-state.ts', 'src/execution/master-paper-command-assembly.ts'],
    [T + 'phase4-identity.test.ts', T + 'order-intent-state.test.ts'], 'PASS', 'FIXED_THIS_PHASE', 'HIGH', 'identity commits; read-only audit 2026-10-03: trade.order_intent, master_paper_action_plan, broker_order, execution_attempt and fill have 0 rows in Production, so no persisted id is orphaned by the v2 scheme'),
  row('P4-010', 'Capital, share and whole-chain conservation properties (order independence, cancel, fill, cash-flow identity)', ['src/theta/capital-budget-evidence.ts', 'src/theta/whole-chain-economics.ts'],
    [T + 'phase4-conservation.test.ts', T + 'whole-chain-properties.test.ts', T + 'phase2-sizing-capital-conservation.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'seeded property tests'),
  row('P4-011', 'AEGIS properties: monotone, boundary, capacity-zero versus veto, cross-candidate isolation', ['src/theta/aegis-contract.ts', 'src/theta/canonical-strategy-frontier.ts'],
    [T + 'phase4-aegis-sizing-capacity.test.ts', T + 'phase4-historical-regressions.test.ts', Q + 'test_aegis_monotonicity_property.py', Q + 'test_aegis_pairwise_monotonicity.py', T + 'phase2-aegis-capacity-zero.test.ts'], 'PASS', 'VERIFIED_AND_EXTENDED', 'HIGH', 'veto on one candidate leaves every other candidate unchanged'),
  row('P4-012', 'Strategy properties: Q worsening, sizing never forced to one, H/D no Paper authority, A/C flat NOT_APPLICABLE, covered calls never exceed whole shares', ['src/theta/canonical-strategy-frontier.ts'],
    [T + 'frontier-properties.test.ts', T + 'phase2-hdac-mechanics.test.ts', T + 'phase2-sizing-structural-properties.test.ts', T + 'phase2-q-boundaries.test.ts'], 'PASS', 'VERIFIED', 'HIGH', 'existing Phase 2 property suites re-run in Phase 4'),
  row('P4-013', 'Management oscillation: one state yields one stable action; no hysteresis is characterised and pinned (no policy invented)', ['src/theta/management-assembly.ts'],
    [T + 'phase2-mgmt-oscillation-execution.test.ts', T + 'management-invariants.test.ts'], 'PASS', 'VERIFIED_CHARACTERISED_NOT_PROVEN_STABLE', 'MEDIUM', 'hysteresis is a policy choice, left to a future evidence-backed revision'),
  row('P4-014', 'Command-5A scheduler stress: stale backlog never starves fresh checkpoints, duplicate scheduling idempotent, exclusive claims, crash and restart drain', ['src/storage/local-observation-job-scheduler.ts'],
    [T + 'phase4-command5a-stress.test.ts', T + 'local-observation-job-scheduler.test.ts', T + 'due-observation-priority.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'MEDIUM', '600-job backlog, 400-job two-worker drain'),
  row('P4-015', 'Training-data firewall: every ordered truth-class pair, only the four forbidden promotions blocked, complete evidence required', ['bots/theta/quant/research/truth_firewall.py'],
    [Q + 'test_phase4_research_integrity.py', Q + 'test_truth_firewall.py'], 'PASS', 'BUILT_THIS_PHASE', 'MEDIUM', 'exhaustive 81-pair sweep'),
  row('P4-016', 'Effective sample size: conservative dependence-component proxy never inflated by repeated scans, relabelling or order', ['bots/theta/quant/research/dataset_readiness.py'],
    [Q + 'test_phase4_research_integrity.py', Q + 'test_dataset_readiness.py'], 'PASS', 'BUILT_THIS_PHASE', 'MEDIUM', 'a proxy, not an empirical effective N; labelled as such in code'),
  row('P4-017', 'Research leakage: randomized point-in-time invariance across trend, momentum, realized-volatility, EWMA and Parkinson features', ['bots/theta/quant/research/pit_leakage_harness.py', 'bots/theta/quant/features'],
    [Q + 'test_phase4_research_integrity.py', Q + 'test_pit_leakage_harness.py'], 'PASS', 'BUILT_THIS_PHASE', 'MEDIUM', '40 random series per family'),
  row('P4-018', 'Time and clock chaos: minute sweep over five sessions (DST, early close), timezone independence, midnight UTC, local-clock API ban', ['src/theta/time-aware-state.ts'],
    [T + 'phase4-time-chaos.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'MEDIUM', 'process.env.TZ matrix'),
  row('P4-019', 'Input fuzz at every provider and plan boundary: typed failure or valid parse, never a crash or silent coercion', ['src/execution/broker.ts', 'src/execution/action-plan-integrity.ts', 'src/theta/option-contract.ts'],
    [T + 'phase4-input-fuzz.test.ts', T + 'provider-boundary-fuzz.test.ts'], 'PASS', 'FIXED_THIS_PHASE', 'HIGH', 'null plan row and 200/null order body fixed'),
  row('P4-020', 'Provider data consistency: a contract whose identity disagrees with its OCC symbol is INVALID, never merged', ['src/theta/option-contract.ts', 'src/theta/option-chain-ingestion.ts'],
    [T + 'phase4-provider-chaos.test.ts', T + 'option-contract.test.ts'], 'PASS', 'FIXED_THIS_PHASE', 'MEDIUM', 'commit 415d5eb'),
  row('P4-021', 'Performance and memory budgets are evidence-based (baseline x8 time, x2 + 256 MB RSS, retained heap bound), not invented', ['docs/operations/THETA_PHASE4_PERFORMANCE_BASELINE_20261003.json'],
    [T + 'phase4-large-chain-stress.test.ts', T + 'phase2-perf-frontier-scaling.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'MEDIUM', 'baseline recorded from a measured run'),
  row('P4-022', 'Historical incident regression matrix: 41 incidents, each mapped to a real test that exists', ['docs/operations/THETA_HISTORICAL_REGRESSION_MATRIX.json'],
    [T + 'phase4-historical-matrix.test.ts', T + 'phase4-historical-regressions.test.ts', 'tests/windows/theta-process-quoting.test.ps1'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'matrix test verifies referenced files and titles exist'),
  row('P4-023', 'Public-repository secret scanner: Alpaca key shape, passworded DB URLs, bearer tokens, secret literals, personal email, user-home paths; artifacts scanned in CI', ['tools/security-scan.mjs', '.github/workflows/ci.yml'],
    [T + 'phase4-security-scan.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'HIGH', 'tracked tree 0 findings; history 0 findings (1,345 commits); docs/operations/THETA_PHASE4_SECURITY_REVIEW_20261003.md'),
  row('P4-024', 'Dependency and supply chain: npm audit 0 advisories, install scripts reviewed, Dependabot weekly for npm and Actions (majors deferred deliberately)', ['package.json', '.github/dependabot.yml'],
    [T + 'phase4-security-scan.test.ts'], 'PASS', 'BUILT_THIS_PHASE', 'MEDIUM', 'security review; major upgrades are separate focused changes'),
  row('P4-025', 'Storage growth projection from real Production table sizes (daily, weekly, monthly; bounded, retained, compacted, archived)', ['docs/operations/THETA_PHASE4_STORAGE_GROWTH_PROJECTION_20261003.md'],
    [], 'NOT_APPLICABLE', 'MEASURED_DOCUMENT_NOT_A_TEST', 'HIGH', 'read-only storage audit 2026-10-03T09:27Z; the projection itself reports the budget as BREACHED (see P4-026)'),
  row('P4-026', 'Production database is over its own 4 GiB budget (4.66 GiB) and projected to pass the 8 GiB plan in about 13 sessions without archive-then-purge or a plan change', ['src/storage/storage-budget.ts', 'tools/theta-storage-audit.ts'],
    [T + 'storage-budget.test.ts', T + 'postgres-storage-audit.test.ts'], 'OWNER_POLICY', 'NEEDS_OWNER_APPROVAL_FOR_IRREVERSIBLE_PRODUCTION_DELETE', 'HIGH', 'docs/operations/THETA_PHASE4_STORAGE_GROWTH_PROJECTION_20261003.md',
    'owner approves archive-then-purge of short-retention and research history (export tooling exists) or raises the plan; carried to Phase 5'),
  row('P4-027', 'Observability and false-WAIT: AEGIS, capital, quote and sizing NOT_REACHED are never labelled as a veto or capacity zero; unknown required input is never an earned WAIT', ['src/theta/canonical-strategy-frontier.ts'],
    [T + 'frontier-properties.test.ts', T + 'phase2-aegis-capacity-zero.test.ts', T + 'false-inactivity-taxonomy.test.ts', T + 'wait-economic-contract.test.ts'], 'PASS', 'VERIFIED', 'HIGH', 'existing suites re-run in Phase 4'),
  row('P4-028', 'Transient-failure recovery: database circuit and probe regression, worker lease loss reported, version-hash mismatch fails typed', ['src/theta/database-health-circuit.ts', 'src/worker/postgres-worker-runtime-store.ts'],
    [T + 'database-health-circuit.test.ts', T + 'phase4-historical-regressions.test.ts', T + 'database-recovery-gate.test.ts'], 'PASS', 'VERIFIED_AND_EXTENDED', 'HIGH', 'phase4-historical-regressions'),
  row('P4-029', 'Unreachable-code pins: capabilities not reachable today carry an explicit registry state instead of a silent default', ['src/providers/capability-registry.ts'],
    [T + 'capability-registry.test.ts', T + 'registry-reachability.test.ts', T + 'production-reachability.test.ts'], 'PASS', 'VERIFIED', 'LOW', 'existing reachability suites'),
  row('P4-030', 'Board truth is not inflated: counts are derived from rows; the 9 data-platform rows are built and proven offline but wired=0 and unreleased, so they add to neither runtime-observed nor wired percentages', ['tools/theta-board.mjs'],
    [T + 'theta-board.test.ts'], 'PASS', 'VERIFIED', 'MEDIUM', 'board test derives counts from rows'),
  row('P4-031', 'Paper order exercised under real broker latency, rate limits and partial fills', ['src/execution/paper-order-coordinator.ts'],
    [], 'FUTURE_PAPER', 'NEEDS_A_REAL_PAPER_ORDER', 'HIGH', 'no Paper order has ever been submitted; Paper gate stays LOCKED in Phase 4', 'Phase 5 owner-authorized activation in an open market'),
  row('P4-032', 'Real exchange-latency and live provider outage behaviour under load', ['src/theta/alpaca-provider.ts'],
    [], 'FUTURE_MARKET', 'NEEDS_OPEN_MARKET', 'MEDIUM', 'chaos suites use deterministic fakes; real outages are only observable live', 'observe during the first full open-market sessions'),
  row('P4-033', 'Empirical effective sample size and calibrated model confidence', ['bots/theta/quant'],
    [], 'EMPIRICAL_ONLY', 'NEEDS_SESSIONS_OF_DATA', 'MEDIUM', 'the proxy is conservative by design; no WR claim is made', 'accumulate resolved episodes; never tune to reach 70 to 80 percent'),
  row('P4-034', 'Vendor-side limits (Aiven connection and storage plan, Alpaca quotas) not controllable from code', ['src/theta/runtime-postgres-client.ts'],
    [T + 'postgres-pool-acquisition.test.ts'], 'PROVIDER_LIMITED', 'PROVIDER_PLAN_LIMIT', 'MEDIUM', 'max 20 connections reported by the provider; pool, circuit and quota guards already bound usage'),
  row('P4-035', 'Browser-side Windows UI rendering of Phase 4 evidence', ['public'],
    [], 'NOT_APPLICABLE', 'NO_UI_SURFACE_CHANGED', 'LOW', 'Phase 4 changed no user-visible surface'),
];

export function computeRegister() {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, register.filter((entry) => entry.CURRENT_STATUS === status).length]));
  return { PHASE4_TOTAL: register.length, ...counts, CODE_SOLVABLE_REMAINING: counts.CODE_SOLVABLE };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync('docs/operations/THETA_PHASE4_REGISTER_20261003.json', `${JSON.stringify({ computed: computeRegister(), rows: register }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(computeRegister())}\n`);
}
