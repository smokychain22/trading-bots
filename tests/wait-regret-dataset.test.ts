import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWaitRegretRow, computeWaitRegretMetrics, type WaitRegretRow } from '../src/research/wait-regret-dataset.js';

const DECISION_AT = '2026-09-22T14:00:00Z';

function baseInput(overrides: Partial<Omit<WaitRegretRow, 'contractVersion' | 'hardVsSoft'>> = {}) {
  return {
    waitDecisionId: 'wait-1', cycleId: 'cycle-1', decisionAt: DECISION_AT,
    exactReason: 'ECONOMIC_WAIT' as const, reasonStage: 'AEGIS_EVALUATION', blockerClass: null,
    bestRejectedCandidate: null, secondBestCandidate: null, evidenceAtDecision: {}, providerStates: [], pipelineStates: [],
    futureOutcome: null, labelAvailableAt: null, counterfactualIdentifiability: 'NOT_IDENTIFIABLE' as const,
    ...overrides,
  };
}

test('CORE CLAIM: a HARD_SAFETY_REJECT is auto-derived hardVsSoft=HARD, never caller-independent', () => {
  const row = buildWaitRegretRow(baseInput({ exactReason: 'HARD_SAFETY_REJECT' }));
  assert.equal(row.hardVsSoft, 'HARD');
});

test('a real SOFT cause (ECONOMIC_WAIT) is correctly derived SOFT', () => {
  const row = buildWaitRegretRow(baseInput({ exactReason: 'ECONOMIC_WAIT' }));
  assert.equal(row.hardVsSoft, 'SOFT');
});

test('ADVERSARIAL: labelAvailableAt before decisionAt is rejected', () => {
  assert.throws(() => buildWaitRegretRow(baseInput({ labelAvailableAt: '2026-09-22T10:00:00Z' })), /WAIT_REGRET_LABEL_BEFORE_DECISION/);
});

test('ADVERSARIAL: a futureOutcome without labelAvailableAt is rejected -- never an unbacked outcome claim', () => {
  assert.throws(() => buildWaitRegretRow(baseInput({
    futureOutcome: { wholeChainNetPnlIfTaken: 50, observedAt: DECISION_AT }, labelAvailableAt: null,
  })), /WAIT_REGRET_OUTCOME_WITHOUT_LABEL_AVAILABLE_AT/);
});

test('CORE CLAIM: a genuine HARD_SAFETY_REJECT never contributes to safetyRejectRate as regret -- it IS the safety rate, not regret', () => {
  const hardRow = buildWaitRegretRow(baseInput({
    exactReason: 'HARD_SAFETY_REJECT', labelAvailableAt: DECISION_AT,
    futureOutcome: { wholeChainNetPnlIfTaken: 500, observedAt: DECISION_AT }, // underlying moved favorably afterward
    counterfactualIdentifiability: 'OBSERVED_PARALLEL',
  }));
  const metrics = computeWaitRegretMetrics([hardRow]);
  assert.equal(metrics.safetyRejectRate, 1);
  // The hard row supplies no eligible regret denominator.
  assert.equal(metrics.gateRegretRate, null);
  assert.equal(metrics.decisionRegretRate, null);
});

test('a SOFT, identifiable, favorable-outcome row DOES contribute to gateRegretRate', () => {
  const row = buildWaitRegretRow(baseInput({
    exactReason: 'IMPLEMENTATION_FALSE_REJECT', labelAvailableAt: DECISION_AT,
    futureOutcome: { wholeChainNetPnlIfTaken: 120, observedAt: DECISION_AT },
    counterfactualIdentifiability: 'OBSERVED_PARALLEL',
  }));
  const metrics = computeWaitRegretMetrics([row]);
  assert.equal(metrics.gateRegretRate, 1);
  assert.equal(metrics.implementationFalseRejectRate, 1);
});

test('rates are reported separately, never combined into one score', () => {
  const metrics = computeWaitRegretMetrics([buildWaitRegretRow(baseInput())]);
  assert.ok(!('regretScore' in metrics));
  assert.ok(!('overallRegret' in metrics));
});

