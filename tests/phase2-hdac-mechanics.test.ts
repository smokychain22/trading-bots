import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { coveredCallContractCapacity } from '../src/theta/secured-contract-capacity.js';
import { deriveCommittedShortCallContracts } from '../src/theta/account-exposure.js';
import { canonicalThetaStrategySources } from '../src/theta/strategy-package.js';

// Phase 2 (offline deterministic correctness): strategies H, D, A, C mechanics and applicability.
// Synthetic data only. No broker, no network, no Production.

const NOW = '2026-09-14T15:00:00.000Z';
type RawContract = Parameters<typeof normalizeOptionContract>[0];

function put(overrides: Partial<RawContract> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...overrides,
  }, NOW);
}
const shortPut = () => put();
// THETA_H window is 2..5 DTE (strategy-package.ts). 2026-09-18 is 4 DTE from 2026-09-14.
const hPut = (overrides: Partial<RawContract> = {}) => put({
  optionSymbol: 'AAPL260918P00190000', occSymbol: 'AAPL260918P00190000', expiration: '2026-09-18', bid: 0.8, ask: 0.9, ...overrides,
});
const longPut = (overrides: Partial<RawContract> = {}) => put({
  optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000', strike: 185, bid: 0.9, ask: 1, delta: -0.15, ...overrides,
});
const call = (overrides: Partial<RawContract> = {}) => put({
  optionSymbol: 'AAPL261016C00210000', occSymbol: 'AAPL261016C00210000', optionType: 'CALL', strike: 210,
  bid: 1.5, ask: 1.6, delta: 0.2, ...overrides,
});

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: eligible.includes(strategyFamily) ? 'ROUTE_APPLICABLE' : 'ROUTE_NOT_APPLICABLE', polarity: 0, detail: 'test route' }],
      policyVersion: 'router-v1',
    })),
  });
}

const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1',
  assignmentCapacityQty: 5, aegisNewRiskState: 'ALLOW_FULL' as const,
  buyingPower: 1_000_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 9, collateralQtyCap: 9, concentrationQtyCap: 9,
    assignmentCapacityQtyCap: 9, tailRiskQtyCap: 9, correlationQtyCap: 9,
    liquidityQtyCap: 9, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};
type Stock = NonNullable<CanonicalStrategyFrontierInput['stock']>;
const stock = (overrides: Partial<Stock> = {}): Stock => ({
  underlying: 'AAPL', shares: 100, currentPrice: 200, brokerCostBasisPerShare: 195, wholeChainEconomicBasisPerShare: 190, ...overrides,
});
const frontier = (input: Partial<CanonicalStrategyFrontierInput> & Pick<CanonicalStrategyFrontierInput, 'contracts'>) =>
  buildCanonicalStrategyFrontier({ ...base, stock: null, routing: routing(['THETA_Q']), ...input });
const branchOf = (f: ReturnType<typeof frontier>, name: string) => {
  const b = f.branches.find((x) => x.branch === name);
  assert.ok(b, `${name} branch present`);
  return b;
};

// ---------------------------------------------------------------------------------------------
// C: covered-call capacity
// ---------------------------------------------------------------------------------------------
test('C capacity boundaries: floor(shares/100), never fractional lots, never negative', () => {
  const table: Array<[number, number]> = [[0, 0], [1, 0], [99, 0], [100, 1], [101, 1], [199, 1], [200, 2], [250, 2]];
  for (const [shares, contracts] of table) assert.equal(coveredCallContractCapacity(shares, 0, 0), contracts, `shares=${shares}`);
});

test('C capacity subtracts already-covered contracts and pending sell-to-open calls, clamped at zero', () => {
  assert.equal(coveredCallContractCapacity(250, 1, 0), 1);
  assert.equal(coveredCallContractCapacity(250, 0, 1), 1);
  assert.equal(coveredCallContractCapacity(250, 1, 1), 0);
  assert.equal(coveredCallContractCapacity(250, 2, 3), 0, 'over-committed account has zero capacity, never negative');
  assert.equal(coveredCallContractCapacity(100, 1, 0), 0);
  assert.equal(coveredCallContractCapacity(99, 0, 0), 0);
  assert.equal(coveredCallContractCapacity(300, 0, 0, 100), 3);
  assert.equal(coveredCallContractCapacity(150, 0, 0, 50), 3, 'non-standard deliverable multiplier is honoured, not assumed to be 100');
});

