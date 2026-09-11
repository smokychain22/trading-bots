import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleCboeRegimeSnapshot,
  createCboeRegimeCache,
  fetchCboeQuote,
  fetchCboeQuoteCached,
  type CboeProviderConfig,
} from '../src/theta/cboe-regime.js';

const NOW = '2026-09-10T15:00:00.000Z';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const baseConfig = (fetchImpl: typeof fetch, overrides: Partial<CboeProviderConfig> = {}): CboeProviderConfig => ({
  apiBase: 'https://cdn.cboe.com',
  fetchImpl,
  now: () => NOW,
  ...overrides,
});

test('a valid public observation is parsed with raw value, asOfUtc, and CBOE source', async () => {
  const fetchImpl = (async () => jsonResponse(200, { data: { symbol: 'VIX', current_price: 14.32, last_trade_time: '2026-09-10T14:55:00.000Z' } })) as typeof fetch;
  const outcome = await fetchCboeQuote(baseConfig(fetchImpl), 'VIX');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value, 14.32);
  assert.equal(outcome.asOfUtc, '2026-09-10T14:55:00.000Z');
});

test('a missing/unrecognized field (no numeric price in the data object) is VALUE_UNKNOWN_AFTER_SUCCESS, never a fabricated 0', async () => {
  const fetchImpl = (async () => jsonResponse(200, { data: { symbol: 'VIX' } })) as typeof fetch;
  const outcome = await fetchCboeQuote(baseConfig(fetchImpl), 'VIX');
  assert.equal(outcome.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
});

test('a genuinely absent data envelope is also VALUE_UNKNOWN_AFTER_SUCCESS, never a REQUEST_ERROR', async () => {
  const fetchImpl = (async () => jsonResponse(200, { unexpected: true })) as typeof fetch;
  const outcome = await fetchCboeQuote(baseConfig(fetchImpl), '$CPCE');
  assert.equal(outcome.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
});

test('a provider failure (500) is REQUEST_ERROR/PROVIDER_FAILURE, never silently treated as UNKNOWN-but-fine', async () => {
  const fetchImpl = (async () => new Response('', { status: 500 })) as typeof fetch;
  const outcome = await fetchCboeQuote(baseConfig(fetchImpl), 'VIX');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'PROVIDER_FAILURE');
  assert.equal(outcome.httpStatus, 500);
});

test('a network failure is REQUEST_ERROR/NETWORK_FAILURE', async () => {
  const fetchImpl = (async () => { throw new Error('ENOTFOUND'); }) as typeof fetch;
  const outcome = await fetchCboeQuote(baseConfig(fetchImpl), 'VIX');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'NETWORK_FAILURE');
});

test('a 429 is REQUEST_ERROR/RATE_LIMITED', async () => {
  const fetchImpl = (async () => new Response('', { status: 429 })) as typeof fetch;
  const outcome = await fetchCboeQuote(baseConfig(fetchImpl), 'VIX');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'RATE_LIMITED');
});

test('a non-JSON body is REQUEST_ERROR/INVALID_PROVIDER_RESPONSE', async () => {
  const fetchImpl = (async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const outcome = await fetchCboeQuote(baseConfig(fetchImpl), 'VIX');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'INVALID_PROVIDER_RESPONSE');
});

test('a stale observation (asOfUtc far in the past relative to retrievedAt) is classified STALE, never GOOD', async () => {
  const staleTime = new Date(new Date(NOW).getTime() - 10 * 3600_000).toISOString(); // 10 hours old
  const fetchImpl = (async () => jsonResponse(200, { data: { current_price: 14.32, last_trade_time: staleTime } })) as typeof fetch;
  const snapshot = await assembleCboeRegimeSnapshot(baseConfig(fetchImpl), createCboeRegimeCache(), 60);
  assert.equal(snapshot.vix.dataQuality, 'STALE');
  assert.equal(snapshot.vix.raw, 14.32); // the raw value is preserved even when stale -- staleness is a quality flag, not a deletion
});

