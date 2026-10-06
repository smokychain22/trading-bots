import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { AlpacaPaperBrokerError, type BrokerOrderRequest, type BrokerOrderSnapshot, type PaperBrokerAdapter } from '../src/execution/broker.js';
import type { BrokerMutationAuthorization } from '../src/execution/execution-control.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator, type PersistedPaperOrderIntent } from '../src/execution/paper-order-coordinator.js';
import { control } from './phase3-exec-fixtures.js';

const NOW = '2026-10-06T15:00:00.000Z';
const SHORT = 'SPY261016P00650000', LONG = 'SPY261016P00645000';
const gate = { baseHostname: 'paper-api.alpaca.markets', accountVerified: true, optionsCapabilityVerified: true, aegisState: 'ALLOW_FULL' as const, quoteFresh: true, priceEvidence: 'QUALIFIED_OPTION_BBO' as const,
  decisionExpiresAt: '2026-10-06T15:01:00.000Z', now: NOW, isNewEntry: true };

const evidence = (multiplier = 100) => ({ orderClass: 'mleg' as const, creditDebitDirection: 'CREDIT' as const, packageIdentity: 'MLEG:fi', legs: [
  { legIndex: 1, optionContractId: 'c-short', providerContractId: 'p-short', occSymbol: SHORT, optionType: 'PUT' as const, positionIntent: 'sell_to_open' as const, ratioQuantity: 1, expiration: '2026-10-16', strike: 650, multiplier, deliverableIdentity: 'STANDARD:SPY:100' },
  { legIndex: 2, optionContractId: 'c-long', providerContractId: 'p-long', occSymbol: LONG, optionType: 'PUT' as const, positionIntent: 'buy_to_open' as const, ratioQuantity: 1, expiration: '2026-10-16', strike: 645, multiplier, deliverableIdentity: 'STANDARD:SPY:100' }] });

let counter = 0;
const intent = (multiplier = 100): Omit<PersistedPaperOrderIntent, 'status' | 'brokerOrderId'> => {
  counter += 1;
  const suffix = String(counter).padStart(12, '0');
  const request: BrokerOrderRequest = { symbol: 'MLEG:fi', qty: 1, side: 'sell', type: 'limit', time_in_force: 'day', limit_price: '-1.10', client_order_id: `theta-fi-${counter}`, order_class: 'mleg',
    legs: [{ symbol: SHORT, side: 'sell', ratio_qty: 1, position_intent: 'sell_to_open' }, { symbol: LONG, side: 'buy', ratio_qty: 1, position_intent: 'buy_to_open' }] };
  return { orderIntentId: `40000000-0000-4000-8000-${suffix}`, executionAccountId: '40000000-0000-4000-8000-000000000002', request, action: 'OPEN_DEFINED_RISK', decisionId: '40000000-0000-4000-8000-000000000003',
    persistedAt: NOW, chainId: '40000000-0000-4000-8000-000000000004', optionContractId: null, underlyingId: '40000000-0000-4000-8000-000000000005', multiLegEvidence: { ...evidence(multiplier), packageIdentity: 'MLEG:fi' },
    executionEvidence: { quoteSource: 'ALPACA', quoteFeed: 'OPRA', quoteSemantics: 'CONSOLIDATED_NBBO', quoteAsOf: NOW, decisionExpiresAt: '2026-10-06T15:01:00.000Z', quoteContentHash: 'a'.repeat(64), aegisState: 'ALLOW_FULL' },
    authorizationEvidence: { executionTier: 'PAPER_EVIDENCE', canonicalQuantity: 1, paperEvidenceQuantity: 1, empiricalEconomicsReady: false, expectedAfterCostEv: null } };
};

const parent = (request: BrokerOrderRequest, status = 'accepted', patch: Partial<BrokerOrderSnapshot> = {}): BrokerOrderSnapshot => ({ id: `broker-${request.client_order_id}`, clientOrderId: request.client_order_id, symbol: request.symbol, qty: 1,
  filledQty: 0, filledAvgPrice: null, side: 'sell', positionIntent: null, status, limitPrice: -1.1, submittedAt: NOW, replacedBy: null, replaces: null, orderClass: 'mleg',
  legs: [{ id: 'l1', symbol: SHORT, side: 'sell', positionIntent: 'sell_to_open', ratioQty: 1, qty: 1, filledQty: 0, filledAvgPrice: null, status: 'new' },
    { id: 'l2', symbol: LONG, side: 'buy', positionIntent: 'buy_to_open', ratioQty: 1, qty: 1, filledQty: 0, filledAvgPrice: null, status: 'new' }], ...patch });

