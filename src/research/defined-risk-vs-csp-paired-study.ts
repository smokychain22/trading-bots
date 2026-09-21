/**
 * R8 Defined-Risk vs CSP paired study (directive priority #1, this pass).
 * Research-only, `brokerAuthority: false`. Compares `THETA_CONVENTIONAL`
 * (bare cash-secured put) against `THETA_DEFINED_RISK` (research-only
 * put credit spread) using the v3 hardened common-horizon contract --
 * this module does NOT recompute comparison maturity or Pareto logic
 * itself; it builds real candidates and delegates to
 * `cross-strategy-common-horizon-contract.ts::compareCrossStrategy`
 * (never a second, competing comparator).
 *
 * Governing constraint from this pass's directive: Defined Risk's
 * contractually finite max loss must NEVER be treated as automatically
 * "safer" in expectation -- superior ES/EV/RPCD/drawdown/fill-quality
 * are each a separate, empirical question this module reports evidence
 * for, never a conclusion it draws. No branch is preferred anywhere in
 * this module.
 *
 * Pairing unit: same underlying, same decisionTimestamp, same
 * FusionSnapshot/PIT state, same ownershipState, same regimeState, same
 * eventState, same account/portfolio context -- NOT the same contract.
 * All real CSP and Defined-Risk candidates from that decision are
 * retained (never only whichever contract a branch happened to
 * preselect).
 */
import {
  cashSecuredPutMaxLossAtZero, compareCrossStrategy,
  type CandidateComparisonInput, type ComparisonContext, type ComparisonProfile, type CrossStrategyComparisonResult,
  type EmpiricalForwardEconomics,
} from './cross-strategy-common-horizon-contract.js';

export const definedRiskVsCspPairedStudyVersion = 'theta-defined-risk-vs-csp-paired-study-v1' as const;

// ---------------------------------------------------------------------
// 1. Pairing identity
// ---------------------------------------------------------------------

/**
 * The real decision-context identity two candidate sets must share to
 * be a valid pair. Deliberately NOT "same contract" -- Conventional's
 * lattice (25-60 DTE, single PUT) and Defined Risk's lattice (7-60 DTE,
 * multi-leg) are structurally disjoint, so requiring identical strikes/
 * expirations would make pairing structurally impossible.
 */
export interface PairingKey {
  readonly underlying: string;
  readonly decisionTimestamp: string;
  readonly fusionSnapshotId: string;
  readonly ownershipState: string;
  readonly regimeState: string | null;
  readonly eventState: string;
  readonly accountContextId: string;
}

export function samePairingKey(a: PairingKey, b: PairingKey): boolean {
  return a.underlying === b.underlying && a.decisionTimestamp === b.decisionTimestamp
    && a.fusionSnapshotId === b.fusionSnapshotId && a.ownershipState === b.ownershipState
    && a.regimeState === b.regimeState && a.eventState === b.eventState && a.accountContextId === b.accountContextId;
}

export interface PairValidationResult {
  readonly valid: boolean;
  readonly reason: string | null;
}

/**
 * Structural validity of a pairing ONLY -- does not evaluate whether
 * either side has any real candidates (that is `classifyComparisonReadiness`'s
 * job, downstream).
 */
export function validatePair(cspKey: PairingKey, definedRiskKey: PairingKey): PairValidationResult {
  if (!samePairingKey(cspKey, definedRiskKey)) return { valid: false, reason: 'PAIRING_KEY_MISMATCH' };
  return { valid: true, reason: null };
}

/** Returns the shared key when both sides genuinely share one, `null` otherwise. */
export function pairDecisionContexts(cspKey: PairingKey, definedRiskKey: PairingKey): PairingKey | null {
  return samePairingKey(cspKey, definedRiskKey) ? cspKey : null;
}

// ---------------------------------------------------------------------
// 2. Defined-Risk (put credit spread) structural economics -- independently
//    re-derived and unit-tested here, never assumed equal to any other
//    module's formula.
// ---------------------------------------------------------------------

