/**
 * Universe discovery funnel diagnostic (Wave 15 section 12, realigned
 * Wave 18 section 1). Research-only, `brokerAuthority: false`.
 *
 * **Realignment note**: the original version of this module used a
 * speculative 11-stage list built before real Production evidence
 * existed. Main `61f2108` ("Diagnose bounded universe stages and
 * distinguish Alpaca auth failures") shipped the real diagnostic type,
 * `UniverseDiscoveryStageDiagnostic` (`src/theta/universe-discovery.ts`).
 * This module now imports that REAL type directly rather than
 * duplicating it, so it can never drift out of sync with Production
 * again -- if Codex adds/renames/removes a stage, this file's import
 * will fail to compile against the new union, forcing an explicit fix
 * here rather than silently analyzing a stale stage list.
 */
import type { UniverseDiscoveryStageDiagnostic } from '../theta/universe-discovery.js';

export const universeDiscoveryFunnelVersion = 'theta-universe-discovery-funnel-v2' as const;

export type ProductionUniverseStage = UniverseDiscoveryStageDiagnostic['stage'];
export type ProductionProviderState = UniverseDiscoveryStageDiagnostic['providerState'];

/** The real pipeline order, per `universe-discovery.ts`'s own doc
 * comments (Stage 0 fetchTradableAssets -> exchange filter -> Stage 1
 * stock bars -> Stage 2 optionability). This is the one place a stage
 * ordering assumption lives -- if Production's real order ever changes,
 * this constant (and only this constant) needs updating, not the
 * analysis logic below. `satisfies readonly ProductionUniverseStage[]`
 * makes the compiler reject this constant if it ever omits or misspells
 * a real stage name. */
export const productionUniverseStageOrder = [
  'SOURCE_ASSETS', 'EXCHANGE_FILTER', 'STOCK_BARS', 'OPTIONABILITY',
] as const satisfies readonly ProductionUniverseStage[];

/** A real per-cycle wrapper around Production's own diagnostic record --
 * `UniverseDiscoveryStageDiagnostic` itself has no `cycleId` (it is
 * already scoped to one cycle's `funnel.stageDiagnostics` array); this
 * research module adds `cycleId` only to group records across MULTIPLE
 * real cycles for the rate/latency aggregation below. */
export interface CycleScopedStageDiagnostic extends UniverseDiscoveryStageDiagnostic {
  readonly cycleId: string;
}

/** States that mean "the provider itself could not be trusted at this
 * stage" -- distinct from a genuine `VALID_EMPTY`/`READY` zero-output
 * result. Grouping these here, once, avoids re-deriving the distinction
 * ad hoc at each call site. */
const PROVIDER_FAILURE_STATES: ReadonlySet<ProductionProviderState> = new Set([
  'INVALID_AUTH', 'PROVIDER_ERROR', 'PROVIDER_LIMITED', 'SCHEMA_INVALID',
]);

export interface UniverseFunnelResult {
  readonly cycleId: string;
  readonly stages: readonly CycleScopedStageDiagnostic[];
  /** The first real stage (in `productionUniverseStageOrder`) whose
   * `outputCount` is zero -- never guessed from the final candidate
   * count alone. `null` when every stage produced output, OR when stage
   * coverage is incomplete (reported separately via
   * `pipelineCoverageComplete`/`missingStages` -- never silently guessed
   * in that case either). */
  readonly firstEmptyStage: ProductionUniverseStage | null;
  /** True only when the first empty stage's `providerState` is itself a
   * provider-failure state -- distinguishes "the universe is genuinely
   * empty under a healthy provider" (real economic signal, still not
   * proof of "no opportunity" on its own -- see `README` note below)
   * from "the provider itself failed and we cannot trust the zero." */
  readonly firstEmptyStageIsProviderFailure: boolean;
  readonly pipelineCoverageComplete: boolean;
  readonly missingStages: readonly ProductionUniverseStage[];
}

