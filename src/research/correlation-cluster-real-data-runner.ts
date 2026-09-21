/**
 * Real-data study runner for correlation-cluster research (directive
 * Phase 9B). `brokerAuthority: false`. Runs `buildCorrelationClusters` and
 * `buildClusterStabilityReport` at the three directive-named lookbacks
 * (20/60/120 trading days) against Codex's real `CorrelationEvidence`
 * exports, one export per lookback -- never fabricates a lookback the
 * export does not actually cover.
 *
 * EXPORT CONTRACT for Codex: one `RealDataExportEnvelope` per lookback,
 * whose `rows` are a time-ordered sequence of already-computed
 * `CorrelationEvidence` snapshots (from the CANONICAL
 * `buildCorrelationEvidence`, correlation-evidence.ts -- this runner never
 * recomputes correlation, only clusters what Codex already computed).
 */
import type { CorrelationEvidence } from '../theta/correlation-evidence.js';
import {
  buildClusterStabilityReport, buildCorrelationClusters,
  type ClusterThresholdConfig, type ClusterTurnoverResult, type ConnectedCluster,
} from './correlation-cluster-research.js';
import { loadRealDataExport, type EvidenceLineage } from './real-data-export-contract.js';

export const correlationClusterRealDataRunnerVersion = 'theta-correlation-cluster-real-data-runner-v1' as const;
export const CORRELATION_CLUSTER_EXPORT_CONTRACT_VERSION = 'theta-correlation-evidence-export-v1' as const;

export type CorrelationLookback = 20 | 60 | 120;

export interface CorrelationClusterRealDataStudyResult {
  readonly lookback: CorrelationLookback;
  readonly status: 'AWAITING_REAL_EXPORT' | 'EXPORT_CONTRACT_INVALID' | 'EXPORT_ROW_COUNT_MISMATCH' | 'COMPLETED';
  readonly reason: string | null;
  readonly evidenceLineage: EvidenceLineage | null;
  readonly snapshotCount: number | null;
  readonly latestClusters: readonly ConnectedCluster[] | null;
  readonly stability: readonly ClusterTurnoverResult[] | null;
}

export function runCorrelationClusterRealDataStudy(
  lookback: CorrelationLookback, rawExport: unknown, clusterConfig: ClusterThresholdConfig,
): CorrelationClusterRealDataStudyResult {
  const loaded = loadRealDataExport<CorrelationEvidence>(rawExport, CORRELATION_CLUSTER_EXPORT_CONTRACT_VERSION);
  if (loaded.status !== 'LOADED' || loaded.envelope === null) {
    const status = loaded.status === 'LOADED' ? 'EXPORT_CONTRACT_INVALID' : loaded.status;
    return {
      lookback, status, reason: loaded.reason, evidenceLineage: null,
      snapshotCount: null, latestClusters: null, stability: null,
    };
  }
  const snapshots = loaded.envelope.rows;
  const mismatchedLookback = snapshots.find((snapshot) => snapshot.lookbackBars !== lookback);
  if (mismatchedLookback !== undefined) {
    return {
      lookback, status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_CONTAINS_A_SNAPSHOT_WITH_MISMATCHED_LOOKBACK',
      evidenceLineage: null, snapshotCount: null, latestClusters: null, stability: null,
    };
  }
  if (snapshots.length === 0) {
    return {
      lookback, status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_CONTAINS_NO_SNAPSHOTS',
      evidenceLineage: null, snapshotCount: null, latestClusters: null, stability: null,
    };
  }
  const clusterSnapshots = snapshots
    .slice()
    .sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf))
    .map((snapshot) => ({ asOf: snapshot.asOf, clusters: buildCorrelationClusters(snapshot, clusterConfig) }));
  const stability = buildClusterStabilityReport(clusterSnapshots);
  const latest = clusterSnapshots[clusterSnapshots.length - 1] as (typeof clusterSnapshots)[number];
  return {
    lookback, status: 'COMPLETED', reason: null, evidenceLineage: 'REAL_EXPORT',
    snapshotCount: snapshots.length, latestClusters: latest.clusters, stability,
  };
}