export type PutCreditSpreadStructuralClassification =
  | 'VALID_CREDIT_SPREAD'
  | 'MISSING_STRIKES'
  | 'INVERTED_STRIKES'
  | 'ZERO_WIDTH_SPREAD'
  | 'MISSING_EXECUTABLE_QUOTE'
  | 'NEGATIVE_OR_ZERO_NET_CREDIT'
  | 'MISSING_MULTIPLIER_OR_QUANTITY'
  | 'MISMATCHED_MULTIPLIERS';

export interface SpreadLegQuote {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string | null;
  readonly multiplier: number | null;
}

export interface PutCreditSpreadStructuralInputs {
  readonly shortStrike: number | null;
  readonly longStrike: number | null;
  /** The short leg is Sell-To-Open -- its real executable credit is its BID. */
  readonly shortLeg: SpreadLegQuote;
  /** The long leg is Buy-To-Open -- its real executable debit is its ASK. */
  readonly longLeg: SpreadLegQuote;
  readonly quantity: number | null;
}

export interface PutCreditSpreadStructuralEconomics {
  readonly classification: PutCreditSpreadStructuralClassification;
  /** Per-share, executable-quote-based: `shortLeg.bid - longLeg.ask`. `null` unless `classification === 'VALID_CREDIT_SPREAD'`. */
  readonly openingNetCreditPerShare: number | null;
  readonly width: number | null;
  readonly maxProfit: number | null;
  readonly maxLoss: number | null;
  readonly multiplier: number | null;
  readonly quantity: number | null;
}

function invalidStructuralEconomics(classification: PutCreditSpreadStructuralClassification): PutCreditSpreadStructuralEconomics {
  return { classification, openingNetCreditPerShare: null, width: null, maxProfit: null, maxLoss: null, multiplier: null, quantity: null };
}

/**
 * `maxProfit = openingNetCredit x multiplier x quantity`,
 * `width = shortStrike - longStrike`,
 * `maxLoss = (width - openingNetCredit) x multiplier x quantity`.
 * An invalid structure (inverted strikes, zero width, a real net DEBIT,
 * a missing executable quote, or mismatched leg multipliers) is
 * REJECTED and classified -- never normalized into plausible-looking
 * economics.
 */
export function computePutCreditSpreadStructuralEconomics(inputs: PutCreditSpreadStructuralInputs): PutCreditSpreadStructuralEconomics {
  const { shortStrike, longStrike, shortLeg, longLeg, quantity } = inputs;
  if (shortStrike === null || longStrike === null) return invalidStructuralEconomics('MISSING_STRIKES');

  const width = shortStrike - longStrike;
  if (width < 0) return invalidStructuralEconomics('INVERTED_STRIKES');
  if (width === 0) return invalidStructuralEconomics('ZERO_WIDTH_SPREAD');

  if (shortLeg.bid === null || longLeg.ask === null) return invalidStructuralEconomics('MISSING_EXECUTABLE_QUOTE');

  if (shortLeg.multiplier === null || longLeg.multiplier === null || quantity === null) return invalidStructuralEconomics('MISSING_MULTIPLIER_OR_QUANTITY');
  if (shortLeg.multiplier !== longLeg.multiplier) return invalidStructuralEconomics('MISMATCHED_MULTIPLIERS');
  const multiplier = shortLeg.multiplier;

  const openingNetCreditPerShare = shortLeg.bid - longLeg.ask;
  if (openingNetCreditPerShare <= 0) return invalidStructuralEconomics('NEGATIVE_OR_ZERO_NET_CREDIT');

  const maxProfit = openingNetCreditPerShare * multiplier * quantity;
  const maxLoss = (width - openingNetCreditPerShare) * multiplier * quantity;
  return { classification: 'VALID_CREDIT_SPREAD', openingNetCreditPerShare, width, maxProfit, maxLoss, multiplier, quantity };
}

