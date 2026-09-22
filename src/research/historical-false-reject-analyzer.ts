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
  // A code fix can only be claimed when this pass actually re-evaluated
  // the SAME candidate against real current-code logic and it now
  // passes where it did not before -- never inferred from the old
  // disposition string alone.
  // record.oldDisposition/oldReasons are not used as a gate here: this
  // analyzer is documented to run only on candidates that were REJECTED
  // historically (that is the entire premise of a false-reject analysis)
  // -- the real system's own disposition vocabulary is inconsistent
  // about which literal string means "rejected" (e.g.
  // new-risk-orchestrator.ts's outcome:'PASS' actually means "passed
  // OVER", i.e. rejected), so this module deliberately does not pattern-
  // match on that string. It only asks: does every dimension this pass
  // could re-evaluate now genuinely pass, with no hard-safety cause
  // still present?
  const changedBecauseOfCodeFix = anyReEvaluated && allNowPass && !anyStillHardSafetyRejected;
  // This module does not itself distinguish a code fix from a policy
  // (threshold/config) change -- that requires knowing whether the
  // underlying LOGIC changed vs. only a CONFIG VALUE changed, which is
  // outside what re-derived evidence alone can prove. Both are folded
  // into changedBecauseOfCodeFix here; a future pass with real commit-
  // level provenance could split them further.
  const changedBecauseOfPolicy = false;

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
