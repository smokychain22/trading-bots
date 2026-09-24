import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementOutcomeRow, aggregateManagementCohort, type ManagementOutcomeRow } from '../src/research/management-outcome-dataset.js';

const ASOF = '2026-09-22T14:00:00Z';

function baseInput(overrides: Partial<Omit<ManagementOutcomeRow, 'contractVersion'>> = {}) {
  return {
    episodeId: 'ep-1', chainId: 'chain-1', decisionId: 'dec-1', decisionAsOf: ASOF,
    lifecycleState: 'CSP_OPEN', knownEvidenceStates: ['DELTA_KNOWN'], unknownEvidenceStates: [],
    feasibleActions: ['HOLD', 'CLOSE'] as const, selectedAction: 'HOLD' as const, selectedCandidateId: null, rejectedAlternatives: [],
    lossCauseEvidenceRef: null, eventEvidenceRef: null, volatilityEvidenceRef: null, executionEvidenceRef: null, portfolioEvidenceRef: null,
    futureWholeChainNetPnl: null, fees: null, slippage: null, tca: null, capitalDays: null, mae: null, mfe: null,
    assignmentOccurred: null, recoveryDuration: null, coveredCallOpened: null, callAwayOccurred: null, terminalState: null,
    featureAvailableAt: '2026-09-22T13:59:00Z', labelAvailableAt: null,
    ...overrides,
  };
}

test('accepts a real, well-formed row', () => {
  const row = buildManagementOutcomeRow(baseInput());
  assert.equal(row.contractVersion, 'theta-management-outcome-dataset-v1');
});

test('ADVERSARIAL: selectedAction not in feasibleActions is rejected', () => {
  assert.throws(() => buildManagementOutcomeRow(baseInput({ selectedAction: 'ROLL', lossCauseEvidenceRef: 'lc-1' })), /MGMT_OUTCOME_SELECTED_ACTION_NOT_FEASIBLE/);
});

test('ADVERSARIAL: a ROLL action requires a real lossCauseEvidenceRef -- the old leg loss must be traceable', () => {
  assert.throws(() => buildManagementOutcomeRow(baseInput({ feasibleActions: ['ROLL'], selectedAction: 'ROLL' })), /MGMT_OUTCOME_ROLL_REQUIRES_LOSS_CAUSE_EVIDENCE_REF/);
  const ok = buildManagementOutcomeRow(baseInput({ feasibleActions: ['ROLL'], selectedAction: 'ROLL', lossCauseEvidenceRef: 'lc-1' }));
  assert.equal(ok.selectedAction, 'ROLL');
});

test('ADVERSARIAL: a future featureAvailableAt relative to decisionAsOf is rejected', () => {
  assert.throws(() => buildManagementOutcomeRow(baseInput({ featureAvailableAt: '2026-09-22T15:00:00Z' })), /MGMT_OUTCOME_FUTURE_FEATURE_AVAILABLE_AT/);
});

test('ADVERSARIAL: a PnL value without labelAvailableAt is rejected -- no future-label leakage', () => {
  assert.throws(() => buildManagementOutcomeRow(baseInput({ futureWholeChainNetPnl: 100 })), /MGMT_OUTCOME_PNL_WITHOUT_LABEL_AVAILABLE_AT/);
});

test('CORE CLAIM: aggregateManagementCohort excludes censored (PnL=null) rows from resolved-N, never treats them as loss/zero', () => {
  const resolved = buildManagementOutcomeRow(baseInput({ futureWholeChainNetPnl: 100, labelAvailableAt: ASOF }));
  const censored = buildManagementOutcomeRow(baseInput({ episodeId: 'ep-2' }));
  const cohort = aggregateManagementCohort('test-cohort', [resolved, censored]);
  assert.equal(cohort.episodeCount, 2);
  assert.equal(cohort.resolvedEpisodeCount, 1);
  assert.equal(cohort.winRate, 1); // only the resolved row counts
});

test('ADVERSARIAL: atomic row and cohort aggregate are structurally distinct types -- no ProfitFactor field on ManagementOutcomeRow', () => {
  const row = buildManagementOutcomeRow(baseInput());
  assert.ok(!('profitFactor' in row));
  assert.ok(!('winRate' in row));
});

test('a fully empty (all-censored) batch produces null cohort stats, never zero-by-default', () => {
  const censored = buildManagementOutcomeRow(baseInput());
  const cohort = aggregateManagementCohort('test-cohort', [censored]);
  assert.equal(cohort.winRate, null);
  assert.equal(cohort.profitFactor, null);
});

test('profitFactor is real gross-win/gross-loss, and null (not Infinity) when grossLoss is zero', () => {
  const allWins = [
    buildManagementOutcomeRow(baseInput({ episodeId: 'e1', futureWholeChainNetPnl: 100, labelAvailableAt: ASOF })),
    buildManagementOutcomeRow(baseInput({ episodeId: 'e2', futureWholeChainNetPnl: 50, labelAvailableAt: ASOF })),
  ];
  const cohort = aggregateManagementCohort('all-wins', allWins);
  assert.equal(cohort.profitFactor, null);
  assert.equal(cohort.avgWin, 75);
});

test('worst episode PnL is distinct from unavailable path drawdown', () => {
  const rows = [
    buildManagementOutcomeRow(baseInput({ episodeId: 'e1', futureWholeChainNetPnl: -300, labelAvailableAt: ASOF })),
    buildManagementOutcomeRow(baseInput({ episodeId: 'e2', futureWholeChainNetPnl: 50, labelAvailableAt: ASOF })),
  ];
  const cohort = aggregateManagementCohort('cohort', rows);
  assert.equal(cohort.maxDrawdown, null);
  assert.equal(cohort.worstEpisodeNetPnl, -300);
});

test('capital-day return requires complete denominators and has no phantom extra capital day', () => {
  const a = buildManagementOutcomeRow(baseInput({ episodeId: 'a', futureWholeChainNetPnl: 100, capitalDays: 10, labelAvailableAt: ASOF }));
  const b = buildManagementOutcomeRow(baseInput({ episodeId: 'b', futureWholeChainNetPnl: -50, capitalDays: null, labelAvailableAt: ASOF }));
  assert.equal(aggregateManagementCohort('complete', [a]).rpcd, 10);
  assert.equal(aggregateManagementCohort('partial', [a, b]).rpcd, null);
  assert.equal(aggregateManagementCohort('zero', [{ ...a, capitalDays: 0 }]).rpcd, null);
});

test('repeated decisions cannot inflate episode N and nonfinite economics cannot enter a cohort', () => {
  const row = buildManagementOutcomeRow(baseInput());
  assert.throws(() => aggregateManagementCohort('duplicates', [row, { ...row, decisionId: 'later' }]), /DUPLICATE_EPISODE/);
  assert.throws(() => buildManagementOutcomeRow(baseInput({ futureWholeChainNetPnl: NaN })), /NONFINITE/);
});
