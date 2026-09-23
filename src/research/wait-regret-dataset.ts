/**
 * WAIT / reject regret dataset (Wave 17 section 8). Research-only,
 * `brokerAuthority: false`. Directly answers the owner's central
 * question: is THETA intelligently selective, or falsely inactive? Reuses
 * `false-inactivity-taxonomy.ts`'s real cause vocabulary and
 * `historical-false-reject-analyzer.ts`'s `CounterfactualIdentifiability`
 * pattern rather than inventing parallel ones. A hard-safety WAIT is
 * NEVER counted as regret merely because the underlying later moved
 * favorably -- `computeWaitRegretMetrics` structurally excludes
 * `hardVsSoft: 'HARD'` rows from every regret-rate numerator.
 */
import type { FalseInactivityCause } from './false-inactivity-taxonomy.js';
import type { FirstPaperBlockerClass } from '../theta/first-paper-blocker-budget.js';

export const waitRegretDatasetVersion = 'theta-wait-regret-dataset-v1' as const;

export type CounterfactualStatus = 'OBSERVED_PARALLEL' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

export interface RejectedCandidateSummary {
  readonly candidateId: string;
  readonly rankScore: number | null;
  readonly rejectionReason: string;
}

export interface WaitRegretRow {
  readonly contractVersion: typeof waitRegretDatasetVersion;
  readonly waitDecisionId: string;
  readonly cycleId: string;
  readonly decisionAt: string;

  readonly exactReason: FalseInactivityCause;
  readonly reasonStage: string;
  readonly blockerClass: FirstPaperBlockerClass | null;
  readonly hardVsSoft: 'HARD' | 'SOFT';

  readonly bestRejectedCandidate: RejectedCandidateSummary | null;
  readonly secondBestCandidate: RejectedCandidateSummary | null;

  readonly evidenceAtDecision: Readonly<Record<string, unknown>>;
  readonly providerStates: readonly string[];
  readonly pipelineStates: readonly string[];

  /** Real, observed future outcome -- null until labelAvailableAt. This
   * module never estimates a fill or a future price for a candidate that
   * was never actually executed. */
  readonly futureOutcome: { readonly wholeChainNetPnlIfTaken: number | null; readonly observedAt: string } | null;
  readonly labelAvailableAt: string | null;
  readonly counterfactualIdentifiability: CounterfactualStatus;
}

/** hardVsSoft is derived, never caller-asserted independently of the
 * real cause -- a real HARD_SAFETY_REJECT/EXECUTION_QUALITY_REJECT/
 * AEGIS_REJECT is always HARD; everything else defaults SOFT unless the
 * caller has a real reason to override (not exposed here -- this keeps
 * the mapping single-sourced from the taxonomy, not duplicated per call
 * site). */
const HARD_CAUSES: ReadonlySet<FalseInactivityCause> = new Set(['HARD_SAFETY_REJECT', 'EXECUTION_QUALITY_REJECT', 'AEGIS_REJECT']);

export function buildWaitRegretRow(input: Omit<WaitRegretRow, 'contractVersion' | 'hardVsSoft'>): WaitRegretRow {
  if (!Number.isFinite(Date.parse(input.decisionAt))) throw new Error('WAIT_REGRET_INVALID_DECISION_AT');
  if (input.labelAvailableAt !== null) {
    const labelMs = Date.parse(input.labelAvailableAt);
    if (!Number.isFinite(labelMs)) throw new Error('WAIT_REGRET_INVALID_LABEL_AVAILABLE_AT');
    if (labelMs < Date.parse(input.decisionAt)) throw new Error('WAIT_REGRET_LABEL_BEFORE_DECISION');
  }
  if (input.futureOutcome !== null && input.labelAvailableAt === null) throw new Error('WAIT_REGRET_OUTCOME_WITHOUT_LABEL_AVAILABLE_AT');
  if (input.futureOutcome !== null && Date.parse(input.futureOutcome.observedAt) > Date.parse(input.labelAvailableAt as string)) {
    throw new Error('WAIT_REGRET_FUTURE_OUTCOME_AFTER_LABEL_AVAILABLE_AT');
  }
  return { contractVersion: waitRegretDatasetVersion, hardVsSoft: HARD_CAUSES.has(input.exactReason) ? 'HARD' : 'SOFT', ...input };
}

