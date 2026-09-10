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
      assert.equal(results.length, 12);
      for (const result of results) {
        assert.equal(result.state, 'GOOD', `${result.capability} expected GOOD, got ${result.state}`);
        assert.equal(typeof result.latencyMs, 'number');
        assert.ok(result.retrievedAt.length > 0);
      }
      const account = results.find((r) => r.capability === 'ACCOUNT_ENVIRONMENT');
      assert.equal(account?.details.equityReadable, true);
      assert.equal(account?.details.optionsApprovalReadable, true);
      assert.equal(account?.details.tradingBlocked, false);

      // Capability distinction correction: OPRA and INDICATIVE are checked
      // independently. consolidatedBbo is true only for OPRA; both are
      // engineeringUsable when reachable; paperExecutionPolicy/tcaQuality
      // are NEVER derived from feed type alone (they start NOT_YET_EVALUATED/
      // UNVALIDATED for either feed -- a separate release decision).
      const opra = results.find((r) => r.capability === 'OPTIONS_MARKET_DATA_OPRA');
      const indicative = results.find((r) => r.capability === 'OPTIONS_MARKET_DATA_INDICATIVE');
      assert.equal(opra?.details.consolidatedBbo, true);
      assert.equal(indicative?.details.consolidatedBbo, false, 'INDICATIVE must never be reported as consolidated BBO, even when reachable');
      assert.equal(indicative?.details.engineeringUsable, true);
      assert.equal(indicative?.details.paperExecutionPolicy, 'NOT_YET_EVALUATED');
      assert.equal(opra?.details.paperExecutionPolicy, 'NOT_YET_EVALUATED', 'OPRA reachability alone must not auto-approve paper execution either');
    }
  );
});

