import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementActionValueRows, buildManagementReturnToGoRows, CANONICAL_MANAGEMENT_ACTIONS } from '../src/research/management-return-to-go.js';

test('CORE CLAIM: unchosen management actions never inherit the chosen action realized return', () => {
  const rows = buildManagementReturnToGoRows({
    managementDecisionPointId: 'm1',
    alternatives: [{ action: 'HOLD', wasSelected: true }, { action: 'CLOSE_FULL', wasSelected: false }, { action: 'ROLL', wasSelected: false }],
    selectedActionResolvedReturnToGo: 42, selectedActionResolvedAt: '2026-09-25T00:00:00Z',
  });
  const chosen = rows.find((r) => r.action === 'HOLD') as (typeof rows)[number];
  const unchosen1 = rows.find((r) => r.action === 'CLOSE_FULL') as (typeof rows)[number];
  const unchosen2 = rows.find((r) => r.action === 'ROLL') as (typeof rows)[number];
  assert.equal(chosen.identifiabilityStatus, 'FACTUAL_OBSERVED');
  assert.equal(chosen.realizedReturnToGo, 42);
  assert.equal(unchosen1.identifiabilityStatus, 'NOT_IDENTIFIABLE');
  assert.equal(unchosen1.realizedReturnToGo, null);
  assert.equal(unchosen2.realizedReturnToGo, null);
});

test('an unresolved chosen action stays NOT_IDENTIFIABLE until its path resolves', () => {
  const rows = buildManagementReturnToGoRows({
    managementDecisionPointId: 'm2',
    alternatives: [{ action: 'HOLD', wasSelected: true }],
    selectedActionResolvedReturnToGo: null, selectedActionResolvedAt: null,
  });
  assert.equal(rows[0]?.identifiabilityStatus, 'NOT_IDENTIFIABLE');
});

test('ADVERSARIAL: exactly one selected alternative is required', () => {
  assert.throws(() => buildManagementReturnToGoRows({
    managementDecisionPointId: 'm3',
    alternatives: [{ action: 'HOLD', wasSelected: false }, { action: 'CLOSE_FULL', wasSelected: false }],
    selectedActionResolvedReturnToGo: null, selectedActionResolvedAt: null,
  }), /MANAGEMENT_RETURN_TO_GO_REQUIRES_EXACTLY_ONE_SELECTED_ALTERNATIVE/);
});

test('ADVERSARIAL: a value without a resolved timestamp is rejected', () => {
  assert.throws(() => buildManagementReturnToGoRows({
    managementDecisionPointId: 'm4',
    alternatives: [{ action: 'HOLD', wasSelected: true }],
    selectedActionResolvedReturnToGo: 10, selectedActionResolvedAt: null,
  }), /MANAGEMENT_RETURN_TO_GO_VALUE_WITHOUT_RESOLVED_AT/);
});

test('CORE CLAIM (5C-7 items 33-34): risk-to-go/capital-days-to-go/tail-outcome/opportunity-cost never leak onto an unchosen alternative', () => {
  const rows = buildManagementActionValueRows({
    managementDecisionPointId: 'm5',
    alternatives: [{ action: 'ROLL', wasSelected: true }, { action: 'CLOSE_FULL', wasSelected: false }],
    selectedActionResolvedReturnToGo: 20, selectedActionResolvedAt: '2026-09-25T00:00:00Z',
    selectedActionValues: { riskToGo: 5, capitalDaysToGo: 10, tailOutcome: -2, opportunityCost: 1 },
    selectedActionTimingClassification: 'WINNER_GIVEBACK',
  });
  const chosen = rows.find((r) => r.action === 'ROLL') as (typeof rows)[number];
  const unchosen = rows.find((r) => r.action === 'CLOSE_FULL') as (typeof rows)[number];
  assert.equal(chosen.riskToGo, 5);
  assert.equal(chosen.timingClassification, 'WINNER_GIVEBACK');
  assert.equal(unchosen.riskToGo, null);
  assert.equal(unchosen.timingClassification, null);
});

test('values without a resolved timestamp are rejected for the extended builder too', () => {
  assert.throws(() => buildManagementActionValueRows({
    managementDecisionPointId: 'm6',
    alternatives: [{ action: 'HOLD', wasSelected: true }],
    selectedActionResolvedReturnToGo: null, selectedActionResolvedAt: null,
    selectedActionValues: { riskToGo: 5, capitalDaysToGo: null, tailOutcome: null, opportunityCost: null },
    selectedActionTimingClassification: null,
  }), /MANAGEMENT_ACTION_VALUE_INPUTS_WITHOUT_RESOLVED_AT/);
});

test('ADVERSARIAL (overnight §36): an unrecognized/typo\'d action string is rejected -- no enum drift can silently pass through', () => {
  assert.throws(() => buildManagementReturnToGoRows({
    managementDecisionPointId: 'm7',
    alternatives: [{ action: 'HOLD', wasSelected: true }, { action: 'CLOSE_PARTIAL_TYPO', wasSelected: false }],
    selectedActionResolvedReturnToGo: null, selectedActionResolvedAt: null,
  }), /MANAGEMENT_RETURN_TO_GO_UNRECOGNIZED_ACTION:CLOSE_PARTIAL_TYPO/);
});

test('all 13 real canonical management actions plus WAIT are individually accepted, none rejected as unrecognized', () => {
  for (const action of CANONICAL_MANAGEMENT_ACTIONS) {
    const rows = buildManagementReturnToGoRows({
      managementDecisionPointId: 'm8',
      alternatives: [{ action, wasSelected: true }],
      selectedActionResolvedReturnToGo: null, selectedActionResolvedAt: null,
    });
    assert.equal(rows[0]?.action, action);
  }
});
