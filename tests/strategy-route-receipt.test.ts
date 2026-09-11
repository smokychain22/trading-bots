import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleStrategyRouteReceipt } from '../src/theta/strategy-route-receipt.js';
import type { StrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';
import type { NewRiskOrchestrationResult } from '../src/theta/new-risk-orchestrator.js';
import type { CrossSymbolEconomicFrontierResult } from '../src/theta/cross-symbol-economic-frontier.js';

const NOW = new Date().toISOString();

const routing = (overrides: Partial<Record<string, unknown>> = {}): StrategyRoutingResponse => ({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: [
    { strategyFamily: 'THETA_Q', eligible: true, eligibilityState: 'ELIGIBLE_PRIMARY', reasons: [{ code: 'OWNERSHIP_AND_LIQUIDITY_OK', polarity: 1, detail: 'x' }], policyVersion: 'router-v1' },
    { strategyFamily: 'THETA_H', eligible: false, eligibilityState: 'INELIGIBLE_RISK', reasons: [{ code: 'BELOW_THETA_H_BAR', polarity: -1, detail: 'x' }], policyVersion: 'router-v1' },
    { strategyFamily: 'THETA_R', eligible: false, eligibilityState: 'INELIGIBLE_STATE', reasons: [{ code: 'NO_OPEN_OPTION_EXPOSURE', polarity: -1, detail: 'x' }], policyVersion: 'router-v1' },
    { strategyFamily: 'THETA_A', eligible: false, eligibilityState: 'INELIGIBLE_STATE', reasons: [{ code: 'NO_ASSIGNMENT_OR_STOCK', polarity: -1, detail: 'x' }], policyVersion: 'router-v1' },
    { strategyFamily: 'THETA_C', eligible: false, eligibilityState: 'INELIGIBLE_STRUCTURE', reasons: [{ code: 'NO_CONFIRMED_STOCK', polarity: -1, detail: 'x' }], policyVersion: 'router-v1' },
    { strategyFamily: 'THETA_D', eligible: false, eligibilityState: 'INELIGIBLE_STATE', reasons: [{ code: 'GATE_NOT_SATISFIED', polarity: -1, detail: 'x' }], policyVersion: 'router-v1' },
  ],
  ...overrides,
} as StrategyRoutingResponse);

const receiptFor = (overrides: Partial<NewRiskOrchestrationResult['receipt']> = {}) => ({
  decisionId: 'd1', snapshotId: 'snap-1', fusionSnapshotHash: 'a'.repeat(64), timestamp: NOW, underlying: 'SPY',
  winningAction: 'PASS' as const, selectedCandidateId: null, quantity: 0, alternatives: [],
  ownershipSnapshotId: null, regimeSnapshotId: null, executionAuthorized: false as const,
  reasonCodes: ['WAIT_LIQUIDITY'], plainEnglishExplanation: 'x', failClosedReason: null,
  policyVersion: 'v1', modelVersions: {},
  ...overrides,
});

const resultFor = (overrides: Partial<NewRiskOrchestrationResult> = {}): NewRiskOrchestrationResult => ({
  receipt: receiptFor(),
  ownership: null, regime: null, routing: null, thetaQ: null, aegis: null,
  paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: [], candidateEconomics: null,
  ...overrides,
});

test('every strategy family appears exactly once, either eligible or ineligible with reasons', () => {
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor(), null, { thetaQ: 'v1' });
  assert.deepEqual(receipt.eligibleStrategies, ['THETA_Q']);
  assert.equal(receipt.ineligibleStrategies.length, 5);
  assert.ok(receipt.ineligibleStrategies.every((s) => s.reasonCodes.length > 0));
});

test('every family except THETA_Q is honestly reported as not generating real candidates', () => {
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor(), null, {});
  assert.deepEqual(receipt.strategiesWithoutCandidateGeneration, ['THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D']);
});

test('a PASS receipt with no selected candidate reports an explicit waitReason, never null', () => {
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor(), null, {});
  assert.equal(receipt.selectedStrategy, null);
  assert.equal(receipt.selectedCandidateId, null);
  assert.equal(receipt.waitReason, 'WAIT_LIQUIDITY');
  assert.equal(receipt.qZeroReason, null);
});

test('a selected candidate with quantity zero reports an explicit qZeroReason, never a silent zero', () => {
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor({
    receipt: receiptFor({ winningAction: 'OPEN', selectedCandidateId: 'C1', quantity: 0, reasonCodes: ['SIZING_FLOOR'] }),
  }), null, {});
  assert.equal(receipt.selectedStrategy, 'THETA_Q');
  assert.equal(receipt.selectedCandidateId, 'C1');
  assert.equal(receipt.qZeroReason, 'Q_ZERO_AFTER_SIZING_OR_EXECUTION_QUALITY');
  assert.equal(receipt.waitReason, null);
});

