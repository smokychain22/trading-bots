import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyProviderDisagreement,
  fetchOptionomicsContextObservation,
  fetchOptionomicsNetFlowWindow,
  fetchOptionomicsOptionChain,
  matchOptionomicsContractIdentity,
  type AlpacaContractIdentity,
  type DisagreementTolerancePolicy,
  type OptionomicsProviderConfig,
} from '../src/theta/optionomics-provider.js';
import { proveOptionomicsExecutionQuoteContract } from '../src/theta/optionomics-quote-proof.js';

// All tests use an injected fetchImpl -- NEVER live network, never real
// credentials. Test credentials below are obvious synthetic placeholders.

const NOW = '2026-09-10T15:00:00.000Z';

const jsonResponse = (status: number, body: unknown, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const noSleep = async (): Promise<void> => {};

test('malformed numeric values remain UNKNOWN while decimal zero and negative Greeks survive', async () => {
  for (const value of ['', '  ', false, true, [], {}, '0x10', 'Infinity']) {
    const fetchImpl = (async () => jsonResponse(200, [{ symbol: 'X', bid: value, delta: value, volume: value }])) as typeof fetch;
    const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
    assert.equal(outcome.kind, 'VALUE_PRESENT');
    if (outcome.kind !== 'VALUE_PRESENT') continue;
    assert.equal(outcome.value.entries[0]?.bid, null);
    assert.equal(outcome.value.entries[0]?.delta, null);
    assert.equal(outcome.value.entries[0]?.volume, null);
  }
  const fetchImpl = (async () => jsonResponse(200, [{ symbol: 'X', bid: ' 0 ', delta: '-3e-1', volume: 0 }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries[0]?.bid, 0);
  assert.equal(outcome.value.entries[0]?.delta, -0.3);
  assert.equal(outcome.value.entries[0]?.volume, 0);
});

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
  assert.equal(outcome.value.httpStatus, 200);
  assert.equal(outcome.value.requestPath, '/api/v1/stocks/SPY/options');
  assert.deepEqual(outcome.value.requestParameters, {});
  assert.equal(outcome.value.documentationReference, 'https://optionomics.ai/docs/api');
  assert.equal(outcome.value.credentialIdentityRefHash.length, 64);
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
    return jsonResponse(200, { date: '2025-04-21', options: [] });
  }) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY', { sessionDate: '2025-04-21' });
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  assert.ok(requested !== null);
  assert.equal(requested.pathname, '/api/v1/stocks/SPY/options');
  assert.equal(requested.searchParams.get('date'), '2025-04-21');
  assert.deepEqual([...requested.searchParams.keys()], ['date']);
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

test('documented chain quote, size, DTE and exposure fields are preserved as research evidence', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{
    symbol: 'SPY261218P00500000', underlying: 'SPY', expiration: '2026-12-18',
    option_type: 'put', strike: '500', price: '4.60', bid: '4.50', ask: '4.70',
    bid_size: '11', ask_size: '13', dte: '96', theo: '4.58', moneyness: '0.92',
    gamma_dollar: '31.2', delta_exposure: '-120000', gamma_exposure: '45000',
    notional_oi: '8400000', as_of: NOW,
  }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const entry = outcome.value.entries[0];
  assert.equal(entry?.price, 4.6);
  assert.equal(entry?.bid, 4.5);
  assert.equal(entry?.ask, 4.7);
  assert.equal(entry?.bidSize, 11);
  assert.equal(entry?.askSize, 13);
  assert.equal(entry?.dte, 96);
  assert.equal(entry?.theoreticalPrice, 4.58);
  assert.equal(entry?.gammaDollar, 31.2);
  assert.equal(entry?.deltaExposure, -120000);
  assert.equal(entry?.gammaExposure, 45000);
  assert.equal(entry?.notionalOpenInterest, 8400000);
  assert.equal(entry?.moneyness, 0.92);
  assert.equal(entry?.quoteSemantics, 'SESSION_RECORDED_RESEARCH');
  assert.equal(entry?.executionEligible, false);
});

