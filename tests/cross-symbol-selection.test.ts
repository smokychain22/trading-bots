import assert from 'node:assert/strict';
import test from 'node:test';
import { computeUnderlyingReturnProxy, rankUnderlyingsByReturnProxy } from '../src/theta/cross-symbol-selection.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';

const NOW = '2026-09-10T15:00:00.000Z';

const contract = (overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract =>
  normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261009P00500000', occSymbol: 'SPY261009P00500000',
    optionType: 'PUT', strike: 500, expiration: '2026-10-09', asOfDate: '2026-09-10', multiplier: 100,
    underlyingBid: null, underlyingAsk: null, underlyingLast: null, underlyingTimestamp: null,
    bid: 4.5, ask: 4.7, bidSize: 10, askSize: 12, lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: NOW, tradeTimestamp: null,
    volume: null, volumeSource: null, openInterest: null, openInterestSource: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: null, greeksSource: null,
    feed: 'INDICATIVE', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15,
    ...overrides,
  }, NOW);

test('computeUnderlyingReturnProxy picks the highest bid/collateral ratio among executable candidates', () => {
  const low = contract({ optionSymbol: 'LOW', bid: 1, ask: 1.05, strike: 500 }); // 1/50000 = 0.00002
  const high = contract({ optionSymbol: 'HIGH', bid: 5, ask: 5.1, strike: 400 }); // 5/40000 = 0.000125
  const proxy = computeUnderlyingReturnProxy('SPY', [low, high]);
  assert.equal(proxy.bestCandidateSymbol, 'HIGH');
  assert.ok(proxy.returnProxy !== null && proxy.returnProxy > 0.0001);
});

test('a non-executable candidate (stale/no quote) is never selected as the best, even with a higher nominal bid', () => {
  const nonExecutable = contract({ optionSymbol: 'STALE_BUT_HIGH_BID', bid: 100, ask: 101, dataQuality: 'STALE' });
  const executable = contract({ optionSymbol: 'REAL', bid: 2, ask: 2.05 });
  const proxy = computeUnderlyingReturnProxy('SPY', [nonExecutable, executable]);
  assert.equal(proxy.bestCandidateSymbol, 'REAL');
});

test('UNKNOWN preservation: no executable candidate at all yields returnProxy null, never a fabricated 0', () => {
  const noBid = contract({ bid: null, ask: null });
  const proxy = computeUnderlyingReturnProxy('SPY', [noBid]);
  assert.equal(proxy.returnProxy, null);
  assert.equal(proxy.bestCandidateSymbol, null);
});

test('an empty contract list yields returnProxy null, never a crash or a fabricated value', () => {
  const proxy = computeUnderlyingReturnProxy('SPY', []);
  assert.equal(proxy.returnProxy, null);
});

test('a zero or negative bid is never treated as a real premium', () => {
  const zeroBid = contract({ bid: 0, ask: 0.05 });
  const proxy = computeUnderlyingReturnProxy('SPY', [zeroBid]);
  assert.equal(proxy.returnProxy, null);
});

test('rankUnderlyingsByReturnProxy sorts descending by proxy, dollar volume plays no role', () => {
  const proxies = [
    { underlying: 'A', bestCandidateSymbol: 'a1', returnProxy: 0.001 },
    { underlying: 'B', bestCandidateSymbol: 'b1', returnProxy: 0.01 },
    { underlying: 'C', bestCandidateSymbol: 'c1', returnProxy: 0.005 },
  ];
  const { ranked } = rankUnderlyingsByReturnProxy(proxies);
  assert.deepEqual(ranked.map((r) => r.underlying), ['B', 'C', 'A']);
});

test('rankUnderlyingsByReturnProxy excludes (never ranks as 0) any underlying with no real candidate', () => {
  const proxies = [
    { underlying: 'A', bestCandidateSymbol: 'a1', returnProxy: 0.01 },
    { underlying: 'B', bestCandidateSymbol: null, returnProxy: null },
  ];
  const { ranked, excluded } = rankUnderlyingsByReturnProxy(proxies);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.underlying, 'A');
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0]?.underlying, 'B');
});
