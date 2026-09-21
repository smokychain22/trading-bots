import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClusterStabilityReport, buildCorrelationClusters, computeClusterExposure,
} from '../src/research/correlation-cluster-research.js';
import type { CorrelationEvidence, PairwiseCorrelationEvidence } from '../src/theta/correlation-evidence.js';

const pair = (left: string, right: string, correlation: number | null, state: 'KNOWN' | 'UNKNOWN' = 'KNOWN'): PairwiseCorrelationEvidence => ({
  left, right, correlation, overlappingReturnCount: state === 'KNOWN' ? 60 : 0,
  state, missingReason: state === 'UNKNOWN' ? 'INSUFFICIENT_OVERLAP' : null,
});

const evidence = (symbols: readonly string[], pairs: readonly PairwiseCorrelationEvidence[]): CorrelationEvidence => ({
  asOf: '2026-09-21T00:00:00Z', lookbackBars: 60, evidenceVersion: 'v1', dataVersion: 'v1',
  provider: 'ALPACA', feeds: [], symbols, pairs, knownPairCoverage: pairs.length > 0 ? pairs.filter((p) => p.state === 'KNOWN').length / pairs.length : 0,
});

test('buildCorrelationClusters implements the chain-link effect: A-B and B-C high, A-C low, still one connected cluster', () => {
  const ev = evidence(['A', 'B', 'C'], [pair('A', 'B', 0.8), pair('B', 'C', 0.8), pair('A', 'C', 0.1)]);
  const clusters = buildCorrelationClusters(ev, { clusterThreshold: 0.7, configVersion: 'v1' });
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].members, ['A', 'B', 'C']);
});

test('buildCorrelationClusters keeps unrelated symbols as separate singleton clusters', () => {
  const ev = evidence(['A', 'B', 'C'], [pair('A', 'B', 0.1), pair('B', 'C', 0.1), pair('A', 'C', 0.1)]);
  const clusters = buildCorrelationClusters(ev, { clusterThreshold: 0.7, configVersion: 'v1' });
  assert.equal(clusters.length, 3);
  assert.ok(clusters.every((cluster) => cluster.members.length === 1));
});

test('buildCorrelationClusters never uses an UNKNOWN pair as an edge, even with a high-looking correlation left over from a stale field', () => {
  const ev = evidence(['A', 'B'], [pair('A', 'B', 0.99, 'UNKNOWN')]);
  const clusters = buildCorrelationClusters(ev, { clusterThreshold: 0.5, configVersion: 'v1' });
  assert.equal(clusters.length, 2);
});

test('buildCorrelationClusters rejects an invalid threshold or missing config version rather than defaulting', () => {
  const ev = evidence(['A', 'B'], [pair('A', 'B', 0.5)]);
  assert.throws(() => buildCorrelationClusters(ev, { clusterThreshold: 1.5, configVersion: 'v1' }), /CORRELATION_CLUSTER_THRESHOLD_INVALID/);
  assert.throws(() => buildCorrelationClusters(ev, { clusterThreshold: 0.5, configVersion: '' }), /CORRELATION_CLUSTER_CONFIG_VERSION_REQUIRED/);
});

test('computeClusterExposure sums capital-at-risk across cluster members and divides by equity, never choosing a cap', () => {
  const clusters = [{ members: ['A', 'B'], edgeCount: 1 }, { members: ['C'], edgeCount: 0 }];
  const results = computeClusterExposure(clusters, [
    { symbol: 'A', capitalAtRisk: 1000 }, { symbol: 'B', capitalAtRisk: 500 }, { symbol: 'C', capitalAtRisk: 200 },
  ], 10000);
  assert.equal(results[0].capitalAtRisk, 1500);
  assert.equal(results[0].clusterExposureFraction, 0.15);
  assert.equal(results[1].clusterExposureFraction, 0.02);
});

test('computeClusterExposure reports null fraction (never zero) when equity is unknown or non-positive', () => {
  const clusters = [{ members: ['A'], edgeCount: 0 }];
  const positions = [{ symbol: 'A', capitalAtRisk: 100 }];
  assert.equal(computeClusterExposure(clusters, positions, null)[0].clusterExposureFraction, null);
  assert.equal(computeClusterExposure(clusters, positions, 0)[0].clusterExposureFraction, null);
});

test('buildClusterStabilityReport reports null turnover for the first snapshot and a real fraction thereafter', () => {
  const snapshot1 = { asOf: '2026-08-01', clusters: [{ members: ['A', 'B'], edgeCount: 1 }, { members: ['C'], edgeCount: 0 }] };
  const snapshot2 = { asOf: '2026-09-01', clusters: [{ members: ['A'], edgeCount: 0 }, { members: ['B', 'C'], edgeCount: 1 }] };
  const report = buildClusterStabilityReport([snapshot1, snapshot2]);
  assert.equal(report[0].membershipTurnover, null);
  assert.equal(report[0].clusterCount, 2);
  assert.equal(report[1].membershipTurnover, 1); // A-B pair broke, B-C pair formed -> full turnover of the union
});

test('buildClusterStabilityReport reports zero turnover when cluster membership is unchanged', () => {
  const snapshot = { asOf: '2026-08-01', clusters: [{ members: ['A', 'B'], edgeCount: 1 }] };
  const report = buildClusterStabilityReport([snapshot, snapshot]);
  assert.equal(report[1].membershipTurnover, 0);
});
