#!/usr/bin/env node
// Phase 1 (truth / wiring / authority / data-flow) denominator register. Every row is classified exactly once.
//   PASS              closed in code with a named deterministic test
//   EXTERNAL_POLICY   remaining gap is an owner decision, not code
//   EXTERNAL_PROVIDER remaining gap is data the provider does not supply
//   FUTURE_DATA       needs a position, a stock lot or resolved outcomes that do not exist yet
//   CODE_SOLVABLE     an open defect that can be fixed now (Phase 1 closes only when this is zero)
// DEFERRED_PHASE2 rows are listed for traceability but are NOT in the Phase 1 denominator.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = (id, evidence, note) => ({ id, class: 'PASS', evidence, note });
export const register = [
  p('RELEASE_IDENTITY_VERIFIED', ['tools/theta-runtime-truth.ts'], 'main = origin/main = deployed = worker; one lease; schema 067; reconciliation GOOD; 0 positions, 0 orders'),
  p('BOARD_RELEASE_METADATA_TRUTH', ['tests/theta-board.test.ts'], 'deployedRelease, observedAtRelease and the unreleased-runtime-change flag are re-derived; stale metadata fails the test'),
  p('DIAGNOSTIC_RISK_WAIT_CLASSIFICATION', ['tests/runtime-behavior-sizing-zero.test.ts', 'tests/db/runtime-behavior-diagnostic.test.ts'], 'NOT_REACHED / unknown / structural zeros are no longer counted as risk waits; existing schema sufficed, no migration'),
  p('STRESS_HISTORY_TRUNCATION_FLAG', ['tests/stress-history-completeness.test.ts'], 'limit+1 probe, boundary 0/1/4999/5000/5001, a truncated read withholds the cold-start exception'),
  p('WHOLE_CHAIN_LEDGER_COMPLETENESS', ['tests/phase1-ledger-and-exposure-truth.test.ts', 'tests/db/whole-chain-components-repository.test.ts', 'tests/lifecycle-ledger-chain.test.ts'], 'unknown close costs and stock lots keep the chain UNKNOWN; realized losses and cash flows are persisted and cannot disappear'),
  p('EXPOSURE_CLASSIFICATION_UNKNOWN', ['tests/phase1-ledger-and-exposure-truth.test.ts'], 'a missing unclassified-position list is UNKNOWN, never zero'),
  p('UNKNOWN_DRIVEN_AEGIS_HOLD_NOT_A_WAIT', ['tests/frontier-properties.test.ts'], 'a hold caused by an unknown required input is SYSTEM_HOLD; a genuine veto stays an earned WAIT'),
  p('AEGIS_INPUT_WRITER_CONFLICTS_ZERO', ['bots/theta/tests/quant/test_aegis_pairwise_monotonicity.py', 'tests/architecture-authority-guards.test.ts'], 'base inputs fail-closed; candidate overrides tighten-only; one Python authority'),
  p('REGISTRY_CONSUMER_ACCURACY', ['tests/registry-reachability.test.ts'], 'every runtime-reachable registry claim sits inside the deployed import closure'),
  p('DEAD_REQUIRED_ZERO', ['tests/architecture-authority-guards.test.ts'], 'no required module is unreferenced; the duplicate legacy trade-update store is quarantined by a guard'),
  p('AUTHORITY_GUARDS_ONE_EACH', ['tests/architecture-authority-guards.test.ts'], 'entry, management, sizing, AEGIS and broker mutation each have exactly one authority'),
  p('TRAINING_SERVING_PARITY', ['tests/serving-features-parity.test.ts', 'tests/realized-volatility-parity.test.ts', 'bots/theta/tests/quant/test_serving_features_parity.py', 'bots/theta/tests/quant/test_realized_volatility_parity.py'], 'TypeScript and Python agree on shared golden fixtures'),
  p('SEMANTIC_FALSE_VALUE_SWEEP', ['tests/phase1-ledger-and-exposure-truth.test.ts', 'tests/frontier-properties.test.ts'], 'unsafe false zero/false/clear sites found by the sweep are fixed and pinned'),
  { id: 'RELATIVE_STRENGTH_FORMULA_BENCHMARK_SCALE', class: 'EXTERNAL_POLICY', evidence: [], note: 'no canonical definition exists; minimum owner decision: benchmark, window and scale of relativeStrength; no instrument approval is implied' },
  { id: 'WHOLE_CHAIN_FEE_SCHEDULE', class: 'EXTERNAL_PROVIDER', evidence: [], note: 'Alpaca supplies no per-fill fees; fees stay UNKNOWN until an owner-attested fee schedule exists' },
  { id: 'WHOLE_CHAIN_DIVIDENDS', class: 'FUTURE_DATA', evidence: [], note: 'no stock lot exists, so no dividend can be observed; the chain stays UNKNOWN (fail-closed)' },
  { id: 'MANAGEMENT_AND_PAPER_OPERATION_OBSERVATION', class: 'FUTURE_DATA', evidence: [], note: 'needs a real Paper position; none exists' },
  { id: 'EMPIRICAL_VALIDATION_AND_CALIBRATION', class: 'FUTURE_DATA', evidence: [], note: 'needs resolved outcomes; none exist' },
  { id: 'SIZING_CAP_2_VS_5', class: 'DEFERRED_PHASE2', evidence: [], note: 'shadow-once inline cap 2 vs structural 5; sizing policy decision, not touched in Phase 1' },
  { id: 'INSTRUMENT_APPROVAL_EXPANSION', class: 'DEFERRED_PHASE2', evidence: [], note: 'owner decision; not performed here' },
  { id: 'Q_TUNING', class: 'DEFERRED_PHASE2', evidence: [], note: 'not performed here' },
];

export function computeRegister() {
  const inScope = register.filter((row) => row.class !== 'DEFERRED_PHASE2');
  const n = (cls) => inScope.filter((row) => row.class === cls).length;
  return { PHASE1_TOTAL_ROWS: inScope.length, PASS: n('PASS'), EXTERNAL_POLICY: n('EXTERNAL_POLICY'), EXTERNAL_PROVIDER: n('EXTERNAL_PROVIDER'),
    FUTURE_DATA: n('FUTURE_DATA'), PHASE1_CODE_SOLVABLE_REMAINING: n('CODE_SOLVABLE'), DEFERRED_PHASE2: register.length - inScope.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = { computed: computeRegister(), rows: register };
  if (process.argv.includes('--write')) writeFileSync(new URL('../docs/operations/THETA_PHASE1_REGISTER_20261002.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.computed, null, 2));
}
