import assert from 'node:assert/strict';
import test from 'node:test';
import { applyUserMaximum, paperCopyPolicySchema, recommendedCopyPolicy, storedCopyPolicy } from '../src/customer/copy-policy.js';

test('recommended policy has no extra numeric caps and preserves zero allocation', () => {
  const policy = recommendedCopyPolicy(0);
  assert.equal(policy.allocation_usd, 0);
  assert.equal(policy.max_open_positions, null);
  assert.equal(policy.max_daily_loss_usd, null);
  assert.equal(policy.max_slippage_per_contract_usd, null);
  assert.deepEqual(storedCopyPolicy(policy), policy);
});
test('custom zero, null and positive caps are distinct through database decoding', () => {
  const policy = paperCopyPolicySchema.parse({ ...recommendedCopyPolicy(12500), limit_mode: 'CUSTOM',
    max_open_positions: 0, max_bot_capital_pct: 17.5, max_daily_loss_usd: null,
    max_slippage_per_contract_usd: 2.25 });
  assert.deepEqual(storedCopyPolicy({ ...policy, allocation_usd: '12500.00000000',
    max_bot_capital_pct: '17.500000', max_slippage_per_contract_usd: '2.25000000' }), policy);
  assert.equal(applyUserMaximum(5, null), 5);
  assert.equal(applyUserMaximum(5, 0), 0);
  assert.equal(applyUserMaximum(5, 100), 5);
});
test('recommended mode cannot smuggle custom caps and platform caps cannot be unknown', () => {
  assert.throws(() => paperCopyPolicySchema.parse({ ...recommendedCopyPolicy(10000), max_contracts: 10 }));
  assert.throws(() => applyUserMaximum(Number.NaN, null));
  assert.throws(() => applyUserMaximum(5, -1));
});
