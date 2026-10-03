// Phase 4: conservation properties over seeded random books (pure functions, no I/O).
//  - CAPITAL: positions + pending orders are counted exactly once; order of the inputs is irrelevant; cancelling a pending order releases exactly
//    its reserve once; a fill converts the pending reserve into actual exposure with no net change; more exposure never increases capacity.
//  - SHARES: free + committed == reconciled; capacity never exceeds what the shares cover; no call can become naked.
//  - WHOLE CHAIN: cash flows are counted exactly once; a realized loss cannot disappear; unknown stays unknown.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAccountExposure, deriveCandidateCapacityAssessment, type DerivedAccountExposure } from '../src/theta/account-exposure.js';
import type { AlpacaOpenOrderSnapshot, AlpacaPositionSnapshot, MasterAccountSnapshot } from '../src/theta/alpaca-provider.js';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { coveredCallContractCapacity, securedContractCapacity, wholeContractsAffordable } from '../src/theta/secured-contract-capacity.js';
import { freeSellableShares } from '../src/theta/stock-share-reconciliation.js';
import { computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NOW = '2026-10-02T15:00:00.000Z';
const UNDERLYINGS = ['AAA', 'BBB', 'CCC', 'DDD'];
const account = (equity: number): MasterAccountSnapshot => ({ accountStatus: 'ACTIVE', equity, cash: equity, buyingPower: equity * 4, optionsBuyingPower: equity, optionsApprovedLevel: 3,
  optionsTradingLevel: 3, tradingBlocked: false, transfersBlocked: false, maskedAccountId: '****', receivedAt: NOW });
const occ = (root: string, strike: number): string => `${root}261120P${String(strike * 1000).padStart(8, '0')}`;

interface Book { readonly positions: AlpacaPositionSnapshot[]; readonly orders: AlpacaOpenOrderSnapshot[]; readonly equity: number }

function randomBook(next: () => number): Book {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const positions: AlpacaPositionSnapshot[] = [];
  const orders: AlpacaOpenOrderSnapshot[] = [];
  for (let index = 0; index < Math.floor(next() * 4); index += 1) {
    const root = pick(UNDERLYINGS), strike = 20 + Math.floor(next() * 80), contracts = 1 + Math.floor(next() * 3);
    positions.push({ symbol: occ(root, strike), assetClass: 'us_option', quantity: -contracts, side: 'short', avgEntryPrice: 1, marketValue: -50, unrealizedPl: 0, receivedAt: NOW });
  }
  for (const root of UNDERLYINGS) if (next() < 0.4) {
    const shares = 100 * (1 + Math.floor(next() * 3));
    positions.push({ symbol: root, assetClass: 'us_equity', quantity: shares, side: 'long', avgEntryPrice: 50, marketValue: shares * (30 + Math.floor(next() * 40)), unrealizedPl: 0, receivedAt: NOW });
  }
  for (let index = 0; index < Math.floor(next() * 4); index += 1) {
    const root = pick(UNDERLYINGS), strike = 20 + Math.floor(next() * 80);
    orders.push({ orderId: `o${index}`, clientOrderId: null, symbol: occ(root, strike), side: 'sell', positionIntent: 'sell_to_open', quantity: 1 + Math.floor(next() * 3),
      limitPrice: 1, status: 'new', submittedAt: NOW, receivedAt: NOW });
  }
  if (next() < 0.5 && positions.some((p) => p.assetClass === 'us_option')) {
    const target = positions.find((p) => p.assetClass === 'us_option') as AlpacaPositionSnapshot;
    orders.push({ orderId: 'close', clientOrderId: null, symbol: target.symbol, side: 'buy', positionIntent: 'buy_to_close', quantity: 1, limitPrice: 0.5, status: 'new', submittedAt: NOW, receivedAt: NOW });
  }
  return { positions, orders, equity: 200_000 + Math.floor(next() * 800_000) };
}

const strikeOf = (symbol: string): number => Number(symbol.slice(-8)) / 1000;
const rootOf = (symbol: string): string => symbol.slice(0, symbol.length - 15);
const shuffled = <T>(items: readonly T[], next: () => number): T[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) { const j = Math.floor(next() * (index + 1)); [copy[index], copy[j]] = [copy[j] as T, copy[index] as T]; }
  return copy;
};
const exposureOf = (book: Book): DerivedAccountExposure => deriveAccountExposure(account(book.equity), book.positions, book.orders);
const near = (a: number | null, b: number | null, message: string): void => {
  assert.ok(a !== null && b !== null && Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);
};

