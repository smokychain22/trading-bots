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
  assert.equal(result.entryBlockingFactCount, 3);
  assert.equal(result.brokerFactImpactSummary.currentEconomicExposureCount, 2);
  assert.equal(result.brokerFactImpactSummary.unknownCurrentImpactCount, 1);
  assert.equal(result.localOnlyIntentCount, 1);
  assert.equal(result.marketOpen, true);
  assert.equal(result.calendarSessionConfirmed, true);
  assert.equal(result.dataQuality, 'GOOD');
  assert.equal(adapter.mutationCalls(), 0);
  assert.equal(store.persisted?.unmatchedFacts.every((fact) => fact.providerFactRefHash.length === 64), true);
  assert.equal(store.persisted?.unmatchedFacts.some((fact) => fact.factType === 'POSITION'), true);
  const unmatchedOrder = store.persisted?.unmatchedFacts.find((fact) => fact.factType === 'ORDER');
  assert.equal(unmatchedOrder?.detail.submittedAt, '2026-09-11T14:30:00Z');
  assert.equal(unmatchedOrder?.detail.filledAveragePrice, null);
  const unmatchedActivity = store.persisted?.unmatchedFacts.find((fact) => fact.factType === 'ACTIVITY');
  assert.equal(unmatchedActivity?.detail.date, '2026-09-11');
  assert.equal(unmatchedActivity?.detail.linkedOrderRefHash, null);
  assert.equal(JSON.stringify(store.persisted).includes('paper-account-owner'), false);
});

test('settled historical orders, fills, fees, and journals remain raw facts but do not block entry', async () => {
  const orders = [
    order({ id: 'historical-order-1', clientOrderId: 'historical-client-1', status: 'filled', filledQty: 1 }),
    order({ id: 'historical-order-2', clientOrderId: 'historical-client-2', status: 'filled', filledQty: 1 }),
  ];
  const activities: BrokerActivity[] = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `fill-${index}`, activityType: 'FILL', symbol: 'AAPL261016P00200000', quantity: 1,
      price: 1.25, date: `2026-09-${16 + index}T14:31:00Z`,
      orderId: index % 2 === 0 ? 'historical-order-1' : 'historical-order-2',
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `fee-${index}`, activityType: 'FEE', symbol: null, quantity: null,
      price: null, netAmount: -0.01, date: `2026-09-${16 + index}`, orderId: null,
    })),
    { id: 'journal-1', activityType: 'JNLC', symbol: null, quantity: null,
      price: null, netAmount: 10, date: '2026-09-18', orderId: null },
  ];
  let mutationCalls = 0;
  const value: PaperBrokerAdapter = {
    accountKind: 'MASTER_API_KEY', environment: 'PAPER',
    getAccount: async () => ({ id: 'paper-account-owner', status: 'ACTIVE' }),
    getPositions: async () => [], getOrders: async () => orders,
    getOrderByClientOrderId: async () => null, getOrder: async () => null,
    getActivities: async () => activities,
    getClock: async () => ({ timestamp: '2026-09-22T14:32:00Z', isOpen: true,
      nextOpen: '2026-09-23T13:30:00Z', nextClose: '2026-09-22T20:00:00Z' }),
    getCalendar: async () => [{ date: '2026-09-22', open: '09:30', close: '16:00' }],
    submitOrder: async () => { mutationCalls += 1; throw new Error('must not submit'); },
    replaceOrder: async () => { mutationCalls += 1; throw new Error('must not replace'); },
    cancelOrder: async () => { mutationCalls += 1; throw new Error('must not cancel'); },
  };
  const store = new CaptureStore();
  store.matchOrders = async (_hash, receivedOrders) => ({
    matched: [], unmatched: [...receivedOrders], missingLocalIntentIds: [],
  });
  const result = await runReadOnlyBrokerReconciliation({ broker: value, store,
    connectionId: 'connection-1', expectedProviderAccountRef: 'paper-account-owner',
    correlationId: 'historical-facts', now: () => '2026-09-22T14:32:00.000Z' });
  assert.equal(result.externalOrUnknownCount, 11);
  assert.equal(result.entryBlockingFactCount, 0);
  assert.equal(result.brokerFactImpactSummary.historicalAccountingOnlyCount, 11);
  assert.equal(store.persisted?.unmatchedFacts.length, 11);
  assert.equal(store.persisted?.factImpactSummary.results.length, 11);
  assert.equal(mutationCalls, 0);
});

test('an activity with no settlement semantics remains UNKNOWN and blocks entry', async () => {
  const adapter = broker();
  const withoutExposure = { ...adapter.value,
    getPositions: async () => [],
    getOrders: async () => [],
    getActivities: async () => [{ id: 'unknown-activity', activityType: 'MYSTERY', symbol: null,
      quantity: null, price: null, date: '2026-09-22', orderId: null }],
  };
  const result = await runReadOnlyBrokerReconciliation({ broker: withoutExposure,
    store: new CaptureStore(), connectionId: 'connection-1',
    expectedProviderAccountRef: 'paper-account-owner', correlationId: 'unknown-impact',
    now: () => '2026-09-22T14:32:00.000Z' });
  assert.equal(result.externalOrUnknownCount, 1);
  assert.equal(result.entryBlockingFactCount, 1);
  assert.equal(result.brokerFactImpactSummary.unknownCurrentImpactCount, 1);
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