test('OPRA NOT_ENTITLED alongside a reachable INDICATIVE feed is reported accurately -- never silently upgraded', async () => {
  await withMockedFetch(
    [
      { match: (u) => u.includes('/v2/account') && !u.includes('activities'), respond: () => jsonResponse(200, accountBody()) },
      { match: (u) => u.includes('/v2/clock'), respond: () => jsonResponse(200, { timestamp: new Date().toISOString(), is_open: true }) },
      { match: (u) => u.includes('/v2/calendar'), respond: () => jsonResponse(200, [{ date: '2026-09-10' }]) },
      { match: (u) => u.includes('/v2/stocks/quotes/latest'), respond: () => jsonResponse(200, { quotes: { SPY: {} } }) },
      { match: (u) => u.includes('/v2/options/contracts'), respond: () => jsonResponse(200, { option_contracts: [] }) },
      { match: (u) => u.includes('feed=opra'), respond: () => jsonResponse(403, { message: 'not entitled' }) },
      { match: (u) => u.includes('feed=indicative'), respond: () => jsonResponse(200, { snapshots: { X: { greeks: { delta: 0.1 } } } }) },
      { match: (u) => u.includes('/v2/positions'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v2/account/activities/FILL'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v1/corporate-actions'), respond: () => jsonResponse(200, {}) }
    ],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      const opra = results.find((r) => r.capability === 'OPTIONS_MARKET_DATA_OPRA');
      const indicative = results.find((r) => r.capability === 'OPTIONS_MARKET_DATA_INDICATIVE');
      assert.equal(opra?.state, 'NOT_ENTITLED');
      assert.equal(opra?.details.feedAvailable, false);
      assert.equal(indicative?.state, 'GOOD');
      assert.equal(indicative?.details.feedAvailable, true);
      assert.equal(indicative?.details.engineeringUsable, true, 'INDICATIVE remains fully usable for engineering even though OPRA is NOT_ENTITLED');
      assert.equal(indicative?.details.consolidatedBbo, false, 'a reachable INDICATIVE feed must never be reported as consolidated BBO');
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

// Security correction: even a malicious/broken provider that reflects the
// exact credential value back in its response body must never cause that
// value to reach a CheckResult -- readiness.ts's evaluate() callbacks only
// ever extract specific, named-safe fields (maskedAccount, booleans,
// counts), never the raw body, so this holds structurally rather than by
// convention. Uses realistic-shaped (but fake, test-only) credential values.
const REALISTIC_FAKE_ALPACA_KEY = 'PKTESTFAKEKEYNOTREAL0000000';
const REALISTIC_FAKE_ALPACA_SECRET = 'FakeTestSecretValueNotReal0000000000000000';
const REALISTIC_FAKE_OPTIONOMICS_TOKEN = 'fakeTestOptionomicsTokenNotReal_00000000';

const secretEnvironment: Environment = {
  ...baseEnvironment,
  ALPACA_API_KEY: REALISTIC_FAKE_ALPACA_KEY,
  ALPACA_SECRET_KEY: REALISTIC_FAKE_ALPACA_SECRET,
  OPTIONOMICS_API_KEY: REALISTIC_FAKE_OPTIONOMICS_TOKEN
};

test('OPRA NOT_ENTITLED with INDICATIVE GOOD never reports every option-feed capability as unavailable -- engineering is never blocked', async () => {
  await withMockedFetch(
    [
      { match: (u) => u.includes('/v2/account') && !u.includes('activities'), respond: () => jsonResponse(200, accountBody()) },
      { match: (u) => u.includes('/v2/clock'), respond: () => jsonResponse(200, { timestamp: new Date().toISOString(), is_open: true }) },
      { match: (u) => u.includes('/v2/calendar'), respond: () => jsonResponse(200, [{ date: '2026-09-10' }]) },
      { match: (u) => u.includes('/v2/stocks/quotes/latest'), respond: () => jsonResponse(200, { quotes: { SPY: {} } }) },
      { match: (u) => u.includes('/v2/options/contracts'), respond: () => jsonResponse(200, { option_contracts: [] }) },
      { match: (u) => u.includes('feed=opra'), respond: () => jsonResponse(403, { message: 'not entitled' }) },
      { match: (u) => u.includes('feed=indicative'), respond: () => jsonResponse(200, { snapshots: { X: { greeks: { delta: 0.1 } } } }) },
      { match: (u) => u.includes('/v2/positions'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v2/account/activities/FILL'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v1/corporate-actions'), respond: () => jsonResponse(200, {}) }
    ],
    async () => {
      const results = await checkAlpaca(baseEnvironment);
      // Every OTHER capability (account, clock, calendar, contracts,
      // positions, activities, corporate actions) must still report GOOD --
      // an OPRA entitlement gap must never cascade into treating the whole
      // account/engineering pipeline as blocked.
      const nonOptionResults = results.filter((r) => r.capability !== 'OPTIONS_MARKET_DATA_OPRA' && r.capability !== 'OPTIONS_MARKET_DATA_INDICATIVE');
      for (const result of nonOptionResults) {
        assert.equal(result.state, 'GOOD', `${result.capability} must remain GOOD regardless of OPRA entitlement`);
      }
    }
  );
});

test('a provider that echoes request headers back in its body never causes a credential to appear in a CheckResult', async () => {
  const echoBody = (): Record<string, unknown> => ({
    status: 'ACTIVE', equity: '1', cash: '1', buying_power: '1', options_approved_level: 1, trading_blocked: false,
    // Simulates a broken/malicious server reflecting the request's own credentials.
    debug_echo_api_key: REALISTIC_FAKE_ALPACA_KEY,
    debug_echo_secret: REALISTIC_FAKE_ALPACA_SECRET
  });
  await withMockedFetch(
    [
      { match: (u) => u.includes('/v2/account') && !u.includes('activities'), respond: () => jsonResponse(200, echoBody()) },
      { match: (u) => u.includes('/v2/clock'), respond: () => jsonResponse(200, { timestamp: new Date().toISOString(), is_open: true }) },
      { match: (u) => u.includes('/v2/calendar'), respond: () => jsonResponse(200, [{ date: '2026-09-10' }]) },
      { match: (u) => u.includes('/v2/stocks/quotes/latest'), respond: () => jsonResponse(200, { quotes: { SPY: {} } }) },
      { match: (u) => u.includes('/v2/options/contracts'), respond: () => jsonResponse(200, { option_contracts: [] }) },
      { match: (u) => u.includes('/v1beta1/options/snapshots'), respond: () => jsonResponse(200, { snapshots: {} }) },
      { match: (u) => u.includes('/v2/positions'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v2/account/activities/FILL'), respond: () => jsonResponse(200, []) },
      { match: (u) => u.includes('/v1/corporate-actions'), respond: () => jsonResponse(200, {}) }
    ],
    async () => {
      const results = await checkAlpaca(secretEnvironment);
      const serialized = JSON.stringify(results);
      assert.ok(!serialized.includes(REALISTIC_FAKE_ALPACA_KEY), 'CheckResult must never contain the raw API key value');
      assert.ok(!serialized.includes(REALISTIC_FAKE_ALPACA_SECRET), 'CheckResult must never contain the raw secret value');
      for (const result of results) {
        assert.equal(result.provenance.credentialValuesLogged, false);
      }
    }
  );
});

test('an Optionomics provider echoing the request token back never causes it to appear in a CheckResult', async () => {
  await withMockedFetch(
    [
      {
        match: (u) => u.includes('optionomics.ai/docs/api'),
        respond: () => new Response('<code>GET /api/v1/tickers</code>', { status: 200, headers: { 'content-type': 'text/html' } })
      },
      {
        match: (u) => u.includes('/api/v1/tickers'),
        respond: () => jsonResponse(200, { tickers: [], debug_echo_token: REALISTIC_FAKE_OPTIONOMICS_TOKEN })
      }
    ],
    async () => {
      const results = await checkOptionomics(secretEnvironment);
      const serialized = JSON.stringify(results);
      assert.ok(!serialized.includes(REALISTIC_FAKE_OPTIONOMICS_TOKEN), 'CheckResult must never contain the raw Optionomics token value');
    }
  );
});
