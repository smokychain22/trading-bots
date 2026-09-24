import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfitabilityBrainRealityReceipt, profitabilityBrainMethodRegistry, realityLevelFor } from '../src/theta/profitability-brain-reality.js';

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

test('level calculation reports the first missing proof and never skips it', () => {
  assert.equal(realityLevelFor({
    typedContract: true, sourceImplemented: true, deterministicTested: false,
    canonicalIntegrated: true, persisted: true, runtimeReachable: true,
    currentWorkerRealData: true, empiricallyValidated: true, brokerAuthorized: true,
  }), 'L2_SOURCE_IMPLEMENTED');
});