test('C capacity is UNKNOWN (null), never zero-by-coercion, for any unknown or invalid input', () => {
  assert.equal(coveredCallContractCapacity(null, 0, 0), null);
  assert.equal(coveredCallContractCapacity(100, null, 0), null);
  assert.equal(coveredCallContractCapacity(100, 0, null), null);
  assert.equal(coveredCallContractCapacity(-1, 0, 0), null);
  assert.equal(coveredCallContractCapacity(Number.NaN, 0, 0), null);
  assert.equal(coveredCallContractCapacity(100, -1, 0), null);
  assert.equal(coveredCallContractCapacity(100, 0.5, 0), null);
  assert.equal(coveredCallContractCapacity(100, 0, 0, 0), null);
});

test('C committed short-call derivation counts open short calls and pending STO calls; unknown stays null', () => {
  const pos = (symbol: string, quantity: number | null, side: 'long' | 'short', assetClass = 'us_option') =>
    ({ symbol, assetClass, quantity, side, marketValue: 1, unrealizedPl: 0, avgEntryPrice: 1, receivedAt: NOW }) as never;
  const ord = (symbol: string | null, positionIntent: string | null, quantity: number | null) =>
    ({ orderId: 'o', clientOrderId: null, symbol, side: 'sell', positionIntent, quantity, limitPrice: 1, status: 'new', submittedAt: NOW, receivedAt: NOW }) as never;
  const C = 'AAPL261016C00210000';
  assert.equal(deriveCommittedShortCallContracts('AAPL', [], []), 0);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos(C, -2, 'short')], []), 2);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos(C, 2, 'short')], []), 2);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos(C, 3, 'long')], []), 0, 'long calls do not consume stock cover');
  assert.equal(deriveCommittedShortCallContracts('AAPL', [], [ord(C, 'sell_to_open', 1)]), 1);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos(C, -1, 'short')], [ord(C, 'sell_to_open', 2)]), 3);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [], [ord(C, 'buy_to_close', 1)]), 0);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos('AAPL261016P00190000', -1, 'short')], [ord('AAPL261016P00190000', 'sell_to_open', 1)]), 0,
    'short puts consume cash collateral, not stock cover');
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos('MSFT261016C00400000', -5, 'short')], []), 0, 'other underlyings are ignored');
  // UNKNOWN: an order that cannot be proven not to be a short call poisons the figure.
  assert.equal(deriveCommittedShortCallContracts('AAPL', [], [ord(C, null, 1)]), null);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [], [ord(C, 'sell_to_open', null)]), null);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos(C, null, 'short')], []), null);
  assert.equal(deriveCommittedShortCallContracts('AAPL', [pos('GARBAGE', -1, 'short')], []), null);
});

test('C frontier: share boundaries produce at most floor(shares/100) contracts and never a naked call', () => {
  const cases: Array<[number, number]> = [[0, 0], [1, 0], [99, 0], [100, 1], [101, 1], [199, 1], [200, 2], [250, 2]];
  for (const [shares, maxContracts] of cases) {
    const f = frontier({ contracts: [call()], stock: stock({ shares }), routing: routing(['THETA_C']) });
    const cc = branchOf(f, 'THETA_CC');
    for (const candidate of cc.candidates) {
      assert.ok(candidate.sizing.quantity <= maxContracts, `shares=${shares} qty=${candidate.sizing.quantity}`);
      assert.equal(candidate.executionAuthorized, false);
      if (maxContracts === 0) {
        assert.equal(candidate.sizing.quantity, 0);
        assert.equal(candidate.riskFeasible, false, `shares=${shares}: no covered shares must be a hard blocker`);
        assert.ok(candidate.hardBlockers.includes('INSUFFICIENT_COVERED_SHARES') || candidate.hardBlockers.includes('NO_CONFIRMED_STOCK_INVENTORY'));
      }
    }
    if (maxContracts > 0) assert.equal(cc.candidates[0]?.sizing.quantity, maxContracts, `shares=${shares}`);
  }
});