test('CAPITAL: exposure equals an independent oracle (positions, stock and pending reserves each counted once) and is independent of input order', () => {
  const next = prng(20261004);
  for (let run = 0; run < 400; run += 1) {
    const book = randomBook(next);
    const exposure = exposureOf(book);
    let csp = 0, stock = 0, pending = 0;
    const perUnderlying = new Map<string, number>();
    const add = (root: string, value: number) => perUnderlying.set(root, (perUnderlying.get(root) ?? 0) + value);
    for (const position of book.positions) {
      if (position.assetClass === 'us_option') { const value = strikeOf(position.symbol) * 100 * Math.abs(position.quantity as number); csp += value; add(rootOf(position.symbol), value); }
      else { stock += position.marketValue as number; add(position.symbol, position.marketValue as number); }
    }
    for (const order of book.orders) if (order.positionIntent === 'sell_to_open') {
      const value = strikeOf(order.symbol) * 100 * (order.quantity as number); pending += value; add(rootOf(order.symbol), value);
    }
    near(exposure.cspCollateralRequired, csp, `run ${run} csp`);
    near(exposure.stockInventoryValue, stock, `run ${run} stock`);
    near(exposure.pendingOpeningCapitalAtRisk, pending, `run ${run} pending`);
    for (const [root, value] of perUnderlying) near(exposure.exposureByUnderlying[root] ?? 0, value, `run ${run} ${root}`);
    const reordered = deriveAccountExposure(account(book.equity), shuffled(book.positions, next), shuffled(book.orders, next));
    near(reordered.cspCollateralRequired, exposure.cspCollateralRequired, `run ${run} order independence csp`);
    near(reordered.pendingOpeningCapitalAtRisk, exposure.pendingOpeningCapitalAtRisk, `run ${run} order independence pending`);
    near(reordered.portfolioCapitalAtRiskPct, exposure.portfolioCapitalAtRiskPct, `run ${run} order independence pct`);
  }
});

test('CAPITAL: cancelling a pending order releases exactly its reserve once; a fill moves the reserve into actual exposure with no net change', () => {
  const next = prng(7);
  for (let run = 0; run < 300; run += 1) {
    const book = randomBook(next);
    const pending = book.orders.find((order) => order.positionIntent === 'sell_to_open');
    if (pending === undefined) continue;
    const root = rootOf(pending.symbol), reserve = strikeOf(pending.symbol) * 100 * (pending.quantity as number);
    const before = exposureOf(book);
    const cancelled = exposureOf({ ...book, orders: book.orders.filter((order) => order !== pending) });
    near((before.exposureByUnderlying[root] ?? 0) - (cancelled.exposureByUnderlying[root] ?? 0), reserve, `run ${run} cancel releases exactly the reserve`);
    near((before.pendingOpeningCapitalAtRisk as number) - (cancelled.pendingOpeningCapitalAtRisk as number), reserve, `run ${run} pending total`);
    for (const other of UNDERLYINGS.filter((name) => name !== root)) near(before.exposureByUnderlying[other] ?? 0, cancelled.exposureByUnderlying[other] ?? 0, `run ${run} other underlyings untouched`);
    const filled = exposureOf({ ...book, orders: book.orders.filter((order) => order !== pending), positions: [...book.positions,
      { symbol: pending.symbol, assetClass: 'us_option', quantity: -(pending.quantity as number), side: 'short', avgEntryPrice: 1, marketValue: -50, unrealizedPl: 0, receivedAt: NOW }] });
    near(filled.exposureByUnderlying[root] ?? 0, before.exposureByUnderlying[root] ?? 0, `run ${run} fill converts pending to actual without changing exposure`);
    near(filled.portfolioCapitalAtRiskPct ?? 0, (before.portfolioCapitalAtRiskPct ?? 0), `run ${run} portfolio ratio is unchanged by a fill`);
    near((filled.cspCollateralRequired as number) - (before.cspCollateralRequired as number), reserve, `run ${run} actual collateral grows by exactly the reserve`);
    near((before.pendingOpeningCapitalAtRisk as number) - (filled.pendingOpeningCapitalAtRisk as number), reserve, `run ${run} pending shrinks by exactly the reserve`);
  }
});

