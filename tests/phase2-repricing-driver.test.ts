import assert from 'node:assert/strict';
import test from 'node:test';
import type { StockInventorySource } from '../src/execution/alpaca-stock-inventory-source.js';
import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from '../src/execution/broker.js';
import { AlpacaPaperBrokerError } from '../src/execution/broker.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';
import { expireStaleReadyOrderIntents, managementRepricePolicyVersion, PostgresManagementRepriceStore, repriceReasonClass,
  runManagementRepricing, type RepriceCandidate, type RepriceDependencies, type RepriceReason, type RepriceStore } from '../src/execution/management-order-repricing.js';
import { masterPaperActionPlanVersion, prepareMasterPaperAction, type ApprovedMasterPaperActionPlan } from '../src/execution/master-paper-action-handoff.js';
import { MasterPaperExecutionOrchestrator } from '../src/execution/master-paper-execution-orchestrator.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';
import { parseOccOptionSymbol } from '../src/theta/account-exposure.js';

const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-13T14:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

const stockPlan: ApprovedMasterPaperActionPlan = {
  contractVersion: masterPaperActionPlanVersion, actionPlanId: id(1), decisionAuthority: 'MANAGEMENT',
  managementInputSnapshotId: id(2), managementActionFrontierId: id(3), actionGroupId: id(1), legSequence: 1, dependsOnActionPlanId: null,
  executionAccountId: id(4), decisionId: id(5), candidateId: `management:${id(3)}:SELL_STOCK`, strategyVersion: 'theta-recovery-v1',
  chainId: id(6), optionContractId: null, underlyingId: id(7), underlying: 'AAPL', optionType: null, symbol: 'AAPL',
  quantity: 100, canonicalQuantity: 100, paperEvidenceQuantity: 100, paperEvidenceRiskCap: 100, paperEvidenceCapReason: 'CANONICAL_QUANTITY_LOWER',
  executionTier: 'PAPER_EVIDENCE', multiplier: 1, action: 'SELL_STOCK', economicBoundary: 190, economicsRemainPositive: true,
  expectedAfterCostEv: null, empiricalEconomicsReady: false, selectedByCanonicalAuthority: true, hardValidityPassed: true,
  accountVerified: true, optionsCapabilityVerified: true, noEquivalentExposureConflict: true, aegisState: 'ALLOW_FULL', killSwitchActive: false,
  decisionExpiresAt: at(30), pricingPolicy: { waitIntervalMs: 5000, maxAttempts: 3, concessionFractions: [0, 0.5, 1], tickSize: 0.01 },
  pricingAttempt: 0, previousLimit: null, committedShortCallContracts: 0, brokerConfirmedShares: 100, freeSellableShares: 100,
};

const stockQuote = (bid: number, ask: number, time: string): ExecutionOptionQuote => ({ contractVersion: executionOptionQuoteContractVersion,
  contractId: 'AAPL', providerContractId: 'AAPL', bid, ask, bidSize: 100, askSize: 100, providerTimestamp: time, receivedAtUtc: time,
  receivedAtMonotonic: 1, sequence: 1, provider: 'ALPACA', sourceSemantics: 'TRUSTED_TWO_SIDED_ORDER_PRICING', connectionState: 'CONNECTED',
  subscriptionState: 'ACTIVE', provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: true, feed: 'iex' } });

const optionQuote = (symbol: string, bid: number, ask: number, time: string): ExecutionOptionQuote => {
  const parsed = parseOccOptionSymbol(symbol);
  assert.ok(parsed);
  return { contractVersion: executionOptionQuoteContractVersion, contractId: symbol, providerContractId: symbol, bid, ask, bidSize: 10, askSize: 10,
    providerTimestamp: time, receivedAtUtc: time, receivedAtMonotonic: 1, sequence: 1, provider: 'ALPACA', sourceSemantics: 'CONSOLIDATED_NBBO',
    connectionState: 'CONNECTED', subscriptionState: 'ACTIVE',
    optionIdentity: { underlying: parsed.underlying, optionSymbol: symbol, expiration: parsed.expiration, strike: parsed.strike, optionType: parsed.optionType,
      multiplier: 100, contractTradable: true, exerciseStyle: 'american', deliverableClassification: 'STANDARD_EQUITY' },
    provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: true } };
};