// ---------------------------------------------------------------------
// 3. Multi-leg vs single-leg execution burden
// ---------------------------------------------------------------------

export type QuoteSynchronizationStatus = 'SYNCHRONIZED' | 'DESYNCHRONIZED' | 'TIMESTAMP_UNKNOWN';

export interface QuoteSynchronizationEvidence {
  readonly status: QuoteSynchronizationStatus;
  readonly ageMs: number | null;
}

/**
 * `maxSyncAgeMs` is REQUIRED and caller-supplied -- this module never
 * invents a synchronization tolerance. Two legs with unknown timestamps
 * are `TIMESTAMP_UNKNOWN`, never assumed synchronized.
 */
export function quoteSynchronizationStatus(
  shortLegTimestamp: string | null, longLegTimestamp: string | null, maxSyncAgeMs: number,
): QuoteSynchronizationEvidence {
  if (shortLegTimestamp === null || longLegTimestamp === null) return { status: 'TIMESTAMP_UNKNOWN', ageMs: null };
  const ageMs = Math.abs(new Date(shortLegTimestamp).getTime() - new Date(longLegTimestamp).getTime());
  return { status: ageMs <= maxSyncAgeMs ? 'SYNCHRONIZED' : 'DESYNCHRONIZED', ageMs };
}

function legSpread(bid: number | null, ask: number | null): number | null {
  return bid === null || ask === null ? null : ask - bid;
}

export interface LegExecutionEvidence {
  readonly legId: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string | null;
  readonly spread: number | null;
}

export interface SpreadExecutionBurdenEvidence {
  readonly shortLeg: LegExecutionEvidence;
  readonly longLeg: LegExecutionEvidence;
  readonly combinedNetCredit: number | null;
  /** Half-spread cost estimate summed across both legs -- a real,
   * documented estimation convention, never presented as an executed
   * fill. */
  readonly combinedExecutionCostEstimatePerShare: number | null;
  readonly quoteSynchronization: QuoteSynchronizationEvidence;
}

export function buildSpreadExecutionBurdenEvidence(
  shortLegId: string, shortLeg: SpreadLegQuote, longLegId: string, longLeg: SpreadLegQuote, maxSyncAgeMs: number,
): SpreadExecutionBurdenEvidence {
  const shortSpread = legSpread(shortLeg.bid, shortLeg.ask);
  const longSpread = legSpread(longLeg.bid, longLeg.ask);
  const combinedNetCredit = shortLeg.bid !== null && longLeg.ask !== null ? shortLeg.bid - longLeg.ask : null;
  const combinedExecutionCostEstimatePerShare = shortSpread !== null && longSpread !== null ? (shortSpread + longSpread) / 2 : null;
  return {
    shortLeg: { legId: shortLegId, bid: shortLeg.bid, ask: shortLeg.ask, quoteTimestamp: shortLeg.quoteTimestamp, spread: shortSpread },
    longLeg: { legId: longLegId, bid: longLeg.bid, ask: longLeg.ask, quoteTimestamp: longLeg.quoteTimestamp, spread: longSpread },
    combinedNetCredit, combinedExecutionCostEstimatePerShare,
    quoteSynchronization: quoteSynchronizationStatus(shortLeg.quoteTimestamp, longLeg.quoteTimestamp, maxSyncAgeMs),
  };
}

// ---------------------------------------------------------------------
// 4. Candidate builders -- project real raw evidence into the hardened
//    common-horizon contract's CandidateComparisonInput. Reuses
//    cashSecuredPutMaxLossAtZero rather than recomputing CSP tail loss
//    independently.
// ---------------------------------------------------------------------

const NULL_EMPIRICAL: EmpiricalForwardEconomics = {
  expectedAfterCostWholeChainPnl: null, probabilityProfitable: null, probabilityAssignment: null,
  expectedAssignmentBurden: null, expectedRecoveryDuration: null, expectedCapitalDays: null,
  expectedShortfall: null, cvar: null, maxDrawdown: null, concentrationImpact: null,
  expectedTca: null, calibratedUncertainty: null,
};

