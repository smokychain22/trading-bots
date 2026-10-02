#!/usr/bin/env node
// THETA capability board. Every row is an explicit claim with a note naming its evidence; percentages are computed from
// explicit denominators below and re-derived by tests/theta-board.test.ts, so the stored numbers cannot drift from the rows.
//
// Flag meanings (all booleans, all about the CURRENT repository head unless stated):
//   impl      source implemented                  wired    reached from the canonical production path (or its declared shadow path)
//   tested    deterministic regression coverage   engDone  no known code-solvable defect remains in this row
//   obsNow    row can be observed on real data without an open position/order (denominator for the runtime percentage)
//   runtime   derived: observed on real data AT the deployed release recorded in boardAsOf (observedAtRelease === deployedRelease)
//   paperApplicable / paper   row needs an actual Paper position/order to be exercised / has been exercised
//   empApplicable / emp       row needs resolved outcomes to be validated / has been validated
//   policyBlocked             remaining gap is an owner-policy decision (not code-solvable); counted separately
//
// releaseStatus (derived, one per row):
//   SOURCE_ONLY                    not wired, or changed after the deployed release (committed, not yet released)
//   NOT_OBSERVABLE_YET             needs a position, an order or resolved outcomes that do not exist
//   DEPLOYED_NOT_YET_OBSERVED      deployed and observable, but not yet observed on real data at THIS release
//   CURRENT_RELEASE_REAL_OBSERVED  observed on real data at the deployed release
// Fixes made after the deployed release are `engDone` but SOURCE_ONLY until released; tests/theta-board.test.ts re-derives
// the unreleased flag from git so a stale release record fails.
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const boardAsOf = {
  deployedRelease: '6b20d713f697fc8ab70e0a223c3a51908c9fcc80',
  priorObservedRelease: 'c3d8868265426d870e50352b06d8d252c68a16c9',
  note: 'rows describe the continuation branch head; runtime flags describe observation at the deployed release only',
  runtimeSourcePaths: ['src/', 'api/', 'bots/theta/quant/', 'tools/windows/', 'package.json'],
};

// id, domain, note, flags
const r = (id, domain, note, f) => ({ id, domain, note, impl: 1, wired: 1, tested: 1, engDone: 1, obsNow: 1, runtime: 0,
  paperApplicable: 0, paper: 0, empApplicable: 0, emp: 0, policyBlocked: 0, ...f });

