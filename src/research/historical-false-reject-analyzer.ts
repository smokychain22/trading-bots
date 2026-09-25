/**
 * Historical false-reject analyzer (Wave 12 Batch 3). Research-only,
 * `brokerAuthority: false`. Compares a historical candidate's real,
 * persisted old disposition/reasons against its currently-derivable
 * structural/execution/event/AEGIS/sizing/economic state, using the
 * SAME real reason-code vocabulary Codex just canonicalized
 * (`option-executability-diagnostics.ts`'s `OptionExecutabilityCause`,
 * `first-paper-blocker-budget.ts`'s `FirstPaperBlockerClass`) rather than
 * inventing a parallel taxonomy.
 *
 * This module never invents a fill, a future quote, or a future event
 * observation. Every output is either a real re-derivation from
 * caller-supplied PIT evidence, or an explicit
 * `INSUFFICIENT_HISTORICAL_EVIDENCE` when that evidence was not
 * supplied. `counterfactualIdentifiability` is the module's own honest
 * statement of how far its conclusion can be trusted -- `OBSERVED` only
 * when the current re-evaluation used the SAME real evidence class the
 * original decision used (not a proxy), `ESTIMABLE` when a real but
 * imperfect proxy was used, `NOT_IDENTIFIABLE` when no real re-evaluation
 * was possible at all.
 *
 * **CORRECTED (2026-09-25)**: Codex independently built its own replay
 * analyzer (`docs/operations/THETA_PERFORMANCE_AND_REPLAY_RECEIPT_2026-09-23.md`)
 * and found, and fixed, the exact same defect this module originally
 * had: automatically attributing `changedBecauseOfCodeFix` to any
 * candidate that now passes re-evaluation, with no requirement that a
 * real code or policy release actually changed between the historical
 * decision and now. A candidate can legitimately "now pass" purely
 * because market conditions changed (a wider spread that day, a stale
 * quote that session), which is not evidence of a code fix. This module
 * now requires explicit `releaseProvenance` (a real historical vs.
 * current release SHA / policy version pair) before it will attribute
 * `changedBecauseOfCodeFix` or `changedBecauseOfPolicy` to anything;
 * without it, both fields are always `false`, no matter how many
 * dimensions now pass.
 */
import { optionExecutabilityCauses, type OptionExecutabilityCause } from '../theta/option-executability-diagnostics.js';
import type { NormalizedOptionContract } from '../theta/option-contract.js';

export const historicalFalseRejectAnalyzerVersion = 'theta-historical-false-reject-analyzer-v1' as const;

export type ReRunState = 'PASS' | 'STILL_REJECTED' | 'NOT_RE_EVALUATED';
export type CounterfactualIdentifiability = 'OBSERVED' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

export interface HistoricalCandidateRecord {
  readonly candidateId: string;
  readonly cycleId: string;
  readonly asOf: string;
  readonly oldDisposition: string;
  readonly oldReasons: readonly string[];
}

export interface CurrentReEvaluationEvidence {
  /** The SAME contract, re-derived from real persisted PIT quote/Greek/
   * liquidity evidence for this exact historical asOf -- never a live
   * re-fetch (that would use future information relative to `asOf`). */
  readonly reDerivedContract: Pick<NormalizedOptionContract,
    'executable' | 'nonExecutableReason' | 'bid' | 'ask' | 'quoteTimestamp' | 'source' | 'feed' | 'dataQuality'> | null;
  readonly deltaWithinCurrentBands: boolean | null;
  readonly openInterestAboveCurrentFloor: boolean | null;
  readonly volumeAboveCurrentFloor: boolean | null;
  readonly ownershipKnownAtAsOf: boolean | null;
  readonly eventStateKnownAtAsOf: 'CLEAR' | 'NEAR' | 'UNKNOWN' | null;
  /** Only set when a real, persisted AEGIS assessment for this exact
   * candidate/cycle exists -- never re-run AEGIS retroactively with
   * present-day model code, which would not be a real historical
   * re-evaluation. */
  readonly persistedAegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'DEFINED_RISK_ONLY' | null;
  readonly persistedSizingQty: number | null;
  readonly currentPolicyVersion: string;
  /** Required to attribute a code fix or a policy change to anything.
   * `null` means no real provenance was supplied -- `changedBecauseOfCodeFix`/
   * `changedBecauseOfPolicy` are then always `false`, regardless of how
   * many dimensions now pass. A real, non-null value must show the
   * historical release/policy differs from the current one to justify
   * either attribution -- a candidate that now passes under the SAME
   * release/policy changed only because of a different market
   * observation that day, not a fix. */
  readonly releaseProvenance: {
    readonly historicalReleaseSha: string | null;
    readonly currentReleaseSha: string;
    readonly historicalPolicyVersion: string | null;
  } | null;
}