test('CAPITAL: more exposure never increases exposure ratios or candidate capacity; more equity never decreases capacity', () => {
  const next = prng(42);
  const policy = { hardCapMultiplier: P.aegis.hardCapMultiplier, maxTickerConcentrationPct: P.aegis.maximumTickerConcentrationPct, maxSectorConcentrationPct: P.aegis.maximumSectorConcentrationPct,
    maxCorrelationClusterPct: P.aegis.maximumCorrelationClusterPct, maxPortfolioCapitalAtRiskPct: P.aegis.maximumPortfolioCapitalAtRiskPct, maxInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct,
    maxAssignmentCapacityPct: P.aegis.maximumAssignmentCapacityPct, maxRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct };
  const capacity = (book: Book, unit: number): number => deriveCandidateCapacityAssessment(exposureOf(book), book.orders, { underlying: 'AAA', securedCollateralPerContract: unit }, 50, policy, 0).quantityCap;
  for (let run = 0; run < 300; run += 1) {
    const book = randomBook(next);
    const unit = 2_000 + Math.floor(next() * 8_000);
    const base = capacity(book, unit);
    const extra: AlpacaOpenOrderSnapshot = { orderId: 'extra', clientOrderId: null, symbol: occ('AAA', 40 + Math.floor(next() * 40)), side: 'sell', positionIntent: 'sell_to_open', quantity: 1 + Math.floor(next() * 3),
      limitPrice: 1, status: 'new', submittedAt: NOW, receivedAt: NOW };
    const more = { ...book, orders: [...book.orders, extra] };
    assert.ok(capacity(more, unit) <= base, `run ${run}: extra pending exposure increased capacity ${base} -> ${capacity(more, unit)}`);
    assert.ok((exposureOf(more).pendingOpeningCapitalAtRisk as number) >= (exposureOf(book).pendingOpeningCapitalAtRisk as number));
    assert.ok(capacity({ ...book, equity: book.equity * 2 }, unit) >= base, `run ${run}: more equity decreased capacity`);
    assert.ok(capacity(book, unit * 2) <= base, `run ${run}: a larger per-contract collateral increased capacity`);
  }
});

test('CAPITAL: affordable and secured contract counts are monotone and never over-size', () => {
  const next = prng(99);
  for (let run = 0; run < 2000; run += 1) {
    const capital = Math.floor(next() * 500_000), unit = 100 + Math.floor(next() * 90_000) + next();
    const count = wholeContractsAffordable(capital, unit) as number;
    assert.ok(count * unit <= capital + 1e-6, `run ${run}: ${count} x ${unit} exceeds ${capital}`);
    assert.ok((count + 1) * unit > capital - 1e-6, `run ${run}: not maximal`);
    assert.ok((wholeContractsAffordable(capital + 1_000, unit) as number) >= count);
    assert.ok((wholeContractsAffordable(capital, unit + 500) as number) <= count);
    assert.equal(securedContractCapacity(capital, unit, 0), count);
  }
  for (const bad of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) assert.equal(wholeContractsAffordable(bad as number | null, 100), null);
  for (const bad of [null, Number.NaN, 0, -5]) assert.equal(wholeContractsAffordable(1_000, bad as number | null), null);
});

test('SHARES: free + committed == reconciled, never negative, and an over-commitment is UNKNOWN (never a quiet zero)', () => {
  const next = prng(31337);
  for (let run = 0; run < 3000; run += 1) {
    const shares = Math.floor(next() * 1_500), committed = Math.floor(next() * 12);
    const result = freeSellableShares(shares, committed);
    if (committed * 100 > shares) { assert.equal(result.state, 'UNKNOWN'); assert.equal(result.freeShares, null); assert.equal(result.reason, 'OVERCOMMITTED_INVALID_STATE'); continue; }
    assert.equal(result.state, 'KNOWN');
    assert.equal((result.freeShares as number) + (result.committedShares as number), shares, `run ${run}: shares not conserved`);
    assert.ok((result.freeShares as number) >= 0);
    assert.equal(result.committedShares, committed * 100);
  }
  for (const bad of [null, -1, 1.5, Number.NaN]) assert.equal(freeSellableShares(bad as number | null, 0).state, 'UNKNOWN');
  assert.equal(freeSellableShares(100, null).state, 'UNKNOWN');
  assert.equal(freeSellableShares(100, undefined).state, 'UNKNOWN');
});

