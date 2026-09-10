import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAlpaca, checkOptionomics } from '../src/providers/readiness.js';
import type { Environment } from '../src/config/environment.js';

// These tests exercise checkAlpaca/checkOptionomics's actual state-mapping behavior
// across the scenarios Phase 2A's readiness foundation must handle correctly, by
// mocking global.fetch. Existing tests only covered pure helper functions
// (assertPaperAlpacaUrl, extractDocumentedOperationPaths, optionomicsProbeUrl) --
// this file adds coverage for the checks themselves, which is where the actual
// CapabilityState classification logic (GOOD/DEGRADED/UNKNOWN/INVALID/NOT_ENTITLED)
// is exercised end-to-end.

const baseEnvironment: Environment = {
  NODE_ENV: 'test',
  PORT: 3000,
  ALPACA_API_KEY: 'test-key',
  ALPACA_SECRET_KEY: 'test-secret',
  ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
  OPTIONOMICS_API_KEY: 'test-optionomics-key',
  OPTIONOMICS_EMAIL: 'operator@example.com'
};

type MockRoute = {
  readonly match: (url: string) => boolean;
  readonly respond: () => Response | Promise<Response>;
};

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });

const withMockedFetch = async (routes: readonly MockRoute[], run: () => Promise<void>): Promise<void> => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const route = routes.find((candidate) => candidate.match(url));
    if (!route) {
      throw new Error(`Unmocked request in test: ${url}`);
    }
    return route.respond();
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

const accountBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  status: 'ACTIVE',
  equity: '10000.00',
  cash: '10000.00',
  buying_power: '20000.00',
  options_approved_level: 2,
  trading_blocked: false,
  ...overrides
});

test('valid PAPER account: every check reports GOOD with account fields readable', async () => {
  await withMockedFetch(
    [
      { match: (u) => u.includes('/v2/account') && !u.includes('activities'), respond: () => jsonResponse(200, accountBody()) },
      { match: (u) => u.includes('/v2/clock'), respond: () => jsonResponse(200, { timestamp: new Date().toISOString(), is_open: true }) },
      { match: (u) => u.includes('/v2/calendar'), respond: () => jsonResponse(200, [{ date: '2026-09-10' }]) },
      { match: (u) => u.includes('/v2/stocks/quotes/latest'), respond: () => jsonResponse(200, { quotes: { SPY: {} } }) },
      { match: (u) => u.includes('/v2/options/contracts'), respond: () => jsonResponse(200, { option_contracts: [{ symbol: 'SPY260101C00500000', deliverables: [], tradable: true }] }) },
      { match: (u) => u.includes('/v1beta1/options/snapshots'), respond: () => jsonResponse(200, { snapshots: { 'SPY260101C00500000': { greeks: { delta: 0.3 } } } }, { 'x-request-id': 'req-1' }) },
      { match: (u) => u.includes('/v2/positions'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v2/account/activities/FILL'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v1/corporate-actions'), respond: () => jsonResponse(200, {}) }
    ],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      assert.equal(results.length, 9);
      for (const result of results) {
        assert.equal(result.state, 'GOOD', `${result.capability} expected GOOD, got ${result.state}`);
        assert.equal(typeof result.latencyMs, 'number');
        assert.ok(result.retrievedAt.length > 0);
      }
      const account = results.find((r) => r.capability === 'ACCOUNT_ENVIRONMENT');
      assert.equal(account?.details.equityReadable, true);
      assert.equal(account?.details.optionsApprovalReadable, true);
      assert.equal(account?.details.tradingBlocked, false);
    }
  );
});

test('invalid credentials (401) map every capability to INVALID', async () => {
  await withMockedFetch(
    [{ match: () => true, respond: () => jsonResponse(401, { message: 'unauthorized' }) }],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      for (const result of results) {
        assert.equal(result.state, 'INVALID');
      }
    }
  );
});

test('missing options/market-data entitlement (403) maps to NOT_ENTITLED, never coerced to GOOD or 0', async () => {
  await withMockedFetch(
    [
      { match: (u) => u.includes('/v1beta1/options/snapshots'), respond: () => jsonResponse(403, { message: 'not entitled to OPRA' }) },
      { match: () => true, respond: () => jsonResponse(200, accountBody()) }
    ],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      const options = results.find((r) => r.capability === 'OPTIONS_MARKET_DATA_OPRA');
      assert.equal(options?.state, 'NOT_ENTITLED');
      assert.notEqual(options?.state, 'GOOD');
    }
  );
});

