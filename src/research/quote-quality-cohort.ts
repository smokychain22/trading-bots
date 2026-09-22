/**
 * Research/diagnostic only. `brokerAuthority: false` always. This module
 * owns NO quote authority -- it never decides a quote is usable, never
 * gates a candidate, and never changes execution/liquidity thresholds.
 *
 * Confirmed before writing any code (against canonical main, merged with
 * Codex's own `zero-trade-diagnostic.ts` `quoteUsableEconomics` addition,
 * commit `c3f3579`): Codex already computes overall known/median/min/max
 * distributions (DTE, |delta|, premium, spread, collateral, break-even,
 * OI, volume, EV) for the quote-usable population across a 13-cycle
 * window. That work is NOT duplicated here. What it does not do: break
 * those distributions into COHORTS (by DTE range, delta range, or spread
 * range) to answer "which slice of the lattice systematically has
 * unusable quotes," and it does not separate "structurally feasible but
 * quote-rejected" (a near-miss) from "structurally infeasible" candidates.
 * This module adds exactly those two things, as a pure, DB-free function
 * over a caller-supplied candidate batch (mirroring the P1-P4 research
 * modules' style, never coupling to a live Postgres pool the way
 * `zero-trade-diagnostic.ts` does).
 *
 * Bucket boundaries are a REQUIRED, caller-justified, versioned input
 * (`QuoteQualityBucketConfig.configVersion`) -- this module never invents
 * or hardcodes a DTE/delta/spread threshold as research or Production
 * truth (per the standing "no hardcoded bucket boundaries as Production
 * rules" directive).
 */
export const quoteQualityCohortVersion = 'theta-quote-quality-cohort-v1' as const;

export interface QuoteQualityCandidateRecord {
  readonly candidateId: string;
  readonly underlying: string;
  readonly dte: number | null;
  readonly delta: number | null;
  readonly spreadPct: number | null;
  readonly quoteAgeSeconds: number | null;
  readonly openInterest: number | null;
  readonly volume: number | null;
  /** Caller-classified (e.g. from the canonical `unknownEvidence`/
   * `hardBlockers` regex bucketing already in `zero-trade-diagnostic.ts`,
   * or `NormalizedOptionContract.executable`). Never re-derived here. */
  readonly quoteUsable: boolean;
  /** Whether the candidate was otherwise structurally/risk feasible
   * (independent of quote quality) -- required to compute a near-miss
   * count without calling a rejected quote a "missed profit." */
  readonly structurallyFeasible: boolean;
}

export interface QuoteQualityBucketDefinition {
  readonly key: string;
  readonly minInclusive: number;
  readonly maxExclusive: number;
}

export interface QuoteQualityBucketConfig {
  readonly configVersion: string;
  readonly dteBuckets: readonly QuoteQualityBucketDefinition[];
  readonly absoluteDeltaBuckets: readonly QuoteQualityBucketDefinition[];
  readonly spreadPctBuckets: readonly QuoteQualityBucketDefinition[];
}

export type QuoteQualityCohortDimension = 'DTE' | 'ABSOLUTE_DELTA' | 'SPREAD_PCT' | 'UNDERLYING';

export interface QuoteQualityCohortEntry {
  readonly dimension: QuoteQualityCohortDimension;
  readonly bucketKey: string;
  readonly candidateCount: number;
  readonly quoteUsableCount: number;
  /** `null` when `candidateCount === 0` -- never a fabricated ratio. */
  readonly quoteUsableFraction: number | null;
}

export interface QuoteQualityCohortReport {
  readonly contractVersion: typeof quoteQualityCohortVersion;
  readonly bucketConfigVersion: string;
  readonly totalCandidateCount: number;
  readonly quoteUsableCount: number;
  readonly quoteUnusableCount: number;
  /** Structurally feasible candidates whose quote was NOT usable -- a
   * near-miss population, never described as a missed profit. */
  readonly structurallyFeasibleButQuoteRejectedCount: number;
  readonly cohorts: readonly QuoteQualityCohortEntry[];
  readonly brokerAuthority: false;
}