test('SHARES: covered-call capacity never exceeds what the shares cover (no naked call) and is monotone non-increasing in commitments', () => {
  const next = prng(555);
  for (let run = 0; run < 3000; run += 1) {
    const shares = Math.floor(next() * 1_500), covered = Math.floor(next() * 8), pending = Math.floor(next() * 5);
    const capacity = coveredCallContractCapacity(shares, covered, pending) as number;
    assert.ok(capacity >= 0);
    if (covered + pending <= Math.floor(shares / 100)) assert.ok((capacity + covered + pending) * 100 <= shares, `run ${run}: ${capacity} + ${covered} + ${pending} contracts would be naked against ${shares} shares`);
    else assert.equal(capacity, 0, `run ${run}: an over-committed book must offer no capacity`);
    assert.ok((coveredCallContractCapacity(shares, covered + 1, pending) as number) <= capacity);
    assert.ok((coveredCallContractCapacity(shares, covered, pending + 1) as number) <= capacity);
    assert.ok((coveredCallContractCapacity(shares + 100, covered, pending) as number) >= capacity);
  }
  assert.equal(coveredCallContractCapacity(null, 0, 0), null);
  assert.equal(coveredCallContractCapacity(100, null, 0), null);
  assert.equal(coveredCallContractCapacity(100, 0, null), null);
});

const BASE: WholeChainComponents = { cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 200, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0, assignmentStrike: null, stockSharesAssigned: 0,
  dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: null, fees: 1.3, feeBasis: 'BROKER_ACTUAL_FEE', executionCostNotEmbeddedInCashflows: 0,
  tcaExecutionShortfall: null, currentStockMarkPerShare: null, openStockShares: 0 } as unknown as WholeChainComponents;

test('WHOLE CHAIN: every cash flow is counted exactly once (a roll changes the total by exactly credit - close cost)', () => {
  const next = prng(2718);
  for (let run = 0; run < 1500; run += 1) {
    const premium = Math.round(next() * 50_000) / 100, close = Math.round(next() * 30_000) / 100, credit = Math.round(next() * 40_000) / 100, rollClose = Math.round(next() * 20_000) / 100;
    const base = { ...BASE, initialPutPremium: premium, putCloseCosts: close };
    const before = computeWholeChainPnl(base).wholeChainPnl as number;
    const after = computeWholeChainPnl({ ...base, rollCredits: credit, rollCloseCosts: rollClose }).wholeChainPnl as number;
    near(after - before, credit - rollClose, `run ${run} roll delta`);
    const sum = computeWholeChainPnl({ ...base, rollCredits: credit, rollCloseCosts: rollClose }).legLevelPnl.reduce((total, leg) => total + (leg.amount as number), 0);
    near(sum, after, `run ${run} total equals the sum of its legs`);
  }
});

test('WHOLE CHAIN: a realized loss cannot disappear (the total strictly decreases with any added close cost) and premium is never counted twice', () => {
  const next = prng(1618);
  for (let run = 0; run < 1500; run += 1) {
    const base = { ...BASE, initialPutPremium: Math.round(next() * 40_000) / 100 };
    const closeA = Math.round(next() * 20_000) / 100 + 0.01;
    const lower = computeWholeChainPnl({ ...base, putCloseCosts: closeA }).wholeChainPnl as number;
    const higher = computeWholeChainPnl({ ...base, putCloseCosts: closeA + 5 }).wholeChainPnl as number;
    near(lower - higher, 5, `run ${run} an extra $5 of close cost lowers P&L by exactly $5`);
    const premiumLeg = computeWholeChainPnl(base).legLevelPnl.filter((leg) => leg.label === 'INITIAL_PUT_PREMIUM');
    assert.equal(premiumLeg.length, 1, 'initial premium appears exactly once');
  }
});

test('WHOLE CHAIN: unknown fees, close costs or roll components keep the whole-chain P&L UNKNOWN; they are never coerced to zero', () => {
  for (const field of ['fees', 'putCloseCosts', 'rollCredits', 'rollCloseCosts', 'dividends', 'coveredCallPremium', 'coveredCallCloseCosts', 'executionCostNotEmbeddedInCashflows', 'initialPutPremium'] as const) {
    const result = computeWholeChainPnl({ ...BASE, [field]: null } as WholeChainComponents);
    assert.equal(result.wholeChainPnl, null, `${field} unknown must make the total unknown`);
    assert.ok(result.legLevelPnl.some((leg) => leg.amount === null), `${field}: the unknown leg stays visible`);
  }
  assert.notEqual(computeWholeChainPnl(BASE).wholeChainPnl, null);
});