test('C frontier: existing short calls and pending CC orders reduce capacity; over-commitment yields zero', () => {
  const run = (committed: number | null | undefined, shares = 250) => branchOf(frontier({
    contracts: [call()], stock: stock({ shares, ...(committed === undefined ? {} : { committedShortCallContracts: committed }) }),
    routing: routing(['THETA_C']),
  }), 'THETA_CC').candidates[0];
  assert.equal(run(0)?.sizing.quantity, 2);
  assert.equal(run(1)?.sizing.quantity, 1);
  const full = run(2);
  assert.equal(full?.sizing.quantity, 0);
  assert.ok(full?.hardBlockers.includes('COVERED_SHARES_ALREADY_COMMITTED'));
  assert.equal(full?.riskFeasible, false);
  const over = run(5);
  assert.equal(over?.sizing.quantity, 0, 'never negative, never naked');
  const unknown = run(null);
  assert.equal(unknown?.sizing.quantity, 0, 'unknown commitment is UNKNOWN, not zero commitment');
  assert.ok(unknown?.hardBlockers.includes('COVERED_CALL_COMMITMENT_UNKNOWN'));
  assert.equal(unknown?.riskFeasible, false);
});

test('C frontier: unknown share quantity is a blocker with zero size, never assumed 100', () => {
  const candidate = branchOf(frontier({ contracts: [call()], stock: stock({ shares: null }), routing: routing(['THETA_C']) }), 'THETA_CC').candidates[0];
  assert.equal(candidate?.sizing.quantity, 0);
  assert.ok(candidate?.hardBlockers.includes('STOCK_QUANTITY_UNKNOWN'));
});

test('C frontier: flat account has no covered-call candidates and the router-not-applicable marker holds', () => {
  const flat = frontier({ contracts: [call(), put()], stock: null, routing: routing(['THETA_Q']) });
  const cc = branchOf(flat, 'THETA_CC');
  assert.equal(cc.applicable, false);
  assert.equal(cc.evaluationState, 'NOT_APPLICABLE');
  assert.equal(cc.candidateCount, 0);
  assert.equal(cc.executionAuthorized, false);
  // Even if a (buggy) router claims C eligible with no stock object, no candidate or quantity can appear.
  const claimed = frontier({ contracts: [call()], stock: null, routing: routing(['THETA_C']) });
  const ccClaimed = branchOf(claimed, 'THETA_CC');
  assert.equal(ccClaimed.candidateCount, 0);
  assert.equal(ccClaimed.candidates.reduce((sum, candidate) => sum + candidate.sizing.quantity, 0), 0);
});

test('C frontier: stock-zero with router-ineligible C is not applicable and every row is router-blocked at zero quantity', () => {
  const f = frontier({ contracts: [call()], stock: stock({ shares: 0 }), routing: routing(['THETA_Q']) });
  const cc = branchOf(f, 'THETA_CC');
  assert.equal(cc.applicable, false);
  for (const candidate of cc.candidates) {
    assert.equal(candidate.sizing.quantity, 0);
    assert.ok(candidate.hardBlockers.includes('ROUTER_NOT_APPLICABLE'));
  }
});

// ---------------------------------------------------------------------------------------------
// A: assigned-stock recovery applicability
// ---------------------------------------------------------------------------------------------
test('A applicability: flat account is NOT_APPLICABLE; only broker-confirmed stock makes it applicable', () => {
  const flat = branchOf(frontier({ contracts: [call()], stock: null, routing: routing(['THETA_Q']) }), 'THETA_RECOVERY');
  assert.equal(flat.applicable, false);
  assert.equal(flat.evaluationState, 'NOT_APPLICABLE');
  assert.equal(flat.candidateCount, 0);
  const zero = branchOf(frontier({ contracts: [call()], stock: stock({ shares: 0 }), routing: routing(['THETA_Q']) }), 'THETA_RECOVERY');
  assert.equal(zero.applicable, false, 'a zero-share stock row is not inventory');
  for (const share of [1, 50, 99, 100, 250]) {
    const held = branchOf(frontier({ contracts: [call()], stock: stock({ shares: share }), routing: routing(['THETA_Q']) }), 'THETA_RECOVERY');
    assert.equal(held.applicable, true, `shares=${share}`);
  }
});

test('A: SELL_STOCK / RECOVERY_WAIT quantities equal confirmed shares and are zero when inventory is absent or unknown', () => {
  const rows = (shares: number | null) => branchOf(frontier({ contracts: [call()], stock: stock({ shares }), routing: routing(['THETA_A']) }), 'THETA_RECOVERY').candidates;
  const sell = (shares: number | null) => rows(shares).find((c) => c.action === 'SELL_STOCK');
  for (const shares of [1, 99, 100, 101, 250]) assert.equal(sell(shares)?.sizing.quantity, shares);
  assert.equal(sell(0)?.sizing.quantity, 0);
  assert.ok(sell(0)?.hardBlockers.includes('NO_CONFIRMED_STOCK_INVENTORY'));
  assert.equal(sell(null)?.sizing.quantity, 0);
  assert.ok(sell(null)?.hardBlockers.includes('STOCK_QUANTITY_UNKNOWN'));
  assert.equal(rows(100).find((c) => c.action === 'RECOVERY_WAIT')?.sizing.quantity, 0, 'waiting places no order');
});