export interface FalseRejectAssessment {
  readonly analyzerVersion: typeof historicalFalseRejectAnalyzerVersion;
  readonly candidateId: string;
  readonly cycleId: string;
  readonly asOf: string;
  readonly oldDisposition: string;
  readonly oldReasons: readonly string[];

  readonly currentStructuralState: ReRunState;
  readonly currentExecutionState: ReRunState;
  readonly currentExecutionCauses: readonly OptionExecutabilityCause[];
  readonly currentEventState: ReRunState;
  readonly currentAegisState: ReRunState;
  readonly currentSizingState: ReRunState;
  readonly currentEconomicState: 'NOT_EVALUATED_THIS_PASS';

  readonly changedBecauseOfCodeFix: boolean;
  readonly changedBecauseOfPolicy: boolean;
  readonly unchangedHardSafety: boolean;
  readonly insufficientHistoricalEvidence: boolean;

  readonly counterfactualIdentifiability: CounterfactualIdentifiability;
  readonly brokerAuthority: false;
}

const HARD_SAFETY_CAUSES: ReadonlySet<OptionExecutabilityCause> = new Set([
  'QUOTE_STALE', 'CROSSED_MARKET', 'INVALID_MARKET', 'QUOTE_AUTHORITY_INVALID', 'QUOTE_FEED_UNSUPPORTED',
]);

/**
 * Re-evaluates ONE historical candidate against caller-supplied
 * re-derived PIT evidence. Never fetches live data, never estimates a
 * fill, never assumes a missing evidence field means the gate passed.
 */
