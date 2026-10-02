import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assembleManagementPaperPlans, compileManagementExecutionLegDirectives,
  type ManagementPaperPlanAssemblyInput } from '../src/execution/management-paper-plan-assembly.js';
import type { StockInventorySource } from '../src/execution/alpaca-stock-inventory-source.js';
import { readCommittedShortCallContracts, readManagementChainInFlight } from '../src/execution/management-chain-inflight.js';
import { prepareMasterPaperAction, type ApprovedMasterPaperActionPlan,
  type MasterPaperActionPreparationResult } from '../src/execution/master-paper-action-handoff.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';
import { buildAlpacaLimitOrder } from '../src/execution/order-construction.js';
import { paperBootstrapManagementPolicyStatus } from '../src/customer/management-policy-status.js';
import { deriveCommittedShortCallContracts, parseOccOptionSymbol } from '../src/theta/account-exposure.js';
import { evaluateCoveredCallCandidates, nondominatedCoveredCallCandidates, type CoveredCallCandidate,
  type CoveredCallUtilityWeights } from '../src/theta/covered-call-lattice.js';
import { buildManagementActionFrontier, type ManagementActionFrontier } from '../src/theta/management-action-frontier.js';
import { assembleManagementInput, PostgresManagementInputStore, type ManagementInputState, type ManagementStockQuoteRead,
  type ManagementStockQuoteReadOutcome } from '../src/theta/management-input-state.js';
import { evaluatePaperBootstrapManagementPolicy, paperBootstrapManagementPolicyVersion,
  type PaperBootstrapPolicyInput, type RollCandidate } from '../src/theta/paper-bootstrap-management-policy.js';
import { THETA_LIFECYCLE_TRANSITIONS } from '../src/theta/runtime-state.js';

// Phase 2 fix pass: D1 close evidence, D2 boundary units, D3 cross-cycle duplicates, D6 zero bid, D7 status truth, HDAC-05 account-net
// covered-call coverage, P2-CHAIN-04 dominance tolerance, STOCK_HELD action edge. Offline and deterministic. prepareMasterPaperAction is
// the broker-free half of the handoff (it has no coordinator and no POST-capable object), so nothing here can mutate a broker.

const T0 = '2026-09-12T14:00:00.000Z';
const T_NEAR = '2026-10-13T14:00:00.000Z';
const EXPIRES = '2026-10-13T14:00:45.000Z';
const UUID = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Opts {
  readonly lifecycle?: 'CSP_OPEN' | 'CC_OPEN' | 'RECOVERY_WAIT'; readonly bid?: number | null; readonly ask?: number | null;
  readonly observedAt?: string; readonly quoteAsOf?: string; readonly shares?: string; readonly contracts?: string;
  readonly chain?: number; readonly mark?: number; readonly brokerShares?: string; readonly stockRead?: ManagementStockQuoteReadOutcome | null;
}

function managed(o: Opts = {}): ManagementInputState {
  const lifecycle = o.lifecycle ?? 'CSP_OPEN';
  const observedAt = o.observedAt ?? T0;
  const hasOption = lifecycle !== 'RECOVERY_WAIT';
  const optionType = lifecycle === 'CC_OPEN' ? 'CALL' : 'PUT';
  const hasStock = lifecycle !== 'CSP_OPEN';
  const symbol = `AAPL261016${optionType === 'CALL' ? 'C' : 'P'}00200000`;
  const contracts = o.contracts ?? '1';
  return assembleManagementInput({
    chain_id: UUID(o.chain ?? 4), lifecycle_state: lifecycle, underlying_id: UUID(5), underlying: 'AAPL',
    option_leg_id: hasOption ? UUID(7) : null, option_contract_id: hasOption ? UUID(6) : null,
    quantity: hasOption ? contracts : null, entry_credit_debit: hasOption ? '200' : null,
    contract_symbol: hasOption ? symbol : null, option_type: hasOption ? optionType : null, strike: hasOption ? '200' : null,
    expiration_date: hasOption ? '2026-10-16' : null, multiplier: hasOption ? '100' : null,
    bid: hasOption ? (o.bid === undefined ? 1 : o.bid) : null, ask: hasOption ? (o.ask === undefined ? 1.1 : o.ask) : null,
    quote_as_of: hasOption ? (o.quoteAsOf ?? observedAt) : null, feed: hasOption ? 'OPRA' : null, quote_quality: hasOption ? 'GOOD' : null,
    realized_option_pnl: '0', open_stock_shares: hasStock ? (o.shares ?? '100') : '0', stock_basis_per_share: hasStock ? '195' : null,
    realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000', options_buying_power: '40000',
    account_as_of: observedAt, fusion_snapshot_id: UUID(3), reconciliation_quality: 'GOOD',
    broker_option_symbol: hasOption ? symbol : null, broker_option_quantity: hasOption ? contracts : null,
    broker_option_side: hasOption ? 'short' : null, broker_option_asset_class: hasOption ? 'us_option' : null,
    broker_option_observed_at: hasOption ? observedAt : null, ledger_option_contract_quantity: hasOption ? contracts : '0',
    snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: true },
      riskState: { assignmentCapacity: 2, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
    broker_position: hasStock ? { currentPrice: o.mark ?? 190 } : null, reconciliation_observed_at: observedAt, position_observed_at: hasStock ? observedAt : null,
    broker_stock_quantity: hasStock ? (o.brokerShares ?? o.shares ?? '100') : null, broker_stock_side: hasStock ? 'long' : null,
  }, { managementInputSnapshotId: UUID(1), reconciliationSnapshotId: UUID(2), observedAt, stockQuoteRead: o.stockRead ?? null });
}

const rollTarget = (overrides: Partial<RollCandidate> = {}): RollCandidate => ({
  optionContractId: UUID(10), symbol: 'AAPL261120P00195000', optionType: 'PUT', strike: 195,
  expiration: '2026-11-20', multiplier: 100, quantity: 1, bid: 1.5, ask: 1.6, ...overrides,
});
const callTarget = (overrides: Partial<RollCandidate> = {}): RollCandidate => ({
  optionContractId: UUID(11), symbol: 'AAPL261120C00205000', optionType: 'CALL', strike: 205,
  expiration: '2026-11-20', multiplier: 100, quantity: 1, bid: 1.5, ask: 1.6, ...overrides,
});

const decide = (input: PaperBootstrapPolicyInput) => {
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  return { evidence, frontier: buildManagementActionFrontier(input, evidence) };
};

const quoteFor = (symbol: string, bid: number, ask: number, at = T_NEAR): ExecutionOptionQuote => {
  const parsed = parseOccOptionSymbol(symbol);
  assert.ok(parsed);
  return { contractVersion: executionOptionQuoteContractVersion, contractId: symbol, providerContractId: symbol, bid, ask,
    bidSize: 10, askSize: 10, providerTimestamp: at, receivedAtUtc: at, receivedAtMonotonic: 1, sequence: 1, provider: 'ALPACA',
    sourceSemantics: 'CONSOLIDATED_NBBO', connectionState: 'CONNECTED', subscriptionState: 'ACTIVE',
    optionIdentity: { underlying: parsed.underlying, optionSymbol: symbol, expiration: parsed.expiration, strike: parsed.strike,
      optionType: parsed.optionType, multiplier: 100, contractTradable: true, exerciseStyle: 'american', deliverableClassification: 'STANDARD_EQUITY' },
    provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: true } };
};

interface Flow {
  readonly frontier: ManagementActionFrontier;
  readonly compiled: ReturnType<typeof compileManagementExecutionLegDirectives>;
  readonly assembled: ReturnType<typeof assembleManagementPaperPlans> | null;
  readonly prepared: readonly MasterPaperActionPreparationResult[];
}

