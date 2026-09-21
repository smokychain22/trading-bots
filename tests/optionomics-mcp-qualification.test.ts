import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { Environment } from '../src/config/environment.js';
import { inspectOptionomicsSecretShape, persistOptionomicsCapabilityQualification, qualifyOptionomicsProductionSurfaces } from '../src/providers/optionomics-mcp-qualification.js';

const environment: Environment = {
  NODE_ENV: 'test', PORT: 3000,
  OPTIONOMICS_EMAIL: 'tester@example.com',
  OPTIONOMICS_API_KEY: 'fake-optionomics-test-token-not-real',
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('secret-shape diagnostics expose booleans only and detect accidental formatting', () => {
  const result = inspectOptionomicsSecretShape({
    ...environment,
    OPTIONOMICS_EMAIL: ' tester@example.com ',
    OPTIONOMICS_API_KEY: ' "Bearer fake-token"\r\n',
  });
  assert.deepEqual(result, {
    OPTIONOMICS_EMAIL_PRESENT: true,
    OPTIONOMICS_TOKEN_PRESENT: true,
    EMAIL_TRIM_CHANGED: true,
    TOKEN_TRIM_CHANGED: true,
    EMAIL_HAS_LEADING_OR_TRAILING_WHITESPACE: true,
    TOKEN_HAS_LEADING_OR_TRAILING_WHITESPACE: true,
    TOKEN_HAS_NEWLINE: true,
    TOKEN_HAS_CARRIAGE_RETURN: true,
    TOKEN_HAS_LINE_FEED: true,
    TOKEN_HAS_BOM: false,
    TOKEN_HAS_NON_BREAKING_SPACE: false,
    TOKEN_HAS_ZERO_WIDTH_CHARACTER: false,
    TOKEN_HAS_OUTER_QUOTES: true,
    TOKEN_ALREADY_HAS_BEARER_PREFIX: false,
    TOKEN_IS_SENSITIVE_PLACEHOLDER: false,
    TOKEN_LOOKS_LIKE_JSON: false,
    TOKEN_LOOKS_LIKE_ENV_ASSIGNMENT: false,
    EMAIL_FORMAT_VALID: true,
    EMAIL_UNICODE_NORMALIZATION_CHANGED: false,
    EMAIL_CASE_NORMALIZATION_CHANGED: false,
    TOKEN_FORMAT_VALID: false,
  });
  assert.equal(JSON.stringify(result).includes('tester@example.com'), false);
  assert.equal(JSON.stringify(result).includes('fake-token'), false);
});

test('MCP base64 bearer authenticates, discovers actual tools and returns field types without values', async () => {
  const encoded = Buffer.from(`${environment.OPTIONOMICS_EMAIL}:${environment.OPTIONOMICS_API_KEY}`, 'utf8').toString('base64');
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    if (url.includes('/api/v1/')) return json(401, { error: 'unauthorized' });
    assert.equal(url, 'https://optionomics.ai/mcp');
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; params?: { name?: string } };
    if (headers.has('X-USER-EMAIL')) return json(401, { error: 'unauthorized' });
    assert.equal(headers.get('Authorization'), `Bearer ${encoded}`);
    if (body.method === 'initialize') {
      return json(200, { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'optionomics', version: '1' } } }, { 'mcp-session-id': 'test-session' });
    }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
    if (body.method === 'tools/list') {
      return json(200, { jsonrpc: '2.0', id: 2, result: { tools: [
        { name: 'unusual_activity', inputSchema: { type: 'object', description: `never echo ${environment.OPTIONOMICS_EMAIL} or ${environment.OPTIONOMICS_API_KEY}`, properties: { symbol: { type: 'string' }, limit: { type: 'integer' } }, required: ['symbol'] } },
        { name: 'options_flow', inputSchema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
        { name: 'options_chain', inputSchema: { type: 'object', properties: { underlying: { type: 'string' } }, required: ['underlying'] } },
        { name: 'net_flow', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
      ] } });
    }
    if (body.method === 'tools/call') {
      return json(200, { jsonrpc: '2.0', id: 10, result: { structuredContent: {
        records: [{ option_symbol: 'SPY261218P00500000', bid: 1.2, ask: 1.3, timestamp: '2026-09-14T13:40:00Z' }],
      } } });
    }
    return json(400, { error: 'unexpected test method' });
  }) as typeof fetch;

  const report = await qualifyOptionomicsProductionSurfaces(environment, fetchImpl);
  assert.equal(report.authenticatedSurface, 'MCP');
  assert.equal(report.mcp.authenticatedScheme, 'BASE64_BEARER');
  assert.equal(report.mcp.headerPairStatus, 401);
  assert.equal(report.mcp.base64BearerStatus, 200);
  assert.equal(report.mcp.toolCount, 4);
  assert.equal(report.rest.capabilities.length, 19);
  assert.equal(report.rest.capabilities.every((entry) => entry.operationAlias.length > 0 && !entry.path.includes('?')), true);
  const dated = report.rest.capabilities.find((entry) => entry.operationAlias === 'stocks.options.historical');
  assert.equal(dated?.requestedDate, '2026-09-18');
  assert.equal(dated?.exactRequestedDateServed, false);
  assert.equal(dated?.fieldTypes.error, 'string');
  assert.equal(report.mcp.evidence.filter((entry) => entry.matchedTool !== null).every((entry) => entry.status === 'CALLED'), true);
  assert.equal(report.mcp.evidence[0]?.fieldTypes['records[].bid'], 'number');
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(String(environment.OPTIONOMICS_EMAIL)), false);
  assert.equal(serialized.includes(String(environment.OPTIONOMICS_API_KEY)), false);
  assert.equal(serialized.includes(encoded), false);
  assert.equal(serialized.includes('SPY261218P00500000'), false);
});

