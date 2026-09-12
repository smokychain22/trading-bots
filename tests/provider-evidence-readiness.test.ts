import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAlpacaEvidenceCapabilities } from '../src/providers/readiness.js';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-request-id': 'safe-request-id' },
});

test('probes only read-only evidence endpoints and preserves entitlement limits', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}?${url.searchParams.toString()}`);
    assert.equal(init?.method, 'GET');
    if (url.pathname === '/v2/stocks/bars') return json({ bars: { SPY: [{ t: '2026-09-10T00:00:00Z' }] } });
    if (url.pathname === '/v2/options/contracts') return json({ option_contracts: [{ symbol: 'SPY261016P00500000' }] });
    if (url.pathname === '/v1beta1/options/snapshots/SPY') {
      if (url.searchParams.get('feed') === 'opra') return json({ message: 'subscription required' }, 403);
      return json({ snapshots: {
        SPY261016P00500000: {
          latestQuote: { bp: 1, ap: 1.1 }, dailyBar: { v: 10 },
          greeks: { delta: -0.2, gamma: 0.01, theta: -0.02, vega: 0.1 },
        },
      } });
    }
    if (url.pathname === '/v1beta1/options/bars') {
      return url.searchParams.get('feed') === 'opra'
        ? json({ message: 'subscription required' }, 403)
        : json({ bars: { SPY261016P00500000: [{ t: '2026-09-10T00:00:00Z' }] } });
    }
    if (url.pathname === '/v1beta1/options/trades') {
      return url.searchParams.get('feed') === 'opra'
        ? json({ message: 'subscription required' }, 403)
        : json({ trades: { SPY261016P00500000: [{ t: '2026-09-10T00:00:00Z' }] } });
    }
    if (url.pathname === '/v1/corporate-actions') return json({ corporate_actions: [] });
    return json({ message: 'unexpected' }, 404);
  };
  const results = await checkAlpacaEvidenceCapabilities({
    tradingApiBase: 'https://paper-api.alpaca.markets',
    marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'PRIVATE-KEY-MUST-NOT-LEAK', apiSecret: 'PRIVATE-SECRET-MUST-NOT-LEAK', fetchImpl,
  }, new Date('2026-09-12T12:00:00Z'));

  const availability = Object.fromEntries(results.map((result) => [result.capability, result.availability]));
  assert.equal(availability.HISTORICAL_STOCK_BARS, 'AVAILABLE');
  assert.equal(availability.CURRENT_OPTION_SNAPSHOTS_INDICATIVE, 'AVAILABLE_WITH_LIMITS');
  assert.equal(availability.CURRENT_OPTION_GREEKS_INDICATIVE, 'AVAILABLE_WITH_LIMITS');
  assert.equal(availability.CURRENT_OPTION_SNAPSHOTS_OPRA, 'NOT_ENTITLED');
  assert.equal(availability.HISTORICAL_OPTION_BARS_INDICATIVE, 'AVAILABLE_WITH_LIMITS');
  assert.equal(availability.HISTORICAL_OPTION_TRADES_OPRA, 'NOT_ENTITLED');
  assert.equal(availability.HISTORICAL_OPTION_BBO, 'NOT_SUPPORTED');
  assert.equal(availability.HISTORICAL_OPTION_GREEKS, 'NOT_SUPPORTED');
  assert.equal(calls.some((call) => call.includes('/v2/orders')), false);
  assert.equal(calls.every((call) => call.startsWith('GET ')), true);
  const serialized = JSON.stringify(results);
  assert.equal(serialized.includes('PRIVATE-KEY-MUST-NOT-LEAK'), false);
  assert.equal(serialized.includes('PRIVATE-SECRET-MUST-NOT-LEAK'), false);
});

test('does not guess historical requests without an observed contract identity', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/v1beta1/options/snapshots/SPY') return json({ snapshots: {} });
    if (url.pathname === '/v2/stocks/bars') return json({ bars: { SPY: [] } });
    if (url.pathname === '/v2/options/contracts') return json({ option_contracts: [] });
    if (url.pathname === '/v1/corporate-actions') return json({ corporate_actions: [] });
    return json({}, 404);
  };
  const results = await checkAlpacaEvidenceCapabilities({
    tradingApiBase: 'https://paper-api.alpaca.markets',
    marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'k', apiSecret: 's', fetchImpl,
  }, new Date('2026-09-12T12:00:00Z'));
  assert.equal(calls.includes('/v1beta1/options/bars'), false);
  assert.equal(calls.includes('/v1beta1/options/trades'), false);
  assert.equal(results.find((result) => result.capability === 'HISTORICAL_OPTION_BARS_INDICATIVE')?.availability, 'UNVERIFIED');
});
