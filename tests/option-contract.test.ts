import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOptionContract, type RawOptionQuoteInput } from '../src/theta/option-contract.js';

const NOW = '2026-09-10T15:00:00.000Z';

const baseRaw = (overrides: Partial<RawOptionQuoteInput> = {}): RawOptionQuoteInput => ({
  source: 'ALPACA',
  underlying: 'AAPL',
  optionSymbol: 'AAPL260116P00200000',
  occSymbol: 'AAPL260116P00200000',
  optionType: 'PUT',
  strike: 200,
  expiration: '2026-01-16',
  asOfDate: '2026-09-10',
  multiplier: 100,
  underlyingBid: 209.5,
  underlyingAsk: 209.6,
  underlyingLast: 209.55,
  underlyingTimestamp: NOW,
  bid: 3.1,
  ask: 3.3,
  bidSize: 20,
  askSize: 25,
  lastTradePrice: 3.2,
  lastTradeSize: 5,
  quoteTimestamp: NOW,
  tradeTimestamp: NOW,
  volume: 150,
  openInterest: 2000,
  iv: 0.28,
  delta: -0.22,
  gamma: 0.01,
  theta: -0.05,
  vega: 0.12,
  rho: null,
  greeksTimestamp: NOW,
  greeksSource: 'ALPACA',
  feed: 'OPRA',
  dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 10,
  maxSpreadPctForExecutable: 0.15,
  ...overrides,
});

test('a clean PUT contract normalizes as executable with derived fields computed', () => {
  const contract = normalizeOptionContract(baseRaw(), NOW);
  assert.equal(contract.executable, true);
  assert.equal(contract.nonExecutableReason, null);
  assert.equal(contract.optionType, 'PUT');
  assert.ok(contract.spread !== null && contract.spread > 0);
  assert.equal(contract.breakEven, 200 - 3.1);
});

test('a CALL contract normalizes with no break-even (PUT-only convention)', () => {
  const contract = normalizeOptionContract(baseRaw({ optionType: 'CALL', optionSymbol: 'AAPL260116C00220000', strike: 220 }), NOW);
  assert.equal(contract.optionType, 'CALL');
  assert.equal(contract.breakEven, null);
});

test('missing Greeks are preserved as null, never fabricated', () => {
  const contract = normalizeOptionContract(
    baseRaw({ iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: null, greeksSource: null }), NOW,
  );
  assert.equal(contract.iv, null);
  assert.equal(contract.delta, null);
  assert.equal(contract.gamma, null);
});

test('zero bid is a real value, not confused with missing data', () => {
  const contract = normalizeOptionContract(baseRaw({ bid: 0 }), NOW);
  assert.equal(contract.bid, 0);
  assert.notEqual(contract.bid, null);
});

test('a wide spread makes the contract non-executable with a stated reason', () => {
  const contract = normalizeOptionContract(baseRaw({ bid: 1.0, ask: 5.0, maxSpreadPctForExecutable: 0.1 }), NOW);
  assert.equal(contract.executable, false);
  assert.ok(contract.nonExecutableReason?.includes('spread'));
});

test('a stale quote makes the contract non-executable', () => {
  const staleTimestamp = '2026-09-10T14:00:00.000Z'; // one hour before NOW
  const contract = normalizeOptionContract(baseRaw({ quoteTimestamp: staleTimestamp }), NOW);
  assert.equal(contract.executable, false);
  assert.ok(contract.nonExecutableReason?.includes('stale'));
});

test('OPRA feed is preserved distinctly from INDICATIVE, never conflated', () => {
  const opra = normalizeOptionContract(baseRaw({ feed: 'OPRA' }), NOW);
  const indicative = normalizeOptionContract(baseRaw({ feed: 'INDICATIVE' }), NOW);
  assert.equal(opra.feed, 'OPRA');
  assert.equal(indicative.feed, 'INDICATIVE');
});

test('unknown feed (null) is preserved as null, never defaulted to a feed type', () => {
  const contract = normalizeOptionContract(baseRaw({ feed: null }), NOW);
  assert.equal(contract.feed, null);
});

test('greeksSource tracks Greek provenance independently of the quote source, never silently conflated', () => {
  const contract = normalizeOptionContract(baseRaw({ source: 'ALPACA', greeksSource: 'OPTIONOMICS', delta: -0.2, gamma: 0.01 }), NOW);
  assert.equal(contract.source, 'ALPACA'); // the quote/bid-ask is still Alpaca's own indicative feed
  assert.equal(contract.greeksSource, 'OPTIONOMICS'); // but the Greeks came from the supplementary features provider
  assert.equal(contract.delta, -0.2);
});

test('non-GOOD data quality makes the contract non-executable', () => {
  const contract = normalizeOptionContract(baseRaw({ dataQuality: 'DEGRADED' }), NOW);
  assert.equal(contract.executable, false);
  assert.ok(contract.nonExecutableReason?.includes('DEGRADED'));
});

test('multiplier is carried through unchanged, never assumed to be 100', () => {
  const contract = normalizeOptionContract(baseRaw({ multiplier: 10 }), NOW);
  assert.equal(contract.multiplier, 10);
});

test('missing bid/ask makes the contract non-executable, never assumed tradable', () => {
  const contract = normalizeOptionContract(baseRaw({ bid: null, ask: null }), NOW);
  assert.equal(contract.executable, false);
  assert.equal(contract.spread, null);
  assert.equal(contract.midpointReference, null);
});

test('executable contracts never carry a nonExecutableReason (schema-enforced)', () => {
  const contract = normalizeOptionContract(baseRaw(), NOW);
  assert.equal(contract.executable, true);
  assert.equal(contract.nonExecutableReason, null);
});

test('DTE is computed from asOfDate to expiration, not assumed', () => {
  const contract = normalizeOptionContract(baseRaw({ asOfDate: '2026-09-10', expiration: '2026-09-20' }), NOW);
  assert.equal(contract.dte, 10);
});