/** frontier -> compile -> plan assembly -> master handoff validation -> adaptive limit. Broker-free by construction. */
async function flow(state: PaperBootstrapPolicyInput, quotes: Readonly<Record<string, ExecutionOptionQuote | null>>,
  extra: Partial<ManagementPaperPlanAssemblyInput> = {}, now = T_NEAR, marketOpen = true, inventory?: StockInventorySource): Promise<Flow> {
  const { frontier } = decide(state);
  const compiled = compileManagementExecutionLegDirectives(state, frontier);
  if (compiled.state !== 'READY') return { frontier, compiled, assembled: null, prepared: [] };
  const assembled = assembleManagementPaperPlans({ state, frontier, managementActionFrontierId: UUID(8), executionAccountId: UUID(9),
    strategyVersion: 'theta-conventional-v1', accountStatus: 'ACTIVE', optionsCapabilityVerified: true, aegisState: 'ALLOW_FULL',
    killSwitchActive: false, paperEvidenceRiskCap: 5, executionLegs: compiled.legs, chainInFlight: { state: 'KNOWN', entries: [] },
    committedShortCallContracts: 1, now, decisionExpiresAt: EXPIRES, ...extra });
  const prepared: MasterPaperActionPreparationResult[] = [];
  if (assembled.state === 'READY') {
    for (const plan of assembled.plans) {
      prepared.push(await prepareMasterPaperAction(plan, { getCurrentQuote: async (p: ApprovedMasterPaperActionPlan) => quotes[p.symbol] ?? null },
        now, marketOpen, undefined, () => now, inventory ?? { async readStockInventory() { return { inventory: { state: 'KNOWN', quantity: state.economics.openStockShares,
          observedAt: now, reason: null }, committedShortCallContracts: 0 }; } }));
    }
  }
  return { frontier, compiled, assembled, prepared };
}

// ---------------------------------------------------------------------------------------------------------------------
// D1 MGMT-CLOSE-EVIDENCE: a frontier-selected risk-reducing close reaches an order offline.
// ---------------------------------------------------------------------------------------------------------------------

test('D1 end to end: policy CLOSE_FULL -> plan -> master handoff validation -> adaptive limit is READY_TO_SUBMIT with a valid buy-to-close limit', async () => {
  const state = managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR });
  const result = await flow(state, { AAPL261016P00200000: quoteFor('AAPL261016P00200000', 0.15, 0.2) });
  assert.equal(result.frontier.selectedAction, 'CLOSE_FULL');
  assert.equal(result.assembled?.state, 'READY');
  assert.equal(result.prepared.length, 1);
  const [prepared] = result.prepared;
  assert.equal(prepared?.state, 'READY_TO_SUBMIT', JSON.stringify(prepared?.blockers));
  assert.equal(prepared?.pricing?.action, 'PLACE');
  assert.equal(prepared?.command?.request.side, 'buy');
  assert.equal(prepared?.command?.request.position_intent, 'buy_to_close');
  assert.equal(prepared?.command?.request.qty, 1);
  assert.equal(prepared?.command?.request.limit_price, '0.15', 'starts at the favorable bid and never exceeds the 0.20 max-ask boundary');
  assert.equal(result.assembled?.state === 'READY' ? result.assembled.plans[0]?.economicBoundary : null, 0.2);
});

test('D1 end to end: policy CLOSE_CC on a covered call is READY_TO_SUBMIT as a call buy-to-close (no share cover needed to buy back)', async () => {
  const state = managed({ lifecycle: 'CC_OPEN', bid: 0.15, ask: 0.2, observedAt: T_NEAR });
  const result = await flow(state, { AAPL261016C00200000: quoteFor('AAPL261016C00200000', 0.15, 0.2) });
  assert.equal(result.frontier.selectedAction, 'CLOSE_CC');
  assert.equal(result.prepared[0]?.state, 'READY_TO_SUBMIT', JSON.stringify(result.prepared[0]?.blockers));
  assert.equal(result.prepared[0]?.command?.request.position_intent, 'buy_to_close');
  assert.equal(result.prepared[0]?.command?.request.symbol, 'AAPL261016C00200000');
});

test('D1/D6 end to end: a worthless short (zero bid, valid ask) is closable with a positive one-tick limit; nothing is invented', async () => {
  const state = managed({ bid: 0, ask: 0.02, observedAt: T_NEAR });
  assert.deepEqual(state.hardBlockers, []);
  const result = await flow(state, { AAPL261016P00200000: quoteFor('AAPL261016P00200000', 0, 0.02) });
  assert.equal(result.frontier.selectedAction, 'CLOSE_FULL');
  const [prepared] = result.prepared;
  assert.equal(prepared?.state, 'READY_TO_SUBMIT', JSON.stringify(prepared?.blockers));
  assert.equal(prepared?.command?.request.limit_price, '0.01');
  assert.ok(Number(prepared?.command?.request.limit_price) <= 0.02, 'never above the ask');
});

test('D1/D6 fail-closed: a missing, stale, crossed, negative-bid, zero-ask or closed-market quote never reaches a limit', async () => {
  const state = managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR });
  const symbol = 'AAPL261016P00200000';
  const run = async (quote: ExecutionOptionQuote | null, marketOpen = true) =>
    (await flow(state, { [symbol]: quote }, {}, T_NEAR, marketOpen)).prepared[0];
  assert.equal((await run(null))?.state, 'NO_QUOTE');
  const stale = await run(quoteFor(symbol, 0.15, 0.2, '2026-10-13T13:58:00.000Z'));
  assert.equal(stale?.state, 'QUOTE_REJECTED');
  assert.ok(stale?.blockers.includes('QUOTE_STALE'));
  const crossed = await run(quoteFor(symbol, 0.3, 0.2));
  assert.equal(crossed?.state, 'QUOTE_REJECTED');
  assert.ok(crossed?.blockers.includes('QUOTE_CROSSED'));
  assert.equal((await run(quoteFor(symbol, -0.01, 0.2)))?.state, 'QUOTE_REJECTED');
  assert.equal((await run(quoteFor(symbol, 0, 0)))?.state, 'QUOTE_REJECTED');
  assert.equal((await run(quoteFor(symbol, 0.15, 0.2), false))?.state, 'BLOCKED');
  // the market moved above the maximum price we agreed to pay: cancel, never chase
  const moved = await run(quoteFor(symbol, 0.25, 0.3));
  assert.equal(moved?.state, 'PRICE_REJECTED');
  assert.deepEqual(moved?.blockers, ['ADAPTIVE_LIMIT_ECONOMIC_BOUNDARY_UNREACHABLE']);
  // state-level stale or unusable current-leg quotes never even select the close
  for (const bad of [managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR, quoteAsOf: '2026-10-13T09:00:00.000Z' }),
    managed({ bid: 0.15, ask: 0, observedAt: T_NEAR }), managed({ bid: null, ask: null, observedAt: T_NEAR })]) {
    assert.notEqual(decide(bad).frontier.selectedAction, 'CLOSE_FULL');
    assert.equal(compileManagementExecutionLegDirectives(bad, decide(bad).frontier).state === 'READY', false);
  }
});

test('D6: only a risk-reducing buy-to-close may price against a zero bid; a sell-to-open of a roll still needs a two-sided positive quote', async () => {
  const state = { ...managed(), rollCandidate: rollTarget() };
  const ok = await flow(state, { AAPL261016P00200000: quoteFor('AAPL261016P00200000', 1.0, 1.1, T0), AAPL261120P00195000: quoteFor('AAPL261120P00195000', 1.5, 1.6, T0) },
    {}, T0);
  assert.equal(ok.frontier.selectedAction, 'ROLL');
  const zeroBidOpen = await flow(state, { AAPL261016P00200000: quoteFor('AAPL261016P00200000', 1.0, 1.1, T0), AAPL261120P00195000: quoteFor('AAPL261120P00195000', 0, 1.6, T0) },
    {}, T0);
  assert.equal(zeroBidOpen.prepared[0]?.state, 'READY_TO_SUBMIT');
  assert.equal(zeroBidOpen.prepared[1]?.state, 'QUOTE_REJECTED');
  assert.ok(zeroBidOpen.prepared[1]?.blockers.includes('TWO_SIDED_QUOTE_INVALID'));
});

// ---------------------------------------------------------------------------------------------------------------------
// MGMT-SELLSTOCK-EVIDENCE: SELL_STOCK reaches READY offline from a fresh executable stock bid/ask; fails closed otherwise.
// ---------------------------------------------------------------------------------------------------------------------

const sellStockPolicyFields = { assignedAtObservedAt: '2026-08-13T14:00:00.000Z', annualOpportunityCostRate: 0.05,
  sellStockOpportunityCostUtilityWeight: 0.02, recoveryForwardHorizonDays: 30 };
const stockRead = (over: Partial<ManagementStockQuoteRead> = {}, at = T_NEAR): ManagementStockQuoteReadOutcome => ({
  quote: { bid: 190, ask: 190.1, bidSize: 100, askSize: 100, timestamp: at, feed: 'iex', ...over }, readFailed: false, receivedAt: at });