test('a selected candidate with positive quantity carries no waitReason and no qZeroReason', () => {
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor({
    receipt: receiptFor({ winningAction: 'OPEN', selectedCandidateId: 'C1', quantity: 2 }),
  }), null, {});
  assert.equal(receipt.selectedStrategy, 'THETA_Q');
  assert.equal(receipt.qZeroReason, null);
  assert.equal(receipt.waitReason, null);
});

test('THETA_Q eligible but never selected because the router never routed a candidate to it reports no strategy selected', () => {
  const receipt = assembleStrategyRouteReceipt(routing({
    results: routing().results.map((r) => (r.strategyFamily === 'THETA_Q' ? { ...r, eligible: false, eligibilityState: 'INELIGIBLE_STATE', reasons: [{ code: 'NOT_A_FRESH_ENTRY_STATE', polarity: -1, detail: 'x' }] } : r)),
  }), resultFor({ receipt: receiptFor({ selectedCandidateId: 'C1', quantity: 2 }) }), null, {});
  // Even if a candidate id somehow appears, an ineligible THETA_Q never
  // gets credited as the selected strategy -- no silent substitution.
  assert.equal(receipt.selectedStrategy, null);
});

test('an EXECUTABLE cross-symbol economic frontier drives the final selectedUnderlying/candidateId over the single-underlying receipt', () => {
  const frontier: CrossSymbolEconomicFrontierResult = {
    snapshotId: 'snap-1', timestamp: NOW, perUnderlying: [], combinedCandidates: [],
    disposition: 'EXECUTABLE_SELECTION', executable: true,
    selectedUnderlying: 'QQQ', selectedCandidateId: 'QQQ-C1',
    reasonCodes: ['SELECTED_BY_HIGHEST_RETURN_PER_CAPITAL_DAY_AMONG_FRONTIER_SURVIVORS'], failClosedReason: null,
  };
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor({
    receipt: receiptFor({ underlying: 'SPY', selectedCandidateId: 'SPY-C1', quantity: 1 }),
  }), frontier, {});
  assert.equal(receipt.selectedUnderlying, 'QQQ');
  assert.equal(receipt.selectedCandidateId, 'QQQ-C1');
  assert.equal(receipt.economicFrontier, frontier);
});

test('a RESEARCH_RANKING_ONLY frontier (executable=false) never becomes a confirmed selection, even though it has a research pick', () => {
  const frontier: CrossSymbolEconomicFrontierResult = {
    snapshotId: 'snap-1', timestamp: NOW, perUnderlying: [], combinedCandidates: [],
    disposition: 'RESEARCH_RANKING_ONLY', executable: false,
    selectedUnderlying: 'QQQ', selectedCandidateId: 'QQQ-C1',
    reasonCodes: ['WAIT_ECONOMIC_EXPECTANCY_UNCALIBRATED', 'RESEARCH_RANKING_BY_LOWEST_CAPITAL_DAYS_ONLY_NOT_EXECUTABLE'],
    failClosedReason: null,
  };
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor({
    receipt: receiptFor({ underlying: 'SPY', selectedCandidateId: 'SPY-C1', quantity: 1 }),
  }), frontier, {});
  assert.equal(receipt.selectedUnderlying, null);
  assert.equal(receipt.selectedCandidateId, null);
  assert.equal(receipt.selectedStrategy, null);
  assert.equal(receipt.waitReason, 'WAIT_ECONOMIC_EXPECTANCY_UNCALIBRATED');
  // The frontier's own research pick remains fully visible for regret analysis.
  assert.equal(receipt.economicFrontier?.selectedUnderlying, 'QQQ');
});

test('a frontier with no selected underlying reports its own reason as the waitReason', () => {
  const frontier: CrossSymbolEconomicFrontierResult = {
    snapshotId: 'snap-1', timestamp: NOW, perUnderlying: [], combinedCandidates: [],
    disposition: 'NO_SURVIVORS', executable: false,
    selectedUnderlying: null, selectedCandidateId: null, reasonCodes: ['NO_FRONTIER_SURVIVORS'], failClosedReason: null,
  };
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor(), frontier, {});
  assert.equal(receipt.waitReason, 'NO_FRONTIER_SURVIVORS');
});

test('AEGIS result and model versions pass through unchanged, never recomputed', () => {
  const aegis = {
    contractVersion: 'theta-aegis-runtime-v1', decisionId: 'd1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'v1',
    families: [], newRiskState: 'ALLOW_FULL', reasons: [], permittedActions: [],
  } as unknown as NewRiskOrchestrationResult['aegis'];
  const receipt = assembleStrategyRouteReceipt(routing(), resultFor({ aegis }), null, { thetaQ: 'v3' });
  assert.equal(receipt.aegis, aegis);
  assert.deepEqual(receipt.modelVersions, { thetaQ: 'v3' });
});