/** A fake Alpaca Paper broker with hooks for fills, races and failures. No network. */
class FakeBroker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const; readonly environment = 'PAPER' as const;
  readonly orders = new Map<string, BrokerOrderSnapshot>();
  calls: string[] = [];
  failReplace: Error | null = null;
  onCancel: (() => void) | null = null;
  private sequence = 0;
  getAccount = async () => ({}); getPositions = async () => []; getOrders = async () => [...this.orders.values()]; getActivities = async () => [];
  getOrder = async (providerOrderId: string) => [...this.orders.values()].find((order) => order.id === providerOrderId) ?? null;
  getOrderByClientOrderId = async (clientOrderId: string) => this.orders.get(clientOrderId) ?? null;
  submitOrder = async (request: BrokerOrderRequest): Promise<BrokerOrderSnapshot> => {
    this.calls.push(`submit:${request.limit_price}`);
    const order: BrokerOrderSnapshot = { id: `broker-${++this.sequence}`, clientOrderId: request.client_order_id, symbol: request.symbol, qty: request.qty, filledQty: 0,
      filledAvgPrice: null, side: request.side, positionIntent: request.position_intent ?? null, status: 'accepted', limitPrice: Number(request.limit_price),
      submittedAt: T0, replacedBy: null, replaces: null };
    this.orders.set(request.client_order_id, order);
    return order;
  };
  replaceOrder = async (providerOrderId: string, replacement: Pick<BrokerOrderRequest, 'qty' | 'limit_price' | 'time_in_force' | 'client_order_id'>): Promise<BrokerOrderSnapshot> => {
    this.calls.push(`replace:${replacement.limit_price}`);
    if (this.failReplace !== null) throw this.failReplace;
    const old = [...this.orders.values()].find((order) => order.id === providerOrderId);
    if (old === undefined) throw new Error('unknown order');
    this.orders.set(old.clientOrderId, { ...old, status: 'replaced' });
    const next: BrokerOrderSnapshot = { ...old, id: `broker-${++this.sequence}`, clientOrderId: replacement.client_order_id, qty: replacement.qty,
      limitPrice: Number(replacement.limit_price), status: 'accepted', replaces: old.id };
    this.orders.set(replacement.client_order_id, next);
    return next;
  };
  cancelOrder = async (providerOrderId: string) => {
    this.calls.push('cancel');
    this.onCancel?.();
    const old = [...this.orders.values()].find((order) => order.id === providerOrderId);
    if (old !== undefined && !['filled', 'canceled'].includes(old.status)) this.orders.set(old.clientOrderId, { ...old, status: 'canceled' });
  };
  fill(clientOrderId: string, quantity?: number): void {
    const order = this.orders.get(clientOrderId);
    assert.ok(order);
    const filledQty = quantity ?? order.qty;
    this.orders.set(clientOrderId, { ...order, filledQty, filledAvgPrice: order.limitPrice, status: filledQty >= order.qty ? 'filled' : 'partially_filled' });
  }
}

const knownInventory = (shares = 100, committed: number | null = 0): StockInventorySource => ({ async readStockInventory() {
  return { inventory: { state: 'KNOWN', quantity: shares, observedAt: clock, reason: null }, committedShortCallContracts: committed }; } });

let clock = T0;

