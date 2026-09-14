import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOptionomicsFeatureSnapshot } from '../src/theta/optionomics-feature-engine.js';
import { fetchOptionomicsOptionChain, type OptionomicsProviderConfig } from '../src/theta/optionomics-provider.js';

const NOW = '2026-09-14T15:00:00.000Z';
const config = (payload: unknown): OptionomicsProviderConfig => ({
  apiBase: 'https://optionomics.ai', email: 'synthetic@example.com', apiToken: 'SYNTHETIC_TEST_TOKEN',
  now: () => NOW, sleepImpl: async () => {},
  fetchImpl: (async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
});

test('builds layered contract features and contract-multiplier-safe structural economics', async () => {
  const payload = [
    { symbol: 'SPY261016P00500000', underlying: 'SPY', expiration: '2026-10-16', option_type: 'put', strike: 500,
      price: 8, bid: 7.9, ask: 8.1, bid_size: 4, ask_size: 6, open_interest: 2000, volume: 0,
      implied_volatility: 0.24, delta: -0.25, gamma: 0.01, theta: -0.08, vega: 0.22, rho: -0.04,
      gamma_exposure: -1200, as_of: NOW },
    { symbol: 'SPY261016C00520000', underlying: 'SPY', expiration: '2026-10-16', option_type: 'call', strike: 520,
      bid: 6, ask: 6.2, implied_volatility: 0.20, delta: 0.25, as_of: NOW },
    { symbol: 'SPY261120P00500000', underlying: 'SPY', expiration: '2026-11-20', option_type: 'put', strike: 500,
      bid: 10, ask: 10.3, implied_volatility: 0.28, delta: -0.30, as_of: NOW },
  ];
  const outcome = await fetchOptionomicsOptionChain(config(payload), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const result = buildOptionomicsFeatureSnapshot({
    chain: outcome.value, flowWindows: [], stockPrice: 510,
    multiplierByContract: new Map([['SPY261016P00500000', 100]]),
  });
  assert.equal(result.responseHash.length, 64);
  assert.equal(result.contracts[0]?.structuralEconomics.securedCollateral.value, 50_000);
  assert.equal(result.contracts[0]?.structuralEconomics.grossBidPremiumCash.value, 790);
  assert.equal(result.contracts[0]?.liquidity.volume.value, 0);
  assert.equal(result.contracts[0]?.marketStructure.gammaExposure.value, -1200);
  assert.ok(Math.abs((result.skew.value ?? 0) - 0.04) < 1e-12);
  assert.equal(result.termStructure.state, 'KNOWN');
  assert.equal(result.volatilitySurface.state, 'KNOWN');
  assert.equal(result.empiricalEvReady, false);
});

test('keeps absent feature families and multiplier-dependent economics UNKNOWN', async () => {
  const outcome = await fetchOptionomicsOptionChain(config([{ symbol: 'X', bid: 0, volume: 0 }]), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const result = buildOptionomicsFeatureSnapshot({ chain: outcome.value, flowWindows: [], stockPrice: null });
  assert.equal(result.contracts[0]?.quote.bid.value, 0);
  assert.equal(result.contracts[0]?.quote.ask.state, 'UNKNOWN');
  assert.equal(result.contracts[0]?.structuralEconomics.securedCollateral.state, 'UNKNOWN');
  assert.ok(result.unavailableFamilies.includes('IV'));
  assert.ok(result.unavailableFamilies.includes('VANNA'));
});
