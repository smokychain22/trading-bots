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
  /** Explicit historical release comparison. Re-evaluation alone cannot attribute a change. */
  readonly changeAttribution?: {
    readonly cause: 'CODE_FIX' | 'POLICY_CHANGE';
    readonly oldSourceSha: string;
    readonly newSourceSha: string;
    readonly oldPolicyVersion: string;
    readonly newPolicyVersion: string;
    readonly evidenceId: string;
  };
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
  readonly fullyReevaluatedAndEligible: boolean;
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
  const attribution = evidence.changeAttribution;
  if (attribution !== undefined) {
    if (!/^[0-9a-f]{40}$/.test(attribution.oldSourceSha)
      || !/^[0-9a-f]{40}$/.test(attribution.newSourceSha)
      || attribution.evidenceId.trim() === ''
      || attribution.newPolicyVersion !== evidence.currentPolicyVersion
      || (attribution.cause === 'CODE_FIX'
        && (attribution.oldSourceSha === attribution.newSourceSha
          || attribution.oldPolicyVersion !== attribution.newPolicyVersion))
      || (attribution.cause === 'POLICY_CHANGE'
        && (attribution.oldSourceSha !== attribution.newSourceSha
          || attribution.oldPolicyVersion === attribution.newPolicyVersion))) {
      throw new Error('FALSE_REJECT_CHANGE_ATTRIBUTION_INVALID');
    }
  }
  const currentExecutionCauses = evidence.reDerivedContract === null
    ? [] : optionExecutabilityCauses(evidence.reDerivedContract);
  const currentExecutionState: ReRunState = evidence.reDerivedContract === null
    ? 'NOT_RE_EVALUATED'
    : evidence.reDerivedContract.executable ? 'PASS' : 'STILL_REJECTED';

  const structuralInputsKnown = evidence.deltaWithinCurrentBands !== null
    && evidence.openInterestAboveCurrentFloor !== null && evidence.volumeAboveCurrentFloor !== null
    && evidence.ownershipKnownAtAsOf !== null;
  const structuralPass = evidence.deltaWithinCurrentBands === true
    && evidence.openInterestAboveCurrentFloor === true && evidence.volumeAboveCurrentFloor === true
    && evidence.ownershipKnownAtAsOf === true;
  const currentStructuralState: ReRunState = !structuralInputsKnown ? 'NOT_RE_EVALUATED' : structuralPass ? 'PASS' : 'STILL_REJECTED';

  const currentEventState: ReRunState = evidence.eventStateKnownAtAsOf === null ? 'NOT_RE_EVALUATED'
    : evidence.eventStateKnownAtAsOf === 'UNKNOWN' ? 'STILL_REJECTED' : evidence.eventStateKnownAtAsOf === 'NEAR' ? 'STILL_REJECTED' : 'PASS';

  const currentAegisState: ReRunState = evidence.persistedAegisState === null ? 'NOT_RE_EVALUATED'
    : ['HOLD_ONLY', 'HARD_VETO', 'DEFINED_RISK_ONLY'].includes(evidence.persistedAegisState) ? 'STILL_REJECTED' : 'PASS';

  const currentSizingState: ReRunState = evidence.persistedSizingQty === null ? 'NOT_RE_EVALUATED'
    : evidence.persistedSizingQty > 0 ? 'PASS' : 'STILL_REJECTED';

  const reEvaluated = [currentStructuralState, currentExecutionState, currentEventState, currentAegisState, currentSizingState];
  const allNowPass = reEvaluated.every((s) => s === 'PASS');
  const anyStillHardSafetyRejected = currentExecutionCauses.some((c) => HARD_SAFETY_CAUSES.has(c))
    || currentAegisState === 'STILL_REJECTED';

  const insufficientHistoricalEvidence = reEvaluated.some((s) => s === 'NOT_RE_EVALUATED');
  const unchangedHardSafety = anyStillHardSafetyRejected;
  const fullyReevaluatedAndEligible = allNowPass && !anyStillHardSafetyRejected;
  const changedBecauseOfCodeFix = fullyReevaluatedAndEligible && attribution?.cause === 'CODE_FIX';
  const changedBecauseOfPolicy = fullyReevaluatedAndEligible && attribution?.cause === 'POLICY_CHANGE';

  const identifiability: CounterfactualIdentifiability = insufficientHistoricalEvidence ? 'NOT_IDENTIFIABLE'
    : evidence.reDerivedContract !== null && evidence.persistedAegisState !== null && evidence.persistedSizingQty !== null
      ? 'OBSERVED' : 'ESTIMABLE';

  return {
    analyzerVersion: historicalFalseRejectAnalyzerVersion, candidateId: record.candidateId, cycleId: record.cycleId,
    asOf: record.asOf, oldDisposition: record.oldDisposition, oldReasons: record.oldReasons,
    currentStructuralState, currentExecutionState, currentExecutionCauses, currentEventState, currentAegisState, currentSizingState,
    currentEconomicState: 'NOT_EVALUATED_THIS_PASS',
    changedBecauseOfCodeFix, changedBecauseOfPolicy, fullyReevaluatedAndEligible,
    unchangedHardSafety, insufficientHistoricalEvidence,
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
  readonly eligibleButCauseUnattributed: number;
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
    newlyEligibleUnderCurrentCode: assessments.filter((a) => a.fullyReevaluatedAndEligible).length,
    eligibleButCauseUnattributed: assessments.filter((a) => a.fullyReevaluatedAndEligible
      && !a.changedBecauseOfCodeFix && !a.changedBecauseOfPolicy).length,
  };
}