class MemoryStore implements RepriceStore {
  readonly events: { orderIntentId: string; attemptNo: number; at: string }[] = [];
  readonly closed: { actionPlanId: string; reason: RepriceReason }[] = [];
  integrity = true; current = true;
  constructor(private readonly intents: InMemoryPaperOrderStore, private readonly plan: ApprovedMasterPaperActionPlan) {}
  async loadCandidates(): Promise<readonly RepriceCandidate[]> {
    const all = [...this.intents.intents.values()].filter((intent) => intent.decisionId === this.plan.decisionId && intent.action === this.plan.action);
    const working = all.filter((intent) => ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL'].includes(intent.status));
    const times = [...all.map((intent) => Date.parse(intent.persistedAt)), ...this.events.map((event) => Date.parse(event.at))];
    return working.map((intent) => ({ orderIntentId: intent.orderIntentId, orderStatus: intent.status, limitPrice: Number(intent.request.limit_price),
      attemptsSoFar: Math.max(all.length, ...this.events.map((event) => event.attemptNo), 0), lastActionAt: new Date(Math.max(...times)).toISOString(),
      actionPlanId: this.plan.actionPlanId, plan: this.integrity ? this.plan : null, integrityMismatches: this.integrity ? [] : ['CONTENT_HASH'],
      decisionStillCurrent: this.current }));
  }
  async closePlan(actionPlanId: string, _orderIntentId: string, reason: RepriceReason): Promise<void> { this.closed.push({ actionPlanId, reason }); }
}

interface Harness {
  readonly broker: FakeBroker; readonly intents: InMemoryPaperOrderStore; readonly store: MemoryStore; readonly coordinator: PaperOrderCoordinator;
  quote: { bid: number; ask: number; at: string | null }; reconciliation: string; marketOpen: boolean; enabled: boolean;
  tick(seconds: number): Promise<ReturnType<typeof runManagementRepricing>>;
  restart(): Harness;
}

async function harness(plan: ApprovedMasterPaperActionPlan = stockPlan, quoteFor: (h: { bid: number; ask: number; at: string }) => ExecutionOptionQuote = (q) => stockQuote(q.bid, q.ask, q.at),
  initial = { bid: 190, ask: 190.1 }, shared?: { broker: FakeBroker; intents: InMemoryPaperOrderStore; store: MemoryStore; quote: Harness['quote'] }): Promise<Harness> {
  clock = T0;
  const broker = shared?.broker ?? new FakeBroker();
  const intents = shared?.intents ?? new InMemoryPaperOrderStore();
  const store = shared?.store ?? new MemoryStore(intents, plan);
  const coordinator = new PaperOrderCoordinator(broker, intents, { masterEnabled: true, followerEnabled: false, pauseNewOrders: false });
  const state: Harness = {
    broker, intents, store, coordinator, quote: shared?.quote ?? { bid: initial.bid, ask: initial.ask, at: T0 }, reconciliation: 'GOOD', marketOpen: true, enabled: true,
    async tick(seconds: number) {
      clock = at(seconds);
      if (state.quote.at !== null && state.quote.at !== 'STALE') state.quote.at = clock;
      const deps: RepriceDependencies = { now: () => clock, executionAccountId: plan.executionAccountId, reconciliationQuality: state.reconciliation,
        marketOpen: state.marketOpen, managementSubmissionEnabled: state.enabled, optionsCapabilityVerified: true, store, coordinator,
        quoteSource: { getCurrentQuote: async () => state.quote.at === null ? null : quoteFor({ bid: state.quote.bid, ask: state.quote.ask,
          at: state.quote.at === 'STALE' ? at(-600) : clock }) },
        stockInventory: knownInventory(), recordPriceEvent: async (event) => { store.events.push({ orderIntentId: event.orderIntentId, attemptNo: event.attemptNo ?? 0, at: event.eventTime }); } };
      return runManagementRepricing(deps);
    },
    restart: () => { throw new Error('replaced below'); },
  };
  (state as { restart: () => Harness }).restart = () => { const next = { ...state } as Harness; return next; };
  if (shared === undefined) {
    const prepared = await prepareMasterPaperAction(plan, { getCurrentQuote: async () => quoteFor({ bid: initial.bid, ask: initial.ask, at: T0 }) }, T0, true,
      undefined, () => T0, knownInventory());
    assert.equal(prepared.state, 'READY_TO_SUBMIT', JSON.stringify(prepared.blockers));
    assert.ok(prepared.command);
    await new MasterPaperExecutionOrchestrator(coordinator).execute(prepared.command);
  }
  return state;
}

const limits = (broker: FakeBroker) => broker.calls.filter((call) => call.startsWith('submit') || call.startsWith('replace')).map((call) => call.split(':')[1]);
const onlyOutcome = async (h: Harness, seconds: number) => ((await h.tick(seconds)).outcomes[0]);

test('attempt 0 -> 1 -> 2 -> maximum: bounded concessions to the floor, then cancel and close the plan (REQUIRES_NEW_DECISION)', async () => {
  const h = await harness();
  assert.deepEqual(limits(h.broker), ['190.10'], 'attempt 0 (the first placement) is the favourable ask');
  assert.equal((await onlyOutcome(h, 4))?.kind, 'LEFT_WORKING', 'inside the wait interval nothing happens');
  const first = await onlyOutcome(h, 6);
  assert.equal(first?.kind, 'REPLACED'); assert.equal(first?.kind === 'REPLACED' && first.attemptNo, 2); assert.equal(first?.kind === 'REPLACED' && first.limitPrice, 190.05);
  const second = await onlyOutcome(h, 12);
  assert.equal(second?.kind, 'REPLACED'); assert.equal(second?.kind === 'REPLACED' && second.attemptNo, 3); assert.equal(second?.kind === 'REPLACED' && second.limitPrice, 190);
  assert.deepEqual(limits(h.broker), ['190.10', '190.05', '190.00']);
  assert.ok(limits(h.broker).every((limit) => Number(limit) >= 190), 'never below the sealed floor');
  const last = await onlyOutcome(h, 18);
  assert.deepEqual([last?.kind, last?.kind === 'CANCELED' && last.reason], ['CANCELED', 'MAX_ATTEMPTS_REACHED']);
  assert.equal(repriceReasonClass.MAX_ATTEMPTS_REACHED, 'REQUIRES_NEW_DECISION');
  assert.deepEqual(h.store.closed, [{ actionPlanId: stockPlan.actionPlanId, reason: 'MAX_ATTEMPTS_REACHED' }]);
  assert.equal(h.broker.calls.filter((call) => call === 'cancel').length, 1);
  assert.equal((await h.tick(24)).examined, 0, 'a cancelled order has no further candidate: the plan cannot be resurrected');
});

test('duplicate trigger: the persisted last-action time makes a second tick in the same interval a no-op', async () => {
  const h = await harness();
  assert.equal((await onlyOutcome(h, 6))?.kind, 'REPLACED');
  const again = await onlyOutcome(h, 6);
  assert.deepEqual([again?.kind, again?.kind === 'LEFT_WORKING' && again.reason], ['LEFT_WORKING', 'NOT_DUE_WAIT_INTERVAL']);
  assert.equal(limits(h.broker).length, 2, 'exactly one replacement');
});

test('restart: the attempt number is rebuilt from persisted rows and never resets to 0', async () => {
  const h = await harness();
  await h.tick(6);
  const rebuilt = await harness(stockPlan, undefined, undefined, { broker: h.broker, intents: h.intents, store: h.store, quote: h.quote });
  const outcome = await onlyOutcome(rebuilt, 12);
  assert.equal(outcome?.kind === 'REPLACED' && outcome.attemptNo, 3, 'continues at attempt 3, not 1');
  assert.deepEqual(limits(h.broker), ['190.10', '190.05', '190.00']);
});

test('late fill: reconciliation sees FILLED first, so no replacement and no cancel are sent', async () => {
  const h = await harness();
  const first = [...h.broker.orders.keys()][0] as string;
  h.broker.fill(first);
  const outcome = await onlyOutcome(h, 6);
  assert.deepEqual([outcome?.kind, outcome?.kind === 'LEFT_WORKING' && outcome.reason], ['LEFT_WORKING', 'ORDER_ALREADY_TERMINAL']);
  assert.deepEqual(h.broker.calls, ['submit:190.10']);
  assert.equal(h.store.closed.length, 0);
});

test('partial fill: a part-filled order is NEVER replaced or cancelled by the driver (its fills stay on the original intent); it rests as a DAY order', async () => {
  const h = await harness();
  const first = [...h.broker.orders.keys()][0] as string;
  h.broker.fill(first, 40);
  for (const seconds of [6, 12, 18, 24]) {
    const outcome = await onlyOutcome(h, seconds);
    assert.deepEqual([outcome?.kind, outcome?.kind === 'LEFT_WORKING' && outcome.reason], ['LEFT_WORKING', 'PARTIAL_FILL_ORDER_LEFT_WORKING']);
  }
  assert.deepEqual(h.broker.calls, ['submit:190.10'], 'no replace, no cancel: the original broker order keeps all executions');
  assert.equal([...h.intents.intents.values()].length, 1);
  assert.equal(h.store.closed.length, 0);
  assert.equal(repriceReasonClass.PARTIAL_FILL_ORDER_LEFT_WORKING, 'OWNER_POLICY');
  // the floor becoming unreachable changes nothing for a part-filled order either
  const low = await harness();
  low.broker.fill([...low.broker.orders.keys()][0] as string, 10);
  low.quote.bid = 188; low.quote.ask = 188.1;
  const rested = await onlyOutcome(low, 6);
  assert.deepEqual([rested?.kind, rested?.kind === 'LEFT_WORKING' && rested.reason], ['LEFT_WORKING', 'PARTIAL_FILL_ORDER_LEFT_WORKING']);
  assert.equal(low.broker.calls.includes('cancel'), false);
  // an integrity failure still stops trading on the plan, even for a part-filled order
  const tampered = await harness(); tampered.store.integrity = false;
  tampered.broker.fill([...tampered.broker.orders.keys()][0] as string, 10);
  assert.equal((await onlyOutcome(tampered, 6))?.kind, 'CANCELED');
});

test('cancel race: a fill that lands during cancellation is a late fill, the plan is not closed', async () => {
  const h = await harness();
  h.quote.bid = 188; h.quote.ask = 188.1; // floor unreachable -> cancel
  h.broker.onCancel = () => h.broker.fill([...h.broker.orders.keys()][0] as string);
  const outcome = await onlyOutcome(h, 6);
  assert.deepEqual([outcome?.kind, outcome?.kind === 'LEFT_WORKING' && outcome.reason], ['LEFT_WORKING', 'LATE_FILL_DURING_CANCEL']);
  assert.equal(h.store.closed.length, 0);
});

test('replace race / broker failure: a failed replacement never duplicates exposure and never counts as a fill', async () => {
  const h = await harness();
  h.broker.failReplace = new AlpacaPaperBrokerError('BROKER_REJECTED', 422, 'rejected');
  const outcome = await onlyOutcome(h, 6);
  assert.equal(outcome?.kind, 'BLOCKED');
  const working = [...h.intents.intents.values()].filter((intent) => ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL'].includes(intent.status));
  assert.equal(working.length, 1, 'the original order is still the only working order');
  h.broker.failReplace = null;
  const retry = await onlyOutcome(h, 20);
  assert.equal(retry?.kind, 'REPLACED', 'a later pass advances; the rejected replacement still counted as an attempt');
  assert.equal(retry?.kind === 'REPLACED' && retry.attemptNo, 3);
  // an ambiguous network failure is reconciled by client order id, never retried blind
  const ambiguous = await harness();
  ambiguous.broker.failReplace = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, 'timeout');
  const timedOut = await onlyOutcome(ambiguous, 6);
  assert.ok(timedOut !== undefined);
  assert.equal(ambiguous.broker.calls.filter((call) => call.startsWith('replace')).length, 1, 'exactly one replace attempt on a timeout');
});

test('quote movement: floor reached exactly is placeable; one tick below the floor cancels and closes the plan; multiple scans below never loop', async () => {
  const touch = await harness();
  touch.quote.bid = 189.9; touch.quote.ask = 190;
  const placed = await onlyOutcome(touch, 6);
  assert.equal(placed?.kind === 'REPLACED' && placed.limitPrice, 190, 'ask exactly at the floor: still placeable at the floor');
  const below = await harness();
  below.quote.bid = 189.9; below.quote.ask = 189.99;
  const cancelled = await onlyOutcome(below, 6);
  assert.deepEqual([cancelled?.kind, cancelled?.kind === 'CANCELED' && cancelled.reason], ['CANCELED', 'ECONOMIC_BOUNDARY_UNREACHABLE']);
  assert.equal(below.store.closed.length, 1);
  for (const seconds of [12, 18, 24]) assert.equal((await below.tick(seconds)).examined, 0, 'no repeated identical plan after the cancel');
  assert.equal(below.broker.calls.filter((call) => call === 'cancel').length, 1);
});

test('bounded concession never crosses the floor, the BBO, or goes up for a sell, across a quote path', async () => {
  const h = await harness(stockPlan, undefined, { bid: 190.2, ask: 190.4 });
  const path = [[190.2, 190.4], [190.1, 190.3], [190.0, 190.2]] as const;
  let seconds = 0;
  for (const [bid, ask] of path) {
    seconds += 6; h.quote.bid = bid; h.quote.ask = ask;
    const outcome = await onlyOutcome(h, seconds);
    if (outcome?.kind === 'REPLACED') assert.ok(outcome.limitPrice >= Math.max(190, bid) - 1e-9 && outcome.limitPrice <= ask + 1e-9);
  }
  assert.ok(limits(h.broker).every((limit) => Number(limit) >= 190));
});

test('KEEP: a concession that rounds to the same limit consumes the attempt (persisted as evidence) so the sequence still terminates', async () => {
  const h = await harness(stockPlan, undefined, { bid: 190, ask: 190.01 });
  assert.deepEqual(limits(h.broker), ['190.01']);
  const kept = await onlyOutcome(h, 6);
  assert.equal(kept?.kind, 'KEPT', JSON.stringify(kept)); assert.equal(kept?.kind === 'KEPT' && kept.attemptNo, 2);
  assert.equal(h.broker.calls.filter((call) => call.startsWith('replace')).length, 0, 'no pointless broker replace');
  const next = await onlyOutcome(h, 12);
  assert.equal(next?.kind, 'REPLACED'); assert.equal(next?.kind === 'REPLACED' && next.attemptNo, 3);
  assert.equal(next?.kind === 'REPLACED' && next.limitPrice, 190);
  const end = await onlyOutcome(h, 18);
  assert.equal(end?.kind, 'CANCELED');
});

test('gates: stale/absent quote, non-GOOD reconciliation, disabled management, closed market and unknown broker state never mutate', async () => {
  const run = async (mutate: (h: Harness) => void, reason: RepriceReason) => {
    const h = await harness(); mutate(h);
    const outcome = await onlyOutcome(h, 6);
    assert.deepEqual([outcome?.kind, outcome?.kind === 'BLOCKED' && outcome.reason], ['BLOCKED', reason]);
    assert.deepEqual(h.broker.calls, ['submit:190.10'], reason);
    assert.equal(h.store.closed.length, 0, reason);
  };
  await run((h) => { h.quote.at = 'STALE'; }, 'QUOTE_UNAVAILABLE');
  await run((h) => { h.quote.at = null; }, 'QUOTE_UNAVAILABLE');
  await run((h) => { h.reconciliation = 'DEGRADED'; }, 'RECONCILIATION_NOT_GOOD');
  await run((h) => { h.enabled = false; }, 'MANAGEMENT_SUBMISSION_NOT_AUTHORIZED');
  await run((h) => { h.marketOpen = false; }, 'MARKET_CLOSED');
  const missing = await harness(); missing.broker.orders.clear();
  const outcome = await onlyOutcome(missing, 6);
  assert.deepEqual([outcome?.kind, outcome?.kind === 'BLOCKED' && outcome.reason], ['BLOCKED', 'BROKER_ORDER_NOT_FOUND']);
  assert.equal(repriceReasonClass.BROKER_ORDER_NOT_FOUND, 'REQUIRES_RECONCILIATION');
});

test('plan integrity failure or a superseded decision cancels the working order and closes the plan with a typed reason', async () => {
  const tampered = await harness(); tampered.store.integrity = false;
  const first = await onlyOutcome(tampered, 6);
  assert.deepEqual([first?.kind, first?.kind === 'CANCELED' && first.reason], ['CANCELED', 'PLAN_INTEGRITY_MISMATCH']);
  assert.equal(tampered.broker.calls.includes('cancel'), true);
  const superseded = await harness(); superseded.store.current = false;
  const second = await onlyOutcome(superseded, 6);
  assert.deepEqual([second?.kind, second?.kind === 'CANCELED' && second.reason], ['CANCELED', 'PLAN_NO_LONGER_CURRENT']);
});

test('stock exit re-checks the broker inventory at every step: a share mismatch blocks the replacement', async () => {
  const h = await harness();
  const mismatch = { ...h, quote: h.quote };
  void mismatch;
  clock = at(6); h.quote.at = clock;
  const report = await runManagementRepricing({ now: () => clock, executionAccountId: stockPlan.executionAccountId, reconciliationQuality: 'GOOD', marketOpen: true,
    managementSubmissionEnabled: true, optionsCapabilityVerified: true, store: h.store, coordinator: h.coordinator,
    quoteSource: { getCurrentQuote: async () => stockQuote(190, 190.1, clock) }, stockInventory: knownInventory(99) });
  assert.equal(report.outcomes[0]?.kind, 'BLOCKED');
  assert.equal(report.outcomes[0]?.kind === 'BLOCKED' && report.outcomes[0].reason, 'PRE_SUBMIT_GATE_BLOCKED');
  assert.equal(h.broker.calls.some((call) => call.startsWith('replace')), false);
});

test('BUY side: a buy-to-close concedes up toward the ceiling and never above it', async () => {
  const symbol = 'AAPL261016P00200000';
  const closePlan: ApprovedMasterPaperActionPlan = { ...stockPlan, actionPlanId: id(21), actionGroupId: id(21), decisionId: id(25), action: 'CLOSE_CSP', symbol,
    optionContractId: id(26), optionType: 'PUT', multiplier: 100, quantity: 1, canonicalQuantity: 1, paperEvidenceQuantity: 1, paperEvidenceRiskCap: 1,
    economicBoundary: 0.2, candidateId: `management:${id(3)}:CLOSE_FULL`, committedShortCallContracts: undefined, brokerConfirmedShares: undefined, freeSellableShares: undefined };
  const h = await harness(closePlan, (q) => optionQuote(symbol, q.bid, q.ask, q.at), { bid: 0.15, ask: 0.2 });
  assert.deepEqual(limits(h.broker), ['0.15']);
  const one = await onlyOutcome(h, 6);
  assert.equal(one?.kind === 'REPLACED' && one.limitPrice, 0.17);
  const two = await onlyOutcome(h, 12);
  assert.equal(two?.kind === 'REPLACED' && two.limitPrice, 0.2);
  assert.ok(limits(h.broker).every((limit) => Number(limit) <= 0.2 + 1e-9));
  const done = await onlyOutcome(h, 18);
  assert.equal(done?.kind, 'CANCELED');
});

test('every reprice reason has exactly one recovery class and every cancel reason requires a new decision', () => {
  const classes = new Set(['TRANSIENT_RETRYABLE', 'REQUIRES_NEW_DECISION', 'REQUIRES_RECONCILIATION', 'OWNER_POLICY', 'TERMINAL']);
  for (const [reason, klass] of Object.entries(repriceReasonClass)) assert.ok(classes.has(klass), reason);
  for (const reason of ['MAX_ATTEMPTS_REACHED', 'ECONOMIC_BOUNDARY_UNREACHABLE', 'ECONOMICS_DISAPPEARED', 'PLAN_INTEGRITY_MISMATCH', 'PLAN_NO_LONGER_CURRENT'] as const) {
    assert.equal(repriceReasonClass[reason], 'REQUIRES_NEW_DECISION');
  }
  assert.equal(managementRepricePolicyVersion, 'theta-management-reprice-v1');
});

test('PostgresManagementRepriceStore and the stale-READY sweep issue well-formed SQL and map rows', async () => {
  const queries: { sql: string; values: unknown[] }[] = [];
  const row = { order_intent_id: id(40), decision_id: id(5), chain_id: id(6), theta_action: 'SELL_STOCK', status: 'ACKNOWLEDGED', limit_price: 190.1, plan_row_id: id(1),
    chain_closed_at: null, chain_state: 'RECOVERY_WAIT', plan_state: 'RECOVERY_WAIT', ip_action_plan_id: id(1), ip_decision_id: id(5), ip_execution_account_id: id(4) };
  const pool = { query: async (sql: string, values: unknown[]) => {
    queries.push({ sql, values });
    if (sql.includes('FROM trade.order_intent oi') && sql.includes('JOIN trade.master_paper_action_plan')) return { rows: [row], rowCount: 1 };
    if (sql.includes('count(DISTINCT')) return { rows: [{ intents: 2, max_attempt_no: 3, last_action_at: new Date(T0) }], rowCount: 1 };
    if (sql.startsWith('UPDATE trade.order_intent')) return { rows: [{ order_intent_id: id(41) }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  } };
  const candidates = await new PostgresManagementRepriceStore(pool as never).loadCandidates(id(4));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.attemptsSoFar, 3, 'max(intents, highest recorded attempt number)');
  assert.equal(candidates[0]?.lastActionAt, T0);
  assert.equal(candidates[0]?.plan, null, 'a row that fails integrity verification yields no plan');
  assert.equal(candidates[0]?.decisionStillCurrent, true);
  assert.equal(await expireStaleReadyOrderIntents(pool as never, id(4), T0), 1);
  const sweep = queries.find((q) => q.sql.startsWith('UPDATE trade.order_intent'));
  assert.match(sweep?.sql ?? '', /status::text='READY'/);
  assert.match(sweep?.sql ?? '', /NOT EXISTS \(SELECT 1 FROM trade\.broker_order/);
});

test('P2-08 lineage: DECISION -> PLAN -> ORDER_INTENT -> CLIENT_ORDER_ID are deterministic, and a replay creates no second broker order', async () => {
  const h = await harness();
  const inventory = knownInventory();
  const source = { getCurrentQuote: async () => stockQuote(190, 190.1, T0) };
  const first = await prepareMasterPaperAction(stockPlan, source, T0, true, undefined, () => T0, inventory);
  const second = await prepareMasterPaperAction(stockPlan, source, T0, true, undefined, () => T0, inventory);
  assert.ok(first.command && second.command);
  assert.equal(first.command.orderIntentId, second.command.orderIntentId);
  assert.equal(first.command.request.client_order_id, second.command.request.client_order_id);
  assert.equal(first.command.decisionId, stockPlan.decisionId);
  assert.equal(first.command.chainId, stockPlan.chainId);
  assert.equal(first.command.action, stockPlan.action);
  assert.equal(first.command.underlyingId, stockPlan.underlyingId);
  // replaying the identical command executes nothing new
  await new MasterPaperExecutionOrchestrator(h.coordinator).execute(second.command);
  assert.equal(h.broker.calls.filter((call) => call.startsWith('submit')).length, 1);
  assert.equal([...h.intents.intents.values()].length, 1);
  // a different decision (or a later pricing attempt) is a different order identity, never an alias of the first
  const otherDecision = await prepareMasterPaperAction({ ...stockPlan, decisionId: id(99), actionPlanId: id(98), actionGroupId: id(98) }, source, T0, true, undefined, () => T0, inventory);
  assert.notEqual(otherDecision.command?.orderIntentId, first.command.orderIntentId);
  assert.notEqual(otherDecision.command?.request.client_order_id, first.command.request.client_order_id);
  const laterAttempt = await prepareMasterPaperAction({ ...stockPlan, pricingAttempt: 1, previousLimit: 190.1 }, source, T0, true, undefined, () => T0, inventory);
  assert.notEqual(laterAttempt.command?.orderIntentId, first.command.orderIntentId);
  assert.notEqual(laterAttempt.command?.request.client_order_id, first.command.request.client_order_id);
  // a replacement stays inside the lineage of the original (same decision, action and chain) - the coordinator rejects anything else
  await h.tick(6);
  const intents = [...h.intents.intents.values()];
  assert.equal(intents.length, 2);
  assert.ok(intents.every((intent) => intent.decisionId === stockPlan.decisionId && intent.chainId === stockPlan.chainId && intent.action === 'SELL_STOCK'));
  await assert.rejects(h.coordinator.replace((intents[1] as { orderIntentId: string }).orderIntentId, { ...(second.command as object), orderIntentId: id(97), decisionId: id(96) } as never, second.command.gate), /REPLACEMENT_LINEAGE_MISMATCH/);
});