test('two-sided Optionomics observations remain rejected for execution by documented semantics', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{
    symbol: 'SPY261218P00500000', bid: 4.5, ask: 4.7, bid_size: 11, ask_size: 13, as_of: NOW,
  }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const proof = proveOptionomicsExecutionQuoteContract(outcome.value);
  assert.equal(proof.observationCount, 1);
  assert.equal(proof.twoSidedQuoteCount, 1);
  assert.equal(proof.twoSidedSizeCount, 1);
  assert.equal(proof.providerTimestampCount, 1);
  assert.equal(proof.executionQuoteAuthority, 'REJECTED');
  assert.equal(proof.freshTrustedTwoSidedOptionQuoteReady, false);
  assert.equal(proof.blocker, 'PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED');
  assert.equal(JSON.stringify(proof).includes('TEST-SYNTHETIC-TOKEN'), false);
});

test('empty authenticated chain produces zero observations without inventing readiness', async () => {
  const fetchImpl = (async () => jsonResponse(200, [])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const proof = proveOptionomicsExecutionQuoteContract(outcome.value);
  assert.equal(proof.observationCount, 0);
  assert.equal(proof.twoSidedQuoteCount, 0);
  assert.equal(proof.freshTrustedTwoSidedOptionQuoteReady, false);
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

test('credential-like values echoed by a provider are redacted from retained raw evidence', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{
    symbol: 'SPY261016P00500000', api_key: 'SECRET-VALUE-MUST-NOT-LEAK',
    nested: { token: 'SECRET-VALUE-MUST-NOT-LEAK', email: 'leaky@example.com' },
  }])) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl, {
    apiToken: 'SECRET-VALUE-MUST-NOT-LEAK', email: 'leaky@example.com',
  }), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const raw = JSON.stringify(outcome.value.rawPayload);
  assert.equal(raw.includes('SECRET-VALUE-MUST-NOT-LEAK'), false);
  assert.equal(raw.includes('leaky@example.com'), false);
  assert.ok(raw.includes('[REDACTED]'));
});

test('metrics normalizer preserves zero, UNKNOWN, INVALID and provider units honestly', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    date: '2026-09-10',
    metrics: { iv_rank: 0, iv_percentile: null, iv_skew_z_score: 'not-a-number', rr25: 0.12, total_gex: -15 },
  }, { 'x-ratelimit-remaining': '99' })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'METRICS', 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const normalized = outcome.value.normalized as Record<string, { state: string; value: number | null }>;
  assert.deepEqual(normalized.ivRank, { state: 'KNOWN', value: 0, reason: null, units: 'PROVIDER_REPORTED_UNVERIFIED' });
  assert.equal(normalized.ivPercentile?.state, 'UNKNOWN');
  assert.equal(normalized.impliedVolatilitySkewZScore?.state, 'INVALID');
  assert.equal(normalized.riskReversal25?.value, 0.12);
  assert.equal(normalized.totalGex?.value, -15);
  assert.equal(outcome.value.executableTruth, false);
  assert.equal(outcome.value.sessionDate, '2026-09-10');
  assert.equal(outcome.value.rateLimit.remaining, '99');
});

test('documented empty metrics is no chain, not a numeric zero or populated envelope', async () => {
  const fetchImpl = (async () => jsonResponse(200, { date: '2026-09-10', metrics: [] })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'METRICS', 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.informationState, 'EMPTY_SESSION_NO_CHAIN');
  assert.equal(outcome.value.populated, false);
  assert.equal(outcome.value.normalized.totalGex, undefined);
});