export type StudyCandidateBuildResult =
  | { readonly status: 'BUILT'; readonly candidate: CandidateComparisonInput }
  | { readonly status: 'REJECTED'; readonly candidateId: string; readonly reason: string };

export interface CspCandidateRawEvidence {
  readonly candidateId: string;
  readonly underlying: string;
  readonly dte: number | null;
  readonly strike: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string | null;
  readonly multiplier: number | null;
  readonly quantity: number | null;
  readonly collateral: number | null;
  readonly buyingPowerImpact: number | null;
  readonly breakEven: number | null;
  readonly downsideCushion: number | null;
}

export function buildCspStudyCandidate(evidence: CspCandidateRawEvidence, context: ComparisonContext): StudyCandidateBuildResult {
  if (evidence.strike === null) return { status: 'REJECTED', candidateId: evidence.candidateId, reason: 'MISSING_STRIKE' };
  if (evidence.bid === null) return { status: 'REJECTED', candidateId: evidence.candidateId, reason: 'MISSING_EXECUTABLE_QUOTE' };
  if (evidence.multiplier === null || evidence.quantity === null) return { status: 'REJECTED', candidateId: evidence.candidateId, reason: 'MISSING_MULTIPLIER_OR_QUANTITY' };

  const maxLoss = cashSecuredPutMaxLossAtZero(evidence.strike, evidence.bid, evidence.multiplier, evidence.quantity);
  const bidAskSpread = legSpread(evidence.bid, evidence.ask);
  const estimatedEntryExecutionCost = bidAskSpread === null ? null : (bidAskSpread / 2) * evidence.multiplier * evidence.quantity;

  return {
    status: 'BUILT',
    candidate: {
      candidateId: evidence.candidateId, context, quantity: evidence.quantity,
      deterministic: {
        action: 'OPEN_CSP', strategy: 'THETA_CONVENTIONAL', underlying: evidence.underlying,
        structureClass: 'CASH_SECURED_SINGLE_LEG', contractIdentities: [evidence.candidateId],
        dte: evidence.dte, strikes: [evidence.strike], executableOpenCreditDebit: evidence.bid,
        multiplier: evidence.multiplier, collateral: evidence.collateral, buyingPowerImpact: evidence.buyingPowerImpact,
        maxLoss, breakEven: evidence.breakEven, downsideCushion: evidence.downsideCushion, width: null,
        bidAskSpread, estimatedEntryExecutionCost, capitalRequirement: evidence.collateral,
      },
      empirical: { ...NULL_EMPIRICAL },
    },
  };
}

export interface DefinedRiskCandidateRawEvidence {
  readonly candidateId: string;
  readonly underlying: string;
  readonly dte: number | null;
  readonly shortStrike: number | null;
  readonly longStrike: number | null;
  readonly shortLeg: SpreadLegQuote;
  readonly longLeg: SpreadLegQuote;
  readonly quantity: number | null;
  readonly buyingPowerImpact: number | null;
  readonly breakEven: number | null;
  readonly downsideCushion: number | null;
  readonly maxSyncAgeMs: number;
}

export interface DefinedRiskStudyCandidateBuildResult {
  readonly result: StudyCandidateBuildResult;
  readonly structuralEconomics: PutCreditSpreadStructuralEconomics;
  readonly executionBurden: SpreadExecutionBurdenEvidence;
}

