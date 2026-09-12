import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyProviderDisagreement,
  fetchOptionomicsNetFlowWindow,
  fetchOptionomicsOptionChain,
  matchOptionomicsContractIdentity,
  type AlpacaContractIdentity,
  type DisagreementTolerancePolicy,
  type OptionomicsProviderConfig,
} from '../src/theta/optionomics-provider.js';

// All tests use an injected fetchImpl -- NEVER live network, never real
// credentials. Test credentials below are obvious synthetic placeholders.

const NOW = '2026-09-10T15:00:00.000Z';

const jsonResponse = (status: number, body: unknown, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const noSleep = async (): Promise<void> => {};

const baseConfig = (fetchImpl: typeof fetch, overrides: Partial<OptionomicsProviderConfig> = {}): OptionomicsProviderConfig => ({
  apiBase: 'https://optionomics.ai',
  email: 'test-synthetic@example.com',
  apiToken: 'TEST-SYNTHETIC-TOKEN-0000',
  fetchImpl,
  now: () => NOW,
  sleepImpl: noSleep,
  maxRetryAttempts: 3,
  ...overrides,
});

test('200 valid response: entries normalize with full Greeks/OI/volume/IV', async () => {
  const fetchImpl = (async () => jsonResponse(200, [
    { symbol: 'SPY260910P00500000', underlying: 'SPY', expiration: '2026-09-10', option_type: 'put', strike: 500, open_interest: 1200, volume: 340, implied_volatility: 0.22, delta: -0.3, gamma: 0.01, theta: -0.05, vega: 0.1, rho: -0.02, as_of: NOW },
  ])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries.length, 1);
  const entry = outcome.value.entries[0];
  assert.equal(entry?.openInterest, 1200);
  assert.equal(entry?.volume, 340);
  assert.equal(entry?.impliedVolatility, 0.22);
  assert.equal(entry?.impliedVolatilityUnits, 'DECIMAL');
  assert.equal(entry?.delta, -0.3);
});

test('historical chain fetch uses only documented point-in-time filters', async () => {
  let requested: URL | null = null;
  const fetchImpl = (async (input) => {
    requested = new URL(String(input));
    return jsonResponse(200, []);
  }) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY', {
    sessionDate: '2025-04-21', expirationDate: '2025-05-16', limit: 250,
    optionType: 'put', strikeMin: 450, strikeMax: 550,
  });
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  assert.equal(requested?.pathname, '/api/v1/stocks/SPY/options');
  assert.equal(requested?.searchParams.get('date'), '2025-04-21');
  assert.equal(requested?.searchParams.get('expiration_date'), '2025-05-16');
  assert.equal(requested?.searchParams.get('option_type'), 'put');
  assert.equal(requested?.searchParams.get('limit'), '250');
  assert.equal(requested?.searchParams.get('strike_min'), '450');
  assert.equal(requested?.searchParams.get('strike_max'), '550');
});

test('200 legitimate empty response: a real query that found nothing is VALUE_PRESENT with zero entries, never an error', async () => {
  const fetchImpl = (async () => jsonResponse(200, [])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries.length, 0);
});

test('200 option with OI = 0 is a real zero, never conflated with UNKNOWN', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{ symbol: 'X', open_interest: 0 }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries[0]?.openInterest, 0);
});

test('200 option with OI absent is UNKNOWN (null), never coerced to zero', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{ symbol: 'X' }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries[0]?.openInterest, null);
});

test('200 volume = 0 is a real zero', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{ symbol: 'X', volume: 0 }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries[0]?.volume, 0);
});

test('200 volume absent is UNKNOWN (null)', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{ symbol: 'X' }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries[0]?.volume, null);
});

test('implied volatility outside the conservative decimal band is reported UNKNOWN, never silently rescaled', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{ symbol: 'X', implied_volatility: 45 }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const entry = outcome.value.entries[0];
  assert.equal(entry?.impliedVolatility, null);
  assert.equal(entry?.impliedVolatilityUnits, 'UNKNOWN');
  assert.equal(entry?.impliedVolatilityRaw, 45);
});

