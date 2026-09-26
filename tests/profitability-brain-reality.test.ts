import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProfitabilityBrainRealityReceipt, deriveRealCurrentWorkerEvidence,
  profitabilityBrainMethodRegistry, realityLevelFor,
} from '../src/theta/profitability-brain-reality.js';

test('V7 census counts product strategies and actions from canonical registries', () => {
  const receipt = buildProfitabilityBrainRealityReceipt();
  assert.equal(receipt.strategyCount, 5);
  assert.deepEqual(receipt.strategies, [
    'THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_RECOVERY', 'THETA_CC', 'THETA_DEFINED_RISK',
  ]);
  assert.equal(receipt.actionCount, 17);
  assert.equal(receipt.hardRuleCount, 11);
  assert.equal(receipt.softFeatureFamilyCount, 20);
  assert.equal(receipt.empiricalModelFamilyCount, 4);
  assert.equal(receipt.profitTakingChallengerCount, 17);
  assert.equal(receipt.methodCount, profitabilityBrainMethodRegistry.length);
  assert.equal(receipt.brokerAuthorizedMethodCount, 0);
});

test('router applicability and adaptive economic switching remain separate capabilities', () => {
  const receipt = buildProfitabilityBrainRealityReceipt();
  assert.equal(receipt.methods.find((item) => item.methodId === 'STRATEGY_APPLICABILITY_ROUTER')?.level,
    'L6_RUNTIME_REACHABLE');
  assert.equal(receipt.methods.find((item) => item.methodId === 'ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING')?.level,
    'L1_TYPED_CONTRACT');
  assert.equal(receipt.methods.find((item) => item.methodId === 'SELECTED_CSP_ENTRY_BASELINE_AND_ABLATION')?.level,
    'L5_PERSISTED');
  assert.equal(receipt.methods.find((item) => item.methodId === 'ENTRY_PROFITABILITY_MODEL')?.level,
    'L1_TYPED_CONTRACT');
});

test('V12 matrix covers each real strategy once and keeps D locked and non-authoritative', () => {
  const receipt = buildProfitabilityBrainRealityReceipt();
  assert.deepEqual(receipt.fiveStrategyRealityMatrix.map((row) => row.branch).toSorted(), [
    'THETA_CC', 'THETA_CONVENTIONAL', 'THETA_DEFINED_RISK', 'THETA_HOLD_STRIKE', 'THETA_RECOVERY',
  ]);
  const definedRisk = receipt.fiveStrategyRealityMatrix.find((row) => row.branch === 'THETA_DEFINED_RISK');
  assert.equal(definedRisk?.authority, 'RESEARCH_ONLY');
  assert.match(definedRisk?.lockedPlan ?? '', /brokerAuthority=false/);
  assert.match(definedRisk?.lockedPlan ?? '', /submissionAllowed=false/);
  assert.equal(receipt.methods.find((item) => item.methodId === 'DEFINED_RISK_LOCKED_MULTI_LEG_PLAN')?.level,
    'L6_RUNTIME_REACHABLE');
});

test('runtime, empirical, and broker proof advance only sequentially', () => {
  const methodId = 'STRATEGY_APPLICABILITY_ROUTER';
  assert.equal(buildProfitabilityBrainRealityReceipt({ currentWorkerRealData: [methodId] })
    .methods.find((item) => item.methodId === methodId)?.level, 'L7_CURRENT_WORKER_REAL_DATA');
  assert.equal(buildProfitabilityBrainRealityReceipt({ currentWorkerRealData: [methodId], empiricallyValidated: [methodId] })
    .methods.find((item) => item.methodId === methodId)?.level, 'L8_EMPIRICALLY_VALIDATED');
  assert.equal(buildProfitabilityBrainRealityReceipt({ currentWorkerRealData: [methodId], empiricallyValidated: [methodId], brokerAuthorized: [methodId] })
    .methods.find((item) => item.methodId === methodId)?.level, 'L9_BROKER_AUTHORIZED');
  assert.equal(buildProfitabilityBrainRealityReceipt({ brokerAuthorized: [methodId] })
    .methods.find((item) => item.methodId === methodId)?.level, 'L6_RUNTIME_REACHABLE');
});