export function buildDefinedRiskStudyCandidate(evidence: DefinedRiskCandidateRawEvidence, context: ComparisonContext): DefinedRiskStudyCandidateBuildResult {
  const structuralEconomics = computePutCreditSpreadStructuralEconomics({
    shortStrike: evidence.shortStrike, longStrike: evidence.longStrike, shortLeg: evidence.shortLeg, longLeg: evidence.longLeg, quantity: evidence.quantity,
  });
  const executionBurden = buildSpreadExecutionBurdenEvidence(
    `${evidence.candidateId}:short`, evidence.shortLeg, `${evidence.candidateId}:long`, evidence.longLeg, evidence.maxSyncAgeMs,
  );

  if (structuralEconomics.classification !== 'VALID_CREDIT_SPREAD') {
    return { result: { status: 'REJECTED', candidateId: evidence.candidateId, reason: structuralEconomics.classification }, structuralEconomics, executionBurden };
  }

  const bidAskSpread = executionBurden.combinedExecutionCostEstimatePerShare === null ? null : executionBurden.combinedExecutionCostEstimatePerShare * 2;
  const estimatedEntryExecutionCost = executionBurden.combinedExecutionCostEstimatePerShare === null ? null
    : executionBurden.combinedExecutionCostEstimatePerShare * (structuralEconomics.multiplier as number) * (structuralEconomics.quantity as number);

  return {
    result: {
      status: 'BUILT',
      candidate: {
        candidateId: evidence.candidateId, context, quantity: evidence.quantity as number,
        deterministic: {
          action: 'OPEN_DEFINED_RISK', strategy: 'THETA_DEFINED_RISK', underlying: evidence.underlying,
          structureClass: 'STRUCTURALLY_DEFINED_RISK_SPREAD', contractIdentities: [`${evidence.candidateId}:short`, `${evidence.candidateId}:long`],
          dte: evidence.dte, strikes: [evidence.shortStrike as number, evidence.longStrike as number],
          executableOpenCreditDebit: structuralEconomics.openingNetCreditPerShare, multiplier: structuralEconomics.multiplier,
          collateral: structuralEconomics.maxLoss, buyingPowerImpact: evidence.buyingPowerImpact,
          maxLoss: structuralEconomics.maxLoss, breakEven: evidence.breakEven, downsideCushion: evidence.downsideCushion,
          width: structuralEconomics.width, bidAskSpread, estimatedEntryExecutionCost,
          capitalRequirement: structuralEconomics.maxLoss,
        },
        empirical: { ...NULL_EMPIRICAL },
      },
    },
    structuralEconomics, executionBurden,
  };
}

// ---------------------------------------------------------------------
// 5. Paired study record + readiness classification (delegates to the
//    hardened common-horizon contract -- never a second comparator).
// ---------------------------------------------------------------------

export type PairedStudyReadiness =
  | 'PAIRING_KEY_MISMATCH'
  | 'STRUCTURAL_PAIR_NOT_READY'
  | 'STRUCTURAL_PAIR_READY'
  | 'EMPIRICAL_OUTCOMES_PENDING'
  | 'PROFILE_NOT_READY'
  | 'OOS_NOT_EVALUATED';

/**
 * Maps the hardened contract's own maturity ladder into paired-study
 * vocabulary. `FULL_RESEARCH_COMPARABLE` maps to `OOS_NOT_EVALUATED` --
 * the ceiling this research phase is permitted to reach, since NO model
 * is ever fit or out-of-sample-validated here (standing constraint, not
 * a data-completeness fact).
 */
export function classifyComparisonReadiness(underlying: CrossStrategyComparisonResult): PairedStudyReadiness {
  switch (underlying.state) {
    case 'NOT_COMPARABLE': return 'STRUCTURAL_PAIR_NOT_READY';
    case 'STRUCTURAL_ONLY': return 'STRUCTURAL_PAIR_READY';
    case 'EV_COMPARABLE_ONLY': return 'EMPIRICAL_OUTCOMES_PENDING';
    case 'PROFILE_NOT_READY': return 'PROFILE_NOT_READY';
    case 'FULL_RESEARCH_COMPARABLE': return 'OOS_NOT_EVALUATED';
  }
}

export interface PairedDecisionRawInput {
  readonly pairingKey: PairingKey;
  readonly cspCandidates: readonly CspCandidateRawEvidence[];
  readonly definedRiskCandidates: readonly DefinedRiskCandidateRawEvidence[];
}

