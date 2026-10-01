import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaProviderError, fetchMarketClock, fetchOpenOrders, fetchPositions, type AlpacaErrorClass, type AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';

const NOW = '2026-10-01T15:00:00.000Z';
const config = (fetchImpl: typeof fetch, requestTimeoutMs = 50): AlpacaProviderConfig => ({
  tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: 'TEST-SYNTHETIC-KEY-0000', apiSecret: 'TEST-SYNTHETIC-SECRET-0000', fetchImpl, requestTimeoutMs,
});
const status = (code: number, body: unknown = {}): typeof fetch => (async () =>
  new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } })) as typeof fetch;

async function classify(operation: () => Promise<unknown>): Promise<{ errorClass: AlpacaErrorClass; httpStatus: number | null; message: string }> {
  try { await operation(); } catch (error) {
    if (error instanceof AlpacaProviderError) return { errorClass: error.errorClass, httpStatus: error.httpStatus, message: error.message };
    throw error;
  }
  throw new Error('expected the provider call to fail');
}

test('HTTP failure matrix: every status maps to a typed class that is never an empty/successful read', async () => {
  const expected: ReadonlyArray<readonly [number, AlpacaErrorClass]> = [
    [400, 'INVALID_REQUEST'], [401, 'INVALID_AUTH'], [403, 'NOT_ENTITLED'], [404, 'INVALID_REQUEST'], [422, 'INVALID_REQUEST'],
    [429, 'RATE_LIMITED'], [500, 'SERVER_ERROR'], [502, 'SERVER_ERROR'], [503, 'SERVER_ERROR'], [504, 'SERVER_ERROR'],
  ];
  for (const [code, errorClass] of expected) {
    for (const [label, call] of [['clock', () => fetchMarketClock(config(status(code)), NOW)],
      ['positions', () => fetchPositions(config(status(code)), NOW)], ['orders', () => fetchOpenOrders(config(status(code)), NOW)]] as const) {
      const failure = await classify(call);
      assert.equal(failure.errorClass, errorClass, `${label} HTTP ${code}`);
      assert.equal(failure.httpStatus, code);
      assert.doesNotMatch(failure.message, /TEST-SYNTHETIC/, 'error text never contains credentials');
    }
  }
});

test('transport failures are typed: abort/timeout, connection reset and DNS are never an empty read', async () => {
  const hang: typeof fetch = ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as typeof fetch;
  assert.equal((await classify(() => fetchMarketClock(config(hang, 20), NOW))).errorClass, 'PROVIDER_TIMEOUT');
  for (const code of ['ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT']) {
    const reset: typeof fetch = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code } }); }) as typeof fetch;
    const failure = await classify(() => fetchPositions(config(reset), NOW));
    assert.equal(failure.errorClass, 'NETWORK_ERROR', code);
  }
});

test('malformed and non-JSON 200 responses are MALFORMED_RESPONSE, never an empty or successful result', async () => {
  const notJson: typeof fetch = (async () => new Response('<html>gateway</html>', { status: 200 })) as typeof fetch;
  assert.equal((await classify(() => fetchMarketClock(config(notJson), NOW))).errorClass, 'MALFORMED_RESPONSE');
  assert.equal((await classify(() => fetchPositions(config(status(200, { not: 'an array' })), NOW))).errorClass, 'MALFORMED_RESPONSE');
  assert.equal((await classify(() => fetchOpenOrders(config(status(200, 'oops')), NOW))).errorClass, 'MALFORMED_RESPONSE');
});

test('a truthful empty account is a valid read, distinct from every failure above', async () => {
  const positions = await fetchPositions(config(status(200, [])), NOW);
  assert.equal(positions.length, 0);
});
