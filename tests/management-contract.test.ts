import assert from 'node:assert/strict';
import test from 'node:test';
import { managementContractVersion, parseManagementDecisionResponse } from '../src/theta/management-contract.js';

const FUSION_HASH = 'a'.repeat(64);

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: managementContractVersion,
  decisionId: 'decision-1',
  snapshotId: 'snapshot-1',
  fusionSnapshotHash: FUSION_HASH,
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  valuations: [
    { action: 'HOLD', feasible: true, certainCashflow: 0, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: 0, utility: null, reasons: [] },
  ],
  selectedAction: 'HOLD',
  selectedReasons: [],
  ...overrides,
});

test('HOLD may be selected even with an unknown utility -- never forces a trade', () => {
  const response = parseManagementDecisionResponse(basePayload(), FUSION_HASH);
  assert.equal(response.selectedAction, 'HOLD');
});

test('a non-HOLD action must never be selected with an unknown utility', () => {
  const payload = basePayload({
    valuations: [
      { action: 'HOLD', feasible: true, certainCashflow: 0, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: 0, utility: null, reasons: [] },
      { action: 'CLOSE', feasible: true, certainCashflow: null, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: null, utility: null, reasons: [] },
    ],
    selectedAction: 'CLOSE',
  });
  assert.throws(() => parseManagementDecisionResponse(payload, FUSION_HASH));
});

test('an infeasible action can never carry a known utility', () => {
  const payload = basePayload({
    valuations: [
      { action: 'CLOSE', feasible: false, certainCashflow: null, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: null, utility: 42, reasons: [] },
    ],
    selectedAction: 'HOLD',
  });
  assert.throws(() => parseManagementDecisionResponse(payload, FUSION_HASH));
});

test('rejects a response tied to another FusionSnapshot', () => {
  assert.throws(() => parseManagementDecisionResponse(basePayload(), 'b'.repeat(64)));
});

test('selectedAction must correspond to a persisted, feasible valuation', () => {
  const payload = basePayload({ selectedAction: 'ROLL' }); // ROLL not in valuations at all
  assert.throws(() => parseManagementDecisionResponse(payload, FUSION_HASH));
});
