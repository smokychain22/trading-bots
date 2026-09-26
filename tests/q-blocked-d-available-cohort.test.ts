import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQBlockedDAvailableCohort, isQBlockedDAvailable, type QBlockedDAvailableSubject } from '../src/research/q-blocked-d-available-cohort.js';

function subject(overrides: Partial<QBlockedDAvailableSubject> = {}): QBlockedDAvailableSubject {
  return {
    decisionId: 'd1', decisionAt: '2026-09-26T14:00:00Z', underlying: 'SPY',
    qBlockReasons: ['COLLATERAL_CAPACITY'], dStructurallyAvailable: true,
    qWouldBeCapitalAtRisk: 5000, dActualCapitalAtRisk: 1000, ...overrides,
  };
}

test('a real Q-blocked/D-available subject is correctly identified', () => {
  assert.equal(isQBlockedDAvailable(subject()), true);
});

test('a subject where Q was not blocked is excluded', () => {
  assert.equal(isQBlockedDAvailable(subject({ qBlockReasons: [] })), false);
});

test('a subject where D is not structurally available is excluded', () => {
  assert.equal(isQBlockedDAvailable(subject({ dStructurallyAvailable: false })), false);
});

test('CORE CLAIM: the cohort NEVER concludes D was preferable -- economicConclusion is always NOT_YET_POSSIBLE', () => {
  const cohort = buildQBlockedDAvailableCohort([subject(), subject({ decisionId: 'd2' })]);
  assert.equal(cohort.economicConclusion, 'NOT_YET_POSSIBLE');
  assert.equal(cohort.subjectCount, 2);
  assert.equal(cohort.byBlockReason.COLLATERAL_CAPACITY, 2);
});

test('averageCapitalAtRiskReduction is null when no subject has both real capital figures', () => {
  const cohort = buildQBlockedDAvailableCohort([subject({ qWouldBeCapitalAtRisk: null })]);
  assert.equal(cohort.averageCapitalAtRiskReduction, null);
});
