import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCapitalBudgetEvidence } from '../src/theta/capital-budget-evidence.js';
import { deriveAccountExposure } from '../src/theta/account-exposure.js';

const now = '2026-09-30T15:00:00.000Z';
const exposure = deriveAccountExposure({ accountStatus: 'ACTIVE', equity: 100_000, cash: 50_000,
  buyingPower: 40_000, optionsBuyingPower: 40_000, optionsApprovedLevel: 2, optionsTradingLevel: 2,
  tradingBlocked: false, transfersBlocked: false, maskedAccountId: 'test-only', receivedAt: now }, [], []);
const base = { candidateId: 'c1', snapshotId: 's1', asOf: now, buyingPower: 40_000, collateralPerUnit: 5000,
  quantity: 2, preAegisQuantity: 4, caps: [{ name: 'RISK_BUDGET', value: 4, state: 'KNOWN' as const }],
  account: { observedAt: now, exposure }, policyVersion: 'test-policy' };

test('canonical capital evidence separates broker BP from permitted capital and preserves measured assignment zero', () => {
  const receipt = buildCapitalBudgetEvidence(base);
  assert.equal(receipt.brokerBuyingPower.value, 40_000);
  assert.equal(receipt.availableNewRiskCapital.value, 20_000);
  assert.equal(receipt.finalCapitalBudget.value, 10_000);
  assert.equal(receipt.assignmentReserve.value, 0);
  assert.equal(receipt.accountEquity.value, 100_000);
  assert.equal(receipt.cashReserve.value, null);
  assert.equal(receipt.maxStrategyCapital.state, 'NOT_CONFIGURED');
  assert.equal(receipt.executionAuthorized, false);
});

test('missing future and overflowing budget evidence never produces fake known dollars', () => {
  for (const account of [null, { ...base.account, observedAt: '2027-01-01T00:00:00Z' }]) {
    const receipt = buildCapitalBudgetEvidence({ ...base, account });
    assert.equal(receipt.assignmentReserve.value, null);
    assert.equal(receipt.accountEquity.value, null);
    assert.equal(receipt.accountObservedAt, null);
  }
  const receipt = buildCapitalBudgetEvidence({ ...base, collateralPerUnit: Number.MAX_VALUE });
  assert.equal(receipt.finalCapitalBudget.value, null);
  assert.equal(receipt.finalCapitalBudget.state, 'UNKNOWN');
});