const stockQuote = (bid: number, ask: number, at = T_NEAR): ExecutionOptionQuote => ({ contractVersion: executionOptionQuoteContractVersion,
  contractId: 'AAPL', providerContractId: 'AAPL', bid, ask, bidSize: 100, askSize: 100, providerTimestamp: at, receivedAtUtc: at,
  receivedAtMonotonic: 1, sequence: 1, provider: 'ALPACA', sourceSemantics: 'TRUSTED_TWO_SIDED_ORDER_PRICING', connectionState: 'CONNECTED',
  subscriptionState: 'ACTIVE', provenance: { authenticated: true, exactContractMapping: true, documentedForOrderPricing: true, feed: 'iex' } });
const sellStockState = (read: ManagementStockQuoteReadOutcome | null, extra: Partial<Opts> = {}) =>
  ({ ...managed({ lifecycle: 'RECOVERY_WAIT', observedAt: T_NEAR, stockRead: read, ...extra }), ...sellStockPolicyFields });

test('SELL_STOCK end to end: fresh stock quote -> floor <= bid -> plan -> master handoff validation -> adaptive limit READY (sell, whole shares, no broker)', async () => {
  const state = sellStockState(stockRead());
  assert.equal(state.stockExecutionQuote?.state, 'KNOWN');
  const result = await flow(state, { AAPL: stockQuote(190, 190.1) }, { committedShortCallContracts: 0 });
  assert.equal(result.frontier.selectedAction, 'SELL_STOCK');
  const evidence = result.frontier.actions.find((a) => a.action === 'SELL_STOCK')?.executionEvidence;
  assert.equal(evidence?.stockEconomicBoundary, 190, 'floor equals the current bid and is never above it');
  assert.ok((evidence?.stockEconomicBoundary as number) <= (state.stockExecutionQuote?.bid as number));
  assert.equal(evidence?.economicsRemainPositive, true);
  assert.equal(evidence?.expectedAfterCostEv, null);
  assert.equal(evidence?.empiricalEconomicsReady, false);
  assert.equal(result.compiled.state, 'READY');
  assert.equal(result.assembled?.state, 'READY', JSON.stringify(result.assembled?.blockers));
  if (result.assembled?.state !== 'READY') return;
  assert.equal(result.assembled.plans.length, 1);
  assert.equal(result.assembled.plans[0]?.canonicalQuantity, 100);
  assert.equal(result.assembled.plans[0]?.economicBoundary, 190);
  const [prepared] = result.prepared;
  assert.equal(prepared?.state, 'READY_TO_SUBMIT', JSON.stringify(prepared?.blockers));
  assert.equal(prepared?.command?.request.side, 'sell');
  assert.equal(prepared?.command?.request.symbol, 'AAPL');
  assert.equal(prepared?.command?.request.qty, 100);
  assert.equal(prepared?.command?.request.limit_price, '190.10', 'starts at the favourable ask');
  assert.ok(Number(prepared?.command?.request.limit_price) >= 190, 'never below the floor');
});

test('SELL_STOCK: the floor rejects a limit below it - the market falling under the floor cancels, never chases down', async () => {
  const state = sellStockState(stockRead());
  const fell = await flow(state, { AAPL: stockQuote(189, 189.1) }, { committedShortCallContracts: 0 });
  assert.equal(fell.prepared[0]?.state, 'PRICE_REJECTED');
  assert.deepEqual(fell.prepared[0]?.blockers, ['ADAPTIVE_LIMIT_ECONOMIC_BOUNDARY_UNREACHABLE']);
  // a partial lot is whole shares as confirmed by the broker-reconciled ledger
  const odd = sellStockState(stockRead(), { shares: '37' });
  const oddFlow = await flow(odd, { AAPL: stockQuote(190, 190.1) }, { committedShortCallContracts: 0 });
  assert.equal(oddFlow.prepared[0]?.command?.request.qty, 37);
});

test('SELL_STOCK fail-closed: missing, stale, future, crossed, zero-bid, zero-ask or failed stock quote keeps evidence null with a typed reason', () => {
  const cases: readonly [string, ManagementStockQuoteReadOutcome | null, string][] = [
    ['no read supplied', null, 'STOCK_EXECUTION_EVIDENCE_NOT_PROVIDED'],
    ['read failed', { quote: null, readFailed: true, receivedAt: T_NEAR }, 'STOCK_QUOTE_READ_FAILED'],
    ['missing bid', stockRead({ bid: null }), 'STOCK_QUOTE_MISSING'],
    ['missing ask', stockRead({ ask: null }), 'STOCK_QUOTE_MISSING'],
    ['no timestamp', stockRead({ timestamp: null }), 'STOCK_QUOTE_TIMESTAMP_MISSING'],
    ['stale', stockRead({ timestamp: '2026-10-13T13:58:00.000Z' }), 'STOCK_QUOTE_STALE'],
    ['future', stockRead({ timestamp: '2026-10-13T14:05:00.000Z' }), 'STOCK_QUOTE_TIMESTAMP_IN_FUTURE'],
    ['crossed', stockRead({ bid: 191, ask: 190 }), 'STOCK_QUOTE_CROSSED'],
    ['zero bid', stockRead({ bid: 0 }), 'STOCK_QUOTE_NONPOSITIVE_BID'],
    ['zero ask', stockRead({ ask: 0 }), 'STOCK_QUOTE_NONPOSITIVE_ASK'],
  ];
  for (const [label, read, reason] of cases) {
    const state = sellStockState(read);
    if (read !== null) { assert.equal(state.stockExecutionQuote?.state, 'UNKNOWN', label); assert.equal(state.stockExecutionQuote?.bid, null, label); }
    const { frontier, evidence } = decide(state);
    assert.equal(frontier.actions.find((a) => a.action === 'SELL_STOCK')?.executionEvidence, null, label);
    const reasons = evidence?.actionValues.find((v) => v.action === 'SELL_STOCK')?.reasons ?? [];
    assert.ok(reasons.some((r) => r.includes(reason)), `${label}: ${JSON.stringify(reasons)}`);
    // even if the policy selected SELL_STOCK, no leg can compile
    const compiled = compileManagementExecutionLegDirectives(state, { ...frontier, selectedAction: 'SELL_STOCK' });
    assert.equal(compiled.state === 'READY', false, label);
  }
  const selected = decide(sellStockState(null)).frontier;
  assert.equal(selected.selectedAction, 'SELL_STOCK');
  const compiled = compileManagementExecutionLegDirectives(sellStockState(null), selected);
  assert.equal(compiled.state, 'BLOCKED');
  assert.deepEqual(compiled.blockers, ['MANAGEMENT_EXECUTION_EVIDENCE_MISSING']);
});

test('SELL_STOCK: the position mark is a valuation, never an executable price - a mark without a quote yields no evidence', () => {
  const state = sellStockState(null, { mark: 190 });
  assert.equal(state.economics.stockMarkPerShare, 190);
  assert.equal(decide(state).frontier.actions.find((a) => a.action === 'SELL_STOCK')?.executionEvidence, null);
});

test('SELL_STOCK: a tie with RECOVERY_WAIT (no positive utility) never compiles even with a good quote', () => {
  const state = { ...managed({ lifecycle: 'RECOVERY_WAIT', observedAt: T_NEAR, stockRead: stockRead() }) };
  const value = evaluatePaperBootstrapManagementPolicy(state)?.actionValues.find((v) => v.action === 'SELL_STOCK');
  assert.equal(value?.executionEvidence?.economicsRemainPositive, false);
});

