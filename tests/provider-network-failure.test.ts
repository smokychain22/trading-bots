import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMasterAccountSnapshot, AlpacaProviderError } from '../src/theta/alpaca-provider.js';
import { fetchOptionomicsOptionChain } from '../src/theta/optionomics-provider.js';
import { providerNetworkFailureCode } from '../src/theta/provider-network-failure.js';

test('Alpaca and Optionomics preserve sanitized transport classes through real adapters', async () => {
  for (const [code, expected] of [['EAI_AGAIN', 'PROVIDER_DNS_FAILURE'], ['ECONNRESET', 'PROVIDER_CONNECTION_LOST'],
    ['CERT_HAS_EXPIRED', 'PROVIDER_TLS_FAILURE'], ['ECONNREFUSED', 'PROVIDER_TCP_FAILURE'],
    ['UND_ERR_CONNECT_TIMEOUT', 'PROVIDER_NETWORK_TIMEOUT'], ['PRIVATE_ERROR', 'PROVIDER_NETWORK_UNKNOWN']]) {
    const error = Object.assign(new Error('PRIVATE_MESSAGE'), { name: 'PRIVATE_ERROR_NAME', cause: { code } });
    const fetchImpl: typeof fetch = async () => { throw error; };
    await assert.rejects(fetchMasterAccountSnapshot({ apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC',
      tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', fetchImpl }, '2026-09-30T15:00:00Z'),
    (e: unknown) => e instanceof AlpacaProviderError && e.errorClass === 'NETWORK_ERROR' && e.safeDetailCode === expected
      && !e.message.includes('PRIVATE'));
    const result = await fetchOptionomicsOptionChain({ apiBase: 'https://optionomics.ai', apiToken: 'SYNTHETIC',
      email: 'synthetic@example.invalid', fetchImpl }, 'SPY');
    assert.equal(result.kind, 'REQUEST_ERROR');
    if (result.kind !== 'REQUEST_ERROR') continue;
    assert.equal(result.errorClass, 'NETWORK_FAILURE'); assert.equal(result.detail, expected);
  }
});

test('cyclic or untyped transport causes stay bounded and private', () => {
  const error: { cause?: unknown } = {}; error.cause = error;
  assert.equal(providerNetworkFailureCode(error), 'PROVIDER_NETWORK_UNKNOWN');
  assert.equal(providerNetworkFailureCode('PRIVATE'), 'PROVIDER_NETWORK_UNKNOWN');
});

test('Alpaca body reset retains network failure rather than malformed JSON', async () => {
  const fetchImpl: typeof fetch = async () => ({ ok: true, status: 200,
    json: async () => { throw Object.assign(new Error('PRIVATE'), { code: 'ECONNRESET' }); } }) as Response;
  await assert.rejects(fetchMasterAccountSnapshot({ apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC',
    tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', fetchImpl }, '2026-09-30T15:00:00Z'),
  (e: unknown) => e instanceof AlpacaProviderError && e.errorClass === 'NETWORK_ERROR' && e.safeDetailCode === 'PROVIDER_CONNECTION_LOST');
});