test('net-flow evidence uses documented 8h/24h/48h window parameters without inventing sentiment', async () => {
  let requested: URL | null = null;
  const fetchImpl = (async (input) => {
    requested = new URL(String(input));
    return jsonResponse(200, { net_calls: [{ timestamp: NOW, value: 12 }], net_puts: [] });
  }) as typeof fetch;
  const outcome = await fetchOptionomicsNetFlowWindow(baseConfig(fetchImpl), 'SPY', 24, NOW);
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(requested?.pathname, '/api/v1/flow/net');
  assert.equal(requested?.searchParams.get('symbol'), 'SPY');
  assert.equal(requested?.searchParams.get('resolution'), '5m');
  assert.equal(Number(requested?.searchParams.get('to')) - Number(requested?.searchParams.get('from')), 24 * 3_600);
  assert.equal(outcome.value.netCalls.length, 1);
  assert.equal(outcome.value.netPuts.length, 0);
  assert.equal(outcome.value.evidenceClass, 'RESEARCH_CONTEXT_ONLY');
  assert.equal(outcome.value.executableTruth, false);
  assert.equal('sentiment' in outcome.value, false);
});

test('empty net-flow arrays remain a successful real observation, not fabricated zero sentiment', async () => {
  const fetchImpl = (async () => jsonResponse(200, { net_calls: [], net_puts: [] })) as typeof fetch;
  const outcome = await fetchOptionomicsNetFlowWindow(baseConfig(fetchImpl), 'SPY', 8, NOW);
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.deepEqual(outcome.value.netCalls, []);
  assert.deepEqual(outcome.value.netPuts, []);
});

test('net-flow schema omission is UNKNOWN after success, never an empty invented series', async () => {
  const fetchImpl = (async () => jsonResponse(200, { result: [] })) as typeof fetch;
  const outcome = await fetchOptionomicsNetFlowWindow(baseConfig(fetchImpl), 'SPY', 48, NOW);
  assert.equal(outcome.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
});

test('one invalid IV remains UNKNOWN without contaminating valid sibling contracts', async () => {
  const fetchImpl = (async () => jsonResponse(200, [
    { symbol: 'BAD', implied_volatility: 45 },
    { symbol: 'GOOD', implied_volatility: 0.27 },
  ])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries[0]?.impliedVolatility, null);
  assert.equal(outcome.value.entries[1]?.impliedVolatility, 0.27);
});

test('invalid JSON body on a 2xx response is a REQUEST_ERROR classified INVALID_PROVIDER_RESPONSE -- the body cannot even be parsed to check its shape', async () => {
  const fetchImpl = (async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  // A non-JSON body cannot even be inspected for shape -- this is an
  // INVALID_PROVIDER_RESPONSE request-level failure, distinct from a
  // schema mismatch on an otherwise-parsed body (the next test: valid
  // JSON, but not the expected array shape, is VALUE_UNKNOWN_AFTER_SUCCESS
  // instead, since the HTTP call itself genuinely succeeded).
  assert.equal(outcome.errorClass, 'INVALID_PROVIDER_RESPONSE');
});

test('schema-invalid response body (2xx, valid JSON, but not array-shaped) is VALUE_UNKNOWN_AFTER_SUCCESS, never a REQUEST_ERROR', async () => {
  const fetchImpl = (async () => jsonResponse(200, { unexpected: 'shape' })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
});

test('401 is classified AUTHENTICATION_FAILED', async () => {
  const fetchImpl = (async () => new Response('', { status: 401 })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'AUTHENTICATION_FAILED');
  assert.equal(outcome.httpStatus, 401);
});

test('402 is classified SUBSCRIPTION_REQUIRED', async () => {
  const fetchImpl = (async () => new Response('', { status: 402 })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'SUBSCRIPTION_REQUIRED');
});

test('403 is classified NOT_ENTITLED', async () => {
  const fetchImpl = (async () => new Response('', { status: 403 })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'NOT_ENTITLED');
});

test('429 then success: a bounded retry recovers, never surfacing the transient 429 as an error', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '1' } });
    return jsonResponse(200, [{ symbol: 'X', open_interest: 5 }]);
  }) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  assert.equal(calls, 2);
});

test('429 exhausted: bounded retries give up and report RATE_LIMITED with attemptCount, never an infinite loop', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('', { status: 429, headers: { 'retry-after': '1' } });
  }) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl, { maxRetryAttempts: 3 }), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'RATE_LIMITED');
  assert.equal(outcome.attemptCount, 3);
  assert.equal(calls, 3);
  assert.equal(outcome.retryAfterSeconds, 1);
});