test('SELL_STOCK must never be possible while a covered call is short against the shares (chain, account-net and handoff layers)', async () => {
  // chain layer: a short call open on this chain blocks the action outright
  const ccOpen = { ...managed({ lifecycle: 'CC_OPEN', observedAt: T_NEAR, stockRead: stockRead() }), ...sellStockPolicyFields };
  const ccEconomics = buildManagementActionFrontier(ccOpen);
  assert.equal(ccEconomics.actions.some((a) => a.action === 'SELL_STOCK'), false, 'CC_OPEN never offers SELL_STOCK');
  const forced = { ...managed({ lifecycle: 'RECOVERY_WAIT', observedAt: T_NEAR, stockRead: stockRead() }), ...sellStockPolicyFields,
    contract: { ...managed({ lifecycle: 'CC_OPEN' }).contract } };
  assert.ok(buildManagementActionFrontier(forced).actions.find((a) => a.action === 'SELL_STOCK')?.blockers.includes('SHORT_CALL_OPEN_AGAINST_SHARES'));
  assert.equal(decide(forced).frontier.actions.find((a) => a.action === 'SELL_STOCK')?.executionEvidence, null);
  // account layer: sibling short calls / pending sell-to-open on the underlying block; unknown blocks
  const state = sellStockState(stockRead());
  for (const [committed, blocker] of [[1, 'STOCK_SALE_WITH_SHORT_CALLS_COMMITTED:SELL_STOCK'], [3, 'STOCK_SALE_WITH_SHORT_CALLS_COMMITTED:SELL_STOCK'],
    [null, 'COMMITTED_SHORT_CALLS_UNKNOWN:SELL_STOCK'], [undefined, 'COMMITTED_SHORT_CALLS_UNKNOWN:SELL_STOCK'],
    [-1, 'COMMITTED_SHORT_CALLS_UNKNOWN:SELL_STOCK'], [1.5, 'COMMITTED_SHORT_CALLS_UNKNOWN:SELL_STOCK']] as const) {
    const result = await flow(state, { AAPL: stockQuote(190, 190.1) }, { committedShortCallContracts: committed as never });
    assert.equal(result.assembled?.state, 'BLOCKED', String(committed));
    assert.ok(result.assembled?.blockers.includes(blocker), `${committed}: ${JSON.stringify(result.assembled?.blockers)}`);
    assert.deepEqual(result.prepared, []);
  }
  // handoff layer, independent of assembly: a plan without proof of zero committed calls is blocked before any quote access
  const ready = await flow(state, { AAPL: stockQuote(190, 190.1) }, { committedShortCallContracts: 0 });
  assert.equal(ready.assembled?.state, 'READY');
  if (ready.assembled?.state !== 'READY') return;
  const plan = ready.assembled.plans[0] as ApprovedMasterPaperActionPlan;
  assert.equal(plan.committedShortCallContracts, 0);
  const calls: number[] = [];
  const source = { getCurrentQuote: async () => { calls.push(1); return null; } };
  const strip = { ...plan } as Record<string, unknown>; delete strip.committedShortCallContracts;
  for (const bad of [strip, { ...plan, committedShortCallContracts: 1 }]) {
    const prepared = await prepareMasterPaperAction(bad as never, source, T_NEAR, true, undefined, () => T_NEAR);
    assert.equal(prepared.state, 'BLOCKED');
    assert.ok(prepared.blockers.includes('STOCK_SALE_SHORT_CALL_COVERAGE_NOT_CONFIRMED'));
  }
  assert.deepEqual(calls, []);
  // and the runtime reads the account-net commitment for a stock exit exactly as it does for a call open
  const runtime = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /leg\.action==='SELL_STOCK'\);/);
});

test('SELL_STOCK loader: exactly ONE bounded stock quote read per underlying per scan, injected; a throwing reader fails closed', async () => {
  const row = { chain_id: 'chain-1', underlying: 'AAPL', underlying_id: UUID(5), lifecycle_state: 'RECOVERY_WAIT', realized_option_pnl: 0,
    realized_stock_pnl: 0, open_stock_shares: 100, stock_basis_per_share: 195, dividends: 0, fees: 0, unknown_fill_fees: false,
    broker_position: { currentPrice: 190 }, snapshot_json: { marketSession: { isOpen: true } } };
  const run = async (rows: unknown[], reader: (symbol: string) => Promise<ManagementStockQuoteRead> | undefined) => {
    const client = { release() {}, on() {}, async query() { return { rows: [], rowCount: 0 }; } };
    const pool = { query: async () => ({ rows, rowCount: rows.length }), connect: async () => client } as never;
    const store = new PostgresManagementInputStore(pool, { async load() { throw new Error('whole chain not under test'); } } as never);
    return store.assembleAndPersistOpenChains('connection', 'recon', '2026-09-18T15:00:00Z', new Map(), reader as never)
      .catch((error: unknown) => error);
  };
  // the whole-chain loader is deliberately unavailable here, so the run rejects AFTER the stock reads; count the reads.
  const symbols: string[] = [];
  await run([row, { ...row, chain_id: 'chain-2' }, { ...row, chain_id: 'chain-3', underlying: 'MSFT' },
    { ...row, chain_id: 'chain-4', underlying: 'NVDA', open_stock_shares: 0 }], async (symbol) => {
    symbols.push(symbol);
    return { bid: 190, ask: 190.1, bidSize: 1, askSize: 1, timestamp: new Date().toISOString(), feed: 'iex' };
  });
  assert.deepEqual(symbols, ['AAPL', 'MSFT'], 'one read per underlying that holds shares; none for a flat underlying');
  const failing = await run([row], async () => { throw new Error('provider down'); });
  assert.match(String((failing as Error).message), /whole chain not under test/, 'a read failure does not abort the scan');
  const production = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  assert.match(production, /fetchLatestStockQuote\(master\.alpaca,symbol,'iex'\)/);
  // the pure classification of a throwing read is a typed UNKNOWN, never a price
  const failed = assembleManagementInput({ ...row, chain_id: UUID(4), underlying_id: UUID(5), fusion_snapshot_id: UUID(3) },
    { managementInputSnapshotId: UUID(1), reconciliationSnapshotId: UUID(2), observedAt: T_NEAR,
      stockQuoteRead: { quote: null, readFailed: true, receivedAt: T_NEAR } });
  assert.equal(failed.stockExecutionQuote?.state, 'UNKNOWN');
  assert.equal(failed.stockExecutionQuote?.reason, 'STOCK_QUOTE_READ_FAILED');
});

// ---------------------------------------------------------------------------------------------------------------------
// D2 MGMT-BOUNDARY-UNITS
// ---------------------------------------------------------------------------------------------------------------------

test('D2 end to end: a roll with real quotes produces a reachable limit on BOTH legs (close-old buy, open-new sell)', async () => {
  const state = { ...managed(), rollCandidate: rollTarget() };
  const result = await flow(state, { AAPL261016P00200000: quoteFor('AAPL261016P00200000', 1.0, 1.1, T0), AAPL261120P00195000: quoteFor('AAPL261120P00195000', 1.5, 1.6, T0) },
    {}, T0);
  assert.equal(result.frontier.selectedAction, 'ROLL');
  assert.equal(result.assembled?.state, 'READY', JSON.stringify(result.assembled?.blockers));
  if (result.assembled?.state !== 'READY') return;
  assert.deepEqual(result.assembled.plans.map((p) => [p.action, p.economicBoundary]), [['ROLL_CSP_CLOSE', 1.1], ['ROLL_CSP_OPEN', 1.5]]);
  const [close, open] = result.prepared;
  assert.equal(close?.state, 'READY_TO_SUBMIT', JSON.stringify(close?.blockers));
  assert.equal(open?.state, 'READY_TO_SUBMIT', JSON.stringify(open?.blockers));
  assert.equal(close?.command?.request.limit_price, '1.00');
  assert.equal(open?.command?.request.limit_price, '1.60');
  assert.equal(close?.command?.request.position_intent, 'buy_to_close');
  assert.equal(open?.command?.request.position_intent, 'sell_to_open');
  // the open leg waits for the close fill and may not exceed it
  assert.equal(result.assembled.plans[1]?.dependsOnActionPlanId, result.assembled.plans[0]?.actionPlanId);
});

test('D2: the multi-candidate roll path and a covered-call roll also emit per-share boundaries', () => {
  const multi = decide({ ...managed(), rollCandidates: [rollTarget()] });
  assert.equal(multi.frontier.selectedAction, 'ROLL');
  const evidence = multi.frontier.actions.find((a) => a.action === 'ROLL')?.executionEvidence;
  assert.equal(evidence?.closeEconomicBoundary, 1.1);
  assert.equal(evidence?.openEconomicBoundary, 1.5);
  const cc = decide({ ...managed({ lifecycle: 'CC_OPEN' }), rollCcCandidates: [callTarget()] });
  assert.equal(cc.frontier.selectedAction, 'ROLL_CC');
  const ccEvidence = cc.frontier.actions.find((a) => a.action === 'ROLL_CC')?.executionEvidence;
  assert.equal(ccEvidence?.closeEconomicBoundary, 1.1);
  assert.equal(ccEvidence?.openEconomicBoundary, 1.5);
  const sell = decide({ ...managed({ lifecycle: 'RECOVERY_WAIT' }), ccCandidate: callTarget(), sellCcPremiumUtilityWeight: 0.01 });
  const sellEvidence = sell.evidence?.actionValues.find((v) => v.action === 'SELL_CC')?.executionEvidence;
  assert.equal(sellEvidence?.openEconomicBoundary, 1.5, 'SELL_CC single-candidate path');
  assert.equal(sellEvidence?.deterministicNetCredit, 150, 'the dollar total stays in the dollar field');
});

