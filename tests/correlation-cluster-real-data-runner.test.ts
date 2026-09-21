import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORRELATION_CLUSTER_EXPORT_CONTRACT_VERSION, runCorrelationClusterRealDataStudy,
} from '../src/research/correlation-cluster-real-data-runner.js';
import type { CorrelationEvidence, PairwiseCorrelationEvidence } from '../src/theta/correlation-evidence.js';

const pair = (left: string, right: string, correlation: number): PairwiseCorrelationEvidence => ({
  left, right, correlation, overlappingReturnCount: 60, state: 'KNOWN', missingReason: null,
});

const snapshot = (asOf: string, lookbackBars: number): CorrelationEvidence => ({
  asOf, lookbackBars, evidenceVersion: 'v1', dataVersion: 'v1', provider: 'ALPACA', feeds: [],
  symbols: ['A', 'B', 'C'], pairs: [pair('A', 'B', 0.8), pair('B', 'C', 0.1), pair('A', 'C', 0.1)],
  knownPairCoverage: 1,
});

const CONFIG = { clusterThreshold: 0.5, configVersion: 'v1' };

test('runCorrelationClusterRealDataStudy reports AWAITING_REAL_EXPORT with no export', () => {
  const result = runCorrelationClusterRealDataStudy(20, null, CONFIG);
  assert.equal(result.status, 'AWAITING_REAL_EXPORT');
  assert.equal(result.lookback, 20);
});

test('runCorrelationClusterRealDataStudy rejects a snapshot whose lookbackBars does not match the requested lookback', () => {
  const result = runCorrelationClusterRealDataStudy(20, {
    exportContractVersion: CORRELATION_CLUSTER_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'fixture', rowCount: 1, rows: [snapshot('2026-09-01', 60)],
  }, CONFIG);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_CONTAINS_A_SNAPSHOT_WITH_MISMATCHED_LOOKBACK');
});

test('runCorrelationClusterRealDataStudy rejects an empty snapshot list', () => {
  const result = runCorrelationClusterRealDataStudy(20, {
    exportContractVersion: CORRELATION_CLUSTER_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'fixture', rowCount: 0, rows: [],
  }, CONFIG);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_CONTAINS_NO_SNAPSHOTS');
});

test('runCorrelationClusterRealDataStudy runs clustering and stability on a valid multi-snapshot export', () => {
  const rows = [snapshot('2026-08-01', 20), snapshot('2026-09-01', 20)];
  const result = runCorrelationClusterRealDataStudy(20, {
    exportContractVersion: CORRELATION_CLUSTER_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'fixture', rowCount: rows.length, rows,
  }, CONFIG);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.evidenceLineage, 'REAL_EXPORT');
  assert.equal(result.snapshotCount, 2);
  assert.ok(result.latestClusters);
  assert.equal(result.stability?.length, 2);
  assert.equal(result.stability?.[0].membershipTurnover, null);
  assert.equal(result.stability?.[1].membershipTurnover, 0); // identical clusters both snapshots -> zero turnover
});