test('A: unknown basis and unknown mark stay UNKNOWN and are never coerced to zero', () => {
  const candidates = branchOf(frontier({
    contracts: [call()], routing: routing(['THETA_A']),
    stock: stock({ shares: 100, brokerCostBasisPerShare: null, wholeChainEconomicBasisPerShare: null, currentPrice: null }),
  }), 'THETA_RECOVERY').candidates;
  const sell = candidates.find((c) => c.action === 'SELL_STOCK');
  assert.ok(sell);
  assert.ok(sell.unknownEvidence.includes('BROKER_COST_BASIS_UNKNOWN'));
  assert.ok(sell.unknownEvidence.includes('WHOLE_CHAIN_ECONOMIC_BASIS_UNKNOWN'));
  assert.ok(sell.unknownEvidence.includes('STOCK_MARK_UNKNOWN'));
  assert.ok(sell.hardBlockers.includes('EXECUTABLE_STOCK_PRICE_UNKNOWN'), 'cannot sell shares at an unknown price');
  const ccAlt = candidates.find((c) => c.action === 'SELL_CC');
  assert.ok(ccAlt);
  assert.equal(ccAlt.economics.wholeChainPnlAtCallAway, null, 'unknown basis => unknown chain P&L, not 0');
  assert.equal(ccAlt.economics.retainedUpside, null, 'unknown mark => unknown retained upside, not 0');
  for (const candidate of candidates) assert.equal(candidate.executionAuthorized, false);
});

test('A: mixed-basis lots are represented only by explicit basis fields; the frontier invents no synthetic inventory', () => {
  // The frontier takes one aggregate share count from broker truth. It must not synthesize extra shares
  // from option intent: with only an option leg (no stock row) there is no inventory at all.
  const f = frontier({ contracts: [put(), call()], stock: null, routing: routing(['THETA_Q', 'THETA_R']) });
  assert.equal(branchOf(f, 'THETA_RECOVERY').candidateCount, 0);
  assert.equal(branchOf(f, 'THETA_CC').candidateCount, 0);
  assert.equal(f.primaryAction === 'MANAGEMENT_AUTHORITY', false, 'flat account must not demand management authority');
});

test('A/C applicable stock routes new-risk selection to management authority and never selects a Q order', () => {
  const f = frontier({ contracts: [put(), call()], stock: stock({ shares: 100 }), routing: routing(['THETA_Q', 'THETA_A', 'THETA_C']) });
  assert.equal(f.primaryAction, 'MANAGEMENT_AUTHORITY');
  assert.equal(f.selectedCandidateId, null);
  assert.equal(f.selectedQuantity, 0);
  assert.equal(f.executionAuthorized, false);
});

// ---------------------------------------------------------------------------------------------
// D: defined-risk put credit spread mechanics
// ---------------------------------------------------------------------------------------------
const dBranch = (contracts: NormalizedOptionContract[], opts: Partial<CanonicalStrategyFrontierInput> = {}) =>
  branchOf(frontier({ contracts, routing: routing(['THETA_Q', 'THETA_D']), ...opts }), 'THETA_DEFINED_RISK');

test('D mechanics: net credit, width, max profit, max loss, breakeven, collateral from BBO per leg', () => {
  const d = dBranch([shortPut(), longPut()]);
  assert.equal(d.candidates.length, 1);
  const c = d.candidates[0];
  assert.ok(c);
  // short leg SELL at bid 2.00, long leg BUY at ask 1.00 => credit 1.00 per share; width 5.
  assert.equal(c.legs.length, 2);
  assert.equal(c.legs[0]?.positionIntent, 'SELL_TO_OPEN');
  assert.equal(c.legs[1]?.positionIntent, 'BUY_TO_OPEN');
  assert.equal(c.legs[0]?.optionSymbol, 'AAPL261016P00190000');
  assert.equal(c.legs[1]?.optionSymbol, 'AAPL261016P00185000');
  assert.equal(c.economics.premiumPerShare, 1);
  assert.equal(c.economics.maxProfit, 100);
  assert.equal(c.economics.maxLoss, 400);
  assert.equal(c.economics.collateral, 400);
  assert.equal(c.economics.breakEven, 189);
  assert.ok(c.economics.maxLoss !== null && c.economics.maxLoss > 0);
  assert.equal(c.economics.maxProfit + c.economics.maxLoss, 5 * 100, 'maxProfit + maxLoss equals width * multiplier');
  assert.equal(c.hardBlockers.length, 0);
  assert.equal(c.executionAuthorized, false);
  assert.equal(c.multiLegRiskEvidence?.authority, 'RESEARCH_ONLY');
  assert.equal(c.multiLegRiskEvidence?.simultaneousFillState, 'NOT_OBSERVED_RESEARCH_ONLY');
  assert.equal(c.multiLegRiskEvidence?.fillRiskState, 'UNCALIBRATED');
  assert.equal(c.multiLegRiskEvidence?.shortLegQuoteState, 'TWO_SIDED');
  assert.equal(c.multiLegRiskEvidence?.longLegQuoteState, 'TWO_SIDED');
});

