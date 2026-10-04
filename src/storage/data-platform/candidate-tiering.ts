// Information-value tiers for candidates. A 2,619-contract chain must not become thousands of large hot rows to make one decision. PostgreSQL keeps full detail for
// SELECTED, FINALIST, NEAR_BOUNDARY and ANOMALY candidates and a compact rejection histogram plus the hash of the COMPLETE candidate list for everything else;
// the complete rows live in the analytical archive and verify against that hash. This is a storage-home decision, never sampling: no candidate is dropped from the archive.
import { canonicalJson, sha256Hex } from './archive-manifest.js';

export const CANDIDATE_TIERS = ['SELECTED', 'FINALIST', 'NEAR_BOUNDARY', 'ANOMALY', 'ORDINARY_REJECTED'] as const;
export type CandidateTier = (typeof CANDIDATE_TIERS)[number];

export interface TierableCandidate {
  readonly candidateId: string;
  readonly branch: string;
  readonly hardBlockers: readonly string[];
  readonly paretoRank: number | null;
  readonly [key: string]: unknown;
}

export interface BranchTieringContext {
  readonly branch: string;
  readonly bestCandidateId: string | null;
  readonly secondBestCandidateId: string | null;
  readonly bestRejectedCandidateId: string | null;
}

export interface TieringPolicy {
  readonly maxFinalistsPerBranch: number;
  readonly nearBoundaryPerBranch: number;
  /** hard-blocker texts that indicate a data or identity anomaly rather than an ordinary economic rejection */
  readonly anomalyBlockerPattern: RegExp;
}

export const defaultTieringPolicy: TieringPolicy = { maxFinalistsPerBranch: 10, nearBoundaryPerBranch: 5, anomalyBlockerPattern: /INVALID|IDENTITY|CROSSED|NON[_ -]?STANDARD|MALFORMED|CONTRADICT|CORRUPT/i };

export function reasonCode(blocker: string): string {
  const match = /^[A-Z][A-Z0-9_]{2,60}/.exec(blocker);
  return match === null ? blocker.slice(0, 60) : match[0];
}

/** Deterministic classification: ties are broken by candidate id, so the same cycle always yields the same tiers. */
export function classifyCandidates(candidates: readonly TierableCandidate[], branches: readonly BranchTieringContext[], selectedCandidateId: string | null, policy: TieringPolicy = defaultTieringPolicy): ReadonlyMap<string, CandidateTier> {
  const tiers = new Map<string, CandidateTier>();
  const byBranch = new Map<string, TierableCandidate[]>();
  for (const candidate of candidates) byBranch.set(candidate.branch, [...(byBranch.get(candidate.branch) ?? []), candidate]);
  const compare = (a: TierableCandidate, b: TierableCandidate): number => (a.paretoRank ?? Number.MAX_SAFE_INTEGER) - (b.paretoRank ?? Number.MAX_SAFE_INTEGER) || a.hardBlockers.length - b.hardBlockers.length || a.candidateId.localeCompare(b.candidateId);
  for (const [branch, list] of byBranch) {
    const context = branches.find((entry) => entry.branch === branch);
    const important = [context?.bestCandidateId, context?.secondBestCandidateId].filter((id): id is string => typeof id === 'string');
    const present = new Set(list.map((candidate) => candidate.candidateId));
    // FINALISTS: the branch's best and second best, then Pareto-rank-1 feasible candidates, capped per branch (important ones always kept)
    const feasible = list.filter((candidate) => candidate.hardBlockers.length === 0).sort(compare);
    const finalists: string[] = important.filter((id) => present.has(id));
    for (const candidate of feasible) {
      if (finalists.length >= Math.max(policy.maxFinalistsPerBranch, finalists.length)) break;
      if (candidate.paretoRank === 1 && !finalists.includes(candidate.candidateId)) finalists.push(candidate.candidateId);
    }
    const finalistSet = new Set(finalists);
    // NEAR_BOUNDARY: the branch's best rejected candidate plus the closest rejected ones (fewest blockers, best Pareto rank), a bounded number per branch
    const rejected = list.filter((candidate) => !finalistSet.has(candidate.candidateId) && candidate.hardBlockers.length > 0).sort(compare);
    const near = new Set<string>();
    if (typeof context?.bestRejectedCandidateId === 'string' && present.has(context.bestRejectedCandidateId) && !finalistSet.has(context.bestRejectedCandidateId)) near.add(context.bestRejectedCandidateId);
    for (const candidate of rejected) { if (near.size >= policy.nearBoundaryPerBranch) break; near.add(candidate.candidateId); }
    for (const candidate of list) {
      let tier: CandidateTier = 'ORDINARY_REJECTED';
      if (candidate.candidateId === selectedCandidateId) tier = 'SELECTED';
      else if (candidate.hardBlockers.some((blocker) => policy.anomalyBlockerPattern.test(blocker))) tier = 'ANOMALY';
      else if (finalistSet.has(candidate.candidateId)) tier = 'FINALIST';
      else if (near.has(candidate.candidateId)) tier = 'NEAR_BOUNDARY';
      tiers.set(candidate.candidateId, tier);
    }
  }
  return tiers;
}