test('a fresh observation is classified GOOD', async () => {
  const freshTime = new Date(new Date(NOW).getTime() - 60_000).toISOString(); // 1 minute old
  const fetchImpl = (async () => jsonResponse(200, { data: { current_price: 14.32, last_trade_time: freshTime } })) as typeof fetch;
  const snapshot = await assembleCboeRegimeSnapshot(baseConfig(fetchImpl), createCboeRegimeCache(), 60);
  assert.equal(snapshot.vix.dataQuality, 'GOOD');
});

test('UNKNOWN preservation: an unparseable put/call-ratio symbol never becomes 0 -- raw stays null, quality stays UNKNOWN', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('CPC')) return jsonResponse(200, { unexpected_shape: true }); // put/call symbols: unrecognized shape
    return jsonResponse(200, { data: { current_price: 14.32, last_trade_time: NOW } });
  }) as typeof fetch;
  const snapshot = await assembleCboeRegimeSnapshot(baseConfig(fetchImpl), createCboeRegimeCache(), 60);
  assert.equal(snapshot.equityPutCall.raw, null);
  assert.equal(snapshot.equityPutCall.dataQuality, 'UNKNOWN');
  assert.equal(snapshot.indexPutCall.raw, null);
  assert.equal(snapshot.totalPutCall.raw, null);
  // VIX/VIX9D/VVIX are unaffected by the put/call symbols' failure.
  assert.equal(snapshot.vix.raw, 14.32);
});

test('a provider failure for one symbol never blocks the rest of the snapshot from being assembled', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/VIX.json')) return new Response('', { status: 500 });
    return jsonResponse(200, { data: { current_price: 90, last_trade_time: NOW } });
  }) as typeof fetch;
  const snapshot = await assembleCboeRegimeSnapshot(baseConfig(fetchImpl), createCboeRegimeCache(), 60);
  assert.equal(snapshot.vix.raw, null);
  assert.equal(snapshot.vix.dataQuality, 'UNKNOWN');
  assert.equal(snapshot.vix.source, 'UNKNOWN');
  assert.equal(snapshot.vvix.raw, 90); // VVIX still real
});

// --- caching ---

test('a cached observation within TTL short-circuits the real HTTP call', async () => {
  let callCount = 0;
  const fetchImpl = (async () => { callCount += 1; return jsonResponse(200, { data: { current_price: 14.32, last_trade_time: NOW } }); }) as typeof fetch;
  const cache = createCboeRegimeCache();
  const config = baseConfig(fetchImpl);
  await fetchCboeQuoteCached(config, cache, 'VIX', 300);
  await fetchCboeQuoteCached(config, cache, 'VIX', 300);
  assert.equal(callCount, 1);
});

test('a cache entry outside TTL triggers a fresh real fetch', async () => {
  let callCount = 0;
  const fetchImpl = (async () => { callCount += 1; return jsonResponse(200, { data: { current_price: 14.32, last_trade_time: NOW } }); }) as typeof fetch;
  const cache = createCboeRegimeCache();
  let clock = NOW;
  const config = baseConfig(fetchImpl, { now: () => clock });
  await fetchCboeQuoteCached(config, cache, 'VIX', 60);
  clock = new Date(new Date(NOW).getTime() + 120_000).toISOString(); // 2 minutes later, TTL=60s
  await fetchCboeQuoteCached(config, cache, 'VIX', 60);
  assert.equal(callCount, 2);
});

test('a failing outcome is also cached (never hammers a down endpoint within the TTL window)', async () => {
  let callCount = 0;
  const fetchImpl = (async () => { callCount += 1; return new Response('', { status: 500 }); }) as typeof fetch;
  const cache = createCboeRegimeCache();
  const config = baseConfig(fetchImpl);
  await fetchCboeQuoteCached(config, cache, 'VIX', 300);
  await fetchCboeQuoteCached(config, cache, 'VIX', 300);
  assert.equal(callCount, 1);
});
