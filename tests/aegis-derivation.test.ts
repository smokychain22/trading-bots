import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveExecutionQualityAcceptable, deriveLiquidityAcceptable, deriveProviderState, deriveStressGapDetected } from '../src/theta/aegis-derivation.js';
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

test('deriveProviderState maps all-GOOD required capabilities to OK', () => {
  assert.equal(deriveProviderState(['GOOD', 'GOOD', 'GOOD']), 'OK');
});

test('deriveProviderState maps any INVALID/NOT_ENTITLED capability to the literal string INVALID (matching aegis.py exact-check)', () => {
  assert.equal(deriveProviderState(['GOOD', 'INVALID', 'GOOD']), 'INVALID');
  assert.equal(deriveProviderState(['GOOD', 'NOT_ENTITLED']), 'INVALID');
});

test('deriveProviderState maps a merely degraded/stale/unknown mix (no INVALID) to null (genuine UNKNOWN), never OK or a fabricated failure', () => {
  assert.equal(deriveProviderState(['GOOD', 'STALE']), null);
  assert.equal(deriveProviderState(['DEGRADED', 'UNKNOWN']), null);
});

test('deriveLiquidityAcceptable is true when at least one candidate has an acceptable spread', () => {
  const tight = contract({ bid: 4.5, ask: 4.55 }); // ~1.1% spread
  const wide = contract({ bid: 4.0, ask: 5.0 }); // ~22% spread
  assert.equal(deriveLiquidityAcceptable([wide, tight], 0.15), true);
});

test('deriveLiquidityAcceptable is false only when every known spread exceeds the floor', () => {
  const wide1 = contract({ bid: 4.0, ask: 5.0 });
  const wide2 = contract({ bid: 3.0, ask: 4.0 });
  assert.equal(deriveLiquidityAcceptable([wide1, wide2], 0.15), false);
});

test('deriveLiquidityAcceptable is UNKNOWN (null) when there is nothing to judge', () => {
  assert.equal(deriveLiquidityAcceptable([], 0.15), null);
  const unknownSpread = contract({ bid: null, ask: null });
  assert.equal(deriveLiquidityAcceptable([unknownSpread], 0.15), null);
});

test('deriveExecutionQualityAcceptable is true when at least one candidate is genuinely executable', () => {
  const executable = contract({ bid: 4.5, ask: 4.6, quoteTimestamp: NOW, dataQuality: 'GOOD' });
  assert.equal(deriveExecutionQualityAcceptable([executable]), true);
});

test('deriveExecutionQualityAcceptable is false when no candidate is executable, and UNKNOWN when there are no candidates at all', () => {
  const nonExecutable = contract({ bid: null, ask: null });
  assert.equal(deriveExecutionQualityAcceptable([nonExecutable]), false);
  assert.equal(deriveExecutionQualityAcceptable([]), null);
});

test('deriveStressGapDetected fires only when a real ret1d exceeds the threshold -- never true from a null (insufficient-history) input', () => {
  assert.equal(deriveStressGapDetected(null, 0.05), false);
  assert.equal(deriveStressGapDetected(0.02, 0.05), false);
  assert.equal(deriveStressGapDetected(-0.08, 0.05), true);
  assert.equal(deriveStressGapDetected(0.08, 0.05), true);
});
