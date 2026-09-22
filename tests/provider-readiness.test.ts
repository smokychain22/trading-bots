import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPaperAlpacaUrl, extractDocumentedOperationPaths, optionomicsProbes, optionomicsProbeUrl,
  probeAlpacaProcessEnvironmentAuth } from '../src/providers/readiness.js';
import { loadEnvironment } from '../src/config/environment.js';

test('accepts the Alpaca paper endpoint only', () => {
  assert.equal(assertPaperAlpacaUrl('https://paper-api.alpaca.markets').hostname, 'paper-api.alpaca.markets');
  assert.throws(() => assertPaperAlpacaUrl('https://api.alpaca.markets'), /Live endpoints are forbidden/);
});

test('discovers only documented Optionomics operations from reference markup', () => {
  const paths = extractDocumentedOperationPaths('<code>GET /api/v1/tickers</code> <code>POST /api/v1/assessments</code> GET /api/v1/tickers');
  assert.deepEqual(paths, ['/api/v1/assessments', '/api/v1/tickers']);
});

test('process-environment auth differential uses only Paper GETs and returns statuses without bodies or credentials', async () => {
  const environment = loadEnvironment({ ALPACA_API_KEY:'test-key',ALPACA_SECRET_KEY:'test-secret',
    ALPACA_BASE_URL:'https://paper-api.alpaca.markets' });
  const calls:string[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    assert.equal(url.hostname,'paper-api.alpaca.markets');
    assert.equal(init?.method,'GET');
    calls.push(url.pathname);
    return new Response(JSON.stringify({id:'must-not-leak'}),{status:url.pathname==='/v2/account'?401:200,
      headers:{'x-request-id':'must-not-leak'}});
  };
  const results=await probeAlpacaProcessEnvironmentAuth(environment,fetchImpl);
  assert.deepEqual(calls,['/v2/account','/v2/clock','/v2/positions','/v2/orders','/v2/assets']);
  assert.deepEqual(results.map((result)=>result.httpStatus),[401,200,200,200,200]);
  assert.equal(JSON.stringify(results).includes('must-not-leak'),false);
  assert.equal(JSON.stringify(results).includes('test-secret'),false);
});

test('process-environment auth differential refuses redacted and live-host credentials before any request', async () => {
  let calls=0;
  const fetchImpl:typeof fetch=async()=>{calls++;return new Response(null,{status:200})};
  const redacted=loadEnvironment({ALPACA_API_KEY:'[SENSITIVE]',ALPACA_SECRET_KEY:'[SENSITIVE]',
    ALPACA_BASE_URL:'[SENSITIVE]'});
  const live=loadEnvironment({ALPACA_API_KEY:'test-key',ALPACA_SECRET_KEY:'test-secret',
    ALPACA_BASE_URL:'https://api.alpaca.markets'});
  assert.equal((await probeAlpacaProcessEnvironmentAuth(redacted,fetchImpl))[0]?.errorCategory,'CONFIG_UNAVAILABLE');
  assert.equal((await probeAlpacaProcessEnvironmentAuth(live,fetchImpl))[0]?.errorCategory,'PAPER_HOST_INVALID');
  assert.equal(calls,0);
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