test('D rejects credit >= width, non-positive credit, and never reports a negative max loss', () => {
  const full = dBranch([shortPut(), longPut({ bid: 0, ask: 0.01 })]).candidates;
  const wide = dBranch([put({ bid: 5.2, ask: 5.3 }), longPut({ bid: 0, ask: 0 + 0.01 })]).candidates[0];
  assert.ok(wide);
  assert.ok(wide.hardBlockers.includes('NET_CREDIT_NOT_BELOW_SPREAD_WIDTH'));
  assert.equal(wide.riskFeasible, false);
  assert.ok(wide.economics.maxLoss !== null && wide.economics.maxLoss <= 0 || wide.economics.maxLoss === null || wide.hardBlockers.length > 0);
  assert.equal(wide.sizing.quantity, 0, 'a rejected spread has quantity zero');
  assert.ok(full[0]);
  const debit = dBranch([put({ bid: 0.5, ask: 0.6 }), longPut({ bid: 1.4, ask: 1.5 })]).candidates[0];
  assert.ok(debit?.hardBlockers.includes('NON_POSITIVE_NET_CREDIT'));
  assert.equal(debit?.riskFeasible, false);
  const exactWidth = dBranch([put({ bid: 5.5, ask: 5.6 }), longPut({ bid: 0.4, ask: 0.5 })]).candidates[0];
  assert.ok(exactWidth?.hardBlockers.includes('NET_CREDIT_NOT_BELOW_SPREAD_WIDTH'), 'credit == width is rejected (zero max loss is impossible)');
});

test('D rejects wrong strike ordering, equal strikes, and mismatched expiry pairing', () => {
  // Wrong ordering: the "long" put has the higher strike. The enumerator never pairs it as a credit spread.
  const inverted = dBranch([longPut(), shortPut()]);
  assert.equal(inverted.candidates.length, 1, 'only the correctly ordered pair is enumerated');
  assert.equal(inverted.candidates[0]?.legs[0]?.optionSymbol, 'AAPL261016P00190000');
  assert.equal(dBranch([shortPut(), put({ optionSymbol: 'AAPL261016P00190000X', occSymbol: null })]).candidates.every((c) => c.legs.length === 2), true);
  // Different expiries are never paired (no calendar/diagonal masquerading as a vertical).
  const otherExpiry = put({
    optionSymbol: 'AAPL261023P00185000', occSymbol: 'AAPL261023P00185000', expiration: '2026-10-23', strike: 185, bid: 0.9, ask: 1,
  });
  assert.equal(dBranch([shortPut(), otherExpiry]).candidates.length, 0);
  // Equal strikes are never a spread.
  const sameStrike = put({ optionSymbol: 'AAPL261016P00190001', occSymbol: 'AAPL261016P00190001' });
  assert.equal(dBranch([shortPut(), sameStrike]).candidates.length, 0);
});

test('D rejects a missing leg: a lone put or a lone call never becomes a one-leg fallback', () => {
  const lone = dBranch([shortPut()]);
  assert.equal(lone.candidates.length, 0);
  assert.notEqual(lone.evaluationState, 'EVALUATED', 'no structure => not a successful evaluation');
  const callsOnly = dBranch([call(), call({ optionSymbol: 'AAPL261016C00215000', occSymbol: 'AAPL261016C00215000', strike: 215 })]);
  assert.equal(callsOnly.candidates.length, 0, 'D is a put credit spread; calls are never paired');
  for (const c of dBranch([shortPut(), longPut(), put({ optionSymbol: 'AAPL261016P00180000', occSymbol: 'AAPL261016P00180000', strike: 180, bid: 0.3, ask: 0.4 })]).candidates) {
    assert.equal(c.legs.length, 2, 'every D candidate has exactly two legs');
    assert.equal(c.action, 'OPEN_DEFINED_RISK');
  }
});

