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
  // Even though futureOutcome shows a big favorable move, gate/decision regret must be 0 -- HARD rows are excluded by construction.
  assert.equal(metrics.gateRegretRate, 0);
  assert.equal(metrics.decisionRegretRate, 0);
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

test('falseAcceptRate is always 0 by construction, never estimated from WAIT-only data', () => {
  const metrics = computeWaitRegretMetrics([buildWaitRegretRow(baseInput())]);
  assert.equal(metrics.falseAcceptRate, 0);
});

test('empty batch produces all-zero rates, never NaN', () => {
  const metrics = computeWaitRegretMetrics([]);
  assert.equal(metrics.totalRows, 0);
  assert.equal(Number.isNaN(metrics.gateRegretRate), false);
});

test('NOT_IDENTIFIABLE rows are excluded from soft-identifiable regret calculations', () => {
  const row = buildWaitRegretRow(baseInput({
    exactReason: 'IMPLEMENTATION_FALSE_REJECT', labelAvailableAt: DECISION_AT,
    futureOutcome: { wholeChainNetPnlIfTaken: 999, observedAt: DECISION_AT },
    counterfactualIdentifiability: 'NOT_IDENTIFIABLE',
  }));
  const metrics = computeWaitRegretMetrics([row]);
  assert.equal(metrics.falseRejectRate, 0);
});
