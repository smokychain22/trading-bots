import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessOptionomicsBranchRequirements,
  classifyOptionomicsTool,
  hashOptionomicsToolCatalog,
  optionomicsEndpointRegistry,
  optionomicsEndpointRegistryHash,
  optionomicsKnownAt,
  validateOptionomicsChainSemantics,
  validateOptionomicsHeatmapMetric,
  validateOptionomicsMetricsSemantics,
} from '../src/theta/optionomics-intelligence-contract.js';

test('documented Optionomics registry keeps every surface non-executable and hash-stable', () => {
  assert.equal(optionomicsEndpointRegistry.length, 32);
  assert.equal(optionomicsEndpointRegistry.every((entry) => entry.executionPriceAuthority === false), true);
  assert.match(optionomicsEndpointRegistryHash, /^[0-9a-f]{64}$/);
  assert.equal(new Set(optionomicsEndpointRegistry.map((entry) => entry.operationAlias)).size, optionomicsEndpointRegistry.length);
});

test('actual MCP tools are classified by cadence, provenance and runtime role without promotion', () => {
  const chain = classifyOptionomicsTool('options_chain');
  assert.deepEqual(chain, {
    toolName: 'options_chain', family: 'OPTION_CHAIN', cadence: 'SESSION_CHAIN',
    provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT',
    discoveryState: 'DISCOVERED', executionPriceAuthority: false,
  });
  const unknown = classifyOptionomicsTool('future_tool');
  assert.equal(unknown.discoveryState, 'UNMAPPED');
  assert.equal(unknown.executionPriceAuthority, false);
  assert.equal(hashOptionomicsToolCatalog([{ name: 'b', argumentSchema: {} }, { name: 'a', argumentSchema: {} }]),
    hashOptionomicsToolCatalog([{ name: 'a', argumentSchema: {} }, { name: 'b', argumentSchema: {} }]));
});

test('chain validation rejects date fallback, missing identity and impossible spot zero', () => {
  assert.deepEqual(validateOptionomicsChainSemantics({ date: '2026-09-15', underlying_price: '0', options: [{}] }, '2026-09-16'), [
    'PROVIDER_DATE_FALLBACK', 'IMPOSSIBLE_SPOT_ZERO', 'MISSING_CONTRACT_IDENTITY',
  ]);
  assert.deepEqual(validateOptionomicsChainSemantics({ date: '2026-09-16', underlying_price: '630.2', options: [{ symbol: 'SPY261016P00600000' }] }, '2026-09-16'), []);
  assert.deepEqual(validateOptionomicsChainSemantics([], null), ['UNEXPECTED_SCHEMA_CHANGE']);
});

test('metrics and heatmap semantic sentinels never become real observations', () => {
  assert.deepEqual(validateOptionomicsMetricsSemantics({ metrics: { total_gex: 0 } }), ['EXPOSURE_ZERO_SENTINEL']);
  assert.deepEqual(validateOptionomicsMetricsSemantics({ metrics: { total_gex: 0, call_gamma_exposure: 0 } }), []);
  assert.deepEqual(validateOptionomicsMetricsSemantics({ metrics: [] }), []);
  assert.deepEqual(validateOptionomicsHeatmapMetric({ metric: 'gamma_exposure', cells: [] }, 'vanna_exposure'), ['PROVIDER_METRIC_SEMANTIC_MISMATCH']);
});

test('news known-at uses the latest availability timestamp', () => {
  assert.equal(optionomicsKnownAt({ published_at: '2026-09-16T10:00:00Z', analyzed_at: '2026-09-16T10:02:00Z' }, '2026-09-16T10:01:00Z'), '2026-09-16T10:02:00.000Z');
});

test('strategy requirements fail only the affected branch and preserve optional degradation', () => {
  const result = assessOptionomicsBranchRequirements('THETA_CONVENTIONAL', {
    OPTION_CHAIN: 'GOOD', VOLATILITY: 'GOOD', EVENTS: 'GOOD', FLOW: 'STALE', EXPOSURE: 'UNKNOWN',
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.degradedOptional, ['FLOW:STALE', 'EXPOSURE:UNKNOWN', 'NEWS:UNKNOWN', 'DISCLOSURES:UNKNOWN']);
  const cc = assessOptionomicsBranchRequirements('THETA_CC', { OPTION_CHAIN: 'GOOD', VOLATILITY: 'UNKNOWN', EVENTS: 'GOOD' });
  assert.equal(cc.ready, false);
  assert.deepEqual(cc.blockers, ['VOLATILITY:UNKNOWN']);
});