function bucketFor(value: number | null, buckets: readonly QuoteQualityBucketDefinition[]): string {
  if (value === null || !Number.isFinite(value)) return 'UNKNOWN';
  const match = buckets.find((bucket) => value >= bucket.minInclusive && value < bucket.maxExclusive);
  return match?.key ?? 'OUT_OF_CONFIGURED_RANGE';
}

function buildCohortEntries(
  dimension: QuoteQualityCohortDimension, keyed: readonly { readonly bucketKey: string; readonly quoteUsable: boolean }[],
): readonly QuoteQualityCohortEntry[] {
  const byBucket = new Map<string, { candidateCount: number; quoteUsableCount: number }>();
  for (const row of keyed) {
    const entry = byBucket.get(row.bucketKey) ?? { candidateCount: 0, quoteUsableCount: 0 };
    entry.candidateCount += 1;
    if (row.quoteUsable) entry.quoteUsableCount += 1;
    byBucket.set(row.bucketKey, entry);
  }
  return [...byBucket.entries()]
    .map(([bucketKey, entry]) => ({
      dimension, bucketKey, candidateCount: entry.candidateCount, quoteUsableCount: entry.quoteUsableCount,
      quoteUsableFraction: entry.candidateCount > 0 ? entry.quoteUsableCount / entry.candidateCount : null,
    }))
    .sort((left, right) => left.bucketKey.localeCompare(right.bucketKey));
}

/**
 * Builds cohort-level quote-quality statistics. Throws on a duplicate
 * `candidateId` (would silently double-count a bucket) rather than
 * summing it twice.
 */
export function buildQuoteQualityCohortReport(
  candidates: readonly QuoteQualityCandidateRecord[], bucketConfig: QuoteQualityBucketConfig,
): QuoteQualityCohortReport {
  if (bucketConfig.configVersion.trim().length === 0) throw new Error('QUOTE_QUALITY_BUCKET_CONFIG_VERSION_REQUIRED');
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) throw new Error(`QUOTE_QUALITY_DUPLICATE_CANDIDATE_ID: ${candidate.candidateId}`);
    seen.add(candidate.candidateId);
  }

  const quoteUsableCount = candidates.filter((candidate) => candidate.quoteUsable).length;
  const structurallyFeasibleButQuoteRejectedCount = candidates.filter(
    (candidate) => candidate.structurallyFeasible && !candidate.quoteUsable,
  ).length;

  const dteRows = candidates.map((candidate) => ({ bucketKey: bucketFor(candidate.dte, bucketConfig.dteBuckets), quoteUsable: candidate.quoteUsable }));
  const deltaRows = candidates.map((candidate) => ({
    bucketKey: bucketFor(candidate.delta === null ? null : Math.abs(candidate.delta), bucketConfig.absoluteDeltaBuckets), quoteUsable: candidate.quoteUsable,
  }));
  const spreadRows = candidates.map((candidate) => ({ bucketKey: bucketFor(candidate.spreadPct, bucketConfig.spreadPctBuckets), quoteUsable: candidate.quoteUsable }));
  const underlyingRows = candidates.map((candidate) => ({ bucketKey: candidate.underlying, quoteUsable: candidate.quoteUsable }));

  return {
    contractVersion: quoteQualityCohortVersion, bucketConfigVersion: bucketConfig.configVersion,
    totalCandidateCount: candidates.length, quoteUsableCount, quoteUnusableCount: candidates.length - quoteUsableCount,
    structurallyFeasibleButQuoteRejectedCount,
    cohorts: [
      ...buildCohortEntries('DTE', dteRows), ...buildCohortEntries('ABSOLUTE_DELTA', deltaRows),
      ...buildCohortEntries('SPREAD_PCT', spreadRows), ...buildCohortEntries('UNDERLYING', underlyingRows),
    ],
    brokerAuthority: false,
  };
}
