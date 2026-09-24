import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOptionContract, type RawOptionQuoteInput } from '../src/theta/option-contract.js';

const receivedAt = '2026-09-25T14:30:01.000Z';
const valid = (): RawOptionQuoteInput => ({
  source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261016P00600000', occSymbol: 'SPY261016P00600000',
  optionType: 'PUT', strike: 600, expiration: '2026-10-16', asOfDate: '2026-09-25', multiplier: 100,
  contractTradable: true, exerciseStyle: 'AMERICAN', deliverableClassification: 'STANDARD_EQUITY',
  underlyingBid: 620, underlyingAsk: 620.1, underlyingLast: 620.05,
  underlyingTimestamp: '2026-09-25T14:30:00.000Z', underlyingQuoteReceivedAt: receivedAt,
  underlyingQuoteSource: 'ALPACA_IEX_QUOTE', bid: 2, ask: 2.1, bidSize: 10, askSize: 12,
  lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: '2026-09-25T14:30:00.000Z',
  tradeTimestamp: '2026-09-25T14:30:00.000Z', volume: null, volumeSource: null,
  openInterest: null, openInterestSource: null, iv: null, delta: null, gamma: null, theta: null,
  vega: null, rho: null, greeksTimestamp: null, greeksSource: null, feed: 'INDICATIVE', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15,
});

test('provider boundary fuzz never turns malformed or absent values into executable defaults', () => {
  const nonExecutable = [
    { bid: null }, { ask: null }, { bid: -1 }, { ask: -1 }, { bid: 3, ask: 2 },
    { quoteTimestamp: '2026-09-25T14:31:00.000Z' }, { quoteTimestamp: '2020-01-01T00:00:00.000Z' },
    { source: 'OPTIONOMICS' }, { feed: null }, { dataQuality: 'UNKNOWN' },
  ] as const;
  for (const mutation of nonExecutable) {
    const contract = normalizeOptionContract({ ...valid(), ...mutation } as RawOptionQuoteInput, receivedAt);
    assert.equal(contract.executable, false, JSON.stringify(mutation));
    assert.notEqual(contract.nonExecutableReason, null);
  }
  const malformed = [
    { multiplier: undefined }, { multiplier: 0 }, { multiplier: Number.NaN }, { strike: Number.POSITIVE_INFINITY },
    { bid: '2.00' }, { expiration: 'not-a-date' }, { optionType: 'UNKNOWN' },
  ] as const;
  for (const mutation of malformed) {
    assert.throws(() => normalizeOptionContract({ ...valid(), ...mutation } as unknown as RawOptionQuoteInput, receivedAt),
      undefined, JSON.stringify(mutation));
  }
});

test('unknown activity and Greeks stay null and never acquire fabricated provenance', () => {
  const contract = normalizeOptionContract(valid(), receivedAt);
  assert.equal(contract.volume, null);
  assert.equal(contract.openInterest, null);
  assert.equal(contract.iv, null);
  assert.equal(contract.delta, null);
  assert.equal(contract.greeksSource, null);
  assert.equal(contract.multiplier, 100);
});