export interface RejectionHistogram {
  readonly totalCandidates: number;
  readonly tierCounts: Readonly<Record<CandidateTier, number>>;
  readonly reasonCounts: Readonly<Record<string, number>>;
  /** hash of the complete list (id + content hash per candidate, sorted): the archive's candidate rows verify against it */
  readonly candidateListHash: string;
}

export function buildHistogram(candidates: readonly TierableCandidate[], tiers: ReadonlyMap<string, CandidateTier>): RejectionHistogram {
  const tierCounts: Record<CandidateTier, number> = { SELECTED: 0, FINALIST: 0, NEAR_BOUNDARY: 0, ANOMALY: 0, ORDINARY_REJECTED: 0 };
  const reasonCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    tierCounts[tiers.get(candidate.candidateId) ?? 'ORDINARY_REJECTED'] += 1;
    for (const blocker of candidate.hardBlockers) reasonCounts[reasonCode(blocker)] = (reasonCounts[reasonCode(blocker)] ?? 0) + 1;
  }
  return { totalCandidates: candidates.length, tierCounts, reasonCounts: Object.fromEntries(Object.entries(reasonCounts).sort(([a], [b]) => a.localeCompare(b))), candidateListHash: candidateListHash(candidates) };
}

export function candidateListHash(candidates: readonly TierableCandidate[]): string {
  return sha256Hex(canonicalJson(candidates.map((candidate) => [candidate.candidateId, sha256Hex(canonicalJson(candidate))]).sort(([a], [b]) => String(a).localeCompare(String(b)))));
}

export interface HotCandidateSplit {
  readonly hot: readonly { readonly tier: Exclude<CandidateTier, 'ORDINARY_REJECTED'>; readonly candidate: TierableCandidate }[];
  readonly histogram: RejectionHistogram;
  readonly fullBytes: number;
  readonly hotBytes: number;
}

export function splitHotCandidates(candidates: readonly TierableCandidate[], branches: readonly BranchTieringContext[], selectedCandidateId: string | null, policy: TieringPolicy = defaultTieringPolicy): HotCandidateSplit {
  const tiers = classifyCandidates(candidates, branches, selectedCandidateId, policy);
  const hot = candidates.flatMap((candidate) => { const tier = tiers.get(candidate.candidateId) ?? 'ORDINARY_REJECTED'; return tier === 'ORDINARY_REJECTED' ? [] : [{ tier, candidate }]; });
  const histogram = buildHistogram(candidates, tiers);
  const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
  return { hot, histogram, fullBytes: bytes(candidates), hotBytes: bytes(hot) + bytes(histogram) };
}
