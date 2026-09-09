import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPaperAlpacaUrl, extractDocumentedOperationPaths, optionomicsProbeUrl } from '../src/providers/readiness.js';

test('accepts the Alpaca paper endpoint only', () => {
  assert.equal(assertPaperAlpacaUrl('https://paper-api.alpaca.markets').hostname, 'paper-api.alpaca.markets');
  assert.throws(() => assertPaperAlpacaUrl('https://api.alpaca.markets'), /Live endpoints are forbidden/);
});

test('discovers only documented Optionomics operations from reference markup', () => {
  const paths = extractDocumentedOperationPaths('<code>GET /api/v1/tickers</code> <code>POST /api/v1/assessments</code> GET /api/v1/tickers');
  assert.deepEqual(paths, ['/api/v1/assessments', '/api/v1/tickers']);
});

test('adds the documented required symbol to the net-flow operation', () => {
  const url = optionomicsProbeUrl('opt.get_flow_net', '/api/v1/flow/net');
  assert.equal(url.pathname, '/api/v1/flow/net');
  assert.equal(url.searchParams.get('symbol'), 'SPY');
});
