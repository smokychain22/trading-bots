import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrokerActivity, BrokerOrderSnapshot, PaperBrokerAdapter } from '../src/execution/broker.js';
import {
  brokerOrderIntentState, runReadOnlyBrokerReconciliation,
  type BrokerReconciliationSnapshotInput,
  type BrokerReconciliationStore,
} from '../src/execution/broker-reconciliation-worker.js';

const order = (overrides: Partial<BrokerOrderSnapshot> = {}): BrokerOrderSnapshot => ({
  id: 'broker-known', clientOrderId: 'theta-known', symbol: 'AAPL261016P00200000',
  qty: 1, filledQty: 0, filledAvgPrice: null, side: 'sell', status: 'new',
  limitPrice: 1.25, submittedAt: '2026-09-11T14:30:00Z', replacedBy: null, replaces: null,
  ...overrides,
});

class CaptureStore implements BrokerReconciliationStore {
  persisted: BrokerReconciliationSnapshotInput | null = null;
  async matchOrders(_hash: string, orders: readonly BrokerOrderSnapshot[]) {
    const known = orders.find((candidate) => candidate.id === 'broker-known');
    return {
      matched: known === undefined ? [] : [{
        orderIntentId: 'intent-known', providerOrderId: known.id, providerOrderIdHash: 'a'.repeat(64),
        brokerStatus: known.status, brokerIntentState: brokerOrderIntentState(known),
      }],
      unmatched: orders.filter((candidate) => candidate.id !== 'broker-known'),
      missingLocalIntentIds: ['intent-local-only'],
    };
  }
  async persist(input: BrokerReconciliationSnapshotInput) { this.persisted = input; }
}

function broker(accountId = 'paper-account-owner') {
  let mutationCalls = 0;
  const activities: BrokerActivity[] = [
    { id: 'activity-known', activityType: 'FILL', symbol: 'AAPL261016P00200000', quantity: 1, price: 1.25, date: '2026-09-11T14:31:00Z', orderId: 'broker-known' },
    { id: 'activity-external', activityType: 'OPASN', symbol: 'MSFT261016P00300000', quantity: 1, price: null, date: '2026-09-11', orderId: null },
  ];
  const value: PaperBrokerAdapter = {
    accountKind: 'MASTER_API_KEY', environment: 'PAPER',
    getAccount: async () => ({ id: accountId, status: 'ACTIVE' }),
    getPositions: async () => [{ symbol: 'MSFT', qty: '100', side: 'long', asset_class: 'us_equity' }],
    getOrders: async () => [order(), order({ id: 'broker-external', clientOrderId: 'manual-1', symbol: 'MSFT' })],
    getOrderByClientOrderId: async () => null,
    getOrder: async () => null,
    getActivities: async () => activities,
    getClock: async () => ({
      timestamp: '2026-09-11T14:32:00Z', isOpen: true,
      nextOpen: '2026-09-12T13:30:00Z', nextClose: '2026-09-11T20:00:00Z',
    }),
    getCalendar: async () => [{ date: '2026-09-11', open: '09:30', close: '16:00' }],
    submitOrder: async () => { mutationCalls += 1; throw new Error('must not submit'); },
    replaceOrder: async () => { mutationCalls += 1; throw new Error('must not replace'); },
    cancelOrder: async () => { mutationCalls += 1; throw new Error('must not cancel'); },
  };
  return { value, mutationCalls: () => mutationCalls };
}

test('read-only reconciliation persists matched and EXTERNAL_OR_UNKNOWN facts without broker mutations', async () => {
  const adapter = broker();
  const store = new CaptureStore();
  const result = await runReadOnlyBrokerReconciliation({
    broker: adapter.value, store, connectionId: 'connection-1',
    expectedProviderAccountRef: 'paper-account-owner', correlationId: 'cycle-1',
    now: () => '2026-09-11T14:32:00.000Z',
  });
  assert.equal(result.matchedOrderCount, 1);
  assert.equal(result.externalOrUnknownCount, 3);
  assert.equal(result.localOnlyIntentCount, 1);
  assert.equal(result.marketOpen, true);
  assert.equal(result.calendarSessionConfirmed, true);
  assert.equal(result.dataQuality, 'GOOD');
  assert.equal(adapter.mutationCalls(), 0);
  assert.equal(store.persisted?.unmatchedFacts.every((fact) => fact.providerFactRefHash.length === 64), true);
  assert.equal(store.persisted?.unmatchedFacts.some((fact) => fact.factType === 'POSITION'), true);
  assert.equal(JSON.stringify(store.persisted).includes('paper-account-owner'), false);
});

test('missing market-session capabilities remain UNKNOWN rather than silently healthy', async () => {
  const adapter = broker();
  const withoutSession = { ...adapter.value, getClock: undefined, getCalendar: undefined };
  const result = await runReadOnlyBrokerReconciliation({
    broker: withoutSession, store: new CaptureStore(), connectionId: 'connection-1',
    expectedProviderAccountRef: 'paper-account-owner', correlationId: 'cycle-unknown-session',
    now: () => '2026-09-11T14:32:00.000Z',
  });
  assert.equal(result.marketOpen, null);
  assert.equal(result.calendarSessionConfirmed, false);
  assert.equal(result.dataQuality, 'UNKNOWN');
});

test('broker state uses fill quantities and preserves partial-fill truth on cancel', () => {
  assert.equal(brokerOrderIntentState(order({ status: 'new', filledQty: 0 })), 'ACKNOWLEDGED');
  assert.equal(brokerOrderIntentState(order({ status: 'new', filledQty: 1 })), 'FILLED');
  assert.equal(brokerOrderIntentState(order({ status: 'canceled', qty: 2, filledQty: 1 })), 'CANCELED');
  assert.equal(brokerOrderIntentState(order({ status: 'mystery', filledQty: 0 })), null);
});

test('master broker identity mismatch fails before persistence or any mutation', async () => {
  const adapter = broker('different-paper-account');
  const store = new CaptureStore();
  await assert.rejects(runReadOnlyBrokerReconciliation({
    broker: adapter.value, store, connectionId: 'connection-1',
    expectedProviderAccountRef: 'paper-account-owner', correlationId: 'cycle-2',
    now: () => '2026-09-11T14:32:00.000Z',
  }), /MASTER_BROKER_IDENTITY_MISMATCH/);
  assert.equal(store.persisted, null);
  assert.equal(adapter.mutationCalls(), 0);
});

test('reconciliation rejects a follower adapter', async () => {
  const adapter = broker();
  const follower = { ...adapter.value, accountKind: 'FOLLOWER_API_KEY' as const };
  await assert.rejects(runReadOnlyBrokerReconciliation({
    broker: follower, store: new CaptureStore(), connectionId: 'connection-1',
    expectedProviderAccountRef: 'paper-account-owner', correlationId: 'cycle-3',
    now: () => '2026-09-11T14:32:00.000Z',
  }), /MASTER_PAPER_BROKER_REQUIRED/);
});