test('REST and MCP rejection stays NONE and never fabricates a tool catalog', async () => {
  const fetchImpl = (async () => json(401, { error: 'unauthorized' })) as typeof fetch;
  const report = await qualifyOptionomicsProductionSurfaces(environment, fetchImpl);
  assert.equal(report.authenticatedSurface, 'NONE');
  assert.equal(report.rest.overviewHeaderPair.status, 401);
  assert.equal(report.rest.tickersHeaderPair.status, 401);
  assert.equal(report.rest.overviewRawBearer.status, 401);
  assert.equal(report.rest.tickersRawBearer.status, 401);
  assert.equal(report.mcp.headerPairStatus, 401);
  assert.equal(report.mcp.base64BearerStatus, 401);
  assert.equal(report.mcp.toolCount, 0);
  assert.equal(report.rest.capabilities.every((entry) => entry.status === 401), true);
  assert.equal(report.mcp.tools.length, 0);
  assert.equal(report.orderSubmission, 'DISABLED');
});

test('REST qualification distinguishes empty metrics, null quote, empty levels and wrong historical date', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/mcp') return json(401, { error: 'unauthorized' });
    if (url.pathname.endsWith('/quote')) return json(200, { date: '2026-09-18', quote: null });
    if (url.pathname.endsWith('/metrics')) return json(200, { date: '2026-09-18', metrics: [] });
    if (url.pathname === '/api/v1/levels' || url.pathname === '/api/v1/dark_pool_levels') return json(200, { levels: [] });
    if (url.pathname.endsWith('/options')) return json(200, { date: '2026-09-17', options: [] });
    return json(200, {});
  }) as typeof fetch;
  const report = await qualifyOptionomicsProductionSurfaces(environment, fetchImpl);
  const byAlias = (alias: string) => report.rest.capabilities.find((probe) => probe.operationAlias === alias);
  assert.equal(byAlias('stocks.quote')?.dataState, 'NULL_QUOTE');
  assert.equal(byAlias('stocks.metrics')?.dataState, 'EMPTY_METRICS_NO_CHAIN');
  assert.equal(byAlias('levels.dark_pool')?.dataState, 'EMPTY_LEVELS');
  assert.equal(byAlias('stocks.options.historical')?.exactRequestedDateServed, false);
  assert.equal(byAlias('stocks.options.historical')?.fieldTypes['options'], 'array');
});

