import assert from 'node:assert/strict';
import test from 'node:test';
import type { Environment } from '../src/config/environment.js';
import { inspectOptionomicsSecretShape, qualifyOptionomicsProductionSurfaces } from '../src/providers/optionomics-mcp-qualification.js';

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
    TOKEN_HAS_OUTER_QUOTES: true,
    TOKEN_ALREADY_HAS_BEARER_PREFIX: false,
  });
  assert.equal(JSON.stringify(result).includes('tester@example.com'), false);
  assert.equal(JSON.stringify(result).includes('fake-token'), false);
});

test('MCP base64 bearer authenticates, discovers actual tools and returns field types without values', async () => {
  const encoded = Buffer.from(`${environment.OPTIONOMICS_EMAIL}:${environment.OPTIONOMICS_API_KEY}`, 'utf8').toString('base64');
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    if (url.endsWith('/api/v1/tickers')) return json(401, { error: 'unauthorized' });
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
  assert.equal(report.mcp.evidence.every((entry) => entry.status === 'CALLED'), true);
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
  assert.equal(report.rest.headerPair.status, 401);
  assert.equal(report.rest.rawBearer.status, 401);
  assert.equal(report.mcp.headerPairStatus, 401);
  assert.equal(report.mcp.base64BearerStatus, 401);
  assert.equal(report.mcp.toolCount, 0);
  assert.equal(report.mcp.tools.length, 0);
  assert.equal(report.orderSubmission, 'DISABLED');
});