test('provider unavailable (5xx) maps to DEGRADED, not silently treated as GOOD', async () => {
  await withMockedFetch(
    [{ match: () => true, respond: () => jsonResponse(503, { message: 'service unavailable' }) }],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      for (const result of results) {
        assert.equal(result.state, 'DEGRADED');
      }
    }
  );
});

test('network failure (provider unreachable) maps to UNKNOWN, never a fabricated zero/default', async () => {
  await withMockedFetch(
    [{ match: () => true, respond: () => { throw new TypeError('fetch failed'); } }],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      for (const result of results) {
        assert.equal(result.state, 'UNKNOWN');
        assert.equal(result.httpStatus, null);
        assert.equal(result.details.networkError, 'TypeError');
      }
    }
  );
});

test('empty positions/activities are readable as a valid empty array, not treated as missing data', async () => {
  await withMockedFetch(
    [
      { match: (u) => u.includes('/v2/positions'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v2/account/activities/FILL'), respond: () => jsonResponse(200, []) },
      { match: () => true, respond: () => jsonResponse(200, accountBody()) }
    ],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      const positions = results.find((r) => r.capability === 'POSITIONS_READ');
      const activities = results.find((r) => r.capability === 'ACCOUNT_ACTIVITY_READ');
      assert.equal(positions?.state, 'GOOD');
      assert.equal(positions?.details.positionCount, 0);
      assert.equal(activities?.state, 'GOOD');
      assert.equal(activities?.details.activityCount, 0);
    }
  );
});

test('existing positions are counted and readable', async () => {
  await withMockedFetch(
    [
      { match: (u) => u.includes('/v2/positions'), respond: () => jsonResponse(200, [{ symbol: 'SPY' }, { symbol: 'QQQ' }]) },
      { match: () => true, respond: () => jsonResponse(200, accountBody()) }
    ],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      const positions = results.find((r) => r.capability === 'POSITIONS_READ');
      assert.equal(positions?.details.positionCount, 2);
    }
  );
});

test('unknown account state (missing status field) is reported as unreadable, not defaulted', async () => {
  await withMockedFetch(
    [{ match: () => true, respond: () => jsonResponse(200, { equity: '1000' }) }],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      const account = results.find((r) => r.capability === 'ACCOUNT_ENVIRONMENT');
      assert.equal(account?.details.accountStatusPresent, false);
      assert.equal(account?.details.optionsApprovalReadable, false);
    }
  );
});

test('malformed provider response (non-JSON body) does not throw and is reported, not silently swallowed', async () => {
  await withMockedFetch(
    [{ match: () => true, respond: () => new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } }) }],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      const account = results.find((r) => r.capability === 'ACCOUNT_ENVIRONMENT');
      assert.equal(account?.state, 'GOOD');
      assert.equal(account?.details.accountStatusPresent, false);
      assert.equal(account?.details.equityReadable, false);
    }
  );
});

test('Optionomics checks only probe operations actually documented, never a guessed endpoint', async () => {
  await withMockedFetch(
    [
      {
        match: (u) => u.includes('optionomics.ai/docs/api'),
        respond: () => new Response('<code>GET /api/v1/tickers</code>', { status: 200, headers: { 'content-type': 'text/html' } })
      },
      { match: (u) => u.includes('/api/v1/tickers'), respond: () => jsonResponse(200, { tickers: [] }) }
    ],
    async () => {
      const results = await checkOptionomics(baseEnvironment);
      // Only the reference discovery result plus the one documented probe
      // (tickers) should appear -- no undocumented capability is invented.
      assert.equal(results.length, 2);
      assert.ok(results.every((r) => r.operationAlias === 'opt.discover_documented_operations' || r.operationAlias === 'opt.list_tickers'));
    }
  );
});

test('Optionomics explicit null values are surfaced as a fact, never coerced to zero', async () => {
  await withMockedFetch(
    [
      {
        match: (u) => u.includes('optionomics.ai/docs/api'),
        respond: () => new Response('<code>GET /api/v1/tickers</code>', { status: 200, headers: { 'content-type': 'text/html' } })
      },
      { match: (u) => u.includes('/api/v1/tickers'), respond: () => jsonResponse(200, { tickers: null }) }
    ],
    async () => {
      const results = await checkOptionomics(baseEnvironment);
      const tickers = results.find((r) => r.operationAlias === 'opt.list_tickers');
      assert.equal(tickers?.details.explicitNullObserved, true);
    }
  );
});