test('qualification verifies heatmap metric, event window and price-history session separately', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/mcp') return json(401, { error: 'unauthorized' });
    if (url.pathname.endsWith('/heatmap')) return json(200, { metric: 'gamma_exposure', date: '2026-09-18', cells: [] });
    if (url.pathname.endsWith('/price_history')) return json(200, { candles: [
      { date: '2026-09-17', close: 500 }, { date: '2026-09-18', close: 501 },
    ] });
    if (url.pathname.endsWith('/events')) return json(200, {
      from: '2026-09-18', to: '2026-09-18', events: [],
      pagination: { current_page: 1, total_pages: 2 },
    });
    return json(200, {});
  }) as typeof fetch;
  const report = await qualifyOptionomicsProductionSurfaces(environment, fetchImpl);
  const byAlias = (alias: string) => report.rest.capabilities.find((probe) => probe.operationAlias === alias);
  assert.equal(byAlias('stocks.price_history')?.requestedSessionInSeries, true);
  assert.equal(byAlias('stocks.price_history')?.exactRequestedDateServed, null);
  assert.equal(byAlias('stocks.heatmap.gamma')?.metricMatchesRequest, true);
  assert.equal(byAlias('stocks.heatmap.vanna')?.metricMatchesRequest, false);
  assert.equal(byAlias('events.historical')?.windowEchoMatches, true);
  assert.equal(byAlias('events.historical')?.paginationComplete, false);
  assert.equal(byAlias('events.historical')?.dataState, 'EMPTY_EVENTS_UNQUALIFIED');
});

test('capability persistence writes a sanitized immutable receipt and refuses leaked secrets', async () => {
  const writes: readonly unknown[][] = [];
  const pool = { query: async (_sql: string, parameters: readonly unknown[]) => {
    (writes as unknown[][]).push([...parameters]);
    return { rowCount: 1 };
  } } as unknown as Pool;
  const report = {
    generatedAt: '2026-09-21T12:00:00Z', rest: { capabilities: [{ operationAlias: 'stocks.metrics',
      status: 200, fieldTypes: { 'metrics.iv_rank': 'number' } }] },
  } as unknown as Parameters<typeof persistOptionomicsCapabilityQualification>[1];
  const hash = await persistOptionomicsCapabilityQualification(pool, report, ['test-secret']);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(writes.length, 1);
  assert.equal(JSON.stringify(writes).includes('test-secret'), false);
  await assert.rejects(() => persistOptionomicsCapabilityQualification(pool,
    { ...report, leak: 'test-secret' } as unknown as typeof report, ['test-secret']),
  /OPTIONOMICS_CAPABILITY_REPORT_NOT_SANITIZED/);
  assert.equal(writes.length, 1);
});

test('stateless MCP tools/list authenticates when initialize is unsupported', async () => {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/api/v1/')) return json(401, { error: 'unauthorized' });
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; params?: { name?: string } };
    if (!headers.has('X-USER-EMAIL')) return json(401, { error: 'unauthorized' });
    if (body.method === 'initialize') return json(400, { error: 'method unsupported' });
    if (body.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: 92, result: { tools: [
      { name: 'options_chain', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
    ] } });
    if (body.method === 'tools/call') return json(200, { jsonrpc: '2.0', id: 91, result: { structuredContent: { records: [] } } });
    return json(400, { error: 'unexpected test method' });
  }) as typeof fetch;
  const report = await qualifyOptionomicsProductionSurfaces(environment, fetchImpl);
  assert.equal(report.authenticatedSurface, 'MCP');
  assert.equal(report.mcp.authenticatedScheme, 'HEADER_PAIR');
  assert.equal(report.mcp.headerPairStatus, 400);
  assert.equal(report.mcp.headerPairToolsListStatus, 200);
  assert.equal(report.mcp.toolCount, 1);
  assert.equal(report.mcp.evidence.find((entry) => entry.requestedCapability === 'OPTIONS_CHAIN')?.status, 'CALLED');
});
