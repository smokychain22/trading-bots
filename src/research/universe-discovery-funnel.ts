/**
 * Universe discovery funnel diagnostic (Wave 15 section 12). Research-
 * only, `brokerAuthority: false`. Answers "which stage eliminated the
 * universe" precisely, rather than guessing from a zero-candidate count
 * alone -- per this wave's explicit instruction not to guess the failing
 * stage. Real evidence this module builds on: main's own recent fix
 * (`production-shadow-runtime.ts`, commit `49c912a`) already correctly
 * sets `completeness: 'DATA_INSUFFICIENT'` when `discovery.candidates.length===0`,
 * closing the "zero-candidate scan silently reads as COMPLETE" defect at
 * that field. This module adds the missing PER-STAGE breakdown so a real
 * zero-candidate scan can be attributed to an exact stage, not just
 * flagged in aggregate.
 */

export const universeDiscoveryFunnelVersion = 'theta-universe-discovery-funnel-v1' as const;

export const universeDiscoveryStages = [
  'SOURCE_ASSETS', 'ACTIVE_TRADEABLE', 'BOUNDED_COHORT', 'UNDERLYING_QUOTES', 'STOCK_BARS',
  'LIQUIDITY', 'OPTIONABILITY', 'OPTION_CONTRACTS', 'DTE_WINDOW', 'OPTION_QUOTES', 'CANDIDATE_ASSEMBLY',
] as const;
export type UniverseDiscoveryStage = typeof universeDiscoveryStages[number];

export type StageEvidenceState = 'VALID_EMPTY' | 'PROVIDER_ERROR' | 'PROVIDER_LIMITED' | 'DATA_INSUFFICIENT' | 'STALE' | 'SCHEMA_ERROR';

export interface StageRecord {
  readonly cycleId: string;
  readonly stage: UniverseDiscoveryStage;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly rejectedCount: number;
  readonly providerState: 'OK' | 'DEGRADED' | 'ERROR' | 'UNKNOWN';
  readonly evidenceState: StageEvidenceState;
  readonly durationMs: number | null;
  readonly reasonCounts: Readonly<Record<string, number>>;
}

export interface UniverseFunnelResult {
  readonly cycleId: string;
  readonly stages: readonly StageRecord[];
  /** The first stage (in defined pipeline order) whose outputCount is
   * zero -- the real, precise answer to "where did the universe become
   * empty," never guessed from the final candidate count alone. `null`
   * when every stage produced output (a healthy funnel) or the stage
   * records don't cover the whole pipeline (reported separately). */
  readonly firstEmptyStage: UniverseDiscoveryStage | null;
  readonly pipelineCoverageComplete: boolean;
  readonly missingStages: readonly UniverseDiscoveryStage[];
}

/** Validates and orders a real batch of per-cycle stage records, then
 * finds the first (in real pipeline order, not array order) stage whose
 * outputCount is zero. Never infers a failing stage when stage records
 * are missing -- reports pipelineCoverageComplete=false and lists exactly
 * which stages have no record, instead of guessing. */
export function analyzeUniverseFunnel(cycleId: string, records: readonly StageRecord[]): UniverseFunnelResult {
  const mismatched = records.filter((r) => r.cycleId !== cycleId);
  if (mismatched.length > 0) throw new Error(`UNIVERSE_FUNNEL_CYCLE_ID_MISMATCH:${mismatched[0]?.stage}`);
  for (const r of records) {
    if (!Number.isInteger(r.inputCount) || r.inputCount < 0) throw new Error(`INVALID_INPUT_COUNT:${r.stage}`);
    if (!Number.isInteger(r.outputCount) || r.outputCount < 0) throw new Error(`INVALID_OUTPUT_COUNT:${r.stage}`);
    if (!Number.isInteger(r.rejectedCount) || r.rejectedCount < 0) throw new Error(`INVALID_REJECTED_COUNT:${r.stage}`);
    if (r.outputCount + r.rejectedCount > r.inputCount) throw new Error(`STAGE_COUNTS_INCONSISTENT:${r.stage}`);
  }

  const byStage = new Map(records.map((r) => [r.stage, r]));
  const orderedStages = universeDiscoveryStages.filter((s) => byStage.has(s));
  const missingStages = universeDiscoveryStages.filter((s) => !byStage.has(s));
  const pipelineCoverageComplete = missingStages.length === 0;

  let firstEmptyStage: UniverseDiscoveryStage | null = null;
  if (pipelineCoverageComplete) {
    for (const stage of universeDiscoveryStages) {
      const record = byStage.get(stage) as StageRecord;
      if (record.outputCount === 0) { firstEmptyStage = stage; break; }
    }
  }

  return {
    cycleId, stages: orderedStages.map((s) => byStage.get(s) as StageRecord),
    firstEmptyStage, pipelineCoverageComplete, missingStages,
  };
}

export interface StageRateSummary {
  readonly stage: UniverseDiscoveryStage;
  readonly cyclesObserved: number;
  readonly emptyUniverseRate: number;
  readonly providerFailureRate: number;
  readonly dataInsufficientRate: number;
  readonly medianStageLatencyMs: number | null;
  readonly p90StageLatencyMs: number | null;
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] as number;
}

/** Aggregates real per-cycle stage records into per-stage rate metrics
 * across a real batch of cycles -- pure counting/percentiles, no
 * estimation. */
export function summarizeStageRates(allCycleRecords: readonly StageRecord[]): readonly StageRateSummary[] {
  return universeDiscoveryStages.map((stage) => {
    const records = allCycleRecords.filter((r) => r.stage === stage);
    const durations = records.map((r) => r.durationMs).filter((d): d is number => d !== null).toSorted((a, b) => a - b);
    return {
      stage, cyclesObserved: records.length,
      emptyUniverseRate: records.length === 0 ? 0 : records.filter((r) => r.outputCount === 0).length / records.length,
      providerFailureRate: records.length === 0 ? 0 : records.filter((r) => r.evidenceState === 'PROVIDER_ERROR').length / records.length,
      dataInsufficientRate: records.length === 0 ? 0 : records.filter((r) => r.evidenceState === 'DATA_INSUFFICIENT').length / records.length,
      medianStageLatencyMs: durations.length === 0 ? null : percentile(durations, 0.5),
      p90StageLatencyMs: durations.length === 0 ? null : percentile(durations, 0.9),
    };
  });
}
