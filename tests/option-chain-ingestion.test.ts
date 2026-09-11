import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeOptionChain, type MergeOptionChainInput } from '../src/theta/option-chain-ingestion.js';

const NOW = '2026-09-10T15:00:00.000Z';

const baseInput = (overrides: Partial<MergeOptionChainInput> = {}): MergeOptionChainInput => ({
  underlying: 'SPY',
  asOfDate: '2026-09-10',
  contracts: [{ symbol: 'SPY261009P00500000', strikePrice: 500, expirationDate: '2026-10-09', optionType: 'PUT', multiplier: 100 }],
  snapshotsBySymbol: new Map(),
  optionomicsBySymbol: new Map(),
  requestedFeed: 'INDICATIVE',
  defaultMultiplierForUnknownContracts: 100,
  receivedAt: NOW,
  maxQuoteAgeSecondsForExecutable: 30,
  maxSpreadPctForExecutable: 0.5,
  ...overrides,
});

test('a contract with a full Alpaca snapshot (bid/ask/Greeks/volume) uses Alpaca for every feature', () => {
  const [contract] = mergeOptionChain(baseInput({
    snapshotsBySymbol: new Map([
      ['SPY261009P00500000', {
        bid: 0.11, ask: 0.12, bidSize: 918, askSize: 931, quoteTimestamp: NOW,
        greeks: { delta: -0.0032, gamma: 0.0001, theta: -0.0187, vega: 0.021, rho: -0.002 },
        impliedVolatility: 0.5228, dailyVolume: 5,
      }],
    ]),
    optionomicsBySymbol: new Map([
      ['SPY261009P00500000', { symbol: 'SPY261009P00500000', delta: -0.5, gamma: 0.5, theta: -0.5, vega: 0.5, rho: -0.5, impliedVolatility: 0.9, volume: 999, openInterest: 42 }],
    ]),
  }));
  assert.ok(contract !== undefined);
  assert.equal(contract?.bid, 0.11);
  assert.equal(contract?.ask, 0.12);
  assert.equal(contract?.delta, -0.0032); // Alpaca's own Greek, not Optionomics's
  assert.equal(contract?.greeksSource, 'ALPACA');
  assert.equal(contract?.volume, 5); // Alpaca's own volume, not Optionomics's 999
  assert.equal(contract?.volumeSource, 'ALPACA');
  // Alpaca never supplies open interest in this module's inputs -- must
  // fall back to Optionomics even when Alpaca supplied every other feature.
  assert.equal(contract?.openInterest, 42);
  assert.equal(contract?.openInterestSource, 'OPTIONOMICS');
});

test('a contract with no Alpaca Greeks falls back to Optionomics, tracked via greeksSource', () => {
  const [contract] = mergeOptionChain(baseInput({
    snapshotsBySymbol: new Map([
      ['SPY261009P00500000', { bid: 0.11, ask: 0.12, bidSize: 918, askSize: 931, quoteTimestamp: NOW, greeks: null, impliedVolatility: null, dailyVolume: null }],
    ]),
    optionomicsBySymbol: new Map([
      ['SPY261009P00500000', { symbol: 'SPY261009P00500000', delta: -0.02, gamma: 0.01, theta: -0.1, vega: 0.02, rho: null, impliedVolatility: 0.3, volume: 12, openInterest: 200 }],
    ]),
  }));
  assert.equal(contract?.delta, -0.02);
  assert.equal(contract?.greeksSource, 'OPTIONOMICS');
  assert.equal(contract?.volume, 12);
  assert.equal(contract?.volumeSource, 'OPTIONOMICS');
});

test('a contract with no snapshot at all is still emitted, fully UNKNOWN and non-executable -- never dropped', () => {
  const [contract] = mergeOptionChain(baseInput());
  assert.ok(contract !== undefined);
  assert.equal(contract?.bid, null);
  assert.equal(contract?.greeksSource, null);
  assert.equal(contract?.volumeSource, null);
  assert.equal(contract?.openInterestSource, null);
  assert.equal(contract?.executable, false);
});

test('Alpaca bid/ask is NEVER substituted by an Optionomics quote, even when Optionomics has one', () => {
  // Optionomics's own chain entries in this module's contract carry no
  // bid/ask fields at all -- this test documents that the merge function's
  // input type structurally cannot accept an Optionomics quote for
  // execution pricing, which is the actual enforcement mechanism.
  const [contract] = mergeOptionChain(baseInput({
    snapshotsBySymbol: new Map([
      ['SPY261009P00500000', { bid: 0.11, ask: 0.12, bidSize: 1, askSize: 1, quoteTimestamp: NOW, greeks: null, impliedVolatility: null, dailyVolume: null }],
    ]),
  }));
  assert.equal(contract?.bid, 0.11);
  assert.equal(contract?.source, 'ALPACA');
});

test('requestedFeed is preserved as the contract feed, INDICATIVE never silently reported as OPRA', () => {
  const [contract] = mergeOptionChain(baseInput({ requestedFeed: 'INDICATIVE' }));
  assert.equal(contract?.feed, 'INDICATIVE');
});

test('a contract absent from the Alpaca listing entirely never appears (no fabricated candidate)', () => {
  const contracts = mergeOptionChain(baseInput());
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0]?.optionSymbol, 'SPY261009P00500000');
});

test('a contract\'s own real multiplier is used over the caller-supplied default when both are present', () => {
  const [contract] = mergeOptionChain(baseInput({
    contracts: [{ symbol: 'ADJ261009P00500000', strikePrice: 500, expirationDate: '2026-10-09', optionType: 'PUT', multiplier: 250 }],
    defaultMultiplierForUnknownContracts: 100,
  }));
  assert.equal(contract?.multiplier, 250);
});

test('the caller-supplied default is used ONLY when the contract\'s own multiplier is genuinely unknown', () => {
  const [contract] = mergeOptionChain(baseInput({
    contracts: [{ symbol: 'SPY261009P00500000', strikePrice: 500, expirationDate: '2026-10-09', optionType: 'PUT', multiplier: null }],
    defaultMultiplierForUnknownContracts: 100,
  }));
  assert.equal(contract?.multiplier, 100);
});