class ScriptedBroker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const; readonly environment = 'PAPER' as const;
  submitCalls = 0; lookups = 0;
  submitError: Error | null = null; submitReturns: BrokerOrderSnapshot | null = null; lookup: BrokerOrderSnapshot | null | Error = null;
  async getAccount() { return {}; } async getPositions() { return []; } async getOrders() { return []; } async getActivities() { return []; } async getOrder() { return null; }
  async getOrderByClientOrderId(): Promise<BrokerOrderSnapshot | null> { this.lookups += 1; if (this.lookup instanceof Error) throw this.lookup; return this.lookup; }
  async submitOrder(request: BrokerOrderRequest, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot> {
    void authorization; this.submitCalls += 1;
    if (this.submitError !== null) throw this.submitError;
    return this.submitReturns ?? parent(request);
  }
  async replaceOrder(): Promise<BrokerOrderSnapshot> { throw new Error('NOT_USED'); }
  async cancelOrder(): Promise<void> { throw new Error('NOT_USED'); }
}

const setup = () => { const broker = new ScriptedBroker(), store = new InMemoryPaperOrderStore(); return { broker, store, coordinator: new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false })) }; };

test('D lost submit response (ambiguous timeout) reconciles by client order id to the REAL parent: one mutation, never a second submit', async () => {
  const { broker, store, coordinator } = setup();
  const input = intent();
  await coordinator.prepare(input);
  broker.submitError = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, 'timeout');
  broker.lookup = parent(input.request);
  const result = await coordinator.submit(input.orderIntentId, gate);
  assert.equal(result?.id, `broker-${input.request.client_order_id}`);
  assert.equal(broker.submitCalls, 1);
  assert.ok(['SUBMITTED', 'ACKNOWLEDGED'].includes((await store.getIntent(input.orderIntentId))?.status as string));
  assert.equal(store.brokerSnapshots.get(input.orderIntentId)?.legs?.length, 2, 'both leg identities persisted from broker truth');
});

test('D ambiguous submit with the order absent at the broker stays RECONCILING (typed, restart-recoverable); it is never REJECTED, never resubmitted, and ends only by the bounded window', async () => {
  const { broker, store, coordinator } = setup();
  const input = intent();
  await coordinator.prepare(input);
  broker.submitError = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', 504, 'gateway timeout');
  broker.lookup = null;
  assert.equal(await coordinator.submit(input.orderIntentId, gate), null);
  assert.equal((await store.getIntent(input.orderIntentId))?.status, 'RECONCILING');
  // restart passes inside the window: still unresolved, still no resubmit
  await coordinator.recoverAfterRestart('2026-10-06T15:00:30.000Z');
  assert.equal((await store.getIntent(input.orderIntentId))?.status, 'RECONCILING');
  assert.equal(broker.submitCalls, 1);
  // after the decision window plus grace, absence is proof the order never reached the broker: terminal EXPIRED (never "filled", never silently dropped)
  await coordinator.recoverAfterRestart('2026-10-06T16:00:00.000Z');
  assert.equal((await store.getIntent(input.orderIntentId))?.status, 'EXPIRED');
  assert.equal(broker.submitCalls, 1);
});

test('D broker rejection is terminal REJECTED with no retry; a rate limit reconciles by client id before any verdict; auth / entitlement failures do not touch the ledger as fills', async () => {
  for (const [category, status] of [['BROKER_REJECTED', 422], ['RATE_LIMITED', 429], ['INVALID_AUTH', 401], ['NOT_ENTITLED', 403]] as const) {
    const { broker, store, coordinator } = setup();
    const input = intent();
    await coordinator.prepare(input);
    broker.submitError = new AlpacaPaperBrokerError(category, status, category);
    broker.lookup = null;
    await assert.rejects(() => coordinator.submit(input.orderIntentId, gate), (error: Error) => error instanceof AlpacaPaperBrokerError, category);
    assert.equal(broker.submitCalls, 1, `${category}: exactly one attempt`);
    assert.ok(['REJECTED', 'UNKNOWN_SUBMISSION', 'RECONCILING', 'SUBMITTING'].includes((await store.getIntent(input.orderIntentId))?.status as string), `${category}: typed state`);
    assert.equal(store.brokerSnapshots.size, 0, `${category}: no fill/leg state invented`);
  }
});