test('500 is classified PROVIDER_FAILURE', async () => {
  const fetchImpl = (async () => new Response('', { status: 500 })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'PROVIDER_FAILURE');
});

test('timeout is classified PROVIDER_TIMEOUT, never hangs the caller', async () => {
  const fetchImpl = (async (_input, init) => {
    const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl, { timeoutMs: 5 }), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'PROVIDER_TIMEOUT');
});

test('network exception (DNS/connection failure) is classified NETWORK_FAILURE', async () => {
  const fetchImpl = (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.equal(outcome.errorClass, 'NETWORK_FAILURE');
});

test('credential values never appear in a thrown/returned error message', async () => {
  const fetchImpl = (async () => new Response('', { status: 401 })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl, { apiToken: 'SECRET-VALUE-MUST-NOT-LEAK', email: 'leaky@example.com' }), 'SPY');
  assert.equal(outcome.kind, 'REQUEST_ERROR');
  if (outcome.kind !== 'REQUEST_ERROR') return;
  assert.ok(!outcome.detail.includes('SECRET-VALUE-MUST-NOT-LEAK'));
  assert.ok(!outcome.detail.includes('leaky@example.com'));
});

// --- Exact contract identity (never fuzzy) ---

const alpacaContracts: readonly AlpacaContractIdentity[] = [
  { symbol: 'SPY260910P00500000', underlying: 'SPY', expiration: '2026-09-10', optionType: 'PUT', strike: 500 },
  { symbol: 'SPY260910P00505000', underlying: 'SPY', expiration: '2026-09-10', optionType: 'PUT', strike: 505 },
];

test('exact OCC symbol identity match', () => {
  const match = matchOptionomicsContractIdentity(
    { rawSymbol: 'SPY260910P00500000', underlying: null, expiration: null, optionType: null, strike: null },
    alpacaContracts,
  );
  assert.equal(match.method, 'EXACT_OCC_SYMBOL');
  assert.equal(match.alpacaSymbol, 'SPY260910P00500000');
});

test('deterministic fallback identity match (underlying+expiration+type+strike) when no symbol is provided', () => {
  const match = matchOptionomicsContractIdentity(
    { rawSymbol: null, underlying: 'SPY', expiration: '2026-09-10', optionType: 'PUT', strike: 505 },
    alpacaContracts,
  );
  assert.equal(match.method, 'EXACT_UNDERLYING_EXPIRATION_TYPE_STRIKE');
  assert.equal(match.alpacaSymbol, 'SPY260910P00505000');
});

test('identity mismatch is rejected as UNMATCHED, never a nearest-strike guess', () => {
  const match = matchOptionomicsContractIdentity(
    { rawSymbol: 'DIFFERENT_SYMBOL', underlying: 'SPY', expiration: '2026-09-10', optionType: 'PUT', strike: 501 },
    alpacaContracts,
  );
  assert.equal(match.method, 'UNMATCHED');
  assert.equal(match.alpacaSymbol, null);
});

// --- Provider disagreement (never a silent average) ---

const disagreementPolicy: DisagreementTolerancePolicy = { policyVersion: 'disagreement-v1-test', minorRelativeTolerance: 0.05, materialRelativeTolerance: 0.2 };

test('identical values classify CONSISTENT', () => {
  assert.equal(classifyProviderDisagreement(0.2, 0.2, disagreementPolicy), 'CONSISTENT');
});

test('a small relative difference classifies CONSISTENT within tolerance', () => {
  assert.equal(classifyProviderDisagreement(0.2, 0.204, disagreementPolicy), 'CONSISTENT');
});

test('a moderate relative difference classifies MINOR_DIFFERENCE', () => {
  assert.equal(classifyProviderDisagreement(0.2, 0.23, disagreementPolicy), 'MINOR_DIFFERENCE');
});

test('a large relative difference classifies MATERIAL_DISAGREEMENT', () => {
  assert.equal(classifyProviderDisagreement(0.2, 0.5, disagreementPolicy), 'MATERIAL_DISAGREEMENT');
});

test('either value UNKNOWN (null) classifies UNKNOWN, never averaged with a guess', () => {
  assert.equal(classifyProviderDisagreement(null, 0.2, disagreementPolicy), 'UNKNOWN');
  assert.equal(classifyProviderDisagreement(0.2, null, disagreementPolicy), 'UNKNOWN');
});