test('falseAcceptRate and conversion remain unavailable in a WAIT-only dataset', () => {
  const metrics = computeWaitRegretMetrics([buildWaitRegretRow(baseInput())]);
  assert.equal(metrics.falseAcceptRate, null);
  assert.equal(metrics.opportunityConversionRate, null);
  assert.equal(metrics.rejectedCandidatePresenceRate, 0);
});

test('empty batch leaves rates unavailable', () => {
  const metrics = computeWaitRegretMetrics([]);
  assert.equal(metrics.totalRows, 0);
  assert.equal(metrics.gateRegretRate, null);
  assert.equal(metrics.safetyRejectRate, null);
});

test('NOT_IDENTIFIABLE rows are excluded from soft-identifiable regret calculations', () => {
  const row = buildWaitRegretRow(baseInput({
    exactReason: 'IMPLEMENTATION_FALSE_REJECT', labelAvailableAt: DECISION_AT,
    futureOutcome: { wholeChainNetPnlIfTaken: 999, observedAt: DECISION_AT },
    counterfactualIdentifiability: 'NOT_IDENTIFIABLE',
  }));
  const metrics = computeWaitRegretMetrics([row]);
  assert.equal(metrics.falseRejectRate, null);
  assert.equal(metrics.softIdentifiableRows, 0);
});

test('a labeled row without a numeric whole-chain counterfactual does not create a regret denominator', () => {
  const row = buildWaitRegretRow(baseInput({
    labelAvailableAt: DECISION_AT,
    futureOutcome: { wholeChainNetPnlIfTaken: null, observedAt: DECISION_AT },
    counterfactualIdentifiability: 'ESTIMABLE',
  }));
  const metrics = computeWaitRegretMetrics([row]);
  assert.equal(metrics.softIdentifiableRows, 0);
  assert.equal(metrics.falseRejectRate, null);
});

test('hard reason cannot be overridden and event sizing provider failures never become favorable-path regret', () => {
  for (const exactReason of ['EVENT_REJECT','SIZING_REJECT','PROVIDER_FAILURE_REJECT','PIPELINE_NOT_EVALUATED'] as const) {
    const row = buildWaitRegretRow({...baseInput({exactReason,labelAvailableAt:DECISION_AT,
      futureOutcome:{wholeChainNetPnlIfTaken:100,observedAt:DECISION_AT},counterfactualIdentifiability:'OBSERVED_PARALLEL'}),hardVsSoft:'SOFT'} as never);
    assert.equal(computeWaitRegretMetrics([row]).gateRegretRate,null);
    if (exactReason === 'EVENT_REJECT' || exactReason === 'SIZING_REJECT') assert.equal(row.hardVsSoft,'HARD');
  }
});

test('modeled and observed counterfactual regret have separate denominators', () => {
  const row = buildWaitRegretRow(baseInput({labelAvailableAt:DECISION_AT,
    futureOutcome:{wholeChainNetPnlIfTaken:100,observedAt:DECISION_AT},counterfactualIdentifiability:'ESTIMABLE'}));
  const metrics = computeWaitRegretMetrics([row]);
  assert.equal(metrics.gateRegretRate,null);
  assert.equal(metrics.modeledGateRegretRate,1);
  assert.equal(metrics.modeledCounterfactualRows,1);
  assert.throws(()=>computeWaitRegretMetrics([row,row]),/DUPLICATE_DECISION/);
});

test('malformed future evidence does not enter a regret denominator', () => {
  for (const futureOutcome of [{wholeChainNetPnlIfTaken:NaN,observedAt:DECISION_AT},
    {wholeChainNetPnlIfTaken:100,observedAt:'invalid'},{wholeChainNetPnlIfTaken:100,observedAt:'2026-09-21T14:00:00Z'}]) {
    assert.throws(()=>buildWaitRegretRow(baseInput({labelAvailableAt:DECISION_AT,futureOutcome})),/OUTCOME_INVALID/);
  }
});
