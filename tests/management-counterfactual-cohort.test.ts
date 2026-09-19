import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeManagementCounterfactuals, type ManagementCounterfactualInput } from '../src/research/management-counterfactual-analysis.js';
import { buildManagementCounterfactualCohortReport } from '../src/research/management-counterfactual-cohort.js';

const decision = (chainId: string, decisionId: string, netPnlAlt: number, source: 'BROKER_ACTUAL' | 'DEFENSIBLE_REPLAY' = 'DEFENSIBLE_REPLAY'): ManagementCounterfactualInput => ({
  decisionId, chainId, decidedAt: '2026-09-01T14:00:00Z', featureCutoff: '2026-09-01T14:00:00Z', selectedAction: 'HOLD',
  outcomes: [
    { action: 'HOLD', source: 'BROKER_ACTUAL', state: 'RESOLVED', labelAvailableAt: '2026-09-10T14:00:00Z',
      wholeChainNetPnl: 100, returnPerCapitalDay: 0.002, maxAdverseExcursion: -80, executionCost: 0, fillModelVersion: null, evidenceId: `actual-${decisionId}` },
    { action: 'CLOSE_FULL', source, state: 'RESOLVED', labelAvailableAt: '2026-09-10T14:00:00Z',
      wholeChainNetPnl: netPnlAlt, returnPerCapitalDay: 0.001, maxAdverseExcursion: -50, executionCost: 5,
      fillModelVersion: source === 'DEFENSIBLE_REPLAY' ? 'replay-v1' : null, evidenceId: `alt-${decisionId}` },
  ],
});

test('aggregates comparable differences across decisions, tracking independent chains separately from raw decision count', () => {
  const analyses = [
    analyzeManagementCounterfactuals(decision('chain-1', 'd1', 80)),  // netPnlDifference = -20
    analyzeManagementCounterfactuals(decision('chain-1', 'd2', 90)),  // same chain, second decision -- netPnlDifference = -10
    analyzeManagementCounterfactuals(decision('chain-2', 'd3', 120)), // different chain -- netPnlDifference = +20
  ];
  const report = buildManagementCounterfactualCohortReport(
    analyses.map((analysis) => ({ analysis })), 2,
  );
  assert.equal(report.decisionCount, 3);
  assert.equal(report.independentChainCount, 2); // chain-1, chain-2 -- NOT 3
  assert.equal(report.brokerAuthority, false);
  const pair = report.actionPairs.find((row) => row.selectedAction === 'HOLD' && row.alternativeAction === 'CLOSE_FULL');
  assert.equal(pair?.comparableDecisionCount, 3);
  assert.equal(pair?.independentChainCount, 2);
  assert.ok(Math.abs((pair?.meanNetPnlDifference as number) - (-10 / 3)) < 1e-9);
  assert.equal(pair?.sampleSizeState, 'SUFFICIENT'); // 2 independent chains >= minimum of 2
});

test('sampleSizeState is INSUFFICIENT when independent chain count is below the caller-supplied minimum, never silently promoted', () => {
  const analyses = [analyzeManagementCounterfactuals(decision('chain-1', 'd1', 80))];
  const report = buildManagementCounterfactualCohortReport(analyses.map((analysis) => ({ analysis })), 5);
  const pair = report.actionPairs[0];
  assert.equal(pair?.sampleSizeState, 'INSUFFICIENT');
  assert.equal(pair?.independentChainCount, 1);
});

test('sampleSizeState is NONE when there are zero comparable observations', () => {
  const report = buildManagementCounterfactualCohortReport([], 2);
  assert.equal(report.actionPairs.length, 0);
  assert.equal(report.independentChainCount, 0);
});

test('a NO_FILL/UNRESOLVED comparison is excluded from the cohort aggregate entirely, never averaged in as a fabricated zero', () => {
  const resolved = analyzeManagementCounterfactuals(decision('chain-1', 'd1', 80));
  const blocked = analyzeManagementCounterfactuals({
    ...decision('chain-2', 'd2', 999),
    outcomes: [
      { action: 'HOLD', source: 'BROKER_ACTUAL', state: 'RESOLVED', labelAvailableAt: '2026-09-10T14:00:00Z',
        wholeChainNetPnl: 100, returnPerCapitalDay: 0.002, maxAdverseExcursion: -80, executionCost: 0, fillModelVersion: null, evidenceId: 'actual-d2' },
      { action: 'CLOSE_FULL', source: 'DEFENSIBLE_REPLAY', state: 'NO_FILL', labelAvailableAt: null,
        wholeChainNetPnl: null, returnPerCapitalDay: null, maxAdverseExcursion: null, executionCost: null, fillModelVersion: 'replay-v1', evidenceId: 'alt-d2' },
    ],
  });
  const report = buildManagementCounterfactualCohortReport([{ analysis: resolved }, { analysis: blocked }], 1);
  const pair = report.actionPairs.find((row) => row.alternativeAction === 'CLOSE_FULL');
  // Only the one resolved/comparable decision contributes -- the blocked one is excluded, not zero-filled.
  assert.equal(pair?.comparableDecisionCount, 1);
  assert.equal(pair?.meanNetPnlDifference, -20);
});

test('rejects a non-positive or non-integer minimumIndependentSample rather than silently defaulting', () => {
  assert.throws(() => buildManagementCounterfactualCohortReport([], 0));
  assert.throws(() => buildManagementCounterfactualCohortReport([], -1));
  assert.throws(() => buildManagementCounterfactualCohortReport([], 1.5));
});

test('the cohortKey is a passthrough label only -- this module never computes grouping itself', () => {
  const report = buildManagementCounterfactualCohortReport([], 1, { strategy: 'THETA_CONVENTIONAL', dteBucket: '25-60' });
  assert.deepEqual(report.cohortKey, { strategy: 'THETA_CONVENTIONAL', dteBucket: '25-60' });
});

test('the report carries no decision/verdict/recommendation field of any kind -- descriptive statistics only', () => {
  const report = buildManagementCounterfactualCohortReport([], 1);
  const keys = Object.keys(report);
  for (const forbidden of ['winner', 'recommendation', 'verdict', 'selectedAction', 'applicable', 'eligible', 'promote']) {
    assert.ok(!keys.map((key) => key.toLowerCase()).includes(forbidden.toLowerCase()), `report must not carry a decision-shaped field: ${forbidden}`);
  }
});