export function assessFalseReject(
  record: HistoricalCandidateRecord, evidence: CurrentReEvaluationEvidence,
): FalseRejectAssessment {
  const currentExecutionCauses = evidence.reDerivedContract === null
    ? [] : optionExecutabilityCauses(evidence.reDerivedContract);
  const currentExecutionState: ReRunState = evidence.reDerivedContract === null
    ? 'NOT_RE_EVALUATED'
    : evidence.reDerivedContract.executable ? 'PASS' : 'STILL_REJECTED';

  const structuralInputsKnown = evidence.deltaWithinCurrentBands !== null
    || evidence.openInterestAboveCurrentFloor !== null || evidence.volumeAboveCurrentFloor !== null;
  const structuralPass = evidence.deltaWithinCurrentBands !== false
    && evidence.openInterestAboveCurrentFloor !== false && evidence.volumeAboveCurrentFloor !== false;
  const currentStructuralState: ReRunState = !structuralInputsKnown ? 'NOT_RE_EVALUATED' : structuralPass ? 'PASS' : 'STILL_REJECTED';

  const currentEventState: ReRunState = evidence.eventStateKnownAtAsOf === null ? 'NOT_RE_EVALUATED'
    : evidence.eventStateKnownAtAsOf === 'UNKNOWN' ? 'STILL_REJECTED' : evidence.eventStateKnownAtAsOf === 'NEAR' ? 'STILL_REJECTED' : 'PASS';

  const currentAegisState: ReRunState = evidence.persistedAegisState === null ? 'NOT_RE_EVALUATED'
    : ['HOLD_ONLY', 'HARD_VETO', 'DEFINED_RISK_ONLY'].includes(evidence.persistedAegisState) ? 'STILL_REJECTED' : 'PASS';

  const currentSizingState: ReRunState = evidence.persistedSizingQty === null ? 'NOT_RE_EVALUATED'
    : evidence.persistedSizingQty > 0 ? 'PASS' : 'STILL_REJECTED';

  const reEvaluated = [currentStructuralState, currentExecutionState, currentEventState, currentAegisState, currentSizingState];
  const anyReEvaluated = reEvaluated.some((s) => s !== 'NOT_RE_EVALUATED');
  const allNowPass = reEvaluated.every((s) => s === 'PASS');
  const anyStillHardSafetyRejected = currentExecutionCauses.some((c) => HARD_SAFETY_CAUSES.has(c))
    || currentAegisState === 'STILL_REJECTED';

  const insufficientHistoricalEvidence = !anyReEvaluated;
  const unchangedHardSafety = anyStillHardSafetyRejected;
  // record.oldDisposition/oldReasons are not used as a gate here: this
  // analyzer is documented to run only on candidates that were REJECTED
  // historically (that is the entire premise of a false-reject analysis)
  // -- the real system's own disposition vocabulary is inconsistent
  // about which literal string means "rejected" (e.g.
  // new-risk-orchestrator.ts's outcome:'PASS' actually means "passed
  // OVER", i.e. rejected), so this module deliberately does not pattern-
  // match on that string.
  //
  // A "now passes" re-evaluation is NEVER attributed to a code fix or a
  // policy change without real release/policy provenance -- a candidate
  // can legitimately now pass purely because market conditions on this
  // re-evaluation differ from the historical session (a different quote,
  // a different spread), which is not evidence anything in THETA
  // changed. This is the exact defect Codex's own independently-built
  // replay analyzer found and fixed; corrected here to match.
  const releaseChanged = evidence.releaseProvenance !== null
    && evidence.releaseProvenance.historicalReleaseSha !== null
    && evidence.releaseProvenance.historicalReleaseSha !== evidence.releaseProvenance.currentReleaseSha;
  const policyChanged = evidence.releaseProvenance !== null
    && evidence.releaseProvenance.historicalPolicyVersion !== null
    && evidence.releaseProvenance.historicalPolicyVersion !== evidence.currentPolicyVersion;
  const nowPasses = anyReEvaluated && allNowPass && !anyStillHardSafetyRejected;
  const changedBecauseOfCodeFix = nowPasses && releaseChanged;
  const changedBecauseOfPolicy = nowPasses && !releaseChanged && policyChanged;

  const identifiability: CounterfactualIdentifiability = insufficientHistoricalEvidence ? 'NOT_IDENTIFIABLE'
    : evidence.reDerivedContract !== null && evidence.persistedAegisState !== null && evidence.persistedSizingQty !== null
      ? 'OBSERVED' : 'ESTIMABLE';

  return {
    analyzerVersion: historicalFalseRejectAnalyzerVersion, candidateId: record.candidateId, cycleId: record.cycleId,
    asOf: record.asOf, oldDisposition: record.oldDisposition, oldReasons: record.oldReasons,
    currentStructuralState, currentExecutionState, currentExecutionCauses, currentEventState, currentAegisState, currentSizingState,
    currentEconomicState: 'NOT_EVALUATED_THIS_PASS',
    changedBecauseOfCodeFix, changedBecauseOfPolicy, unchangedHardSafety, insufficientHistoricalEvidence,
    counterfactualIdentifiability: identifiability, brokerAuthority: false,
  };
}

export interface FalseRejectDayAggregate {
  readonly asOfDate: string;
  readonly candidatesTotal: number;
  readonly structurallyRejected: number;
  readonly executionRejected: number;
  readonly eventRejected: number;
  readonly aegisRejected: number;
  readonly sizingRejected: number;
  readonly implementationCausedReject: number;
  readonly insufficientEvidence: number;
  readonly newlyEligibleUnderCurrentCode: number;
}

/** Aggregates a real batch of assessments for one historical session --
 * pure counting, never estimates an outcome for any individual row. */
export function aggregateFalseRejectDay(asOfDate: string, assessments: readonly FalseRejectAssessment[]): FalseRejectDayAggregate {
  return {
    asOfDate, candidatesTotal: assessments.length,
    structurallyRejected: assessments.filter((a) => a.currentStructuralState === 'STILL_REJECTED').length,
    executionRejected: assessments.filter((a) => a.currentExecutionState === 'STILL_REJECTED').length,
    eventRejected: assessments.filter((a) => a.currentEventState === 'STILL_REJECTED').length,
    aegisRejected: assessments.filter((a) => a.currentAegisState === 'STILL_REJECTED').length,
    sizingRejected: assessments.filter((a) => a.currentSizingState === 'STILL_REJECTED').length,
    implementationCausedReject: assessments.filter((a) => a.changedBecauseOfCodeFix).length,
    insufficientEvidence: assessments.filter((a) => a.insufficientHistoricalEvidence).length,
    newlyEligibleUnderCurrentCode: assessments.filter((a) => a.changedBecauseOfCodeFix && !a.unchangedHardSafety).length,
  };
}
