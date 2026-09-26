import assert from 'node:assert/strict';
import test from 'node:test';
import { computePackageMark } from '../src/research/command5a-mark-semantics.js';
import type { ContractPathQuoteObservation } from '../src/research/contract-path-observation-runtime.js';

function quote(overrides: Partial<ContractPathQuoteObservation> & { optionSymbol: string }): ContractPathQuoteObservation {
  return {
    bid: 1.5, ask: 1.55, providerTimestamp: '2026-09-21T14:00:00Z', receivedAt: '2026-09-21T14:00:01Z',
    impliedVolatility: 0.28, delta: -0.2, gamma: 0.01, theta: -0.05, vega: 0.1,
    provider: 'ALPACA', feed: 'OPRA', quality: 'GOOD', reasonCodes: [],
    ...overrides,
  };
}

test('CORE CLAIM: single-leg mark is mid(bid, ask), matching this codebase\'s own established convention', () => {
  const result = computePackageMark({
    legIdentities: [{ optionSymbol: 'SPY251017P00590000', side: 'SHORT' }],
    quotes: [quote({ optionSymbol: 'SPY251017P00590000', bid: 2.0, ask: 2.10 })],
  });
  assert.equal(result.markType, 'SINGLE_LEG_MID');
  assert.equal(result.packageMark, 2.05);
  assert.equal(result.identifiability, 'PRESENT_VALID');
  assert.equal(result.singleLegImpliedVolatility, 0.28);
  assert.equal(result.shortLegImpliedVolatility, null);
});

test('CORE CLAIM: two-leg (D) package mark uses conservative short.bid-long.ask / short.ask-long.bid, never leg-mid averaging', () => {
  const result = computePackageMark({
    legIdentities: [
      { optionSymbol: 'SPY251017P00590000', side: 'SHORT' },
      { optionSymbol: 'SPY251017P00580000', side: 'LONG' },
    ],
    quotes: [
      quote({ optionSymbol: 'SPY251017P00590000', bid: 3.0, ask: 3.10, impliedVolatility: 0.30 }),
      quote({ optionSymbol: 'SPY251017P00580000', bid: 1.0, ask: 1.05, impliedVolatility: 0.32 }),
    ],
  });
  assert.equal(result.markType, 'DEFINED_RISK_PACKAGE_MID');
  // packageBid = shortBid - longAsk = 3.0 - 1.05 = 1.95; packageAsk = shortAsk - longBid = 3.10 - 1.0 = 2.10
  assert.equal(result.packageBidIfDefined, 1.95);
  assert.equal(result.packageAskIfDefined, 2.10);
  assert.equal(result.packageMark, (1.95 + 2.10) / 2);
  assert.equal(result.identifiability, 'PRESENT_VALID');
});

test('CORE CLAIM: multi-leg IV is never averaged into one spread scalar -- shortLegIV and longLegIV stay separate', () => {
  const result = computePackageMark({
    legIdentities: [
      { optionSymbol: 'A', side: 'SHORT' },
      { optionSymbol: 'B', side: 'LONG' },
    ],
    quotes: [
      quote({ optionSymbol: 'A', impliedVolatility: 0.40 }),
      quote({ optionSymbol: 'B', impliedVolatility: 0.20 }),
    ],
  });
  assert.equal(result.shortLegImpliedVolatility, 0.40);
  assert.equal(result.longLegImpliedVolatility, 0.20);
  assert.equal(result.singleLegImpliedVolatility, null);
  // Explicitly not (0.40+0.20)/2 -- no averaged scalar exists on the result at all.
  assert.ok(!('spreadImpliedVolatility' in result));
});

test('ADVERSARIAL: a package mark that cannot be constructed from real bid/ask stays null and NOT_IDENTIFIABLE, never zero', () => {
  const result = computePackageMark({
    legIdentities: [
      { optionSymbol: 'A', side: 'SHORT' },
      { optionSymbol: 'B', side: 'LONG' },
    ],
    quotes: [
      quote({ optionSymbol: 'A', bid: null, ask: null }),
      quote({ optionSymbol: 'B', bid: 1.0, ask: 1.05 }),
    ],
  });
  assert.equal(result.packageMark, null);
  assert.equal(result.packageBidIfDefined, null);
  assert.equal(result.identifiability, 'NOT_IDENTIFIABLE');
});

test('ADVERSARIAL: a leg identity with no matching observed quote throws rather than silently dropping the leg', () => {
  assert.throws(() => computePackageMark({
    legIdentities: [{ optionSymbol: 'MISSING', side: 'SHORT' }],
    quotes: [quote({ optionSymbol: 'DIFFERENT' })],
  }), /COMMAND5A_MARK_LEG_NOT_OBSERVED/);
});

test('quality reflects the WORST leg quality present, never the best', () => {
  const result = computePackageMark({
    legIdentities: [
      { optionSymbol: 'A', side: 'SHORT' },
      { optionSymbol: 'B', side: 'LONG' },
    ],
    quotes: [
      quote({ optionSymbol: 'A', quality: 'GOOD' }),
      quote({ optionSymbol: 'B', quality: 'STALE' }),
    ],
  });
  assert.equal(result.quality, 'STALE');
});

test('ADVERSARIAL: an unsupported leg count (3+) throws rather than guessing package semantics', () => {
  assert.throws(() => computePackageMark({
    legIdentities: [
      { optionSymbol: 'A', side: 'SHORT' }, { optionSymbol: 'B', side: 'LONG' }, { optionSymbol: 'C', side: 'SHORT' },
    ],
    quotes: [quote({ optionSymbol: 'A' }), quote({ optionSymbol: 'B' }), quote({ optionSymbol: 'C' })],
  }), /COMMAND5A_MARK_UNSUPPORTED_LEG_COUNT/);
});
