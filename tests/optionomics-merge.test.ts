import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { mergeAlpacaAndOptionomicsObservation, type MergeOptionObservationPolicy } from '../src/theta/optionomics-merge.js';
import type { NormalizedOptionomicsEntry } from '../src/theta/optionomics-provider.js';

const NOW = '2026-09-10T15:00:00.000Z';

const alpacaContract = (overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract =>
  normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY260910P00500000', occSymbol: 'SPY260910P00500000',
    optionType: 'PUT', strike: 500, expiration: '2026-10-10', asOfDate: '2026-09-10', multiplier: 100,
    underlyingBid: null, underlyingAsk: null, underlyingLast: null, underlyingTimestamp: null,
    bid: 4.5, ask: 4.7, bidSize: 10, askSize: 12, lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: NOW, tradeTimestamp: null,
    volume: null, volumeSource: null, openInterest: null, openInterestSource: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: null, greeksSource: null,
    feed: 'INDICATIVE', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15,
    ...overrides,
  }, NOW);

const optionomicsEntry = (overrides: Partial<NormalizedOptionomicsEntry> = {}): NormalizedOptionomicsEntry => ({
  rawSymbol: 'SPY260910P00500000', underlying: 'SPY', expiration: '2026-10-10', optionType: 'PUT', strike: 500,
  openInterest: 1200, volume: 340, impliedVolatility: 0.22, impliedVolatilityUnits: 'DECIMAL', impliedVolatilityRaw: 0.22,
  delta: -0.3, gamma: 0.01, theta: -0.05, vega: 0.1, rho: -0.02, asOf: NOW, retrievedAt: NOW,
  ...overrides,
});

const policy: MergeOptionObservationPolicy = { policyVersion: 'merge-v1-test', disagreementTolerance: { policyVersion: 'disagreement-v1-test', minorRelativeTolerance: 0.05, materialRelativeTolerance: 0.2 } };

test('ALPACA bid/ask are passed through unchanged and never overwritten by Optionomics', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(alpacaContract(), [optionomicsEntry()], policy);
  assert.equal(merged.alpacaBid, 4.5);
  assert.equal(merged.alpacaAsk, 4.7);
});

test('open interest is ALWAYS sourced from Optionomics -- Alpaca has no OI field in this pipeline', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(alpacaContract(), [optionomicsEntry({ openInterest: 900 })], policy);
  assert.equal(merged.openInterest, 900);
  assert.equal(merged.openInterestSource, 'OPTIONOMICS');
});

test('open interest is UNAVAILABLE (never zero) when Optionomics does not report it', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(alpacaContract(), [optionomicsEntry({ openInterest: null })], policy);
  assert.equal(merged.openInterest, null);
  assert.equal(merged.openInterestSource, 'UNAVAILABLE');
});

test('volume prefers Alpaca when Alpaca reports a known value, never overwritten by Optionomics', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(alpacaContract({ volume: 50, volumeSource: 'ALPACA' }), [optionomicsEntry({ volume: 340 })], policy);
  assert.equal(merged.volume, 50);
  assert.equal(merged.volumeSource, 'ALPACA');
});

test('volume falls back to Optionomics only when Alpaca has no known value', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(alpacaContract({ volume: null, volumeSource: null }), [optionomicsEntry({ volume: 340 })], policy);
  assert.equal(merged.volume, 340);
  assert.equal(merged.volumeSource, 'OPTIONOMICS');
});

test('identity is exact OCC symbol matched when both providers use the same symbol format', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(alpacaContract(), [optionomicsEntry()], policy);
  assert.equal(merged.identityMatch, 'EXACT_OCC_SYMBOL');
});

test('an unmatched Optionomics entry (different contract) never merges -- every Optionomics field stays UNAVAILABLE', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(
    alpacaContract(),
    [optionomicsEntry({ rawSymbol: 'SPY260910P00505000', underlying: 'SPY', expiration: '2026-10-10', optionType: 'PUT', strike: 505 })],
    policy,
  );
  assert.equal(merged.identityMatch, 'UNMATCHED');
  assert.equal(merged.openInterest, null);
  assert.equal(merged.openInterestSource, 'UNAVAILABLE');
  assert.equal(merged.volumeSource, 'UNAVAILABLE');
});

test('a material IV disagreement between providers is classified, never silently averaged', () => {
  const merged = mergeAlpacaAndOptionomicsObservation(
    alpacaContract({ iv: 0.2, greeksSource: 'ALPACA' }),
    [optionomicsEntry({ impliedVolatility: 0.5 })],
    policy,
  );
  // Alpaca's own IV is preferred as the merged value...
  assert.equal(merged.impliedVolatility, 0.2);
  assert.equal(merged.impliedVolatilitySource, 'ALPACA');
  // ...but the disagreement with Optionomics' reported value is still surfaced.
  assert.equal(merged.impliedVolatilityDisagreement, 'MATERIAL_DISAGREEMENT');
});
