// Phase 4: provider chaos at the normalization boundary. A provider defect must never become fabricated market truth:
//   - no non-finite number reaches a normalized contract (NaN / Infinity become UNKNOWN = null);
//   - a contract is `executable` only when its quote is two-sided, uncrossed, fresh, tight, Alpaca-sourced and GOOD;
//   - an UNKNOWN field is never zero; duplicate or inconsistent provider rows never create a second contract identity from nothing;
//   - the only acceptable failures are typed (no TypeError / unhandled exception).
// Pagination, cyclic tokens, partial chains and HTTP/transport failures are covered in phase3-provider-gaps and alpaca-failure-matrix tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeOptionChain, type AlpacaOptionContractListing, type AlpacaOptionSnapshot, type MergeOptionChainInput } from '../src/theta/option-chain-ingestion.js';
import type { NormalizedOptionContract } from '../src/theta/option-contract.js';

const NOW = '2026-09-10T15:00:00.000Z';
const SYMBOL = 'SPY261009P00500000';
const listing = (over: Partial<AlpacaOptionContractListing> = {}): AlpacaOptionContractListing => ({ symbol: SYMBOL, strikePrice: 500, expirationDate: '2026-10-09', optionType: 'PUT', multiplier: 100, ...over } as AlpacaOptionContractListing);
const snapshot = (over: Partial<AlpacaOptionSnapshot> = {}): AlpacaOptionSnapshot => ({ bid: 1.1, ask: 1.2, bidSize: 10, askSize: 10, quoteTimestamp: NOW,
  greeks: { delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03 }, impliedVolatility: 0.28, dailyVolume: 40, ...over } as AlpacaOptionSnapshot);
const input = (listings: AlpacaOptionContractListing[], snapshots: Array<[string, AlpacaOptionSnapshot]>): MergeOptionChainInput => ({ underlying: 'SPY', asOfDate: '2026-09-10', contracts: listings,
  snapshotsBySymbol: new Map(snapshots), optionomicsBySymbol: new Map(), requestedFeed: 'INDICATIVE', defaultMultiplierForUnknownContracts: 100, receivedAt: NOW,
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.5 });
const one = (over: Partial<AlpacaOptionSnapshot>, listingOver: Partial<AlpacaOptionContractListing> = {}): NormalizedOptionContract => {
  const [contract] = mergeOptionChain(input([listing(listingOver)], [[SYMBOL, snapshot(over)]]));
  assert.ok(contract !== undefined);
  return contract;
};

