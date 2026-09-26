import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrictnessFunnelReport } from '../src/research/strictness-funnel-report.js';
import type { FalseInactivityRecord } from '../src/research/false-inactivity-taxonomy.js';
import { buildWaitRegretRow } from '../src/research/wait-regret-dataset.js';

test('CORE CLAIM: an empty batch produces null rates and totalCandidates=0, never a fabricated 0', () => {
  const report = buildStrictnessFunnelReport([]);
  assert.equal(report.totalCandidates, 0);
  assert.equal(report.candidateSurvivalRate, null);
  assert.equal(report.hardRejectRate, null);
  assert.equal(report.sizeZeroRate, null);
  assert.equal(report.waitRate, null);
});

test('softDemotionRate is always null -- not identifiable from FalseInactivityRecord alone', () => {
  const records: FalseInactivityRecord[] = [{ candidateId: 'c1', cause: 'GOOD_WAIT' }];
  const report = buildStrictnessFunnelReport(records);
  assert.equal(report.softDemotionRate, null);
});

test('CORE CLAIM: real per-cause rates computed correctly from a mixed batch', () => {
  const records: FalseInactivityRecord[] = [
    { candidateId: 'c1', cause: 'HARD_SAFETY_REJECT' },
    { candidateId: 'c2', cause: 'SIZING_REJECT' },
    { candidateId: 'c3', cause: 'GOOD_WAIT' },
    { candidateId: 'c4', cause: 'PIPELINE_NOT_EVALUATED' },
  ];
  const report = buildStrictnessFunnelReport(records);
  assert.equal(report.totalCandidates, 4);
  assert.equal(report.hardRejectRate, 0.25);
  assert.equal(report.sizeZeroRate, 0.25);
  assert.equal(report.waitRate, 0.25);
  // survival excludes hard-reject (1) and not-evaluated (1) from the 4 total
  assert.equal(report.candidateSurvivalRate, 0.5);
});

test('gateRegretRate/opportunityConversionRate/overfilterSuspicionRate stay null without a real WaitRegretRow batch', () => {
  const report = buildStrictnessFunnelReport([{ candidateId: 'c1', cause: 'GOOD_WAIT' }]);
  assert.equal(report.gateRegretRate, null);
  assert.equal(report.opportunityConversionRate, null);
  assert.equal(report.overfilterSuspicionRate, null);
});

test('CORE CLAIM: gateRegretRate/opportunityConversionRate/overfilterSuspicionRate are sourced from the real computeWaitRegretMetrics, not reinvented', () => {
  const row = buildWaitRegretRow({
    waitDecisionId: 'w1', cycleId: 'cycle-1', decisionAt: '2026-09-22T14:00:00Z',
    exactReason: 'IMPLEMENTATION_FALSE_REJECT', reasonStage: 'AEGIS_EVALUATION', blockerClass: null,
    bestRejectedCandidate: { candidateId: 'x1', rankScore: 0.8, rejectionReason: 'SOFT' },
    secondBestCandidate: null, evidenceAtDecision: {}, providerStates: [], pipelineStates: [],
    futureOutcome: { wholeChainNetPnlIfTaken: 100, observedAt: '2026-09-22T14:00:00Z' },
    labelAvailableAt: '2026-09-22T14:00:00Z', counterfactualIdentifiability: 'OBSERVED_PARALLEL',
  });
  const report = buildStrictnessFunnelReport([], [row]);
  // Real, directly-verified computeWaitRegretMetrics output for this exact
  // fixture (not assumed): gateRegretRate=1, falseRejectRate=1,
  // opportunityConversionRate=null (a real field this specific fixture does
  // not populate -- passed through faithfully, never reinvented).
  assert.equal(report.gateRegretRate, 1);
  assert.equal(report.overfilterSuspicionRate, 1);
  assert.equal(report.opportunityConversionRate, null);
});
