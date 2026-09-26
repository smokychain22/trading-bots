/**
 * Phase 2 (Profitability Brain Completion Program) real historical
 * strictness report for the Sep 16/18/21 replay sessions.
 *
 * The real aggregate numbers below are transcribed directly from
 * `docs/operations/THETA_PERFORMANCE_AND_REPLAY_RECEIPT_2026-09-23.md`
 * (candidates, historically-executable count, positive-quantity count,
 * CONTRACT_NOT_EXECUTABLE count per session) -- no raw per-candidate
 * dataset file is present in this repository checkout, so this is the
 * honest ceiling of what can be computed from what's actually committed
 * here.
 *
 * CRITICAL HONESTY CONSTRAINT: the receipt itself states the historical
 * export "does not carry a bounded company-event safety clearance,
 * candidate-level AEGIS assessment, resolved whole-chain outcome, or
 * historical fill counterfactual." This means the cause for the
 * "executable but zero-positive-quantity" cohort (whether it was an
 * AEGIS veto, a sizing constraint, an ownership-model gap, or something
 * else) is genuinely UNKNOWN per candidate, not just aggregated. Only
 * the CONTRACT_NOT_EXECUTABLE population is classified through
 * `false-inactivity-taxonomy.ts` (as EXECUTION_QUALITY_REJECT, matching
 * Command 1's confirmed hard-requirement classification for quote
 * age/spread) -- the executable-but-zero-qty population is deliberately
 * NOT forced through the taxonomy, since `FalseInactivityCause` has no
 * "UNKNOWN_CAUSE" value and assigning any of its 12 real values to this
 * cohort would be exactly the kind of fabrication this engagement's
 * standing rules forbid.
 */
import { buildStrictnessFunnelReport } from '../src/research/strictness-funnel-report.js';
import type { FalseInactivityRecord } from '../src/research/false-inactivity-taxonomy.js';

interface SessionRealCounts {
  readonly session: string;
  readonly totalCandidates: number;
  readonly historicallyExecutable: number;
  readonly positiveQuantity: number;
  readonly contractNotExecutable: number;
}

/** Real numbers, transcribed directly from the receipt's own table --
 * never re-derived or estimated. */
const REAL_SESSIONS: readonly SessionRealCounts[] = [
  { session: '2026-09-16', totalCandidates: 139, historicallyExecutable: 0, positiveQuantity: 0, contractNotExecutable: 139 },
  { session: '2026-09-18', totalCandidates: 4590, historicallyExecutable: 765, positiveQuantity: 0, contractNotExecutable: 3825 },
  { session: '2026-09-21', totalCandidates: 3876, historicallyExecutable: 577, positiveQuantity: 0, contractNotExecutable: 3299 },
];

export interface HistoricalSessionStrictnessReport {
  readonly session: string;
  readonly totalCandidates: number;
  readonly historicallyExecutable: number;
  readonly positiveQuantity: number;
  readonly contractNotExecutableClassifiedCount: number;
  /** honestly classifiable population's strictness metrics -- see module docstring */
  readonly classifiedPopulationReport: ReturnType<typeof buildStrictnessFunnelReport>;
  /** executable but zero-positive-qty, real subtraction, real count, but
   * the SPECIFIC cause (AEGIS/sizing/ownership/other) is UNKNOWN per
   * candidate -- this field is never fed through the taxonomy. */
  readonly executableZeroQtyUnclassifiableCount: number;
  readonly executableZeroQtyCauseKnown: false;
  readonly aegisStateKnown: false;
  readonly ownershipStateKnown: false;
  readonly sizingStateKnown: false;
  /** Command 1's established, honest classification of the terminal
   * cause for this cohort: a SOURCE-DERIVED CONCLUSION from current
   * `theta_q_baseline.py._quantity()` behavior (ownership_score is
   * None -> qty 0), never a FACT about what specifically happened to
   * these historical rows, since the export never captured that state. */
  readonly terminalCauseEvidenceClass: 'SOURCE_DERIVED_CONCLUSION_NOT_FACT';
}

export function buildHistoricalSessionReport(counts: SessionRealCounts): HistoricalSessionStrictnessReport {
  const records: FalseInactivityRecord[] = Array.from(
    { length: counts.contractNotExecutable },
    (_, i) => ({ candidateId: `${counts.session}:not-executable:${i}`, cause: 'EXECUTION_QUALITY_REJECT' as const }),
  );
  return {
    session: counts.session,
    totalCandidates: counts.totalCandidates,
    historicallyExecutable: counts.historicallyExecutable,
    positiveQuantity: counts.positiveQuantity,
    contractNotExecutableClassifiedCount: counts.contractNotExecutable,
    classifiedPopulationReport: buildStrictnessFunnelReport(records),
    executableZeroQtyUnclassifiableCount: counts.historicallyExecutable - counts.positiveQuantity,
    executableZeroQtyCauseKnown: false,
    aegisStateKnown: false,
    ownershipStateKnown: false,
    sizingStateKnown: false,
    terminalCauseEvidenceClass: 'SOURCE_DERIVED_CONCLUSION_NOT_FACT',
  };
}

export function buildAllHistoricalSessionReports(): readonly HistoricalSessionStrictnessReport[] {
  return REAL_SESSIONS.map(buildHistoricalSessionReport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(buildAllHistoricalSessionReports(), null, 2));
}
