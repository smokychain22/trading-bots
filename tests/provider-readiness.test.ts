import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPaperAlpacaUrl, extractDocumentedOperationPaths, optionomicsProbes, optionomicsProbeUrl } from '../src/providers/readiness.js';

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

test('uses the documented heatmap metric for each exposure family', () => {
  assert.equal(optionomicsProbeUrl('opt.get_gamma_exposure_heatmap', '/api/v1/stocks/{symbol}/heatmap').searchParams.get('metric'), 'gamma_exposure');
  assert.equal(optionomicsProbeUrl('opt.get_vanna_exposure_heatmap', '/api/v1/stocks/{symbol}/heatmap').searchParams.get('metric'), 'vanna_exposure');
  assert.equal(optionomicsProbeUrl('opt.get_charm_exposure_heatmap', '/api/v1/stocks/{symbol}/heatmap').searchParams.get('metric'), 'charm_exposure');
});

test('capability discovery rejects routes absent from the documentation', () => {
  const probes = optionomicsProbes(['/api/v1/tickers']);
  assert.deepEqual(probes.map((probe) => probe.path), ['/api/v1/tickers']);
  assert.equal(probes.some((probe) => probe.path === '/api/v1/stocks/{symbol}/options'), false);
});