export interface PairedDecisionRecord {
  readonly pairingKey: PairingKey;
  readonly cspBuildResults: readonly StudyCandidateBuildResult[];
  readonly definedRiskBuildResults: readonly DefinedRiskStudyCandidateBuildResult[];
  readonly bestStructuralCspCandidateId: string | null;
  readonly bestStructuralDefinedRiskCandidateId: string | null;
  readonly rejectedCandidateIds: readonly string[];
  readonly missingEvidenceReasons: readonly string[];
  readonly comparison: CrossStrategyComparisonResult | null;
  readonly readiness: PairedStudyReadiness;
}

/**
 * "Best structural candidate" here means highest `executableOpenCreditDebit`
 * among structurally BUILT candidates -- a real, known, deterministic
 * fact about premium collected at entry. This is NOT an economic
 * ranking (no EV/ES claim); it exists only to identify a natural
 * reference candidate for descriptive reporting.
 */
function bestByOpenCredit(built: readonly CandidateComparisonInput[]): string | null {
  const withCredit = built.filter((c) => c.deterministic.executableOpenCreditDebit !== null);
  if (withCredit.length === 0) return null;
  return withCredit.reduce((best, c) => (c.deterministic.executableOpenCreditDebit as number) > (best.deterministic.executableOpenCreditDebit as number) ? c : best).candidateId;
}

/**
 * Builds one full paired-decision record: retains EVERY real candidate
 * on both sides (never only a preselected one), classifies rejected
 * structures with their exact reason, and delegates comparability to
 * `compareCrossStrategy` under the caller-supplied `profile` --
 * `ENTRY_WHOLE_CHAIN_V1` is the recommended profile for this specific
 * comparison, since assignment/recovery/TCA mechanics genuinely differ
 * between a bare CSP and a defined-risk spread.
 */
export function buildPairedDecisionRecord(input: PairedDecisionRawInput, context: ComparisonContext, profile: ComparisonProfile): PairedDecisionRecord {
  const cspBuildResults = input.cspCandidates.map((c) => buildCspStudyCandidate(c, context));
  const definedRiskBuildResults = input.definedRiskCandidates.map((c) => buildDefinedRiskStudyCandidate(c, context));

  const builtCsp = cspBuildResults.filter((r): r is Extract<StudyCandidateBuildResult, { status: 'BUILT' }> => r.status === 'BUILT').map((r) => r.candidate);
  const builtDefinedRisk = definedRiskBuildResults.map((r) => r.result).filter((r): r is Extract<StudyCandidateBuildResult, { status: 'BUILT' }> => r.status === 'BUILT').map((r) => r.candidate);

  const rejectedCandidateIds = [
    ...cspBuildResults.filter((r) => r.status === 'REJECTED').map((r) => r.candidateId),
    ...definedRiskBuildResults.map((r) => r.result).filter((r) => r.status === 'REJECTED').map((r) => r.candidateId),
  ];
  const missingEvidenceReasons = [
    ...new Set([
      ...cspBuildResults.filter((r): r is Extract<StudyCandidateBuildResult, { status: 'REJECTED' }> => r.status === 'REJECTED').map((r) => r.reason),
      ...definedRiskBuildResults.map((r) => r.result).filter((r): r is Extract<StudyCandidateBuildResult, { status: 'REJECTED' }> => r.status === 'REJECTED').map((r) => r.reason),
    ]),
  ];

  const bestStructuralCspCandidateId = bestByOpenCredit(builtCsp);
  const bestStructuralDefinedRiskCandidateId = bestByOpenCredit(builtDefinedRisk);

  const allBuilt = [...builtCsp, ...builtDefinedRisk];
  const comparison = allBuilt.length === 0 ? null : compareCrossStrategy(allBuilt, profile);
  const readiness = comparison === null ? 'STRUCTURAL_PAIR_NOT_READY' : classifyComparisonReadiness(comparison);

  return {
    pairingKey: input.pairingKey, cspBuildResults, definedRiskBuildResults,
    bestStructuralCspCandidateId, bestStructuralDefinedRiskCandidateId,
    rejectedCandidateIds, missingEvidenceReasons, comparison, readiness,
  };
}