// Phase 1 reclosure (THETA-BRAIN-L7-CALLER-GAP): deriveRealCurrentWorkerEvidence
// is the real caller this gap was missing. Naming correction (Pass 2, item
// 17): this is a SYNTHETIC_FIXTURE_MATCHING_REAL_SHAPE, not real evidence --
// its shape mirrors the field structure of the real Sep24 SQLite evidence
// recovered in Phase 2 (a THETA_CONVENTIONAL branch, evaluated, candidates
// carrying an aegisState and a sizing.quantity), so it proves the
// derivation LOGIC is correct against a realistic structure, but it is not
// itself a claim of real historical data. See
// tests/theta-real-historical-episode.test.ts for the actual deserialized
// historical object test.
test('SYNTHETIC_FIXTURE_MATCHING_REAL_SHAPE: an evaluated frontier with AEGIS/sizing evidence derives the correct methodIds, never over-claiming an unevaluated branch', () => {
  const evidence = deriveRealCurrentWorkerEvidence({
    strategyFrontier: {
      selectedCandidateId: null,
      branches: [
        {
          branch: 'THETA_CONVENTIONAL', evaluated: true,
          candidates: [{ aegisState: 'HARD_VETO', sizing: { quantity: 0 } }],
        },
        { branch: 'THETA_HOLD_STRIKE', evaluated: false, candidates: [] },
        { branch: 'THETA_DEFINED_RISK', evaluated: false, candidates: [] },
        { branch: 'THETA_RECOVERY', evaluated: false, candidates: [] },
        { branch: 'THETA_CC', evaluated: false, candidates: [] },
      ],
    },
  });
  assert.ok(evidence.includes('CURRENT_DECISION_STATE'));
  assert.ok(evidence.includes('STRATEGY_APPLICABILITY_ROUTER'));
  assert.ok(evidence.includes('CANONICAL_ENTRY_SELECTION'));
  assert.ok(evidence.includes('CONVENTIONAL_CANDIDATE_ENUMERATION'));
  assert.ok(evidence.includes('Q_STRUCTURAL_ECONOMIC_DECISION'));
  assert.ok(evidence.includes('AEGIS_RISK_PERMISSION'));
  assert.ok(evidence.includes('CONSTRAINED_QUANTITY_SIZING'));
  // Never over-claims for the unevaluated branches.
  assert.ok(!evidence.includes('RECOVERY_CANDIDATE_ENUMERATION'));
  assert.ok(!evidence.includes('COVERED_CALL_CANDIDATE_ENUMERATION'));
});

test('a null frontier (bridge never ran / cycle failed before the brain) derives zero real evidence, never a false claim', () => {
  const evidence = deriveRealCurrentWorkerEvidence({ strategyFrontier: null });
  assert.deepEqual(evidence, []);
});

test('feeding real derived evidence into buildProfitabilityBrainRealityReceipt genuinely promotes those methods to L7, and only those methods', () => {
  const evidence = deriveRealCurrentWorkerEvidence({
    strategyFrontier: {
      selectedCandidateId: null,
      branches: [{ branch: 'THETA_CONVENTIONAL', evaluated: true, candidates: [{ aegisState: 'ALLOW_FULL', sizing: { quantity: 1 } }] }],
    },
  });
  const receipt = buildProfitabilityBrainRealityReceipt({ currentWorkerRealData: evidence });
  assert.equal(receipt.methods.find((m) => m.methodId === 'AEGIS_RISK_PERMISSION')?.level, 'L7_CURRENT_WORKER_REAL_DATA');
  assert.equal(receipt.methods.find((m) => m.methodId === 'RECOVERY_CANDIDATE_ENUMERATION')?.level, 'L6_RUNTIME_REACHABLE', 'a method with no real evidence this cycle must stay at its base level, never inflated');
});

test('level calculation reports the first missing proof and never skips it', () => {
  assert.equal(realityLevelFor({
    typedContract: true, sourceImplemented: true, deterministicTested: false,
    canonicalIntegrated: true, persisted: true, runtimeReachable: true,
    currentWorkerRealData: true, empiricallyValidated: true, brokerAuthorized: true,
  }), 'L2_SOURCE_IMPLEMENTED');
});