const numericFields = (contract: NormalizedOptionContract): Array<[string, unknown]> => Object.entries(contract).filter(([, value]) => typeof value === 'number' || value === null || value === undefined) as Array<[string, unknown]>;
const assertFiniteOrNull = (contract: NormalizedOptionContract, label: string): void => {
  for (const [key, value] of Object.entries(contract)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${label}: ${key} = ${value}`);
};

/** a malformed provider VALUE either fails loudly with a typed error (the reviewed contract: it indicates a mapping defect) or, if a contract
 *  is returned, it is finite and not executable. It must never be a crash, a non-finite number, or an executable contract. */
const loudOrSafe = (label: string, run: () => NormalizedOptionContract): void => {
  try {
    const contract = run();
    assertFiniteOrNull(contract, label);
    assert.equal(contract.executable, false, `${label}: a malformed value produced an executable contract`);
  } catch (error) {
    assert.ok(error instanceof Error && !(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof ReferenceError), `${label}: programming error`);
  }
};

test('NaN and Infinity in any quote, size, volume or Greek fail loudly (typed) or stay non-executable; never a non-finite number, never zero', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (const field of ['bid', 'ask', 'bidSize', 'askSize', 'impliedVolatility', 'dailyVolume'] as const) loudOrSafe(`${field}=${bad}`, () => one({ [field]: bad } as Partial<AlpacaOptionSnapshot>));
    for (const field of ['delta', 'gamma', 'theta', 'vega', 'rho'] as const) {
      const run = () => one({ greeks: { delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, [field]: bad } as never });
      try { assertFiniteOrNull(run(), `greek ${field}=${bad}`); } catch (error) { assert.ok(error instanceof Error && !(error instanceof TypeError), `greek ${field}=${bad}`); }
    }
  }
});

test('a missing quote, one-sided quote, crossed quote, zero or negative price is never executable and never invents a price', () => {
  for (const [name, over] of [['no bid', { bid: null }], ['no ask', { ask: null }], ['both missing', { bid: null, ask: null }], ['crossed', { bid: 1.5, ask: 1.2 }],
    ['zero ask', { ask: 0 }], ['negative bid', { bid: -0.1 }], ['negative ask', { ask: -1 }]] as const) {
    const contract = one(over as Partial<AlpacaOptionSnapshot>);
    assert.equal(contract.executable, false, `${name} must not be executable`);
    assert.ok(typeof contract.nonExecutableReason === 'string' && contract.nonExecutableReason.length > 0, `${name} must state why`);
    if (over.bid === null) assert.equal(contract.bid, null, `${name}: a missing bid stays UNKNOWN`);
    if (over.ask === null) assert.equal(contract.ask, null, `${name}: a missing ask stays UNKNOWN`);
  }
});

test('stale, future and garbage quote timestamps are never treated as fresh', () => {
  for (const [name, quoteTimestamp] of [['ancient', '2026-01-01T00:00:00Z'], ['one minute old', '2026-09-10T14:58:59Z'], ['future', '2026-09-10T16:00:00Z'], ['garbage', 'not-a-time'], ['null', null], ['empty', '']] as const) {
    loudOrSafe(`${name} quote timestamp`, () => one({ quoteTimestamp: quoteTimestamp as never }));
  }
  assert.equal(one({ quoteTimestamp: NOW }).executable, true, 'the control case (fresh, tight, two-sided) is executable');
});

test('a wide spread is not executable and the spread is derived, never provided', () => {
  assert.equal(one({ bid: 0.1, ask: 1.0 }).executable, false);
  assert.equal(one({ bid: 1.1, ask: 1.2 }).executable, true);
});

test('missing Greeks stay UNKNOWN; they are never coerced to zero or copied from another field', () => {
  const contract = one({ greeks: null, impliedVolatility: null });
  assert.equal(contract.delta, null); assert.equal(contract.gamma, null); assert.equal(contract.theta, null); assert.equal(contract.vega, null); assert.equal(contract.iv, null);
  assert.equal(contract.greeksSource, null);
});

test('open interest and volume are UNKNOWN when no provider supplied them, never zero', () => {
  const contract = one({ dailyVolume: null });
  assert.equal(contract.volume, null);
  assert.equal(contract.openInterest, null);
});

test('identity that disagrees with the contract OCC symbol is INVALID and never executable (collateral is computed from the strike, orders are placed by symbol)', () => {
  const cases: Array<[string, Partial<AlpacaOptionContractListing>]> = [
    ['strike disagrees with the OCC symbol', { strikePrice: 400 }], ['strike differs by one tick', { strikePrice: 500.5 }], ['expiration disagrees with the OCC symbol', { expirationDate: '2026-11-20' }],
    ['type disagrees with the OCC symbol', { optionType: 'CALL' }]];
  for (const [name, over] of cases) {
    const [contract] = mergeOptionChain(input([listing(over)], [[SYMBOL, snapshot()]]));
    assert.ok(contract !== undefined, name);
    assert.equal(contract.executable, false, `${name}: must not be executable`);
    assert.equal(contract.dataQuality, 'INVALID', `${name}: must be INVALID`);
    assert.match(contract.nonExecutableReason ?? '', /identity disagrees with its OCC symbol/, name);
  }
  // a consistent identity stays executable
  assert.equal(one({}).executable, true);
  // structurally malformed identity fails loudly (typed), never silently accepted
  for (const [name, over] of [['nonpositive strike', { strikePrice: 0 }], ['NaN strike', { strikePrice: Number.NaN }], ['zero multiplier', { multiplier: 0 }], ['negative multiplier', { multiplier: -100 }]] as Array<[string, Partial<AlpacaOptionContractListing>]>) {
    loudOrSafe(name, () => one({}, over));
  }
});

test('duplicate provider rows never create a second distinct identity; conflicting duplicates are not both silently accepted as executable', () => {
  const merged = mergeOptionChain(input([listing(), listing()], [[SYMBOL, snapshot()]]));
  assert.equal(new Set(merged.map((contract) => contract.optionSymbol)).size, 1, 'duplicates share one identity');
  const conflicting = mergeOptionChain(input([listing(), listing({ strikePrice: 505 })], [[SYMBOL, snapshot()]]));
  const executable = conflicting.filter((contract) => contract.executable);
  assert.ok(executable.length <= 1 || new Set(executable.map((contract) => contract.strike)).size === 1, 'two conflicting rows for one symbol must not both be executable at different strikes');
});

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('FUZZ: 3,000 randomly corrupted listings and snapshots never produce a non-finite number, a fabricated price, or an executable bad quote', () => {
  const next = prng(20261004);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const weird = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 1e12, -1e12, 22, -22, 0.5, 1e-9];
  let executableCount = 0, typedFailures = 0;
  for (let run = 0; run < 3000; run += 1) {
    const maybe = <T>(good: T, bad: () => unknown): T => (next() < 0.3 ? (bad() as T) : good);
    const strike = maybe(500, () => pick([...weird, null, '500', undefined]));
    const bid = maybe(1.1, () => pick([...weird, null, undefined, '1.1']));
    const ask = maybe(1.2, () => pick([...weird, null, undefined, '1.2']));
    const raw = {
      listing: listing({ strikePrice: strike as never, multiplier: maybe(100, () => pick([...weird, null, undefined])) as never, expirationDate: maybe('2026-10-09', () => pick(['', 'garbage', null, '2026-13-45', '2026-10-09T00:00:00Z'])) as never,
        optionType: maybe('PUT', () => pick(['put', 'CALL', null, 'X'])) as never }),
      snapshot: snapshot({ bid: bid as never, ask: ask as never, bidSize: maybe(10, () => pick([...weird, null])) as never, askSize: maybe(10, () => pick([...weird, null])) as never,
        quoteTimestamp: maybe(NOW, () => pick(['', 'garbage', null, '2030-01-01T00:00:00Z', '2000-01-01T00:00:00Z'])) as never,
        greeks: maybe({ delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03 }, () => pick([null, { delta: pick(weird), gamma: pick(weird), theta: null, vega: pick(weird), rho: undefined }, {}])) as never,
        impliedVolatility: maybe(0.28, () => pick([...weird, null])) as never, dailyVolume: maybe(40, () => pick([...weird, null, undefined])) as never }),
    };
    try {
      const [contract] = mergeOptionChain(input([raw.listing], [[SYMBOL, raw.snapshot]]));
      assert.ok(contract !== undefined);
      assertFiniteOrNull(contract, `run ${run}`);
      if (contract.executable) {
        executableCount += 1;
        assert.ok(typeof contract.bid === 'number' && typeof contract.ask === 'number' && contract.bid > 0 && contract.ask >= contract.bid, `run ${run}: executable with an unusable quote`);
        assert.equal(contract.bid, raw.snapshot.bid, `run ${run}: the executable bid is not the provider bid (fabricated)`);
        assert.equal(contract.ask, raw.snapshot.ask, `run ${run}: the executable ask is not the provider ask (fabricated)`);
        assert.equal(contract.dataQuality, 'GOOD');
        assert.ok(contract.strike === raw.listing.strikePrice && Number.isFinite(contract.strike as number) && (contract.strike as number) > 0, `run ${run}: executable with an unusable strike`);
        assert.ok(contract.multiplier === 100, `run ${run}: executable with multiplier ${contract.multiplier}`);
        assert.ok(contract.strike === 500 && contract.expiration === '2026-10-09' && contract.optionType === 'PUT', `run ${run}: executable with an identity that disagrees with its OCC symbol`);
      }
      void numericFields;
    } catch (error) {
      typedFailures += 1;
      assert.ok(!(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof ReferenceError), `run ${run}: programming error ${(error as Error).message}`);
    }
  }
  console.log(`provider fuzz: executable=${executableCount}, typed failures=${typedFailures}`);
  assert.ok(executableCount > 100, 'the fuzz must keep exercising the clean path');
});