test('D missing BBO on one leg is UNKNOWN price, hard-blocked, quantity zero (never a zero-price leg)', () => {
  const noAsk = dBranch([shortPut(), longPut({ bid: null, ask: null })]).candidates[0];
  assert.ok(noAsk);
  assert.ok(noAsk.hardBlockers.includes('MULTI_LEG_PRICE_UNKNOWN'));
  assert.equal(noAsk.economics.premiumPerShare, null);
  assert.equal(noAsk.economics.maxLoss, null);
  assert.equal(noAsk.economics.maxProfit, null);
  assert.equal(noAsk.sizing.quantity, 0);
  assert.equal(noAsk.riskFeasible, false);
  const noBid = dBranch([put({ bid: null, ask: null }), longPut()]).candidates[0];
  assert.ok(noBid?.hardBlockers.includes('MULTI_LEG_PRICE_UNKNOWN'));
  assert.equal(noBid?.sizing.quantity, 0);
});

test('D one stale or crossed leg makes the spread infeasible (never selectable)', () => {
  const stale = dBranch([shortPut(), longPut({ quoteTimestamp: '2026-09-14T14:00:00.000Z' })]).candidates[0];
  assert.ok(stale);
  assert.equal(stale.riskFeasible, false, 'a stale long leg makes the whole spread unusable');
  assert.equal(stale.executionAuthorized, false);
  assert.ok(stale.hardBlockers.some((b) => b.startsWith('DEFINED_RISK_LEG_QUOTE')));
  const crossed = dBranch([shortPut(), longPut({ bid: 1.2, ask: 1 })]).candidates[0];
  assert.ok(crossed);
  assert.equal(crossed.riskFeasible, false);
  assert.ok(crossed.hardBlockers.some((b) => b.startsWith('DEFINED_RISK_LEG_QUOTE')));
});

test('D opening cost sizing: fees and slippage reduce, never increase, the after-cost view', () => {
  const costly = dBranch([shortPut(), longPut()], {
    openingCostPolicy: { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 2, costModelVersion: 'test-v1' },
  }).candidates[0];
  const free = dBranch([shortPut(), longPut()]).candidates[0];
  assert.ok(costly && free);
  assert.equal(costly.economics.modeledOpeningCosts.total === null ? false : costly.economics.modeledOpeningCosts.total > 0, true);
  assert.equal(free.economics.modeledOpeningCosts.total, null, 'no cost policy => costs UNKNOWN, not zero');
  assert.ok(free.multiLegRiskEvidence?.unknownReasons.includes('OPENING_COST_UNKNOWN'));
  assert.equal(costly.economics.maxProfit, free.economics.maxProfit, 'gross max profit is unchanged by the cost model');
});

// ---------------------------------------------------------------------------------------------
// H / D isolation from Q (shadow branches)
// ---------------------------------------------------------------------------------------------
test('H and D are shadow/research only: neither has broker authority or an executable sizing path', () => {
  const sources = canonicalThetaStrategySources as ReadonlyArray<{ branch?: string; strategyVersion: string; status: string }>;
  const statuses = new Map(sources.map((s) => [s.branch ?? s.strategyVersion, s.status]));
  void statuses;
  const f = frontier({
    contracts: [shortPut(), longPut()], routing: routing(['THETA_Q', 'THETA_H', 'THETA_D']),
    sizingPolicy: base.sizingPolicy,
  });
  for (const name of ['THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK']) {
    const b = branchOf(f, name);
    assert.ok(['RESEARCH_ONLY', 'SHADOW'].includes(b.status), `${name} status ${b.status}`);
    assert.equal(b.executionAuthorized, false);
    assert.equal(b.empiricalEconomicsReady, false);
    for (const candidate of b.candidates) assert.equal(candidate.executionAuthorized, false);
  }
  assert.equal(f.executionAuthorized, false);
});

