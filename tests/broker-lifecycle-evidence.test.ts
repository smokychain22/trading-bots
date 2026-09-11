import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileManagedOptionLifecycle, type ManagedOptionLifecycleInput } from '../src/execution/broker-lifecycle-evidence.js';

const activity = (type: string, quantity: number | null = 1) => ({
  id: `${type}-1`, activityType: type, symbol: 'AAPL261016P00150000', quantity,
  price: null, date: '2026-10-16', orderId: null,
});
const base = (): ManagedOptionLifecycleInput => ({
  chainId: 'chain-1', currentState: 'CSP_OPEN', legKind: 'SHORT_PUT',
  optionSymbol: 'AAPL261016P00150000', underlyingSymbol: 'AAPL', contracts: 1, multiplier: 100,
  previousPositions: [{ symbol: 'AAPL261016P00150000', quantity: -1 }], currentPositions: [],
  activities: [], observedAt: '2026-10-16T21:00:00.000Z',
});

test('moneyness or a disappeared position cannot confirm assignment without broker activity', () => {
  const input = base();
  const result = reconcileManagedOptionLifecycle({ ...input, currentPositions: [{ symbol: 'AAPL', quantity: 100 }] });
  assert.deepEqual(result, { state: 'UNKNOWN', brokerActivityId: null, transitionPath: [], reasonCode: 'BROKER_TERMINAL_ACTIVITY_NOT_CONFIRMED' });
});

test('broker assignment plus exact stock appearance confirms the full recovery path', () => {
  const input = base();
  const result = reconcileManagedOptionLifecycle({
    ...input, currentPositions: [{ symbol: 'AAPL', quantity: 100 }], activities: [activity('OPASN')],
  });
  assert.equal(result.state, 'CONFIRMED');
  assert.deepEqual(result.transitionPath, ['ASSIGNED', 'STOCK_HELD', 'RECOVERY_WAIT']);
});

test('short-put expiry returns to cash only after broker OPEXP evidence', () => {
  const result = reconcileManagedOptionLifecycle({ ...base(), activities: [activity('OPEXP', null)] });
  assert.equal(result.state, 'CONFIRMED');
  assert.deepEqual(result.transitionPath, ['EXPIRE_OTM', 'REDEPLOY']);
});

test('covered-call expiry returns owned stock to recovery evaluation', () => {
  const input = base();
  const result = reconcileManagedOptionLifecycle({
    ...input, currentState: 'CC_OPEN', legKind: 'COVERED_CALL',
    previousPositions: [{ symbol: input.optionSymbol, quantity: -1 }, { symbol: 'AAPL', quantity: 100 }],
    currentPositions: [{ symbol: 'AAPL', quantity: 100 }], activities: [activity('OPEXP', null)],
  });
  assert.equal(result.state, 'CONFIRMED');
  assert.deepEqual(result.transitionPath, ['EXPIRE_OTM', 'RECOVERY_WAIT']);
});

test('covered-call assignment confirms call-away only when shares leave the account', () => {
  const input = base();
  const common = {
    ...input, currentState: 'CC_OPEN' as const, legKind: 'COVERED_CALL' as const,
    previousPositions: [{ symbol: input.optionSymbol, quantity: -1 }, { symbol: 'AAPL', quantity: 100 }],
    activities: [activity('OPASN')],
  };
  assert.equal(reconcileManagedOptionLifecycle({ ...common, currentPositions: [{ symbol: 'AAPL', quantity: 100 }] }).state, 'UNKNOWN');
  const confirmed = reconcileManagedOptionLifecycle({ ...common, currentPositions: [] });
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.deepEqual(confirmed.transitionPath, ['CALL_AWAY', 'CLOSED']);
});

test('unknown multiplier is non-reconcilable and never defaults to 100', () => {
  const result = reconcileManagedOptionLifecycle({ ...base(), multiplier: null, activities: [activity('OPASN')] });
  assert.equal(result.state, 'INVALID');
  assert.equal(result.reasonCode, 'CONTRACT_ECONOMICS_INVALID');
});