// ---------------------------------------------------------------------------------------------------------------------
// D3 MGMT-CROSS-CYCLE-DUP
// ---------------------------------------------------------------------------------------------------------------------

test('D3: a later cycle (new frontier) cannot emit a second equivalent management order while the first is working or its state is unknown', async () => {
  const state = managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR });
  const quotes = { AAPL261016P00200000: quoteFor('AAPL261016P00200000', 0.15, 0.2) };
  const cycle1 = await flow(state, quotes, { managementActionFrontierId: UUID(8) });
  assert.equal(cycle1.assembled?.state, 'READY');
  if (cycle1.assembled?.state !== 'READY') return;
  const working = [{ source: 'ACTION_PLAN' as const, id: cycle1.assembled.plans[0]?.actionPlanId as string, decisionId: cycle1.assembled.decision.decisionId }];
  // cycle 2 = a new frontier id (a new decision) for the same chain while cycle 1's plan is READY / working
  const cycle2 = await flow(state, quotes, { managementActionFrontierId: UUID(88), chainInFlight: { state: 'KNOWN', entries: working } });
  assert.equal(cycle2.assembled?.state, 'BLOCKED');
  assert.deepEqual(cycle2.assembled?.blockers, ['MANAGEMENT_EQUIVALENT_ORDER_IN_FLIGHT']);
  assert.deepEqual(cycle2.prepared, [], 'nothing reaches the handoff');
  // a working order INTENT (submitted, partially filled, awaiting reconciliation ...) blocks the same way
  const intent = [{ source: 'ORDER_INTENT' as const, id: UUID(77), decisionId: cycle1.assembled.decision.decisionId }];
  assert.equal((await flow(state, quotes, { managementActionFrontierId: UUID(88), chainInFlight: { state: 'KNOWN', entries: intent } })).assembled?.state, 'BLOCKED');
  // a different decision's entry with a null decision id (unattributable) also blocks
  assert.equal((await flow(state, quotes, { chainInFlight: { state: 'KNOWN', entries: [{ source: 'ORDER_INTENT', id: UUID(78), decisionId: null }] } })).assembled?.state, 'BLOCKED');
  // UNKNOWN or absent evidence blocks (no default)
  for (const unknown of [{ state: 'UNKNOWN' as const }, undefined]) {
    const result = await flow(state, quotes, { chainInFlight: unknown as never });
    assert.equal(result.assembled?.state, 'BLOCKED');
    assert.deepEqual(result.assembled?.blockers, ['MANAGEMENT_CHAIN_IN_FLIGHT_STATE_UNKNOWN']);
  }
  // an idempotent replay of the SAME decision is not a conflict (the store ON CONFLICT DO NOTHING absorbs it)
  const replay = await flow(state, quotes, { managementActionFrontierId: UUID(8), chainInFlight: { state: 'KNOWN', entries: working } });
  assert.equal(replay.assembled?.state, 'READY');
  // and a clear chain publishes with the conflict flag derived from the evidence, not a literal
  const clear = await flow(state, quotes, { chainInFlight: { state: 'KNOWN', entries: [] } });
  assert.equal(clear.assembled?.state === 'READY' ? clear.assembled.plans[0]?.noEquivalentExposureConflict : null, true);
});

test('D3: the in-flight guard covers closes, rolls and covered calls alike (any non-terminal order on the chain)', async () => {
  const entry = [{ source: 'ORDER_INTENT' as const, id: UUID(79), decisionId: UUID(80) }];
  const roll = await flow({ ...managed(), rollCandidate: rollTarget() }, {}, { chainInFlight: { state: 'KNOWN', entries: entry } }, T0);
  assert.equal(roll.assembled?.state, 'BLOCKED');
  const cc = await flow({ ...managed({ lifecycle: 'CC_OPEN' }), rollCcCandidates: [callTarget()] }, {}, { chainInFlight: { state: 'KNOWN', entries: entry } }, T0);
  assert.equal(cc.assembled?.state, 'BLOCKED');
  assert.ok(cc.assembled?.blockers.includes('MANAGEMENT_EQUIVALENT_ORDER_IN_FLIGHT'));
});

test('D3: the production feed reads every non-terminal plan and order intent for the chain, and fails closed on any read error', async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const pool = { query: async (sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    return /master_paper_action_plan/.test(sql) ? { rows: [{ id: UUID(60), decision_id: UUID(61) }] } : { rows: [{ id: UUID(62), decision_id: null }] };
  } };
  const known = await readManagementChainInFlight(pool as never, UUID(9), UUID(4));
  assert.deepEqual(known, { state: 'KNOWN', entries: [
    { source: 'ACTION_PLAN', id: UUID(60), decisionId: UUID(61) }, { source: 'ORDER_INTENT', id: UUID(62), decisionId: null }] });
  assert.match(calls[0]?.sql ?? '', /status IN \('READY','CLAIMED','WAITING_GATE'\)/);
  assert.deepEqual(calls[1]?.values[2], ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);
  const broken = { query: async () => { throw new Error('db down'); } };
  assert.deepEqual(await readManagementChainInFlight(broken as never, UUID(9), UUID(4)), { state: 'UNKNOWN' });
  // the runtime passes both feeds into the assembly and does not swallow an in-flight block as a degraded job
  const runtime = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /readManagementChainInFlight\(pool,master\.executionAccountId,state\.chainId\)/);
  assert.match(runtime, /assembleManagementPaperPlans\(\{state,frontier:persisted\.frontier,chainInFlight,committedShortCallContracts/);
  const assembly = readFileSync(new URL('../src/execution/management-paper-plan-assembly.ts', import.meta.url), 'utf8');
  assert.ok(!/noEquivalentExposureConflict:\s*true/.test(assembly), 'the hard-coded literal must stay gone');
});

// ---------------------------------------------------------------------------------------------------------------------
// HDAC-05: account-net covered-call coverage at plan assembly AND order construction.
// ---------------------------------------------------------------------------------------------------------------------

function sellCcFrontier(state: ManagementInputState, quantity = 1): ManagementActionFrontier {
  const base = buildManagementActionFrontier(state);
  return { ...base, selectedAction: 'SELL_CC', decisionState: 'ACTION_SELECTED', policyVersion: 'p', policyEvidenceHash: 'd'.repeat(64),
    reasonCodes: ['SELECT_SELL_CC'], actions: base.actions.map((a) => a.action === 'SELL_CC'
      ? { ...a, feasibility: 'FEASIBLE' as const, blockers: [], executionEvidence: { closeEconomicBoundary: null, openEconomicBoundary: 1.5,
        stockEconomicBoundary: null, economicsRemainPositive: true, expectedAfterCostEv: null, empiricalEconomicsReady: false,
        deterministicEconomicsValidated: true, deterministicNetCredit: 150 * quantity,
        targetContract: { symbol: 'AAPL261120C00205000', optionContractId: UUID(11), optionType: 'CALL' as const, multiplier: 100, quantity } } } : a) };
}

function assembleSellCc(state: ManagementInputState, committed: number | null | undefined, chainInFlight = { state: 'KNOWN' as const, entries: [] }) {
  const frontier = sellCcFrontier(state);
  const compiled = compileManagementExecutionLegDirectives(state, frontier);
  assert.equal(compiled.state, 'READY');
  if (compiled.state !== 'READY') throw new Error('unreachable');
  return assembleManagementPaperPlans({ state, frontier, managementActionFrontierId: UUID(8), executionAccountId: UUID(9),
    strategyVersion: 'theta-recovery-v1', accountStatus: 'ACTIVE', optionsCapabilityVerified: true, aegisState: 'ALLOW_FULL',
    killSwitchActive: false, paperEvidenceRiskCap: 1, executionLegs: compiled.legs, chainInFlight,
    ...(committed === undefined ? {} : { committedShortCallContracts: committed }), now: T0, decisionExpiresAt: '2026-09-12T14:00:45.000Z' });
}

