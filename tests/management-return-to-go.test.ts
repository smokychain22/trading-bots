import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementReturnToGoRows } from '../src/research/management-return-to-go.js';

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