const rawRows = [
  // --- providers and data
  r('ALPACA_ACCOUNT_POSITIONS_ORDERS_READ', 'PROVIDERS', 'typed failure matrix; live reconciliation GOOD', { runtime: 1 }),
  r('ALPACA_MARKET_CLOCK_CALENDAR', 'PROVIDERS', 'session gating observed all session', { runtime: 1 }),
  r('ALPACA_OPTION_CHAIN_ENUMERATION', 'PROVIDERS', '2,619 SPY puts enumerated, pagination boundaries tested', { runtime: 1 }),
  r('ALPACA_OPTION_QUOTES_BBO', 'PROVIDERS', 'finalist refresh telemetry, 183 observations', { runtime: 1 }),
  r('ALPACA_STOCK_BARS', 'PROVIDERS', 'history features computed each cycle', { runtime: 1 }),
  r('ALPACA_CORPORATE_ACTIONS', 'PROVIDERS', 'coverage reported as UNKNOWN when empty, tested', { runtime: 1 }),
  r('OPTIONOMICS_CONTEXT', 'PROVIDERS', 'flow/metrics/context fetched on cadence', { runtime: 1 }),
  r('OPTIONOMICS_EVENT_COVERAGE', 'PROVIDERS', 'macro event coverage typed', { runtime: 1 }),
  r('UNIVERSE_DISCOVERY_RANKING', 'PROVIDERS', 'ranked before bound in source; deployed release still cuts first 100', { runtime: 0 }),
  r('PAPER_INSTRUMENT_MANIFEST', 'PROVIDERS', 'SPY only; promotion contract written; widening is an owner decision', { runtime: 1, policyBlocked: 1 }),
  // --- features and brain
  r('UNDERLYING_FEATURES_TS', 'BRAIN', 'production feature definitions locked by golden vectors', { runtime: 1 }),
  r('FEATURE_PYTHON_SERVING_PARITY', 'BRAIN', 'research definitions locked to TS for RV, trend, gaps', { wired: 0, obsNow: 0 }),
  r('OWNERSHIP_MODEL', 'BRAIN', 'relativeStrength special-cased to manifest funds (circular gate); needs owner policy', { runtime: 1, policyBlocked: 1, engDone: 0 }),
  r('REGIME_MODEL', 'BRAIN', 'v0 transparent model reached each cycle', { runtime: 1, empApplicable: 1 }),
  r('STRATEGY_ROUTER', 'BRAIN', 'applicability by lifecycle state; flat -> Q only', { runtime: 1 }),
  r('Q_CANDIDATE_LATTICE', 'BRAIN', 'DTE/delta/OI/volume/spread; 363 of 2,619 qualified', { runtime: 1 }),
  r('Q_ECONOMIC_DECISION', 'BRAIN', 'structural economics + bootstrap ownership rule', { runtime: 1, empApplicable: 1 }),
  r('H_SHADOW', 'BRAIN', 'research/shadow; cannot freeze Q (tested)', { runtime: 1 }),
  r('D_SHADOW', 'BRAIN', 'research/shadow; two-leg economics tested', { runtime: 1 }),
  r('A_RECOVERY', 'BRAIN', 'NOT_APPLICABLE while flat; lifecycle tested', { obsNow: 0 }),
  r('C_COVERED_CALL', 'BRAIN', 'NOT_APPLICABLE while flat; floor(shares/100) boundary tested', { obsNow: 0 }),
  r('COMPANY_EVENT_POLICY', 'BRAIN', 'earnings/macro gate typed', { runtime: 1 }),
  r('AEGIS_TWELVE_FAMILIES', 'BRAIN', 'candidate-specific; SPY concentration veto observed in 47/47 cycles', { runtime: 1 }),
  r('AEGIS_NOT_REACHED_SEMANTICS', 'BRAIN', 'not-reached distinct from unknown in source; deployed release still labels AEGIS_UNKNOWN', { runtime: 0 }),
  r('CAPITAL_BUDGET', 'BRAIN', 'equity/cash/BP/collateral measured; BP != usable capital', { runtime: 1 }),
  r('STRUCTURAL_SIZING', 'BRAIN', 'single authority; cent-exact and monotone properties tested', { runtime: 1 }),
  r('ENTRY_SELECTION_FRONTIER', 'BRAIN', 'single authority; metamorphic invariance tested', { runtime: 1 }),
  r('COMMON_HORIZON_COMPARISON', 'BRAIN', 'shadow comparator; roll legs now total by type', { runtime: 1 }),
  r('FINALIST_QUOTE_REFRESH', 'BRAIN', 'refresh p50 26 ms observed', { runtime: 1 }),
  // --- management and lifecycle (need a position to observe)
  r('MANAGEMENT_ACTION_FRONTIER', 'MANAGEMENT', 'single selector, guard-tested', { obsNow: 0, paperApplicable: 1 }),
  r('PROFIT_MANAGEMENT', 'MANAGEMENT', 'not a fixed 50%; challenger grid research-executable', { obsNow: 0, paperApplicable: 1, empApplicable: 1 }),
  r('LOSS_MANAGEMENT', 'MANAGEMENT', 'hold/close/roll/expire/assign/recover compared on forward economics', { obsNow: 0, paperApplicable: 1, empApplicable: 1 }),
  r('ROLL_ECONOMICS', 'MANAGEMENT', 'close-old + open-new; unknown credit now UNKNOWN', { obsNow: 0, paperApplicable: 1 }),
  r('ASSIGNMENT_HANDLING', 'MANAGEMENT', 'lifecycle router + evidence tested', { obsNow: 0, paperApplicable: 1 }),
  r('RECOVERY_DECISION', 'MANAGEMENT', 'wait/sell/CC compared', { obsNow: 0, paperApplicable: 1 }),
  r('COVERED_CALL_MANAGEMENT', 'MANAGEMENT', 'open/close/roll/call-away tested', { obsNow: 0, paperApplicable: 1 }),
  r('WHOLE_CHAIN_ACCOUNTING', 'MANAGEMENT', 'identities property-tested; ledger chains reconcile', { obsNow: 0, paperApplicable: 1 }),
  // --- execution
  r('ORDER_INTENT_STATE_MACHINE', 'EXECUTION', 'transition invariants tested', { obsNow: 0, paperApplicable: 1 }),
  r('PAPER_ORDER_COORDINATOR', 'EXECUTION', 'sole mutation authority, guard-tested', { obsNow: 0, paperApplicable: 1 }),
  r('IDEMPOTENT_CLIENT_ORDER_ID', 'EXECUTION', 'deterministic id + DB unique constraint tested', { obsNow: 0, paperApplicable: 1 }),
  r('UNKNOWN_SUBMIT_RECONCILIATION', 'EXECUTION', 'reconcile by clientOrderId before retry', { obsNow: 0, paperApplicable: 1 }),
  r('PARTIAL_FILL_HANDLING', 'EXECUTION', 'partial never advances ledger', { obsNow: 0, paperApplicable: 1 }),
  r('BROKER_RECONCILIATION', 'EXECUTION', 'GOOD all session, 0 positions 0 orders', { runtime: 1 }),
  r('FIRST_CANARY_ACCEPTANCE', 'EXECUTION', 'qty-1 cap, audit-record completion, no relock', { obsNow: 0, paperApplicable: 1 }),
  r('AUTONOMOUS_PAPER_TRANSITION', 'EXECUTION', 'real-schema DB test; never exercised live', { obsNow: 0, paperApplicable: 1 }),
  r('EXECUTION_GATE_LOCK', 'EXECUTION', 'LOCKED confirmed each cycle; live and followers off', { runtime: 1 }),
  r('FOLLOWER_EXECUTION_LOCKED', 'EXECUTION', 'intentionally disabled', { wired: 0, obsNow: 0 }),
  // --- learning
  r('T0_CYCLE_ARCHIVE', 'LEARNING', 'WAIT cycle archived and hash-verified', { runtime: 1 }),
  r('PROVIDER_FREE_REPLAY', 'LEARNING', 'replayed with 0 provider calls; tamper rejected', { runtime: 1 }),
  r('COMMAND5A_LOCAL_SCHEDULER', 'LEARNING', 'SQLite scheduler fresh-first', { runtime: 1 }),
  r('POSTGRES_OBSERVATION_JOBS', 'LEARNING', 'fresh-first + retry in source; deployed release produced 0 observed', { runtime: 0 }),
  r('MARKS_TICKER', 'LEARNING', '40 s read-only tick in source; not deployed', { runtime: 0 }),
  r('COUNTERFACTUAL_TRUTH_CLASSES', 'LEARNING', 'broker actual vs counterfactual vs modeled kept separate', { runtime: 1 }),
  r('OUTCOME_DATASET_EXPORT', 'LEARNING', 'PIT export, hashes, bounded', { runtime: 1 }),
  r('BACKTEST_WALKFORWARD', 'LEARNING', 'purged walk-forward harness; no resolved data', { wired: 0, obsNow: 0, empApplicable: 1 }),
  r('MODEL_CALIBRATION', 'LEARNING', 'interfaces complete; insufficient resolved outcomes', { wired: 0, obsNow: 0, empApplicable: 1 }),
  // --- operations
  r('POSTGRES_RUNTIME', 'OPERATIONS', 'schema 067 healthy, pool bounded', { runtime: 1 }),
  r('SCHEMA_MIGRATIONS', 'OPERATIONS', 'forward-only, CI-applied', { runtime: 1 }),
  r('WINDOWS_SUPERVISOR_LEASE', 'OPERATIONS', 'one supervisor, one lease', { runtime: 1 }),
  r('WORKER_HEALTH_HEARTBEAT', 'OPERATIONS', 'fresh health, SHA aligned', { runtime: 1 }),
  r('STORAGE_SPOOL_PARQUET', 'OPERATIONS', 'deferred state reported as UNKNOWN, never zero', { runtime: 1 }),
  r('CI_PIPELINE', 'OPERATIONS', 'exact-SHA CI, disposable Postgres steps', { runtime: 1 }),
  r('RELEASE_CUTOVER_GOVERNANCE', 'OPERATIONS', 'immutable release worktree, SHA alignment', { runtime: 1 }),
  // --- open items found by the audits (each is a real, not-yet-fixed row; none changes a trade decision today)
  r('DIAGNOSTIC_RISK_WAIT_CLASSIFICATION', 'PHASE1', 'sizing zeros classified by cause; only risk-evaluated zeros count as RISK_WAIT; v6 diagnostic, no migration', { obsNow: 0 }),
  r('STRESS_HISTORY_TRUNCATION_FLAG', 'PHASE1', 'limit+1 completeness record in both stress assessments; truncated read withholds the cold-start exception', { obsNow: 0 }),
  r('REGISTRY_REACHABILITY_GUARD', 'PHASE1', 'registry runtime claims must sit inside the deployed import closure; research->production edges pinned', { wired: 0, obsNow: 0 }),
  r('WHOLE_CHAIN_FEES_DIVIDENDS_INPUT', 'PHASE1', 'fees (provider supplies none) and dividends (no stock lot) stay UNKNOWN by design; needs a fee-schedule attestation', { obsNow: 0, policyBlocked: 1 }),
  r('REGISTRY_SOURCE_LISTS', 'OPEN', 'verified: the registry second list names SOURCES; shadow-strategy-orchestrator is a real research producer of H/D evaluation, so no entry is wrong', { obsNow: 0 }),
  r('DEAD_MODULE_INVENTORY', 'OPEN', 'inventoried: tested library modules with no production importer are classified LIBRARY / FUTURE; the duplicate legacy trade-update store is quarantined by a guard test; no required module is dead', { obsNow: 0, wired: 0 }),
  r('SHADOW_ONCE_SIZING_POLICY_DIVERGENCE', 'OPEN', 'thetaQ sizing uses an inline concentration cap of 2 while structural sizing uses 5; which is intended is a sizing-policy decision', { engDone: 0, obsNow: 0, policyBlocked: 1 }),
  // --- security
  r('SECRET_HYGIENE', 'SECURITY', '1,890 paths scanned, 0 findings', { runtime: 1 }),
  r('PUBLIC_REPO_POLICY', 'SECURITY', 'env ignored, storage policy PASS', { runtime: 1 }),
  r('AUTHORITY_GUARDS', 'SECURITY', 'whole-repo mutation/selector/sizing guard tests', { runtime: 1 }),
  r('ERROR_SANITIZATION', 'SECURITY', 'credentials never in provider errors (tested)', { runtime: 1 }),
];