test('HDAC-05: account-net coverage - committed short calls reduce what the chain\'s shares can still cover; unknown blocks', () => {
  const recovery = managed({ lifecycle: 'RECOVERY_WAIT', shares: '100' });
  const ready = assembleSellCc(recovery, 0);
  assert.equal(ready.state, 'READY');
  assert.equal(ready.state === 'READY' ? ready.plans[0]?.committedShortCallContracts : null, 0);
  assert.equal(ready.state === 'READY' ? ready.plans[0]?.confirmedCoveredShares : null, 100);
  // a sibling chain / pending sell-to-open already commits the one contract these 100 shares can cover
  const taken = assembleSellCc(recovery, 1);
  assert.equal(taken.state, 'BLOCKED');
  assert.deepEqual(taken.blockers, ['COVERED_CALL_ACCOUNT_NET_COVERAGE_INSUFFICIENT:OPEN_CC']);
  // unknown commitment (null / absent) blocks - never zero
  for (const unknown of [null, undefined]) {
    const result = assembleSellCc(recovery, unknown);
    assert.equal(result.state, 'BLOCKED');
    assert.deepEqual(result.blockers, ['COMMITTED_SHORT_CALLS_UNKNOWN:OPEN_CC']);
  }
  assert.equal(assembleSellCc(recovery, -1).state, 'BLOCKED');
  assert.equal(assembleSellCc(recovery, 1.5).state, 'BLOCKED');
});

test('HDAC-05: two chains on one underlying competing for the same 100 shares - only the first covered call is allowed', () => {
  const chainA = managed({ lifecycle: 'RECOVERY_WAIT', shares: '100', chain: 4 });
  const chainB = managed({ lifecycle: 'RECOVERY_WAIT', shares: '100', chain: 14 });
  // cycle 1: nothing is committed on AAPL yet
  const committedBefore = deriveCommittedShortCallContracts('AAPL', [], []);
  assert.equal(committedBefore, 0);
  const first = assembleSellCc(chainA, committedBefore);
  assert.equal(first.state, 'READY');
  // chain A's sell-to-open call is now a pending open order on the account; chain B sees it as committed
  const pendingOrder = { orderId: 'o1', clientOrderId: null, symbol: 'AAPL261120C00205000', side: 'sell', positionIntent: 'sell_to_open' as const,
    quantity: 1, limitPrice: 1.6, status: 'new', submittedAt: T0, receivedAt: T0 };
  const committedAfter = deriveCommittedShortCallContracts('AAPL', [], [pendingOrder]);
  assert.equal(committedAfter, 1);
  const second = assembleSellCc(chainB, committedAfter);
  assert.equal(second.state, 'BLOCKED');
  assert.deepEqual(second.blockers, ['COVERED_CALL_ACCOUNT_NET_COVERAGE_INSUFFICIENT:OPEN_CC']);
  // an unreadable broker row makes the whole commitment UNKNOWN, which blocks as well
  const unknownRow = deriveCommittedShortCallContracts('AAPL', [{ symbol: 'GARBAGE', assetClass: 'us_option', quantity: -1, side: 'short',
    avgEntryPrice: null, marketValue: null, unrealizedPl: null, receivedAt: T0 }], []);
  assert.equal(unknownRow, null);
  assert.equal(assembleSellCc(chainB, unknownRow).state, 'BLOCKED');
  // genuine extra cover (200 shares, one contract committed) leaves exactly one contract
  assert.equal(assembleSellCc(managed({ lifecycle: 'RECOVERY_WAIT', shares: '200' }), 1).state, 'READY');
  assert.equal(assembleSellCc(managed({ lifecycle: 'RECOVERY_WAIT', shares: '200' }), 2).state, 'BLOCKED');
});

test('HDAC-05: a covered-call ROLL nets out the call it is closing (and only that call)', async () => {
  const state = { ...managed({ lifecycle: 'CC_OPEN' }), rollCcCandidates: [callTarget()] };
  const quotes = { AAPL261016C00200000: quoteFor('AAPL261016C00200000', 1.0, 1.1, T0), AAPL261120C00205000: quoteFor('AAPL261120C00205000', 1.5, 1.6, T0) };
  // the account holds exactly this chain's one short call: closing it frees the cover for the replacement
  const ok = await flow(state, quotes, { committedShortCallContracts: 1 }, T0);
  assert.equal(ok.frontier.selectedAction, 'ROLL_CC');
  assert.equal(ok.assembled?.state, 'READY', JSON.stringify(ok.assembled?.blockers));
  if (ok.assembled?.state !== 'READY') return;
  assert.deepEqual(ok.assembled.plans.map((p) => [p.action, p.committedShortCallContracts ?? null]), [['ROLL_CC_CLOSE', null], ['ROLL_CC_OPEN', 0]]);
  assert.equal(ok.prepared[1]?.state, 'READY_TO_SUBMIT', JSON.stringify(ok.prepared[1]?.blockers));
  assert.equal(ok.prepared[1]?.command?.request.position_intent, 'sell_to_open');
  // a sibling's extra short call on the same 100 shares leaves no cover for the replacement
  const crowded = await flow(state, quotes, { committedShortCallContracts: 2 }, T0);
  assert.equal(crowded.assembled?.state, 'BLOCKED');
  assert.deepEqual(crowded.assembled?.blockers, ['COVERED_CALL_ACCOUNT_NET_COVERAGE_INSUFFICIENT:ROLL_CC_OPEN']);
  // a commitment smaller than the call being closed is internally inconsistent -> UNKNOWN -> blocked
  const inconsistent = await flow(state, quotes, { committedShortCallContracts: 0 }, T0);
  assert.deepEqual(inconsistent.assembled?.blockers, ['COMMITTED_SHORT_CALLS_UNKNOWN:ROLL_CC_OPEN']);
  const unknown = await flow(state, quotes, { committedShortCallContracts: null }, T0);
  assert.deepEqual(unknown.assembled?.blockers, ['COMMITTED_SHORT_CALLS_UNKNOWN:ROLL_CC_OPEN']);
});

test('HDAC-05: order construction and the master handoff enforce the same account-net rule independently of the assembly', async () => {
  const base = { action: 'OPEN_CC' as const, symbol: 'AAPL261120C00205000', quantity: 1, limitPrice: 1.5, clientOrderId: 'cc1', optionMultiplier: 100 };
  assert.equal(buildAlpacaLimitOrder({ ...base, confirmedCoveredShares: 100, committedShortCallContracts: 0 }).side, 'sell');
  assert.throws(() => buildAlpacaLimitOrder({ ...base, confirmedCoveredShares: 100, committedShortCallContracts: 1 }), /coverage/);
  assert.throws(() => buildAlpacaLimitOrder({ ...base, confirmedCoveredShares: 100 }), /known committed short-call count/);
  assert.throws(() => buildAlpacaLimitOrder({ ...base, confirmedCoveredShares: 100, committedShortCallContracts: null }), /known committed short-call count/);
  assert.equal(buildAlpacaLimitOrder({ ...base, quantity: 2, confirmedCoveredShares: 300, committedShortCallContracts: 1 }).qty, 2);
  assert.throws(() => buildAlpacaLimitOrder({ ...base, quantity: 2, confirmedCoveredShares: 300, committedShortCallContracts: 2 }), /coverage/);
  // buy-to-close of a call needs no cover and no commitment figure
  assert.equal(buildAlpacaLimitOrder({ action: 'CLOSE_CC', symbol: base.symbol, quantity: 1, limitPrice: 1, clientOrderId: 'c2' }).side, 'buy');
  // the handoff blocks a covered-call plan whose commitment is missing or over-commits the shares, before any quote or broker access
  const ready = assembleSellCc(managed({ lifecycle: 'RECOVERY_WAIT', shares: '100' }), 0);
  assert.equal(ready.state, 'READY');
  if (ready.state !== 'READY') return;
  const plan = ready.plans[0] as ApprovedMasterPaperActionPlan;
  const sourceCalls: number[] = [];
  const source = { getCurrentQuote: async () => { sourceCalls.push(1); return null; } };
  const strip = { ...plan } as Record<string, unknown>; delete strip.committedShortCallContracts;
  const missing = await prepareMasterPaperAction(strip as never, source, T0, true, undefined, () => T0);
  assert.equal(missing.state, 'BLOCKED');
  assert.ok(missing.blockers.includes('COVERED_CALL_ACCOUNT_NET_COVERAGE_NOT_CONFIRMED'));
  const over = await prepareMasterPaperAction({ ...plan, committedShortCallContracts: 1 }, source, T0, true, undefined, () => T0);
  assert.equal(over.state, 'BLOCKED');
  assert.ok(over.blockers.includes('COVERED_CALL_ACCOUNT_NET_COVERAGE_NOT_CONFIRMED'));
  assert.deepEqual(sourceCalls, [], 'the quote source is never consulted for a plan that fails coverage');
});

