import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyEvidenceCycleInterruption, classifyZeroTradeEvidence, summarizeKnownNumbers } from '../src/theta/zero-trade-diagnostic.js';

const baseline = {
  cycleCount: 13, actionReadyCycles: 0, actionPlansReady: 0, orderIntentCount: 0,
  candidateCount: 130, feasibleCandidateCount: 0, providerBlockedCycles: 0,
  dataWaitCycles: 0, quoteWaitCycles: 0, quantityZeroCount: 0, aegisVetoCount: 0,
  paralysisCycles: 0, healthyWaitCycles: 13,
};

test('zero-trade evidence identifies an execution handoff defect only after a ready action', () => {
  assert.equal(classifyZeroTradeEvidence({ ...baseline, actionReadyCycles:1, actionPlansReady:1 }), 'EXECUTION_PATH_DEFECT');
});

test('zero-trade evidence keeps provider, sizing, AEGIS, and paralysis causes distinct', () => {
  assert.equal(classifyZeroTradeEvidence({ ...baseline, providerBlockedCycles:7 }), 'DATA_PROVIDER_BLOCKER');
  assert.equal(classifyZeroTradeEvidence({ ...baseline, feasibleCandidateCount:4, quantityZeroCount:4 }), 'SIZING_BLOCKER');
  assert.equal(classifyZeroTradeEvidence({ ...baseline, feasibleCandidateCount:3, aegisVetoCount:3 }), 'AEGIS_DOMINANCE_REQUIRES_RESEARCH');
  assert.equal(classifyZeroTradeEvidence({ ...baseline, paralysisCycles:13 }), 'CONFIRMED_WAIT_PARALYSIS');
  assert.equal(classifyZeroTradeEvidence({ ...baseline, paralysisCycles:2, healthyWaitCycles:11 }), 'POSSIBLE_WAIT_PARALYSIS');
});

test('numeric diagnostic distributions preserve unknown values and use a deterministic median', () => {
  assert.deepEqual(summarizeKnownNumbers([null, 4, 1, undefined, 3]), {
    known: 3, unknown: 2, minimum: 1, median: 3, maximum: 4,
  });
  assert.deepEqual(summarizeKnownNumbers([4, 2]), {
    known: 2, unknown: 0, minimum: 2, median: 3, maximum: 4,
  });
  assert.deepEqual(summarizeKnownNumbers([null]), {
    known: 0, unknown: 1, minimum: null, median: null, maximum: null,
  });
});

test('zero-trade evidence reports healthy selectivity and insufficient evidence without inventing a defect', () => {
  assert.equal(classifyZeroTradeEvidence(baseline), 'HEALTHY_SELECTIVITY');
  assert.equal(classifyZeroTradeEvidence({ ...baseline, cycleCount:0, candidateCount:0, healthyWaitCycles:0 }), 'INSUFFICIENT_EVIDENCE');
});

test('interrupted evidence cycles stay distinct from completed trade decisions', () => {
  const invoked_at = '2026-09-22T16:25:00.000Z';
  assert.equal(classifyEvidenceCycleInterruption({ status:'FAILED',invoked_at }, '2026-09-22T16:26:00.000Z'), 'FAILED');
  assert.equal(classifyEvidenceCycleInterruption({ status:'RUNNING',invoked_at }, '2026-09-22T16:30:29.000Z'), null);
  assert.equal(classifyEvidenceCycleInterruption({ status:'RUNNING',invoked_at }, '2026-09-22T16:30:31.000Z'), 'TIMED_OUT_WITHOUT_RECEIPT');
  assert.equal(classifyEvidenceCycleInterruption({ status:'SUCCEEDED',invoked_at }, '2026-09-22T16:40:00.000Z'), null);
});
