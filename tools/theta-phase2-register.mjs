#!/usr/bin/env node
// Strategy-brain Phase 2 denominator register (risk / capital / sizing / management closure).
// STATUS is exactly one of: PASS, CODE_SOLVABLE, OWNER_POLICY, PROVIDER_LIMITED, FUTURE_MARKET, FUTURE_PAPER, EMPIRICAL_ONLY, NOT_APPLICABLE.
// SOLVABILITY says how the row got there (FIXED_THIS_PHASE, ALREADY_CORRECT, or the reason it is not code-solvable).
// Phase 2 closes only when CODE_SOLVABLE_REMAINING is zero. Rows are data; counts are derived.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const T = 'tests/phase2-';
const row = (ID, DOMAIN, SOURCE, CANONICAL_AUTHORITY, CURRENT_BEHAVIOR, EXPECTED_BEHAVIOR, TEST, STATUS, SOLVABILITY, NEXT_ACTION = 'none') =>
  ({ ID, DOMAIN, SOURCE, CANONICAL_AUTHORITY, CURRENT_BEHAVIOR, EXPECTED_BEHAVIOR, TEST, STATUS, SOLVABILITY, NEXT_ACTION });

export const register = [
  // ---- sizing / capital
  row('SIZE-2V5', 'SIZING', 'src/theta/theta-shadow-once.ts', 'paper-bootstrap-runtime-policy.ts sizing', 'inline Q-stage cap 2 was an unexplained duplicate of bootstrap concentration cap 5', 'one policy source; Q-stage quantity cannot change final quantity', [T + 'sizing-policy-single-source.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('SIZE-FINAL-AUTHORITY', 'SIZING', 'canonical-strategy-frontier.ts structuralSizing', 'structuralSizing', 'final = min of all caps; zero valid; no forced one; monotone in every cap, collateral, reserve, pending, equity', 'same', [T + 'sizing-structural-properties.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('SIZE-RISK-CAPACITY', 'SIZING', 'canonical-strategy-frontier.ts', 'AEGIS-approved quantity', 'final quantity could exceed the quantity AEGIS evaluated', 'final <= AEGIS risk capacity, named AEGIS_RISK_CAPACITY, unknown sizes to zero', [T + 'sizing-capital-conservation.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('SIZE-CENTS', 'SIZING', 'secured-contract-capacity.ts, sizing.py', 'exact arithmetic', 'float strike*100 under-sized exact fits', 'integer cents everywhere', [T + 'sizing-cents-boundary.test.ts', 'bots/theta/tests/quant/test_sizing_cents_boundary.py'], 'PASS', 'FIXED_THIS_PHASE'),
  row('CAPITAL-MODEL', 'CAPITAL', 'account-exposure.ts, capital budget', 'single-count exposure', 'BP != usable capital; positions, pending orders and stock counted once; mismatched pending evidence UNKNOWN', 'same', [T + 'sizing-capital-conservation.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('CAPITAL-MULTI-CANDIDATE', 'CAPITAL', 'frontier selection', 'one execution per cycle', 'candidates sized independently, one selected, order independent; pending intents shrink capacity', 'same', [T + 'sizing-capital-conservation.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('SPY-ACCOUNT-FIT', 'ACCOUNT', 'archive e9f4b10f', 'account policy', '0 of 362/363 Q-valid SPY puts fit the hard threshold at $100k equity: ACCOUNT_POLICY_INCOMPATIBILITY', 'honest zero, classified', [T + 'sizing-spy-account-fit.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('ACCOUNT-INCOMPATIBILITY-LABEL', 'SIZING', 'frontier, cycle, diagnostic', 'one capacity-zero vocabulary', 'ACCOUNT_CAPACITY_ZERO / PORTFOLIO_CAPACITY; proven-incompatible shortlist candidates labelled', 'AEGIS result, capacity, sizing and WAIT reason agree', [T + 'sizing-zero-label.test.ts', T + 'aegis-capacity-zero.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('ACCOUNT-CONCENTRATION-POLICY', 'ACCOUNT', 'AEGIS ticker concentration 15%', 'owner policy', 'every Q-valid SPY put exceeds the single-underlying veto at current equity', 'owner chooses account scale or policy; not changed here', [T + 'sizing-spy-account-fit.test.ts'], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  // ---- Q
  row('Q-FUNNEL', 'Q', 'src/theta/q-entry-funnel.ts', 'frontier + Q evaluation', 'per-stage input/pass/fail/unknown/n-a with exact reasons, in the cycle result and diagnostic', 'no generic NO_QUALIFYING_CANDIDATE', [T + 'q-funnel.test.ts', T + 'q-fixes.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('Q-BOUNDARIES', 'Q', 'lattice gates + Python Q', 'bootstrap policy', 'epsilon below/exact/above for every numeric gate; spread rounding fixed so exactly 15% passes', 'no boundary flip', [T + 'q-boundaries.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('Q-METAMORPHIC', 'Q', 'funnel, frontier', 'determinism', 'reorder, duplicate and research-only changes do not change eligibility; tightening never adds candidates', 'same', [T + 'q-funnel.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('Q-ECONOMIC-SOURCE', 'Q', 'contract schema, merge', 'Alpaca executable BBO', 'every record names contract, bid, ask, spread, timestamp; Optionomics cannot set executable prices', 'same', [T + 'q-economics-source.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('Q-FEE-TYPING', 'Q', 'cost-basis-typing.ts, whole-chain', 'actual vs modeled costs', 'modeled/slippage/unknown fee basis keeps realized chain UNKNOWN', 'never record a modeled fee as broker actual', [T + 'q-economics-source.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('Q-FINALIST-SHORTLIST', 'Q', 'finalist-quote-refresh.ts', 'lattice gates', 'shortlist ranks gate-passing and capital-fitting contracts first; no gate changed', 'same', [T + 'q-fixes.test.ts', T + 'q-funnel.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('Q-DELTA-SIGN', 'Q', 'option-contract.ts', 'unknown never coerced', 'positive put delta becomes UNKNOWN', 'same', [T + 'q-fixes.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('Q-OWNERSHIP-FLOOR-REGISTERED', 'Q', 'paper-bootstrap-runtime-policy.ts', 'registered versioned policy', 'floor 0.3 registered, identical value', 'same', [T + 'q-fixes.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('Q-SENSITIVITY', 'Q', 'tools/theta-phase2-q-funnel-sensitivity.ts', 'research only', 'inactivity is capital (AEGIS concentration veto); no Q strictness variant yields a positive quantity; equity x2/x3 does', 'explain, not change', ['docs/operations/THETA_PHASE2_Q_FUNNEL_SENSITIVITY_20261002.json'], 'PASS', 'RESEARCH_DELIVERED'),
  row('Q-MIN-PREMIUM-EDGE', 'Q', 'theta_q_baseline.py minimumPositiveEdge (unused)', 'owner policy', 'no minimum premium or net-of-cost gate', 'owner decides a floor or removes the dead config', [T + 'q-boundaries.test.ts'], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  row('Q-EARNINGS-UNIT', 'Q', 'earningsExclusionDays', 'TRD silent on unit', 'compared as trading sessions', 'owner states sessions or calendar days', [T + 'q-fixes.test.ts'], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  // ---- H / D / A / C
  row('H-MECHANICS-ISOLATION', 'H', 'frontier, theta_h_baseline.py', 'shadow only', 'unknown gamma/gap/earnings vetoes; H failure cannot block Q, create a WAIT, rank over Q, submit orders or use capital', 'same', [T + 'hdac-mechanics.test.ts', 'bots/theta/tests/quant/test_phase2_hdac_router_h.py', T + 'q-shadow-isolation.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('D-MECHANICS-ISOLATION', 'D', 'frontier', 'shadow only', 'exact credit/width/max loss/breakeven; rejects bad structures; stale or crossed leg blocks; no one-leg fallback; cannot block Q', 'same', [T + 'hdac-mechanics.test.ts', T + 'q-shadow-isolation.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('A-APPLICABILITY', 'A', 'frontier, strategy_router.py', 'broker-confirmed inventory', 'flat = NOT_APPLICABLE; no synthetic shares; unknown basis stays UNKNOWN', 'same', [T + 'hdac-mechanics.test.ts', 'bots/theta/tests/quant/test_phase2_hdac_router_h.py'], 'PASS', 'FIXED_THIS_PHASE'),
  row('C-COVERAGE-NO-NAKED', 'C', 'secured-contract-capacity.ts, order-construction.ts, coordinator, plan assembly', 'never naked', 'floor(shares/100) minus covered minus pending; unknown blocks; every path to a short call checks cover; account-net committed calls enforced', 'same', [T + 'hdac-mechanics.test.ts', T + 'hdac-naked-call-guard.test.ts', T + 'fixpass-management-execution.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('A-MIXED-LOT-BASIS', 'A', 'frontier', 'lot ledger', 'aggregate share count only; per-lot basis not modeled', 'per-lot basis needs lots that do not exist yet', [], 'FUTURE_PAPER', 'NEEDS_REAL_LOTS', 'revisit after first assignment'),
  row('D-FILL-RISK', 'D', 'frontier', 'paper evidence', 'simultaneous two-leg fill uncalibrated', 'paper mechanics', [], 'FUTURE_PAPER', 'NEEDS_PAPER_FILLS'),
  row('H-EMPIRICAL-THRESHOLDS', 'H', 'theta_h_baseline.py', 'TRD section 30/40', 'win rate and gamma thresholds unvalidated', 'OOS ablation', [], 'EMPIRICAL_ONLY', 'NEEDS_OUTCOMES'),
  // ---- lifecycle / management
  row('LIFECYCLE-MATRIX', 'LIFECYCLE', 'runtime-state.ts', 'TRD section 4', '256-pair legal transition matrix; management outranks new entry; STOCK_HELD offers only RECOVERY_WAIT', 'same', [T + 'mgmt-lifecycle-matrix.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('LIFECYCLE-EXTRA-STATES', 'LIFECYCLE', 'runtime-state.ts', 'TRD revision', 'ENTRY_WORKING, ASSIGNMENT_PENDING, CC_MANAGEMENT etc. are order-intent or decision concepts, not lifecycle states', 'owner decides whether the TRD adds states or direct STOCK_HELD edges', [T + 'mgmt-lifecycle-matrix.test.ts'], 'OWNER_POLICY', 'TRD_REVISION_NOT_DEFECT', 'owner / versioned TRD revision'),
  row('PROFIT-MANAGEMENT', 'MANAGEMENT', 'paper-bootstrap-management-policy.ts', 'forward economics', 'no fixed profit percent; challengers never final unless promoted', 'same', [T + 'mgmt-forward-economics.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('LOSS-MANAGEMENT-NO-SUNK-COST', 'MANAGEMENT', 'policy, common-horizon-economics.ts', 'forward economics', 'realized-loss sweeps give identical decisions; recovery capital sized on mark not cost basis', 'same', [T + 'mgmt-forward-economics.test.ts', T + 'chain-recovery-cc.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('LOSS-ENTRY-CREDIT-ANCHOR', 'MANAGEMENT', 'policy near-exhausted close trigger', 'owner policy', 'threshold is a fraction of the original entry credit', 'owner picks the forward quantity and threshold', [T + 'mgmt-forward-economics.test.ts'], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  row('ROLL-ECONOMICS-UNITS', 'ROLL', 'roll-incremental-utility.ts, policy', 'TRD ROLL-001', 'complete forward economics; unknown credit blocks; per-share boundaries; same-collateral extension priced in capital-days', 'same', [T + 'mgmt-forward-economics.test.ts', T + 'fixpass-management-execution.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('ROLL-EXECUTION-STRUCTURE', 'ROLL', 'broker-fill-lifecycle-router.ts', 'TRD ROLL-003', 'only both legs filled records a roll; partials stay PARTIAL/UNKNOWN; old-leg P&L immutable', 'same', [T + 'mgmt-oscillation-execution.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('CLOSE-REACHES-ORDER', 'MANAGEMENT', 'policy, plan assembly, handoff, adaptive limit', 'TRD section 54', 'CLOSE_FULL/CLOSE_CC reach READY offline; zero-bid buy-to-close allowed; bad quotes block', 'same', [T + 'fixpass-management-execution.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('SELL-STOCK-REACHES-ORDER', 'MANAGEMENT', 'policy, management input, plan assembly', 'TRD section 54', 'executable Alpaca stock bid is a floor boundary; stock quote read once per underlying; short-call guard at frontier, plan assembly and handoff', 'same', [T + 'fixpass-management-execution.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('CHAIN-INFLIGHT-GUARD', 'MANAGEMENT', 'management-chain-inflight.ts, plan assembly', 'idempotency', 'no second management plan while the chain has a non-terminal plan or order; unknown blocks', 'same', [T + 'fixpass-management-execution.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('MANAGEMENT-AUTHORITY', 'MANAGEMENT', 'whole src', 'buildManagementActionFrontier', 'proposers never touch execution; one decision builder', 'same', [T + 'mgmt-authority-guards.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('OSCILLATION-DETERMINISM', 'MANAGEMENT', 'policy, frontier', 'determinism', 'pure function; decision bound to input hash and timestamp; idempotent plan ids', 'same', [T + 'mgmt-oscillation-execution.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('OSCILLATION-HYSTERESIS', 'MANAGEMENT', 'policy', 'owner policy', 'a quote straddling a threshold may flip the action between cycles; no cooldown', 'owner decides dwell or cooldown', [T + 'mgmt-oscillation-execution.test.ts'], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  row('EVENT-LIQUIDITY-INTERACTION', 'MANAGEMENT', 'frontier', 'exit supremacy, no fake price', 'events block only new risk; illiquid exits fall back to hold or expiry', 'same', [T + 'mgmt-forward-economics.test.ts', T + 'mgmt-oscillation-execution.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('PROFIT-LOSS-EMPIRICAL-EV', 'MANAGEMENT', 'policy', 'TRD section 30', 'EV, tail and IV effects are not modeled in the bootstrap policy', 'promoted empirical policy', [], 'EMPIRICAL_ONLY', 'NEEDS_OUTCOMES'),
  row('MANAGEMENT-LIVE-POSITION', 'MANAGEMENT', 'runtime', 'Paper', 'real management of a live Paper position not yet observed', 'future Paper', [], 'FUTURE_PAPER', 'NEEDS_POSITION'),
  // ---- chain economics
  row('ASSIGNMENT-ECONOMICS', 'CHAIN', 'whole-chain-economics.ts, assignment-utility.ts', 'TRD Appendix A', 'cash = strike*100*shares; basis net of option premium; unknown fees/dividends keep total UNKNOWN', 'same', [T + 'chain-assignment-economics.test.ts', T + 'chain-stock-disposal.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('STOCK-DISPOSAL-LOT-COVERAGE', 'CHAIN', 'broker-fill-lifecycle-router.ts, postgres-broker-fill-lifecycle-orchestrator.ts', 'whole-chain accounting', 'a stock sale is recorded only when exactly one open lot is sold in full; otherwise UNKNOWN (no cross-lot basis blending)', 'same', [T + 'chain-stock-disposal.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('SELL-STOCK-BROKER-SHARES', 'CHAIN', 'management-input-state.ts, management-paper-plan-assembly.ts', 'no short stock', 'a stock sale compiles only when the broker position confirms at least the ledger shares', 'same', ['tests/management-paper-plan-assembly.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('MULTI-LOT-DISPOSAL-ALLOCATION', 'CHAIN', 'broker-fill-lifecycle-router.ts', 'whole-chain accounting', 'a sale spanning several open lots is recorded UNKNOWN (fail closed); allocation across lots is not built', 'allocate across lots once more than one open lot can exist', [], 'FUTURE_PAPER', 'NEEDS_MULTIPLE_LOTS', 'build when a chain can hold several open lots'),
  row('RECOVERY-DECISION', 'CHAIN', 'recovery-state.ts', 'forward economics', 'WAIT/SELL_STOCK/SELL_CC on forward economics, identical across historical loss', 'same', [T + 'chain-recovery-cc.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('COVERED-CALL-BELOW-BASIS', 'CHAIN', 'bootstrap SELL_CC gate belowBasisAllowed=false', 'owner policy', 'strikes below effective basis are rejected', 'owner decides forward-economics rule or exception', [T + 'chain-recovery-cc.test.ts'], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  row('WHOLE-CHAIN-IDENTITY', 'CHAIN', 'whole-chain-economics.ts, ledger-contract.ts', 'accounting identity', '4800 seeded episodes agree across three computations; unknown P&L is null not zero', 'same', [T + 'chain-random-episodes.test.ts', T + 'chain-false-value-sweep.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('FALSE-ECONOMICS-SWEEP', 'CHAIN', 'src/theta, src/execution', 'unknown never zero/one', 'unsafe zero/one sites fixed; none left in decision paths', 'zero unsafe', [T + 'chain-false-value-sweep.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('CHAIN-FEES-DIVIDENDS', 'CHAIN', 'Alpaca', 'provider limits', 'per-fill fees not supplied; dividends need a stock lot', 'owner-attested fee schedule / future data', [], 'PROVIDER_LIMITED', 'EXTERNAL'),
  row('RECOVERY-MODEL', 'CHAIN', 'recovery-state.ts', 'TRD', 'recovery probability and time model not modeled', 'validated model', [], 'EMPIRICAL_ONLY', 'NEEDS_OUTCOMES'),
  // ---- AEGIS
  row('AEGIS-12-FAMILIES', 'AEGIS', 'bots/theta/quant/models/aegis.py', 'AEGIS contract', 'all 12 families: normal, boundary, veto, zero capacity, unknown, invalid units; no strategy bypass or contamination', 'same', ['bots/theta/tests/quant/test_phase2_aegis_families.py'], 'PASS', 'ALREADY_CORRECT'),
  row('AEGIS-MONOTONICITY', 'AEGIS', 'aegis.py', 'AEGIS contract', 'worsening a risk input never loosens, except the documented Paper cold-start marker', 'same', ['bots/theta/tests/quant/test_phase2_aegis_families.py', 'bots/theta/tests/quant/test_aegis_pairwise_monotonicity.py'], 'PASS', 'ALREADY_CORRECT'),
  row('HARD-VETO-VS-CAPACITY-ZERO', 'AEGIS', 'frontier, diagnostic', 'AEGIS contract section 3', 'valid candidate that the account cannot size is quantity zero (capacity), not a hard veto', 'four surfaces agree', [T + 'aegis-capacity-zero.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('WATERFALL', 'AEGIS', 'frontier', 'one receipt per candidate', 'every cap named, binding constraint identified, no unexplained zero', 'same', [T + 'sizing-capital-conservation.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  // ---- universe / instruments
  row('DISCOVERY-APPROVAL-SEPARATION', 'UNIVERSE', 'src/theta/instrument-eligibility-state.ts', 'TEAM_CHARTER', 'five eligibility states; discovery never implies approval', 'same', [T + 'universe-eligibility-state.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('PROMOTION-CONTRACT', 'UNIVERSE', 'instrument-eligibility-state.ts', 'owner approval', 'nineteen typed evidence slots; nothing approved', 'same', [T + 'universe-eligibility-state.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('RELATIVE-STRENGTH-DEFINITION', 'UNIVERSE', 'ownership model', 'owner policy', 'no canonical benchmark, window or scale', 'owner defines', [T + 'universe-eligibility-state.test.ts'], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  row('INSTRUMENT-APPROVAL-EXPANSION', 'UNIVERSE', 'paper manifest', 'owner policy', 'SPY only', 'owner approves instruments', [], 'OWNER_POLICY', 'POLICY_NOT_DEFECT', 'owner decision'),
  row('INSTRUMENT-FIT-RESEARCH', 'UNIVERSE', 'docs/operations/THETA_PHASE2_INSTRUMENT_FIT_RESEARCH_20261002.json', 'research only', 'arithmetic fit threshold stated; no offline non-SPY data', 'capture in session if owner nominates symbols', [], 'FUTURE_MARKET', 'NEEDS_PROVIDER_DATA'),
  // ---- shadow isolation / performance
  row('SHADOW-PRODUCTION-ISOLATION', 'ISOLATION', 'frontier, shadow trader', 'shadow only', 'H/D/research evidence cannot consume capital, block Q, raise Q quantity, submit orders or select; virtual trader sizes at min(Q-stage, final)', 'same', [T + 'q-shadow-isolation.test.ts', T + 'hdac-mechanics.test.ts', T + 'sizing-policy-single-source.test.ts'], 'PASS', 'FIXED_THIS_PHASE'),
  row('FRONTIER-SCALING', 'PERF', 'frontier', 'complexity', 'near-linear time, flat payload per candidate, no per-candidate provider call', 'same', [T + 'perf-frontier-scaling.test.ts'], 'PASS', 'ALREADY_CORRECT'),
  row('FIRST-PAPER-FILL-AND-PROFITABILITY', 'RUNTIME', 'runtime', 'Paper', 'no Paper fill, assignment or call-away observed', 'future runtime', [], 'FUTURE_PAPER', 'NEEDS_POSITION'),
  row('CANDIDATE-DISTRIBUTION-REAL-SESSION', 'RUNTIME', 'runtime', 'market session', 'real candidate distribution on this release unobserved', 'future market', [], 'FUTURE_MARKET', 'NEEDS_SESSION'),
];

export const deferredToPhase3 = [
  'SELL_STOCK / close repricing driver: pricingAttempt is always 0, so only the first-attempt limit is placed (broker order state machine)',
  'SELL_STOCK floor liveness: freeing a chain after the floor becomes unreachable (broker order state machine)',
  'pre-submit quote age 45s vs decision-time 30s (execution mechanics)',
  'management plan row immutability / hash re-check at claim (execution plan store)',
];
const STATUSES = ['PASS', 'CODE_SOLVABLE', 'OWNER_POLICY', 'PROVIDER_LIMITED', 'FUTURE_MARKET', 'FUTURE_PAPER', 'EMPIRICAL_ONLY', 'NOT_APPLICABLE'];
export function computeRegister() {
  const n = (status) => register.filter((r) => r.STATUS === status).length;
  return { PHASE2_TOTAL: register.length, PASS: n('PASS'), OWNER_POLICY: n('OWNER_POLICY'), PROVIDER_LIMITED: n('PROVIDER_LIMITED'),
    FUTURE_MARKET: n('FUTURE_MARKET'), FUTURE_PAPER: n('FUTURE_PAPER'), EMPIRICAL_ONLY: n('EMPIRICAL_ONLY'), NOT_APPLICABLE: n('NOT_APPLICABLE'),
    CODE_SOLVABLE_REMAINING: n('CODE_SOLVABLE') };
}
export { STATUSES };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = { computed: computeRegister(), rows: register, deferredToPhase3: deferredToPhase3 };
  if (process.argv.includes('--write')) writeFileSync(new URL('../docs/operations/THETA_STRATEGY_PHASE2_REGISTER_20261002.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.computed, null, 2));
}