test('GEX zero sentinel and documented legacy-null metric stay unknown for different reasons', async () => {
  const fetchImpl = (async () => jsonResponse(200, { date: '2026-09-10', metrics: { total_gex: '0', vrp_20: null, iv_rank: '42.5' } })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'METRICS', 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const fields = outcome.value.normalized as Record<string, { state: string; value: number | null; reason: string | null }>;
  assert.equal(fields.totalGex?.reason, 'PROVIDER_ZERO_CAN_MEAN_NOT_COMPUTED');
  assert.equal(fields.volatilityRiskPremium20d?.reason, 'DOCUMENTED_LEGACY_NULL');
  assert.equal(fields.ivRank?.value, 42.5);
});

test('historical date fallback is rejected, and invalid dates are rejected before HTTP', async () => {
  let requests = 0;
  const fetchImpl = (async () => { requests += 1; return jsonResponse(200, { date: '2025-04-18', options: [] }); }) as typeof fetch;
  const invalid = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY', { sessionDate: '2025-02-30' });
  assert.equal(invalid.kind, 'REQUEST_ERROR');
  assert.equal(requests, 0);
  const fallback = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY', { sessionDate: '2025-04-21' });
  assert.equal(fallback.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
  assert.equal(requests, 1);
});

test('dated metrics and heatmap responses must serve the requested session', async () => {
  const fetchImpl = (async () => jsonResponse(200, { date: '2026-09-18', metrics: { iv_rank: 20 },
    metric: 'gamma_exposure', cells: [] })) as typeof fetch;
  const metrics = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'METRICS', 'SPY', { sessionDate: '2026-09-17' });
  const heatmap = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'EXPOSURE_HEATMAP', 'SPY', { sessionDate: '2026-09-17' });
  assert.equal(metrics.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
  assert.equal(heatmap.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
});

test('option numeric strings parse strictly and deprecated per-day IV is ignored', async () => {
  const fetchImpl = (async () => jsonResponse(200, { options: [{ iv_per_trading_day: '0.0125', iv_per_day: '999', bid: 'invalid', ask: '1.25' }] })) as typeof fetch;
  const outcome = await fetchOptionomicsOptionChain(baseConfig(fetchImpl), 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.entries[0]?.ivPerTradingDay, 0.0125);
  assert.equal(outcome.value.entries[0]?.bid, null);
  assert.equal(outcome.value.entries[0]?.ask, 1.25);
});

test('event normalizer retains known-at and filters explicit other-symbol rows', async () => {
  const fetchImpl = (async () => jsonResponse(200, { from: '2026-09-10', to: '2026-10-10', events: [
    { ticker: 'SPY', known_at: '2026-09-09T12:00:00Z', scheduled_at: '2026-09-15T14:00:00Z', type: 'MACRO' },
    { ticker: 'AAPL', known_at: '2026-09-09T12:00:00Z', scheduled_at: '2026-09-16T14:00:00Z' },
    { region: 'US', known_at: '2026-09-08T12:00:00Z', date: '2026-09-17' },
  ] })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'EVENTS', 'SPY', {
    from: '2026-09-10', to: '2026-10-10', perPage: 100,
  });
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const rows = (outcome.value.normalized.rows as readonly Record<string, unknown>[]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.knownAt, '2026-09-09T12:00:00Z');
  assert.deepEqual(outcome.value.requestParameters, { from: '2026-09-10', to: '2026-10-10', per_page: '100' });
});

test('confirmed context endpoints reject unrecognized 2xx shapes instead of fabricating empty state', async () => {
  const fetchImpl = (async () => jsonResponse(200, { unexpected: true })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'EXPOSURE_HEATMAP', 'SPY');
  assert.equal(outcome.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
});

test('Vanna and Charm heatmaps use explicit documented metrics and preserve separate state', async () => {
  const requestedMetrics: string[] = [];
  const fetchImpl = (async (input) => {
    const url = new URL(String(input));
    const metric = url.searchParams.get('metric') ?? '';
    requestedMetrics.push(metric);
    return jsonResponse(200, { symbol: 'SPY', date: '2026-09-14', metric, strikes: [500], expirations: ['2026-10-16'], cells: [{ strike: 500, expiration: '2026-10-16', value: 12 }] });
  }) as typeof fetch;
  const vanna = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'VANNA_EXPOSURE_HEATMAP', 'SPY');
  const charm = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'CHARM_EXPOSURE_HEATMAP', 'SPY');
  assert.equal(vanna.kind, 'VALUE_PRESENT');
  assert.equal(charm.kind, 'VALUE_PRESENT');
  assert.deepEqual(requestedMetrics, ['vanna_exposure', 'charm_exposure']);
  if (vanna.kind === 'VALUE_PRESENT') assert.equal(vanna.value.normalized.metric, 'vanna_exposure');
  if (charm.kind === 'VALUE_PRESENT') assert.equal(charm.value.normalized.metric, 'charm_exposure');
});

test('heatmap metric mismatch remains unknown instead of accepting provider fallback', async () => {
  const fetchImpl = (async () => jsonResponse(200, { metric: 'gamma_exposure', cells: [{ value: 1 }] })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'VANNA_EXPOSURE_HEATMAP', 'SPY');
  assert.equal(outcome.kind, 'VALUE_UNKNOWN_AFTER_SUCCESS');
});

test('empty event arrays prove reachability but do not fabricate populated event context', async () => {
  const fetchImpl = (async () => jsonResponse(200, { events: [] })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'EVENTS', 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.populated, false);
  assert.equal(outcome.value.informationState, 'EMPTY_RESULT_COVERAGE_UNVERIFIED');
  assert.equal(outcome.value.paginationComplete, null);
});

test('event pagination exposes incomplete coverage without claiming a negative', async () => {
  const fetchImpl = (async () => jsonResponse(200, { from: '2026-09-21', to: '2026-09-30', events: [],
    pagination: { page: 1, total_pages: 2 } })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'EVENTS', 'SPY', {
    from: '2026-09-21', to: '2026-09-30', perPage: 100,
  });
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.paginationComplete, false);
  assert.equal(outcome.value.informationState, 'EMPTY_RESULT_COVERAGE_UNVERIFIED');
});

