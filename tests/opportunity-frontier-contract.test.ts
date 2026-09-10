import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOpportunityFrontierResponse } from '../src/theta/opportunity-frontier-contract.js';

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-opportunity-frontier-runtime-v1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  entries: [
    { candidateId: 'c1', rank: 1, disposition: 'OPEN_FULL', waitReason: null, rejectionCategory: null, reasons: [] },
  ],
  actionableCandidateIds: ['c1'],
  globalIdle: null,
  ...overrides,
});

test('WAIT must carry a specific waitReason', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    entries: [{ candidateId: 'c1', rank: null, disposition: 'WAIT', waitReason: null, rejectionCategory: 'EVENT', reasons: [] }],
    actionableCandidateIds: [],
    globalIdle: {
      reason: 'EVENT_RISK_CLUSTER', eligibleUnderlyingsScanned: 1, contractsEvaluated: 1, positiveEvCandidates: 0,
      riskRejectedCandidates: 0, executionRejectedCandidates: 0, bestRejectedCandidateId: null, bestRejectedEv: null,
    },
  })));
});

test('an OPEN_* disposition must carry a rank', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    entries: [{ candidateId: 'c1', rank: null, disposition: 'OPEN_FULL', waitReason: null, rejectionCategory: null, reasons: [] }],
  })));
});

test('globalIdle must be null whenever an actionable candidate exists', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    globalIdle: {
      reason: 'NO_POSITIVE_AFTER_COST_EDGE', eligibleUnderlyingsScanned: 1, contractsEvaluated: 1,
      positiveEvCandidates: 0, riskRejectedCandidates: 0, executionRejectedCandidates: 0,
      bestRejectedCandidateId: null, bestRejectedEv: null,
    },
  })));
});

test('no actionable candidate requires a globalIdle report', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    entries: [{ candidateId: 'c1', rank: null, disposition: 'PASS', waitReason: null, rejectionCategory: 'NEGATIVE_EV', reasons: [] }],
    actionableCandidateIds: [],
    globalIdle: null,
  })));
});

test('a well-formed actionable response parses cleanly', () => {
  const response = parseOpportunityFrontierResponse(basePayload());
  assert.equal(response.actionableCandidateIds.length, 1);
});