test('HDAC-05: the production commitment feed is UNKNOWN on any external/unknown broker fact or read error', async () => {
  const rows = (positions: unknown[], orders: unknown[], plans: unknown[] = []) => ({ query: async (sql: string) => ({ rows: /broker_reconciliation_snapshot/.test(sql) ? [{ observed_at: '2026-10-13T13:59:00.000Z' }] : /trade\.fill/.test(sql) ? [] : /broker_position_snapshot/.test(sql) ? positions : /master_paper_action_plan/.test(sql) ? plans : orders }) });
  const input = { executionAccountId: UUID(9), reconciliationSnapshotId: UUID(2), underlying: 'AAPL', externalOrUnknownCount: 0 };
  assert.equal(await readCommittedShortCallContracts(rows([], []) as never, input), 0);
  assert.equal(await readCommittedShortCallContracts(rows([{ symbol: 'AAPL261120C00205000', quantity: -2, side: 'short', asset_class: 'us_option' }], []) as never, input), 2);
  assert.equal(await readCommittedShortCallContracts(rows([], [{ id: 'i1', broker_symbol: 'AAPL261120C00210000', side: 'sell', position_intent: 'SELL_TO_OPEN', quantity: 1, status: 'SUBMITTED' }]) as never, input), 1);
  // a READY/CLAIMED covered-call plan (e.g. a sibling chain planned in the same cycle) is a commitment before any order intent exists
  assert.equal(await readCommittedShortCallContracts(rows([], [], [{ id: 'p1', symbol: 'AAPL261120C00205000', quantity: 1 }]) as never, input), 1);
  assert.equal(await readCommittedShortCallContracts(rows([], [], [{ id: 'p2', symbol: 'MSFT261120C00400000', quantity: 3 }]) as never, input), 0);
  // a position row with an UNKNOWN asset class that is an OCC short call is counted, never skipped
  assert.equal(await readCommittedShortCallContracts(rows([{ symbol: 'AAPL261120C00205000', quantity: -1, side: 'short', asset_class: null }], []) as never, input), 1);
  assert.equal(await readCommittedShortCallContracts(rows([], []) as never, { ...input, externalOrUnknownCount: 1 }), null);
  assert.equal(await readCommittedShortCallContracts({ query: async () => { throw new Error('down'); } } as never, input), null);
  assert.equal(await readCommittedShortCallContracts(rows([], [{ id: 'i2', broker_symbol: 'AAPL261120C00210000', side: 'sell', position_intent: null, quantity: 1, status: 'READY' }]) as never, input), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// D7, P2-CHAIN-04, STOCK_HELD.
// ---------------------------------------------------------------------------------------------------------------------

test('D7: the operator status reports the policy constant and the live new-risk state, not pinned strings', () => {
  const enabled = paperBootstrapManagementPolicyStatus({ masterEnabled: true, pauseNewOrders: false });
  assert.equal(enabled.policy_version, paperBootstrapManagementPolicyVersion);
  assert.equal(enabled.new_risk_management_actions, 'ENABLED_PAPER_EVIDENCE_TIER_GATED');
  assert.equal(enabled.empirical_profitability_claimed, false);
  assert.equal(paperBootstrapManagementPolicyStatus({ masterEnabled: true, pauseNewOrders: true }).new_risk_management_actions, 'DISABLED');
  assert.equal(paperBootstrapManagementPolicyStatus({ masterEnabled: false, pauseNewOrders: false }).new_risk_management_actions, 'DISABLED');
  const api = readFileSync(new URL('../src/customer/api.ts', import.meta.url), 'utf8');
  assert.ok(!/theta-paper-bootstrap-management-policy-v\d/.test(api), 'api.ts must not pin a policy version string');
  assert.ok(!/new_risk_management_actions:\s*"DISABLED"/.test(api));
  assert.match(api, /paperBootstrapManagementPolicyStatus\(executionControl\)/);
  // the constant is the live policy version (v2 at the time of writing; any bump flows through)
  assert.equal(paperBootstrapManagementPolicyVersion, 'theta-paper-bootstrap-management-policy-v2');
});

test('P2-CHAIN-04: dominance compares integer cents, so float dust in a spread cannot decide dominance', () => {
  const weights: CoveredCallUtilityWeights = { upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 0, eventRiskPenalty: 0, dividendExDateRiskPenalty: 0,
    belowBasisPenalty: 0, provenance: { policyVersion: 't', configurationId: 't', effectiveVersion: 't', sourceReason: 'fixpass' } };
  const make = (id: string, bid: number, ask: number): CoveredCallCandidate => ({ symbol: id, optionContractId: id, strike: 205, expiration: '2026-11-20',
    delta: null, bid, ask, multiplier: 100, quantity: 1, openInterest: null, volume: null, dividendExDateRisk: 'ABSENT_VERIFIED', eventRisk: 'ABSENT_VERIFIED' });
  const chain = { initialPutPremium: 0, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0, assignmentStrike: 195, stockSharesAssigned: 100, dividends: 0,
    coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: null, fees: 0, executionCostNotEmbeddedInCashflows: 0,
    tcaExecutionShortfall: 0, cashflowBasis: 'ACTUAL_FILL_CASHFLOW' as const };
  // both spreads are exactly 30 cents; in binary floating point they are 30.000000000000004 and 29.999999999999982 dollars*100
  const wide = make('higher-premium', 1.2, 1.5), narrow = make('lower-premium', 1.1, 1.4);
  const assessments = evaluateCoveredCallCandidates(195, 196, 100, chain, [wide, narrow], weights);
  const spreads = assessments.map((a) => a.spreadDollars as number);
  assert.notEqual(spreads[0], spreads[1], 'the fixture really has float dust between equal spreads');
  assert.equal(Math.round((spreads[0] as number) * 100), Math.round((spreads[1] as number) * 100));
  const survivors = nondominatedCoveredCallCandidates(assessments).map((a) => a.candidate.optionContractId);
  assert.deepEqual(survivors, ['higher-premium'], 'higher premium at an equal spread dominates; float dust must not rescue the dominated candidate');
  // a genuine one-cent worse spread still prevents dominance
  const tradeoff = evaluateCoveredCallCandidates(195, 196, 100, chain, [make('hp', 1.2, 1.51), narrow], weights);
  assert.equal(nondominatedCoveredCallCandidates(tradeoff).length, 2);
});

test('MGMT-STOCKHELD-ACTION-EDGE: STOCK_HELD only waits; a chain resting there can never emit an order the ledger cannot apply', () => {
  const held = assembleManagementInput({
    chain_id: UUID(4), lifecycle_state: 'STOCK_HELD', underlying_id: UUID(5), underlying: 'AAPL', option_leg_id: null, option_contract_id: null,
    quantity: null, entry_credit_debit: null, contract_symbol: null, option_type: null, strike: null, expiration_date: null, multiplier: null,
    bid: null, ask: null, quote_as_of: null, feed: null, quote_quality: null, realized_option_pnl: '0', open_stock_shares: '100',
    stock_basis_per_share: '195', realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000', options_buying_power: '40000',
    account_as_of: T0, fusion_snapshot_id: UUID(3), reconciliation_quality: 'GOOD',
    snapshot_json: { underlyingState: { last: 190 }, marketSession: { isOpen: true }, riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' },
      eventState: { state: 'CLEAR' } }, broker_position: { currentPrice: 190 } },
  { managementInputSnapshotId: UUID(1), reconciliationSnapshotId: UUID(2), observedAt: T0 });
  const frontier = buildManagementActionFrontier(held);
  assert.deepEqual(frontier.actions.map((a) => a.action), ['RECOVERY_WAIT']);
  assert.deepEqual(THETA_LIFECYCLE_TRANSITIONS.STOCK_HELD, ['RECOVERY_WAIT']);
  const policy = decide({ ...held, assignedAtObservedAt: '2026-08-13T14:00:00.000Z', annualOpportunityCostRate: 0.05,
    sellStockOpportunityCostUtilityWeight: 0.02, recoveryForwardHorizonDays: 30, ccCandidate: callTarget(), sellCcPremiumUtilityWeight: 1 });
  assert.notEqual(policy.frontier.selectedAction, 'SELL_STOCK');
  assert.notEqual(policy.frontier.selectedAction, 'SELL_CC');
  const compiled = compileManagementExecutionLegDirectives(held, policy.frontier);
  assert.equal(compiled.state, 'NO_BROKER_ACTION');
});

test('D4 policy wiring: the roll capital-day weight prices a same-collateral extension through the real policy', () => {
  const state = managed();
  const sameStrikeFar = rollTarget({ optionContractId: UUID(12), strike: 200, expiration: '2027-04-16', symbol: 'AAPL270416P00200000', bid: 3, ask: 3.1 });
  assert.equal(decide({ ...state, rollCandidates: [sameStrikeFar] }).frontier.selectedAction, 'ROLL', 'weight 0 (default): pure net credit');
  // 20,000 of collateral held ~182 extra days: a 0.001/USD-day weight costs ~3,640 and removes a 190 net credit
  const priced = decide({ ...state, rollCandidates: [sameStrikeFar], rollIncrementalCapitalDayWeight: 0.001 });
  assert.equal(priced.frontier.selectedAction, 'HOLD');
  assert.ok((priced.evidence?.actionValues.find((v) => v.action === 'ROLL')?.reasons ?? []).some((r) => r.startsWith('INCREMENTAL_CAPITAL_DAYS_')));
});

// ---------------------------------------------------------------------------------------------------------------------
// P2-04 / P2-05: two share truths and free-sellable shares gate every stock disposal.
// ---------------------------------------------------------------------------------------------------------------------

test('P2-04 scan time: ledger vs broker shares - only an exact, GOOD, fresh agreement compiles a stock exit', () => {
  const compileFor = (state: ManagementInputState) => compileManagementExecutionLegDirectives(state, decide(state).frontier);
  const ok = sellStockState(stockRead(), { shares: '100', brokerShares: '100' });
  assert.equal(compileFor(ok).state, 'READY');
  const cases: readonly [string, ManagementInputState, string][] = [
    ['ledger 100 / broker 99', sellStockState(stockRead(), { shares: '100', brokerShares: '99' }), 'STOCK_SHARES_LEDGER_BROKER_MISMATCH:LEDGER_AHEAD_OF_BROKER'],
    ['ledger 100 / broker 0', sellStockState(stockRead(), { shares: '100', brokerShares: '0' }), 'STOCK_SHARES_LEDGER_BROKER_MISMATCH:LEDGER_AHEAD_OF_BROKER'],
    ['ledger 100 / broker 150', sellStockState(stockRead(), { shares: '100', brokerShares: '150' }), 'STOCK_SHARES_LEDGER_BROKER_MISMATCH:BROKER_AHEAD_OF_LEDGER'],
    ['broker unavailable', { ...ok, brokerStockInventory: { state: 'UNKNOWN', quantity: null, observedAt: null, reason: 'BROKER_POSITION_UNAVAILABLE' } },
      'STOCK_SHARES_BROKER_EVIDENCE_UNKNOWN:BROKER_UNAVAILABLE'],
    ['broker evidence absent', { ...ok, brokerStockInventory: undefined }, 'STOCK_SHARES_BROKER_EVIDENCE_UNKNOWN:BROKER_UNAVAILABLE'],
    ['stale broker snapshot', { ...ok, brokerStockInventory: { state: 'KNOWN', quantity: 100, observedAt: '2026-10-13T13:50:00.000Z', reason: null } },
      'STOCK_SHARES_BROKER_EVIDENCE_UNKNOWN:BROKER_EVIDENCE_STALE'],
    ['broker short stock', { ...ok, brokerStockInventory: { state: 'KNOWN', quantity: -100, observedAt: T_NEAR, reason: null } },
      'STOCK_SHARES_LEDGER_BROKER_MISMATCH:BROKER_SHORT_STOCK_POSITION'],
  ];
  for (const [label, state, blocker] of cases) {
    const compiled = compileFor(state);
    assert.equal(compiled.state, 'BLOCKED', label);
    assert.deepEqual(compiled.blockers, [blocker], label);
  }
  // ledger 0 / broker 100 never even offers SELL_STOCK (no ledger inventory)
  const noLedger = sellStockState(stockRead(), { shares: '0', brokerShares: '100' });
  assert.ok(buildManagementActionFrontier(noLedger).actions.find((a) => a.action === 'SELL_STOCK')?.blockers.includes('NO_OPEN_STOCK_INVENTORY'));
  assert.equal(compileManagementExecutionLegDirectives(noLedger, { ...decide(noLedger).frontier, selectedAction: 'SELL_STOCK' }).state === 'READY', false);
});

test('P2-04 submit time: a fresh broker inventory read must agree; no source / failed read / mismatch never reaches a quote or order', async () => {
  const state = sellStockState(stockRead());
  const ready = await flow(state, { AAPL: stockQuote(190, 190.1) }, { committedShortCallContracts: 0 });
  assert.equal(ready.assembled?.state, 'READY');
  if (ready.assembled?.state !== 'READY') return;
  const plan = ready.assembled.plans[0] as ApprovedMasterPaperActionPlan;
  assert.equal(plan.brokerConfirmedShares, 100);
  assert.equal(plan.freeSellableShares, 100);
  let quoteCalls = 0;
  const quotes = { getCurrentQuote: async () => { quoteCalls += 1; return stockQuote(190, 190.1); } };
  const known = (quantity: number, committed: number | null = 0): StockInventorySource => ({ async readStockInventory() {
    return { inventory: { state: 'KNOWN', quantity, observedAt: T_NEAR, reason: null }, committedShortCallContracts: committed }; } });
  const attempt = (inventory?: StockInventorySource, p: ApprovedMasterPaperActionPlan = plan) =>
    prepareMasterPaperAction(p, quotes, T_NEAR, true, undefined, () => T_NEAR, inventory);
  assert.deepEqual((await attempt(undefined)).blockers, ['STOCK_INVENTORY_SOURCE_UNAVAILABLE']);
  assert.deepEqual((await attempt({ async readStockInventory() { throw new Error('down'); } })).blockers, ['STOCK_INVENTORY_READ_FAILED']);
  assert.deepEqual((await attempt(known(99))).blockers, ['STOCK_SHARES_LEDGER_BROKER_MISMATCH:LEDGER_AHEAD_OF_BROKER']);
  assert.deepEqual((await attempt(known(0))).blockers, ['STOCK_SHARES_LEDGER_BROKER_MISMATCH:LEDGER_AHEAD_OF_BROKER']);
  assert.deepEqual((await attempt(known(150))).blockers, ['STOCK_SHARES_LEDGER_BROKER_MISMATCH:BROKER_AHEAD_OF_LEDGER']);
  assert.deepEqual((await attempt({ async readStockInventory() {
    return { inventory: { state: 'UNKNOWN', quantity: null, observedAt: null, reason: 'BROKER_POSITION_UNAVAILABLE' }, committedShortCallContracts: 0 }; } })).blockers,
  ['STOCK_SHARES_BROKER_EVIDENCE_UNKNOWN:BROKER_UNAVAILABLE']);
  assert.deepEqual((await attempt(known(100, 1))).blockers, ['STOCK_SALE_WITH_SHORT_CALLS_COMMITTED']);
  assert.deepEqual((await attempt(known(100, null))).blockers, ['COMMITTED_SHORT_CALLS_UNKNOWN']);
  // a plan stripped of the share evidence is blocked before any read
  const stripped = { ...plan } as Record<string, unknown>; delete stripped.brokerConfirmedShares;
  assert.ok((await attempt(known(100), stripped as never)).blockers.includes('STOCK_SALE_SHARE_RECONCILIATION_NOT_CONFIRMED'));
  assert.equal(quoteCalls, 0, 'no quote is fetched for any blocked stock exit');
  assert.equal((await attempt(known(100))).state, 'READY_TO_SUBMIT');
});
