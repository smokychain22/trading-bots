import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPaperAlpacaUrl, extractDocumentedOperationPaths } from '../src/providers/readiness.js';

test('accepts the Alpaca paper endpoint only', () => {
  assert.equal(assertPaperAlpacaUrl('https://paper-api.alpaca.markets').hostname, 'paper-api.alpaca.markets');
  assert.throws(() => assertPaperAlpacaUrl('https://api.alpaca.markets'), /Live endpoints are forbidden/);
});

test('discovers only documented Optionomics operations from reference markup', () => {
  const paths = extractDocumentedOperationPaths('<code>GET /api/v1/tickers</code> <code>POST /api/v1/assessments</code> GET /api/v1/tickers');
  assert.deepEqual(paths, ['/api/v1/assessments', '/api/v1/tickers']);
});
