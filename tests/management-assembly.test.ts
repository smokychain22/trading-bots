import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleManagementDecision, type ManagementAssemblyInput } from '../src/theta/management-assembly.js';
import type { ManagementDecisionResponse } from '../src/theta/management-contract.js';
import type { AegisAssessmentResponse } from '../src/theta/aegis-contract.js';
import type { ExecutionQualityResponse } from '../src/theta/execution-quality-contract.js';

const NOW = new Date().toISOString();
const HASH = 'a'.repeat(64);

const management = (selectedAction: ManagementDecisionResponse['selectedAction']): ManagementDecisionResponse => ({
  contractVersion: 'theta-management-runtime-v1', decisionId: 'd1', snapshotId: 's1', fusionSnapshotHash: HASH,
  timestamp: NOW, policyVersion: 'v1',
  valuations: [
    { action: 'HOLD', feasible: true, certainCashflow: 0, estimatedFutureValue: 10, tailRiskPenalty: 1, capitalDaysPenalty: 1, executionPenalty: 0, utility: 8, reasons: [] },
    { action: selectedAction, feasible: true, certainCashflow: null, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: null, utility: selectedAction === 'HOLD' ? 8 : 20, reasons: [] },
  ],
  selectedAction, selectedReasons: [],
});

const aegis = (state: AegisAssessmentResponse['newRiskState']): AegisAssessmentResponse => ({
  contractVersion: 'theta-aegis-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
  families: [{ family: 'PER_TRADE', state, reasons: [] }], newRiskState: state, reasons: [],
  permittedActions: ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'],
});

const executionQuality = (action: ExecutionQualityResponse['recommendedAction']): ExecutionQualityResponse => ({
  contractVersion: 'theta-execution-quality-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
  spreadPct: 0.05, fillProbability: 0.8, expectedSlippagePerShare: 0.01,
  acceptable: action === 'SUBMIT', recommendedAction: action, reasons: [],
});

const baseInput = (overrides: Partial<ManagementAssemblyInput> = {}): ManagementAssemblyInput => ({
  snapshotId: 's1', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-1',
  management: management('HOLD'), aegis: aegis('ALLOW_FULL'), executionQuality: null, holdAdvantage: 5,
  policyVersion: 'v1', modelVersions: { management: 'v1' }, requiredModelVersions: { management: 'v1' },
  providerStateGood: true,
  ...overrides,
});

test('HOLD passes through cleanly with holdAdvantage carried', () => {
  const receipt = assembleManagementDecision(baseInput());
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.equal(receipt.holdAdvantage, 5);
  assert.equal(receipt.executionAuthorized, false);
});

test('CLOSE is confirmed when execution quality recommends SUBMIT', () => {
  const receipt = assembleManagementDecision(baseInput({
    management: management('CLOSE'), executionQuality: executionQuality('SUBMIT'),
  }));
  assert.equal(receipt.selectedAction, 'CLOSE');
});

test('CLOSE is never blocked by a restrictive AEGIS state -- exit supremacy', () => {
  const receipt = assembleManagementDecision(baseInput({
    management: management('CLOSE'), aegis: aegis('HARD_VETO'), executionQuality: executionQuality('SUBMIT'),
  }));
  assert.equal(receipt.selectedAction, 'CLOSE');
});

test('ROLL is blocked by HARD_VETO and falls back to HOLD', () => {
  const receipt = assembleManagementDecision(baseInput({
    management: management('ROLL'), aegis: aegis('HARD_VETO'), executionQuality: executionQuality('SUBMIT'),
  }));
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.equal(receipt.reasonCodes.includes('AEGIS_BLOCKS_NEW_RISK_MANAGEMENT_ACTION'), true);
});

test('ROLL is blocked by HOLD_ONLY and falls back to HOLD', () => {
  const receipt = assembleManagementDecision(baseInput({
    management: management('ROLL'), aegis: aegis('HOLD_ONLY'), executionQuality: executionQuality('SUBMIT'),
  }));
  assert.equal(receipt.selectedAction, 'HOLD');
});

test('ROLL proceeds under ALLOW_FULL when execution quality permits', () => {
  const receipt = assembleManagementDecision(baseInput({
    management: management('ROLL'), aegis: aegis('ALLOW_FULL'), executionQuality: executionQuality('SUBMIT'),
  }));
  assert.equal(receipt.selectedAction, 'ROLL');
});

test('a poor execution-quality gate falls back to HOLD even when AEGIS permits the action', () => {
  const receipt = assembleManagementDecision(baseInput({
    management: management('CLOSE'), aegis: aegis('ALLOW_FULL'), executionQuality: executionQuality('CANCEL'),
  }));
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.equal(receipt.reasonCodes.includes('EXECUTION_QUALITY_GATE_FAILED'), true);
});

test('bad provider state fails closed to HOLD', () => {
  const receipt = assembleManagementDecision(baseInput({ providerStateGood: false, management: management('CLOSE') }));
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.equal(receipt.failClosedReason !== null, true);
});

test('model version mismatch fails closed to HOLD', () => {
  const receipt = assembleManagementDecision(baseInput({
    modelVersions: { management: 'v2' }, management: management('CLOSE'),
  }));
  assert.equal(receipt.selectedAction, 'HOLD');
});

test('snapshot hash mismatch between input and management response fails closed', () => {
  const receipt = assembleManagementDecision(baseInput({
    fusionSnapshotHash: 'b'.repeat(64), management: management('CLOSE'),
  }));
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.equal(receipt.failClosedReason !== null, true);
});

test('executionAuthorized is always false, even for a confirmed action', () => {
  const receipt = assembleManagementDecision(baseInput({ management: management('CLOSE'), executionQuality: executionQuality('SUBMIT') }));
  assert.equal(receipt.executionAuthorized, false);
});