test('provider-reported zero flow totals remain populated known observations', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    bullish_flow: [], bearish_flow: [], top_calls: [], top_puts: [], total_premium: 0, trade_count: 0,
  })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'FLOW_AGGREGATES', 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  assert.equal(outcome.value.populated, true);
  assert.equal((outcome.value.normalized.totalPremium as { value: number }).value, 0);
});

test('context adapters send only query parameters confirmed for that operation', async () => {
  let requestUrl = '';
  const fetchImpl = (async (input) => {
    requestUrl = String(input);
    return jsonResponse(200, { date: '2026-09-14', bullish_flow: [], bearish_flow: [], top_calls: [], top_puts: [], total_premium: 0, trade_count: 0 });
  }) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl), 'FLOW_AGGREGATES', 'SPY', {
    from: '2026-09-01', to: '2026-09-14', sessionDate: '2026-09-14', perPage: 100,
  });
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  const url = new URL(requestUrl);
  assert.deepEqual(Object.fromEntries(url.searchParams), { date: '2026-09-14' });
});

test('context observations redact echoed credentials and never return executable truth', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    metrics: { iv_rank: 20 }, token: 'SECRET-VALUE-MUST-NOT-LEAK', email: 'leaky@example.com',
  })) as typeof fetch;
  const outcome = await fetchOptionomicsContextObservation(baseConfig(fetchImpl, {
    apiToken: 'SECRET-VALUE-MUST-NOT-LEAK', email: 'leaky@example.com',
  }), 'METRICS', 'SPY');
  assert.equal(outcome.kind, 'VALUE_PRESENT');
  if (outcome.kind !== 'VALUE_PRESENT') return;
  const raw = JSON.stringify(outcome.value.rawPayload);
  assert.equal(raw.includes('SECRET-VALUE-MUST-NOT-LEAK'), false);
  assert.equal(raw.includes('leaky@example.com'), false);
  assert.equal(outcome.value.executableTruth, false);
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