test('H ranking cannot override Q: selection only ever comes from THETA_CONVENTIONAL OPEN_CSP candidates', () => {
  // Make H dramatically "better" on paper (higher premium) and confirm Q still owns the selection.
  const richPut = put({ optionSymbol: 'AAPL261016P00195000', occSymbol: 'AAPL261016P00195000', strike: 195, bid: 9, ask: 9.1, delta: -0.4 });
  const f = frontier({ contracts: [shortPut(), richPut], routing: routing(['THETA_Q', 'THETA_H']) });
  const selectedId = f.selectedCandidateId;
  if (selectedId !== null) {
    assert.ok(selectedId.startsWith('THETA_CONVENTIONAL:'), `selected ${selectedId}`);
    assert.equal(f.selectedBranch, 'THETA_CONVENTIONAL');
  }
  assert.notEqual(f.selectedBranch, 'THETA_HOLD_STRIKE');
  assert.notEqual(f.selectedBranch, 'THETA_DEFINED_RISK');
  assert.equal(f.secondBestCandidateId === null || !f.secondBestCandidateId.startsWith('THETA_HOLD_STRIKE'), true);
});

test('H with every short-DTE feature missing is PARTIAL/UNKNOWN, never zero, and cannot create a Production WAIT', () => {
  const missing = hPut({ gamma: null, theta: null, iv: null, delta: null, vega: null, rho: null, greeksSource: null, greeksTimestamp: null });
  const withMissing = frontier({ contracts: [missing, shortPut()], routing: routing(['THETA_Q', 'THETA_H']), maxAdverseGap60d: null });
  const hold = branchOf(withMissing, 'THETA_HOLD_STRIKE');
  const h = hold.candidates[0];
  assert.ok(h);
  assert.equal(h.shortDteRiskEvidence?.state, 'PARTIAL');
  assert.equal(h.shortDteRiskEvidence?.gamma, null, 'unknown gamma is null, not 0');
  assert.equal(h.shortDteRiskEvidence?.theta, null, 'unknown theta is null, not 0');
  for (const reason of ['GAMMA_UNKNOWN', 'THETA_UNKNOWN', 'MAX_ADVERSE_GAP_60D_UNKNOWN']) {
    assert.ok(h.shortDteRiskEvidence?.unknownReasons.includes(reason), reason);
  }
  assert.equal(h.executionAuthorized, false);
  // H's incompleteness must not alter Q's outcome: compare the Q branch and the primary action with and without H routed.
  const qOnly = frontier({ contracts: [missing, shortPut()], routing: routing(['THETA_Q']), maxAdverseGap60d: null });
  assert.equal(withMissing.primaryAction, qOnly.primaryAction);
  assert.equal(withMissing.selectedQuantity, qOnly.selectedQuantity);
  assert.equal(withMissing.globalWaitEarned, qOnly.globalWaitEarned);
  assert.equal(branchOf(withMissing, 'THETA_CONVENTIONAL').evaluationState, branchOf(qOnly, 'THETA_CONVENTIONAL').evaluationState);
});

test('H and D failure cannot block Q', () => {
  const baseline = frontier({ contracts: [shortPut()], routing: routing(['THETA_Q']) });
  const qBranch = branchOf(baseline, 'THETA_CONVENTIONAL');
  assert.equal(qBranch.evaluationState, 'EVALUATED');
  // Hostile contract whose gamma getter throws only for H-specific reads would be shadow-local; here we
  // make D/H structurally impossible (calls only for D, one-sided books) and require Q to be unchanged.
  const hostile = frontier({ contracts: [shortPut(), longPut({ bid: null, ask: null })], routing: routing(['THETA_Q', 'THETA_H', 'THETA_D']) });
  const q2 = branchOf(hostile, 'THETA_CONVENTIONAL');
  assert.equal(q2.applicable, true);
  assert.equal(q2.evaluationState, 'EVALUATED');
  assert.ok(q2.candidates.some((c) => c.sizing.quantity > 0 && c.riskFeasible), 'Q still has a sized, feasible candidate');
  assert.equal(hostile.selectedBranch, 'THETA_CONVENTIONAL');
  assert.equal(hostile.primaryAction, 'OPEN_CSP');
});

test('H and D consume no Production capital: their rows never contribute to the selected quantity or collateral', () => {
  const f = frontier({ contracts: [shortPut(), longPut()], routing: routing(['THETA_Q', 'THETA_H', 'THETA_D']) });
  assert.equal(f.selectedBranch, 'THETA_CONVENTIONAL');
  assert.ok(f.selectedCandidateId?.startsWith('THETA_CONVENTIONAL:'));
  const selected = f.branches.flatMap((b) => b.candidates).filter((c) => c.candidateId === f.selectedCandidateId);
  assert.equal(selected.length, 1);
  assert.equal(f.selectedQuantity, selected[0]?.sizing.quantity ?? -1);
  // H/D rows carry sizing for research comparison only, authorised for nothing.
  for (const b of f.branches.filter((x) => x.branch === 'THETA_HOLD_STRIKE' || x.branch === 'THETA_DEFINED_RISK')) {
    for (const c of b.candidates) assert.equal(c.executionAuthorized, false);
  }
});