export interface WaitRegretMetrics {
  readonly totalRows: number;
  readonly softIdentifiableRows: number;
  readonly observedParallelRows: number;
  readonly falseRejectRate: number | null;
  readonly falseAcceptRate: null;
  readonly gateRegretRate: number | null;
  readonly decisionRegretRate: number | null;
  readonly opportunityConversionRate: null;
  readonly rejectedCandidatePresenceRate: number | null;
  readonly implementationFalseRejectRate: number | null;
  readonly providerFailureRejectRate: number | null;
  readonly economicWaitRate: number | null;
  readonly safetyRejectRate: number | null;
  readonly dataInsufficientRate: number | null;
}

function rate(rows: readonly WaitRegretRow[], predicate: (row: WaitRegretRow) => boolean): number | null {
  if (rows.length === 0) return null;
  return rows.filter(predicate).length / rows.length;
}

/**
 * Computes real, structurally-separated regret rates from a real batch
 * of rows. `falseRejectRate`/`gateRegretRate`/`decisionRegretRate` are
 * computed ONLY over `hardVsSoft: 'SOFT'` rows with a real, non-null
 * `futureOutcome` (OBSERVED_PARALLEL or ESTIMABLE identifiability) --
 * a HARD row can never contribute to a regret numerator, regardless of
 * what its (irrelevant, uncomputed) future outcome would have been.
 */
export function computeWaitRegretMetrics(rows: readonly WaitRegretRow[]): WaitRegretMetrics {
  const softIdentifiable = rows.filter((r) => r.hardVsSoft === 'SOFT'
    && r.counterfactualIdentifiability !== 'NOT_IDENTIFIABLE'
    && typeof r.futureOutcome?.wholeChainNetPnlIfTaken === 'number');
  const observedParallel = softIdentifiable.filter((r) => r.counterfactualIdentifiability === 'OBSERVED_PARALLEL');
  const positiveOutcome = (row: WaitRegretRow): boolean => {
    const value = row.futureOutcome?.wholeChainNetPnlIfTaken;
    return typeof value === 'number' && value > 0;
  };

  return {
    totalRows: rows.length,
    softIdentifiableRows: softIdentifiable.length,
    observedParallelRows: observedParallel.length,
    falseRejectRate: rate(softIdentifiable, (r) => positiveOutcome(r)
      && (r.exactReason === 'IMPLEMENTATION_FALSE_REJECT' || r.exactReason === 'ECONOMIC_WAIT')),
    falseAcceptRate: null, // WAIT-only evidence has no accepted-then-lost denominator.
    gateRegretRate: rate(softIdentifiable, positiveOutcome),
    decisionRegretRate: rate(observedParallel, positiveOutcome),
    opportunityConversionRate: null, // Candidate presence does not establish an actual conversion.
    rejectedCandidatePresenceRate: rate(rows, (r) => r.bestRejectedCandidate !== null),
    implementationFalseRejectRate: rate(rows, (r) => r.exactReason === 'IMPLEMENTATION_FALSE_REJECT'),
    providerFailureRejectRate: rate(rows, (r) => r.exactReason === 'PROVIDER_FAILURE_REJECT' || r.exactReason === 'DATA_STALE_REJECT'),
    economicWaitRate: rate(rows, (r) => r.exactReason === 'ECONOMIC_WAIT'),
    safetyRejectRate: rate(rows, (r) => r.hardVsSoft === 'HARD'),
    dataInsufficientRate: rate(rows, (r) => r.exactReason === 'DATA_UNAVAILABLE_REJECT'),
  };
}