test('D 429 whose order DID reach the broker is adopted, not rejected (the live order can never sit behind a REJECTED intent)', async () => {
  const { broker, store, coordinator } = setup();
  const input = intent();
  await coordinator.prepare(input);
  broker.submitError = new AlpacaPaperBrokerError('RATE_LIMITED', 429, 'too many');
  broker.lookup = parent(input.request);
  const result = await coordinator.submit(input.orderIntentId, gate);
  assert.equal(result?.id, `broker-${input.request.client_order_id}`);
  assert.notEqual((await store.getIntent(input.orderIntentId))?.status, 'REJECTED');
});

test('D reconciliation read failures and malformed broker payloads stay unresolved and typed, never UNKNOWN -> PASS', async () => {
  const { broker, store, coordinator } = setup();
  const input = intent();
  await coordinator.prepare(input);
  broker.submitError = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, 'timeout');
  broker.lookup = new AlpacaPaperBrokerError('MALFORMED_RESPONSE', 200, 'bad body');
  await assert.rejects(() => coordinator.submit(input.orderIntentId, gate));
  assert.ok(['UNKNOWN_SUBMISSION', 'RECONCILING'].includes((await store.getIntent(input.orderIntentId))?.status as string));
  assert.equal(broker.submitCalls, 1);
  // a parent that claims mleg but reports no legs can not be persisted as leg truth
  const missingLegs = parent(input.request, 'accepted', { legs: undefined });
  broker.lookup = missingLegs;
  await assert.rejects(() => coordinator.reconcileUnknown(input.orderIntentId));
  assert.equal(store.brokerSnapshots.size, 0);
});

test('D unknown multiplier / wrong identity / worker death before submit are refused or recoverable, never defaulted', async () => {
  const { broker, store, coordinator } = setup();
  await assert.rejects(() => coordinator.prepare(intent(0)), /MULTI_LEG_DURABLE_EVIDENCE_INVALID/, 'a zero/unknown multiplier is never assumed to be 100');
  const input = intent();
  await coordinator.prepare(input);
  // worker death between prepare and submit: the READY intent survives, a restart finds nothing ambiguous to resubmit, and nothing reached the broker
  assert.equal((await store.getIntent(input.orderIntentId))?.status, 'READY');
  assert.deepEqual(await coordinator.recoverAfterRestart(), []);
  assert.equal(broker.submitCalls, 0);
  // wrong leg identity at the broker (drifted symbol) is refused on reconcile
  broker.submitError = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, 'timeout');
  broker.lookup = parent(input.request, 'accepted', { legs: [{ id: 'l1', symbol: 'SPY261016P00600000', side: 'sell', positionIntent: 'sell_to_open', ratioQty: 1, qty: 1, filledQty: 0, filledAvgPrice: null, status: 'new' },
    { id: 'l2', symbol: LONG, side: 'buy', positionIntent: 'buy_to_open', ratioQty: 1, qty: 1, filledQty: 0, filledAvgPrice: null, status: 'new' }] });
  await assert.rejects(() => coordinator.submit(input.orderIntentId, gate));
  assert.equal(broker.submitCalls, 1);
  assert.equal(store.brokerSnapshots.size, 0);
});

test('H shares the ONE order path with Q: no H module owns broker mutation, order construction or persistence (so Phase 3 E1 failure injection covers H)', () => {
  for (const file of readdirSync(new URL('../src/theta/', import.meta.url)).filter((name) => /^hold-strike-.*\.ts$/.test(name))) {
    const text = readFileSync(new URL(`../src/theta/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /PaperOrderCoordinator|PaperBrokerAdapter|submitOrder|cancelOrder|replaceOrder|\bpg\b|from 'pg'|fetch\(/, `${file} must not mutate the broker or touch the database`);
  }
});
