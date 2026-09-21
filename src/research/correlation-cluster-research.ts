import type { CorrelationEvidence } from '../theta/correlation-evidence.js';

/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO correlation-clustering or exposure-cap policy. `correlation-
 * evidence.ts`'s `buildCorrelationEvidence` (Codex-owned) remains the sole
 * pairwise-correlation computation -- this module consumes its
 * already-computed `CorrelationEvidence.pairs` read-only and never
 * recomputes a single correlation value itself.
 *
 * Per the standing distinction this directive is explicit about: a
 * correlation CLUSTER THRESHOLD (which pairs count as "related," used
 * here) is conceptually separate from a CLUSTER EXPOSURE CAP (how much
 * capital a related group may carry in aggregate, a Production AEGIS
 * policy decision this module never makes). `clusterThreshold` below is a
 * required, caller-supplied research input -- never invented internally,
 * and never treated as a promoted Production value.
 */
export const correlationClusterResearchVersion = 'theta-correlation-cluster-research-v1' as const;

export interface ClusterThresholdConfig {
  readonly clusterThreshold: number;
  readonly configVersion: string;
}

export interface ConnectedCluster {
  readonly members: readonly string[];
  readonly edgeCount: number;
}

/**
 * Threshold-graph connected-components clustering: two symbols are edge-
 * connected iff their KNOWN pairwise correlation meets clusterThreshold.
 * Clusters are the connected components of that graph -- NOT simply pairs
 * that are individually correlated. This deliberately implements and
 * documents the directive's named chain-link effect: if A-B is high and
 * B-C is high but A-C is low, A/B/C still land in ONE connected cluster,
 * because clustering is transitive through the graph, not pairwise.
 */
export function buildCorrelationClusters(
  evidence: CorrelationEvidence, config: ClusterThresholdConfig,
): readonly ConnectedCluster[] {
  if (!Number.isFinite(config.clusterThreshold) || config.clusterThreshold < -1 || config.clusterThreshold > 1) {
    throw new Error('CORRELATION_CLUSTER_THRESHOLD_INVALID');
  }
  if (config.configVersion.trim().length === 0) throw new Error('CORRELATION_CLUSTER_CONFIG_VERSION_REQUIRED');

  const adjacency = new Map<string, Set<string>>();
  for (const symbol of evidence.symbols) adjacency.set(symbol, new Set());
  let edgeCount = 0;
  for (const pair of evidence.pairs) {
    if (pair.state !== 'KNOWN' || pair.correlation === null) continue;
    if (pair.correlation < config.clusterThreshold) continue;
    adjacency.get(pair.left)?.add(pair.right);
    adjacency.get(pair.right)?.add(pair.left);
    edgeCount += 1;
  }
  void edgeCount;

  const visited = new Set<string>();
  const clusters: ConnectedCluster[] = [];
  for (const symbol of evidence.symbols) {
    if (visited.has(symbol)) continue;
    const componentMembers: string[] = [];
    const queue = [symbol];
    visited.add(symbol);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      componentMembers.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
    componentMembers.sort();
    const componentEdgeCount = componentMembers.reduce((sum, member) => sum + (adjacency.get(member)?.size ?? 0), 0) / 2;
    clusters.push({ members: componentMembers, edgeCount: componentEdgeCount });
  }
  return clusters.sort((left, right) => right.members.length - left.members.length || (left.members[0] ?? '').localeCompare(right.members[0] ?? ''));
}

export interface ClusterExposureInput {
  readonly symbol: string;
  readonly capitalAtRisk: number;
}

export interface ClusterExposureResult {
  readonly clusterMembers: readonly string[];
  readonly capitalAtRisk: number;
  readonly clusterExposureFraction: number | null;
}

/**
 * Descriptive ClusterExposure = capital-at-risk in cluster / equity, per
 * the directive's exact formula. This module never chooses a cap -- it
 * only reports the ratio for a caller-supplied replay/account snapshot,
 * for a future Codex policy to consume.
 */
export function computeClusterExposure(
  clusters: readonly ConnectedCluster[], positions: readonly ClusterExposureInput[], accountEquity: number | null,
): readonly ClusterExposureResult[] {
  const capitalBySymbol = new Map(positions.map((position) => [position.symbol, position.capitalAtRisk]));
  return clusters.map((cluster) => {
    const capitalAtRisk = cluster.members.reduce((sum, member) => sum + (capitalBySymbol.get(member) ?? 0), 0);
    return {
      clusterMembers: cluster.members, capitalAtRisk,
      clusterExposureFraction: accountEquity !== null && accountEquity > 0 ? capitalAtRisk / accountEquity : null,
    };
  });
}

export interface ClusterStabilitySnapshot {
  readonly asOf: string;
  readonly clusters: readonly ConnectedCluster[];
}

export interface ClusterTurnoverResult {
  readonly asOf: string;
  readonly clusterCount: number;
  readonly largestClusterSize: number;
  /** Fraction of symbol-pairs whose same-cluster-membership status flipped
   * versus the immediately preceding snapshot. `null` for the first
   * snapshot (no prior to compare against). */
  readonly membershipTurnover: number | null;
}

function sameClusterPairs(clusters: readonly ConnectedCluster[]): ReadonlySet<string> {
  const pairs = new Set<string>();
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.members.length; i += 1) {
      for (let j = i + 1; j < cluster.members.length; j += 1) {
        pairs.add(`${cluster.members[i]}|${cluster.members[j]}`);
      }
    }
  }
  return pairs;
}

/**
 * Measures cluster-count/largest-cluster/membership-turnover stability
 * across a time-ordered sequence of already-built cluster snapshots
 * (e.g. one per monthly as-of date) -- descriptive only, no policy
 * threshold promoted.
 */
export function buildClusterStabilityReport(snapshots: readonly ClusterStabilitySnapshot[]): readonly ClusterTurnoverResult[] {
  let previousPairs: ReadonlySet<string> | null = null;
  return snapshots.map((snapshot) => {
    const pairs = sameClusterPairs(snapshot.clusters);
    let membershipTurnover: number | null = null;
    if (previousPairs !== null) {
      const union = new Set([...previousPairs, ...pairs]);
      const flipped = [...union].filter((pair) => previousPairs?.has(pair) !== pairs.has(pair)).length;
      membershipTurnover = union.size === 0 ? 0 : flipped / union.size;
    }
    previousPairs = pairs;
    return {
      asOf: snapshot.asOf, clusterCount: snapshot.clusters.length,
      largestClusterSize: snapshot.clusters.reduce((max, cluster) => Math.max(max, cluster.members.length), 0),
      membershipTurnover,
    };
  });
}