// ---------------------------------------------------------------------
// 6. Descriptive cohort summary -- no verdict, no preferred branch.
// ---------------------------------------------------------------------

export interface PairedCohortSummary {
  readonly readinessCounts: Readonly<Record<PairedStudyReadiness, number>>;
  readonly totalPairs: number;
  readonly pairsWithAnyRejectedCandidate: number;
}

const EMPTY_READINESS_COUNTS: Record<PairedStudyReadiness, number> = {
  PAIRING_KEY_MISMATCH: 0, STRUCTURAL_PAIR_NOT_READY: 0, STRUCTURAL_PAIR_READY: 0,
  EMPIRICAL_OUTCOMES_PENDING: 0, PROFILE_NOT_READY: 0, OOS_NOT_EVALUATED: 0,
};

/** Purely descriptive -- counts by readiness state, never a ranking or "which branch is winning" claim. */
export function summarizePairedCohorts(records: readonly PairedDecisionRecord[]): PairedCohortSummary {
  const readinessCounts = { ...EMPTY_READINESS_COUNTS };
  let pairsWithAnyRejectedCandidate = 0;
  for (const record of records) {
    readinessCounts[record.readiness] += 1;
    if (record.rejectedCandidateIds.length > 0) pairsWithAnyRejectedCandidate += 1;
  }
  return { readinessCounts, totalPairs: records.length, pairsWithAnyRejectedCandidate };
}

// ---------------------------------------------------------------------
// 7. Future outcome contract -- per-candidate real future evidence,
//    never assumed lifecycle-equivalent between CSP and Defined Risk.
// ---------------------------------------------------------------------

export type FutureOutcomeApplicability = 'APPLICABLE_PENDING' | 'APPLICABLE_OBSERVED' | 'NOT_APPLICABLE' | 'UNKNOWN';

/**
 * One real candidate's eventual future outcome. Every dollar/duration
 * field defaults `null` (UNKNOWN/pending) until real evidence populates
 * it -- this contract reserves the shape, it never fabricates a value.
 * `assignmentApplicability`/`recoveryApplicability` are reported
 * PER CANDIDATE, never assumed identical between a CSP and a spread --
 * a defined-risk spread's long leg can materially change whether
 * assignment/recovery mechanics even apply, and that depends on real
 * broker/expiration mechanics this module does not assume.
 */
export interface EntryFutureOutcomeRecord {
  readonly candidateId: string;
  readonly branch: 'THETA_CONVENTIONAL' | 'THETA_DEFINED_RISK';
  readonly wholeChainNetPnl: number | null;
  readonly returnPerCapitalDay: number | null;
  readonly profitFactorContribution: number | null;
  readonly maxDrawdown: number | null;
  readonly expectedShortfallRealized: number | null;
  readonly assignmentOccurred: boolean | null;
  readonly assignmentApplicability: FutureOutcomeApplicability;
  readonly recoveryDurationDays: number | null;
  readonly recoveryApplicability: FutureOutcomeApplicability;
  readonly tca: number | null;
  readonly totalFees: number | null;
  readonly exerciseAssignmentEffectNotes: string | null;
}

export function emptyEntryFutureOutcomeRecord(candidateId: string, branch: 'THETA_CONVENTIONAL' | 'THETA_DEFINED_RISK'): EntryFutureOutcomeRecord {
  return {
    candidateId, branch, wholeChainNetPnl: null, returnPerCapitalDay: null, profitFactorContribution: null,
    maxDrawdown: null, expectedShortfallRealized: null, assignmentOccurred: null,
    assignmentApplicability: 'UNKNOWN', recoveryDurationDays: null, recoveryApplicability: 'UNKNOWN',
    tca: null, totalFees: null, exerciseAssignmentEffectNotes: null,
  };
}