/**
 * Analyzes a real batch of Production stage diagnostics for one cycle.
 * A zero-output `SOURCE_ASSETS` stage is reported as `firstEmptyStage:
 * 'SOURCE_ASSETS'` -- this module never converts that into an "economic
 * no opportunity" claim; that interpretation belongs to a downstream
 * consumer that also knows the real completeness/DATA_INSUFFICIENT
 * semantics `production-shadow-runtime.ts` already enforces (main
 * `49c912a`), not to this stage-level diagnostic alone.
 */
export function analyzeUniverseFunnel(cycleId: string, records: readonly CycleScopedStageDiagnostic[]): UniverseFunnelResult {
  const mismatched = records.filter((r) => r.cycleId !== cycleId);
  if (mismatched.length > 0) throw new Error(`UNIVERSE_FUNNEL_CYCLE_ID_MISMATCH:${mismatched[0]?.stage}`);
  for (const r of records) {
    if (!Number.isInteger(r.inputCount) || r.inputCount < 0) throw new Error(`INVALID_INPUT_COUNT:${r.stage}`);
    if (!Number.isInteger(r.outputCount) || r.outputCount < 0) throw new Error(`INVALID_OUTPUT_COUNT:${r.stage}`);
    if (!Number.isInteger(r.rejectedCount) || r.rejectedCount < 0) throw new Error(`INVALID_REJECTED_COUNT:${r.stage}`);
    if (r.outputCount + r.rejectedCount > r.inputCount) throw new Error(`STAGE_COUNTS_INCONSISTENT:${r.stage}`);
  }

  const byStage = new Map(records.map((r) => [r.stage, r]));
  const orderedStages = productionUniverseStageOrder.filter((s) => byStage.has(s));
  const missingStages = productionUniverseStageOrder.filter((s) => !byStage.has(s));
  const pipelineCoverageComplete = missingStages.length === 0;

  let firstEmptyStage: ProductionUniverseStage | null = null;
  if (pipelineCoverageComplete) {
    for (const stage of productionUniverseStageOrder) {
      const record = byStage.get(stage) as CycleScopedStageDiagnostic;
      if (record.outputCount === 0) { firstEmptyStage = stage; break; }
    }
  }
  const firstEmptyStageIsProviderFailure = firstEmptyStage !== null
    && PROVIDER_FAILURE_STATES.has((byStage.get(firstEmptyStage) as CycleScopedStageDiagnostic).providerState);

  return {
    cycleId, stages: orderedStages.map((s) => byStage.get(s) as CycleScopedStageDiagnostic),
    firstEmptyStage, firstEmptyStageIsProviderFailure, pipelineCoverageComplete, missingStages,
  };
}

export interface StageRateSummary {
  readonly stage: ProductionUniverseStage;
  readonly cyclesObserved: number;
  readonly emptyOutputRate: number;
  readonly providerFailureRate: number;
  readonly medianStageLatencyMs: number | null;
  readonly p90StageLatencyMs: number | null;
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] as number;
}

/** Aggregates real per-cycle stage diagnostics into per-stage rates
 * across a real batch of cycles -- pure counting/percentiles, no
 * estimation. `providerFailureRate` and `emptyOutputRate` are reported
 * SEPARATELY, never combined -- a stage can be empty under a healthy
 * provider (a real signal) or empty because the provider failed (a
 * completely different signal), and conflating them was exactly this
 * module's original defect. */
export function summarizeStageRates(allCycleRecords: readonly CycleScopedStageDiagnostic[]): readonly StageRateSummary[] {
  return productionUniverseStageOrder.map((stage) => {
    const records = allCycleRecords.filter((r) => r.stage === stage);
    const durations = records.map((r) => r.durationMs).toSorted((a, b) => a - b);
    return {
      stage, cyclesObserved: records.length,
      emptyOutputRate: records.length === 0 ? 0 : records.filter((r) => r.outputCount === 0).length / records.length,
      providerFailureRate: records.length === 0 ? 0 : records.filter((r) => PROVIDER_FAILURE_STATES.has(r.providerState)).length / records.length,
      medianStageLatencyMs: durations.length === 0 ? null : percentile(durations, 0.5),
      p90StageLatencyMs: durations.length === 0 ? null : percentile(durations, 0.9),
    };
  });
}