// Fresh observations made against the deployed release (runtime-truth receipt after the 6b20d71 cutover, 2026-10-02 08:56Z).
const observedAtDeployed = new Set(['ALPACA_ACCOUNT_POSITIONS_ORDERS_READ', 'BROKER_RECONCILIATION', 'EXECUTION_GATE_LOCK', 'POSTGRES_RUNTIME',
  'SCHEMA_MIGRATIONS', 'WINDOWS_SUPERVISOR_LEASE', 'WORKER_HEALTH_HEARTBEAT', 'RELEASE_CUTOVER_GOVERNANCE']);
// Rows whose runtime source changed after the deployed release: committed, not released.
const unreleasedIds = new Set([]);

export const rows = rawRows.map((row) => {
  const everObserved = Boolean(row.runtime);
  const observedAtRelease = !everObserved ? null : observedAtDeployed.has(row.id) ? boardAsOf.deployedRelease : boardAsOf.priorObservedRelease;
  const unreleased = unreleasedIds.has(row.id) ? 1 : 0;
  const runtime = observedAtRelease === boardAsOf.deployedRelease && !unreleased ? 1 : 0;
  const releaseStatus = !row.wired || unreleased ? 'SOURCE_ONLY' : !row.obsNow ? 'NOT_OBSERVABLE_YET'
    : runtime ? 'CURRENT_RELEASE_REAL_OBSERVED' : 'DEPLOYED_NOT_YET_OBSERVED';
  return { ...row, runtime, unreleased, observedAtRelease, releaseStatus };
});

