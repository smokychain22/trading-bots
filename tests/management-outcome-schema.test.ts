import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateManagementOutcomeRecord, type ManagementDecisionRecord, type ManagementOutcomeRecord,
} from '../src/research/management-outcome-schema.js';

function decision(overrides: Partial<ManagementDecisionRecord> = {}): ManagementDecisionRecord {
  return {
    chainId: 'chain-1', decisionTimestamp: '2026-09-22T14:00:00Z', lifecycleState: 'CSP_OPEN',
    currentUnderlyingState: { last: 205, regimeCohort: 'NEUTRAL' },
    currentOptionState: { bid: 1.0, ask: 1.1, delta: -0.2 },
    wholeChainRealizedPnlToDate: 0, currentExecutableCloseCost: 1.1, currentAnalyticalMark: 1.05,
    dte: 20, eventState: 'CLEAR', ownershipState: 'ELIGIBLE', availableActions: ['HOLD', 'CLOSE', 'ROLL'],
    rollCandidateIds: ['r1', 'r2'], ccCandidateIds: [], selectedAction: 'HOLD', secondBestAction: 'ROLL',
    bestRejectedAction: 'ROLL', policyVersion: 'theta-paper-bootstrap-management-policy-v1',
    actionReasonCodes: ['BOOTSTRAP_DETERMINISTIC_NO_EMPIRICAL_CLAIM'], ...overrides,
  };
}

function outcome(overrides: Partial<ManagementOutcomeRecord> = {}): ManagementOutcomeRecord {
  return {
    decision: decision(), realizedActionResult: null, realizedActionResultProvenance: 'NOT_IDENTIFIABLE',
    counterfactuals: [], ...overrides,
  };
}

test('validateManagementOutcomeRecord accepts an open (unresolved) record with NOT_IDENTIFIABLE realized result', () => {
  const result = validateManagementOutcomeRecord(outcome());
  assert.equal(result.valid, true);
});

test('validateManagementOutcomeRecord rejects NOT_IDENTIFIABLE provenance carrying a non-null realized value', () => {
  const result = validateManagementOutcomeRecord(outcome({ realizedActionResult: 50, realizedActionResultProvenance: 'NOT_IDENTIFIABLE' }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NOT_IDENTIFIABLE_PROVENANCE_MUST_NEVER_CARRY_A_NON_NULL_VALUE');
});

test('validateManagementOutcomeRecord accepts a real OBSERVED result once the chain resolves', () => {
  const result = validateManagementOutcomeRecord(outcome({ realizedActionResult: 85, realizedActionResultProvenance: 'OBSERVED' }));
  assert.equal(result.valid, true);
});

test('validateManagementOutcomeRecord rejects an ESTIMABLE counterfactual with no value', () => {
  const result = validateManagementOutcomeRecord(outcome({
    counterfactuals: [{ action: 'CLOSE', value: null, provenance: 'ESTIMABLE' }],
  }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CLOSE:OBSERVED_OR_ESTIMABLE_PROVENANCE_REQUIRES_A_NON_NULL_VALUE');
});

test('validateManagementOutcomeRecord accepts a real ESTIMABLE counterfactual with a value', () => {
  const result = validateManagementOutcomeRecord(outcome({
    counterfactuals: [{ action: 'CLOSE', value: -30, provenance: 'ESTIMABLE' }, { action: 'ROLL', value: null, provenance: 'NOT_IDENTIFIABLE' }],
  }));
  assert.equal(result.valid, true);
});

test('validateManagementOutcomeRecord rejects the selected action also appearing as a counterfactual of itself', () => {
  const result = validateManagementOutcomeRecord(outcome({
    decision: decision({ selectedAction: 'HOLD' }),
    counterfactuals: [{ action: 'HOLD', value: 10, provenance: 'ESTIMABLE' }],
  }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'SELECTED_ACTION_MUST_NOT_ALSO_APPEAR_AS_A_COUNTERFACTUAL');
});

test('validateManagementOutcomeRecord rejects a duplicate counterfactual action', () => {
  const result = validateManagementOutcomeRecord(outcome({
    counterfactuals: [
      { action: 'CLOSE', value: -10, provenance: 'ESTIMABLE' },
      { action: 'CLOSE', value: -20, provenance: 'ESTIMABLE' },
    ],
  }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'DUPLICATE_COUNTERFACTUAL_ACTION');
});
