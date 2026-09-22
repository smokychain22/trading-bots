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
    dte: 20, eventState: 'CLEAR', ownershipState: 'ELIGIBLE', availableActions: ['HOLD', 'CLOSE_FULL', 'ROLL'],
    rollCandidateIds: ['r1', 'r2'], ccCandidateIds: [], selectedAction: 'HOLD', secondBestAction: 'ROLL',
    bestRejectedAction: 'ROLL', policyVersion: 'theta-paper-bootstrap-management-policy-v1',
    actionReasonCodes: ['BOOTSTRAP_DETERMINISTIC_NO_EMPIRICAL_CLAIM'], ...overrides,
  };
}

function outcome(overrides: Partial<ManagementOutcomeRecord> = {}): ManagementOutcomeRecord {
  return {
    decision: decision(), realizedActionResult: null, selectedActionOutcomeStatus: 'PENDING',
    counterfactuals: [], ...overrides,
  };
}

test('validateManagementOutcomeRecord accepts a PENDING (still open) record with a null realized result', () => {
  const result = validateManagementOutcomeRecord(outcome());
  assert.equal(result.valid, true);
});

test('REPAIR: validateManagementOutcomeRecord rejects PENDING status carrying a non-null realized value -- an open chain has no real result yet', () => {
  const result = validateManagementOutcomeRecord(outcome({ realizedActionResult: 50, selectedActionOutcomeStatus: 'PENDING' }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NON_OBSERVED_STATUS_MUST_NOT_CARRY_A_REALIZED_RESULT_VALUE');
});

test('REPAIR: validateManagementOutcomeRecord accepts NOT_RECOVERABLE with a null value -- distinct from PENDING, the outcome will never be known', () => {
  const result = validateManagementOutcomeRecord(outcome({ realizedActionResult: null, selectedActionOutcomeStatus: 'NOT_RECOVERABLE' }));
  assert.equal(result.valid, true);
});

test('validateManagementOutcomeRecord requires a non-null value once OBSERVED', () => {
  const missingValue = validateManagementOutcomeRecord(outcome({ realizedActionResult: null, selectedActionOutcomeStatus: 'OBSERVED' }));
  assert.equal(missingValue.valid, false);
  assert.equal(missingValue.reason, 'OBSERVED_STATUS_REQUIRES_A_NON_NULL_REALIZED_RESULT');
  const valid = validateManagementOutcomeRecord(outcome({ realizedActionResult: 85, selectedActionOutcomeStatus: 'OBSERVED' }));
  assert.equal(valid.valid, true);
});

test('REPAIR: validateManagementOutcomeRecord rejects an ESTIMABLE counterfactual with no value', () => {
  const result = validateManagementOutcomeRecord(outcome({
    counterfactuals: [{ action: 'CLOSE_FULL', value: null, provenance: 'ESTIMABLE' }],
  }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CLOSE_FULL:OBSERVED_PARALLEL_OR_ESTIMABLE_PROVENANCE_REQUIRES_A_NON_NULL_VALUE');
});

test('REPAIR: validateManagementOutcomeRecord requires OBSERVED_PARALLEL (not a bare OBSERVED) for a counterfactual, and accepts it with a value', () => {
  const result = validateManagementOutcomeRecord(outcome({
    counterfactuals: [{ action: 'CLOSE_FULL', value: -30, provenance: 'OBSERVED_PARALLEL' }, { action: 'ROLL', value: null, provenance: 'NOT_IDENTIFIABLE' }],
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

test('REPAIR: using the real canonical action vocabulary prevents a coarse label (e.g. "CC") from bypassing the duplicate-action check', () => {
  // Two DIFFERENT real CC-family actions -- SELL_CC (a decision on a fresh CC) and ROLL_CC (a decision on
  // an already-open CC) -- must be treated as distinct actions, never collapsed into one coarse "CC" label.
  const result = validateManagementOutcomeRecord(outcome({
    decision: decision({ selectedAction: 'HOLD' }),
    counterfactuals: [
      { action: 'SELL_CC', value: 50, provenance: 'ESTIMABLE' },
      { action: 'ROLL_CC', value: 40, provenance: 'ESTIMABLE' },
    ],
  }));
  assert.equal(result.valid, true); // distinct actions, no false duplicate
});

test('validateManagementOutcomeRecord rejects a genuine duplicate counterfactual action', () => {
  const result = validateManagementOutcomeRecord(outcome({
    counterfactuals: [
      { action: 'CLOSE_FULL', value: -10, provenance: 'ESTIMABLE' },
      { action: 'CLOSE_FULL', value: -20, provenance: 'ESTIMABLE' },
    ],
  }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'DUPLICATE_COUNTERFACTUAL_ACTION');
});