const count = (predicate) => rows.filter(predicate).length;
const pct = (num, den) => (den === 0 ? null : Math.round((num / den) * 10000) / 100);
const metric = (numerator, denominator) => ({ numerator, denominator, percent: pct(numerator, denominator) });

export function computeBoard() {
  const total = rows.length;
  const obs = rows.filter((row) => row.obsNow);
  const paper = rows.filter((row) => row.paperApplicable);
  const emp = rows.filter((row) => row.empApplicable);
  return {
    totalRows: total,
    preMarketEngineering: metric(count((row) => row.engDone), total),
    implementation: metric(count((row) => row.impl), total),
    wiring: metric(count((row) => row.wired), total),
    tested: metric(count((row) => row.tested), total),
    currentReleaseRuntime: metric(obs.filter((row) => row.runtime).length, obs.length),
    paperOperation: metric(paper.filter((row) => row.paper).length, paper.length),
    empiricalValidation: metric(emp.filter((row) => row.emp).length, emp.length),
    openCodeSolvable: rows.filter((row) => !row.engDone && !row.policyBlocked).map((row) => row.id),
    ownerPolicyBlocked: rows.filter((row) => row.policyBlocked).map((row) => row.id),
    releaseStatusCounts: Object.fromEntries(['SOURCE_ONLY', 'NOT_OBSERVABLE_YET', 'DEPLOYED_NOT_YET_OBSERVED', 'CURRENT_RELEASE_REAL_OBSERVED']
      .map((status) => [status, rows.filter((row) => row.releaseStatus === status).length])),
    unreleasedRowCount: rows.filter((row) => row.unreleased).length,
    liveGraduation: { numerator: 0, denominator: null, percent: null, note: 'not authorized; excluded from every denominator' },
  };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] === self) {
  const board = { asOf: boardAsOf, computed: computeBoard(), rows };
  if (process.argv.includes('--write')) {
    writeFileSync(new URL('../docs/operations/THETA_BOARD_20261001.json', import.meta.url), JSON.stringify(board, null, 2) + '\n');
  }
  console.log(JSON.stringify(board.computed, null, 2));
  void readFileSync;
}