test('H: a router-ineligible H branch never receives non-zero quantity even though its rows are enumerated for research', () => {
  const f = frontier({ contracts: [hPut(), shortPut()], routing: routing(['THETA_Q']) });
  const h = branchOf(f, 'THETA_HOLD_STRIKE');
  assert.equal(h.applicable, false);
  assert.ok(h.candidates.length > 0, 'research rows are still enumerated');
  for (const c of h.candidates) {
    assert.equal(c.sizing.quantity, 0);
    assert.ok(c.hardBlockers.includes('ROUTER_NOT_APPLICABLE'));
    assert.equal(c.riskFeasible, false);
  }
});

test('H mechanics: pin distance, gap, gamma, theta and spread are carried through when present', () => {
  const f = frontier({ contracts: [hPut(), shortPut()], routing: routing(['THETA_Q', 'THETA_H']), maxAdverseGap60d: 0.07 });
  const h = branchOf(f, 'THETA_HOLD_STRIKE').candidates[0];
  assert.ok(h?.shortDteRiskEvidence);
  const e = h.shortDteRiskEvidence;
  assert.equal(e.gamma, 0.01);
  assert.equal(e.theta, -0.04);
  assert.equal(e.maxAdverseGap60d, 0.07);
  assert.ok(Math.abs((e.pinDistancePct ?? Number.NaN) - 10 / 200) < 1e-12, 'pin distance = |spot-strike|/spot');
  assert.ok(Math.abs((e.distanceToStrikePct ?? Number.NaN) - 10 / 190) < 1e-12);
  assert.equal(e.assignmentConsequence, 'SHORT_PUT_MAY_ASSIGN_STOCK');
  assert.equal(e.authority, 'RESEARCH_ONLY');
  assert.equal(h.economics.maxProfit, 80, 'bid * multiplier, not mid');
  assert.equal(h.economics.maxLoss, (190 - 0.8) * 100);
  assert.equal(h.economics.breakEven, 189.2);
  assert.equal(h.dte, 4);
});

test('H short-DTE window is 2..5 DTE inclusive and is disjoint from the 32-DTE Q contract', () => {
  const at = (dte: number) => {
    const day = String(14 + dte).padStart(2, '0');
    const symbol = `AAPL2609${day}P00190000`;
    return hPut({ optionSymbol: symbol, occSymbol: symbol, expiration: `2026-09-${day}` });
  };
  const count = (dte: number) => branchOf(frontier({ contracts: [at(dte)], routing: routing(['THETA_Q', 'THETA_H']) }), 'THETA_HOLD_STRIKE').candidates.length;
  assert.equal(count(1), 0);
  assert.equal(count(2), 1);
  assert.equal(count(5), 1);
  assert.equal(count(6), 0);
  assert.equal(branchOf(frontier({ contracts: [shortPut()], routing: routing(['THETA_Q', 'THETA_H']) }), 'THETA_HOLD_STRIKE').candidates.length, 0);
});

test('H pin risk: an at-the-money short put reports zero pin distance, and an unknown spot reports UNKNOWN not zero', () => {
  const atm = hPut({ underlyingBid: 189.9, underlyingAsk: 190.1, underlyingLast: 190 });
  const atmEvidence = branchOf(frontier({ contracts: [atm], routing: routing(['THETA_Q', 'THETA_H']) }), 'THETA_HOLD_STRIKE').candidates[0]?.shortDteRiskEvidence;
  assert.equal(atmEvidence?.pinDistancePct, 0);
  assert.equal(atmEvidence?.distanceToStrikePct, 0);
  const noSpot = hPut({ underlyingBid: null, underlyingAsk: null, underlyingLast: null });
  const e = branchOf(frontier({ contracts: [noSpot], routing: routing(['THETA_Q', 'THETA_H']) }), 'THETA_HOLD_STRIKE').candidates[0]?.shortDteRiskEvidence;
  assert.equal(e?.pinDistancePct, null);
  assert.equal(e?.distanceToStrikePct, null);
  assert.ok(e?.unknownReasons.includes('UNDERLYING_REFERENCE_UNKNOWN'));
});
