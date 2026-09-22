/**
 * R8 Defined-Risk vs CSP paired study (directive priority #1). v2
 * (hardened). Research-only, `brokerAuthority: false`. Compares
 * `THETA_CONVENTIONAL` (bare cash-secured put) against
 * `THETA_DEFINED_RISK` (research-only put credit spread) using the v4
 * hardened common-horizon contract -- this module does NOT recompute
 * comparison maturity or Pareto logic itself; it builds real candidates
 * and delegates to `cross-strategy-common-horizon-contract.ts::compareCrossStrategy`
 * (never a second, competing comparator).
 *
 * Governing constraint: Defined Risk's contractually finite max loss
 * must NEVER be treated as automatically "safer" in expectation --
 * superior ES/EV/RPCD/drawdown/fill-quality are each a separate,
 * empirical question this module reports evidence for, never a
 * conclusion it draws. No branch is preferred anywhere in this module.
 *
 * v2 hardening, per direct user review of v1's own gaps:
 *  - CORRECTED FACT: v1's doc comments claimed Conventional (25-60 DTE)
 *    and Defined Risk (7-60 DTE) have "structurally disjoint" lattices.
 *    They do NOT -- they OVERLAP at 25-60 DTE (per the real registry,
 *    `strategy-package.ts`). Only Hold-Strike (2-5 DTE) vs. Conventional
 *    is genuinely disjoint; that fact must never be silently carried
 *    over to Defined Risk. Because the lattices overlap, this module
 *    now supports two explicitly separate study cohorts (`StudyCohort`)
 *    that must never be mixed into one undifferentiated result:
 *     - `COHORT_A_SAME_EXPIRATION`: CSP and Defined-Risk candidates
 *       constrained to a single shared `targetDte` -- isolates the
 *       economic effect of adding the protective long leg to an
 *       otherwise-comparable short put.
 *     - `COHORT_B_STRATEGY_NATIVE_LATTICE`: each branch draws from its
 *       own full allowed lattice -- answers which complete strategy
 *       POLICY performs better when each may choose its own structure.
 *  - `computePutCreditSpreadStructuralEconomics` now independently
 *    rejects a net-debit-disguised-as-credit structure AND a
 *    net-credit >= width structure (which would imply `maxLoss <= 0` --
 *    never a legitimate credit spread, always inconsistent/crossed/stale
 *    executable evidence), plus non-finite/negative strikes and quotes,
 *    a crossed leg quote (bid > ask), non-positive/non-integer
 *    quantity, and non-positive multiplier -- each classified
 *    individually rather than collapsed into one generic rejection.
 *  - Quote evidence now separates two independent concepts:
 *    `quoteSynchronizationStatus` (legs observed near EACH OTHER) and
 *    `quoteFreshnessAtDecision` (a leg observed near the DECISION
 *    moment) -- a pair of legs can be synchronized with each other
 *    while both being stale relative to the decision, and this module
 *    no longer conflates the two. Both `maxSyncAgeMs` and
 *    `maxQuoteAgeMs` are required, caller/version-supplied policy --
 *    never an invented constant.
 *  - Candidate provenance (`CandidateProvenance`) is now carried on
 *    every raw candidate and independently re-verified against the
 *    pair's `PairingKey` by `buildPairedDecisionRecord` -- a caller can
 *    no longer accidentally combine candidates from different snapshots
 *    by mislabeling a container object; a mismatch is rejected as
 *    `CANDIDATE_PAIRING_CONTEXT_MISMATCH`.
 *  - `bestByOpenCredit` renamed to `highestOpeningCredit*CandidateId` --
 *    highest premium is NOT "best structural," it is exactly what it
 *    measures. A real, transparent, unweighted structural Pareto
 *    frontier (`computeStructuralNonDominated`) is added alongside it.
 *  - `EntryFutureOutcomeRecord` no longer stores `expectedShortfallRealized`/
 *    `profitFactorContribution` as per-candidate scalars -- ES and
 *    Profit Factor are COHORT-level distributional statistics, not
 *    single-trade outcomes. The per-candidate record now holds only
 *    atomic observed quantities; `computeCohortOutcomeMetrics`
 *    aggregates a collection of resolved records into the cohort-level
 *    figures.
 *  - `DefinedRiskLegOutcomeState` represents real leg asymmetry (short
 *    assigned/long open, long exercised/sold, package close, one leg
 *    closing before the other, pin risk, etc.) -- the schema never
 *    assumes a protective long put makes assignment inapplicable by
 *    default.
 *  - Lifecycle-specific empirical fields use `EmpiricalDatum` (KNOWN/
 *    UNKNOWN/NOT_APPLICABLE), matching the v4 hardened contract, instead
 *    of a bare nullable number that could not distinguish "not yet
 *    known" from "does not apply."
 *
 * Pairing unit: same underlying, same decisionTimestamp, same
 * FusionSnapshot/PIT state, same ownershipState, same regimeState, same
 * eventState, same account/portfolio context -- NOT the same contract
 * (except within `COHORT_A_SAME_EXPIRATION`, which additionally
 * constrains both sides to one shared expiration). All real CSP and
 * Defined-Risk candidates from that decision are retained (never only
 * whichever contract a branch happened to preselect).
 */
import {
  cashSecuredPutMaxLossAtZero, compareCrossStrategy, unknownDatum,
  type CandidateComparisonInput, type ComparisonContext, type ComparisonProfile, type CrossStrategyComparisonResult,
  type EmpiricalDatum, type EmpiricalForwardEconomics,
} from './cross-strategy-common-horizon-contract.js';

export const definedRiskVsCspPairedStudyVersion = 'theta-defined-risk-vs-csp-paired-study-v2' as const;

// ---------------------------------------------------------------------
// 1. Pairing identity + provenance
// ---------------------------------------------------------------------

/**
 * The real decision-context identity two candidate sets must share to
 * be a valid pair. Deliberately NOT "same contract" in general --
 * Conventional's lattice (25-60 DTE, single PUT) and Defined Risk's
 * lattice (7-60 DTE, multi-leg) genuinely OVERLAP at 25-60 DTE, so
 * "same contract" pairing is possible for `COHORT_A_SAME_EXPIRATION`
 * but is never REQUIRED for `COHORT_B_STRATEGY_NATIVE_LATTICE`.
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

/** Structural validity of a pairing ONLY -- does not evaluate whether either side has any real candidates. */
export function validatePair(cspKey: PairingKey, definedRiskKey: PairingKey): PairValidationResult {
  if (!samePairingKey(cspKey, definedRiskKey)) return { valid: false, reason: 'PAIRING_KEY_MISMATCH' };
  return { valid: true, reason: null };
}

/** Returns the shared key when both sides genuinely share one, `null` otherwise. */
export function pairDecisionContexts(cspKey: PairingKey, definedRiskKey: PairingKey): PairingKey | null {
  return samePairingKey(cspKey, definedRiskKey) ? cspKey : null;
}

/**
 * Two explicitly different study cohorts -- their results must NEVER be
 * mixed into one undifferentiated set (see the module doc comment).
 */
export type StudyCohort = 'COHORT_A_SAME_EXPIRATION' | 'COHORT_B_STRATEGY_NATIVE_LATTICE';

/**
 * Immutable provenance every raw candidate carries, independently
 * re-verified against the pair's `PairingKey` -- proves a candidate
 * actually belongs to the decision it claims to, rather than trusting
 * the caller's container grouping.
 */
export interface CandidateProvenance {
  readonly decisionTimestamp: string;
  readonly fusionSnapshotId: string;
  readonly accountContextId: string;
  readonly ownershipState: string;
  readonly regimeState: string | null;
  readonly eventState: string;
  readonly underlying: string;
  readonly sourceEvidenceIds: readonly string[];
}

export function provenanceMatchesPairingKey(provenance: CandidateProvenance, key: PairingKey): boolean {
  return provenance.decisionTimestamp === key.decisionTimestamp && provenance.fusionSnapshotId === key.fusionSnapshotId
    && provenance.accountContextId === key.accountContextId && provenance.ownershipState === key.ownershipState
    && provenance.regimeState === key.regimeState && provenance.eventState === key.eventState
    && provenance.underlying === key.underlying;
}

// ---------------------------------------------------------------------
// 2. Defined-Risk (put credit spread) structural economics -- independently
//    re-derived and unit-tested here, never assumed equal to any other
//    module's formula. Every invalid/inconsistent structure is
//    classified individually and REJECTED, never normalized.
// ---------------------------------------------------------------------

export type PutCreditSpreadStructuralClassification =
  | 'VALID_CREDIT_SPREAD'
  | 'MISSING_STRIKES'
  | 'NON_FINITE_STRIKE'
  | 'NEGATIVE_STRIKE'
  | 'INVERTED_STRIKES'
  | 'ZERO_WIDTH_SPREAD'
  | 'MISSING_EXECUTABLE_QUOTE'
  | 'NON_FINITE_QUOTE'
  | 'NEGATIVE_QUOTE'
  | 'CROSSED_LEG_QUOTE'
  | 'MISSING_MULTIPLIER_OR_QUANTITY'
  | 'NON_POSITIVE_MULTIPLIER'
  | 'NON_POSITIVE_QUANTITY'
  | 'NON_INTEGER_QUANTITY'
  | 'MISMATCHED_MULTIPLIERS'
  | 'NEGATIVE_OR_ZERO_NET_CREDIT'
  | 'NET_CREDIT_EXCEEDS_OR_EQUALS_WIDTH';

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
  /** Guaranteed strictly positive whenever `classification === 'VALID_CREDIT_SPREAD'` -- `netCredit >= width` is rejected as `NET_CREDIT_EXCEEDS_OR_EQUALS_WIDTH` precisely to guarantee this. */
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
 * `maxLoss` is NEVER allowed to be non-positive: a `netCredit >= width`
 * reading implies inconsistent/crossed/stale executable evidence, not a
 * legitimate ordinary credit spread, and is rejected as
 * `NET_CREDIT_EXCEEDS_OR_EQUALS_WIDTH`.
 */
export function computePutCreditSpreadStructuralEconomics(inputs: PutCreditSpreadStructuralInputs): PutCreditSpreadStructuralEconomics {
  const { shortStrike, longStrike, shortLeg, longLeg, quantity } = inputs;

  if (shortStrike === null || longStrike === null) return invalidStructuralEconomics('MISSING_STRIKES');
  if (!Number.isFinite(shortStrike) || !Number.isFinite(longStrike)) return invalidStructuralEconomics('NON_FINITE_STRIKE');
  if (shortStrike < 0 || longStrike < 0) return invalidStructuralEconomics('NEGATIVE_STRIKE');

  const width = shortStrike - longStrike;
  if (width < 0) return invalidStructuralEconomics('INVERTED_STRIKES');
  if (width === 0) return invalidStructuralEconomics('ZERO_WIDTH_SPREAD');

  if (shortLeg.bid === null || shortLeg.ask === null || longLeg.bid === null || longLeg.ask === null) {
    return invalidStructuralEconomics('MISSING_EXECUTABLE_QUOTE');
  }
  const quoteValues = [shortLeg.bid, shortLeg.ask, longLeg.bid, longLeg.ask];
  if (!quoteValues.every((v) => Number.isFinite(v))) return invalidStructuralEconomics('NON_FINITE_QUOTE');
  if (quoteValues.some((v) => v < 0)) return invalidStructuralEconomics('NEGATIVE_QUOTE');
  if (shortLeg.bid > shortLeg.ask || longLeg.bid > longLeg.ask) return invalidStructuralEconomics('CROSSED_LEG_QUOTE');

  if (shortLeg.multiplier === null || longLeg.multiplier === null || quantity === null) return invalidStructuralEconomics('MISSING_MULTIPLIER_OR_QUANTITY');
  if (shortLeg.multiplier <= 0 || longLeg.multiplier <= 0) return invalidStructuralEconomics('NON_POSITIVE_MULTIPLIER');
  if (quantity <= 0) return invalidStructuralEconomics('NON_POSITIVE_QUANTITY');
  if (!Number.isInteger(quantity)) return invalidStructuralEconomics('NON_INTEGER_QUANTITY');
  if (shortLeg.multiplier !== longLeg.multiplier) return invalidStructuralEconomics('MISMATCHED_MULTIPLIERS');
  const multiplier = shortLeg.multiplier;

  const openingNetCreditPerShare = shortLeg.bid - longLeg.ask;
  if (openingNetCreditPerShare <= 0) return invalidStructuralEconomics('NEGATIVE_OR_ZERO_NET_CREDIT');
  if (openingNetCreditPerShare >= width) return invalidStructuralEconomics('NET_CREDIT_EXCEEDS_OR_EQUALS_WIDTH');

  const maxProfit = openingNetCreditPerShare * multiplier * quantity;
  const maxLoss = (width - openingNetCreditPerShare) * multiplier * quantity;
  return { classification: 'VALID_CREDIT_SPREAD', openingNetCreditPerShare, width, maxProfit, maxLoss, multiplier, quantity };
}

// ---------------------------------------------------------------------
// 3. Multi-leg vs single-leg execution burden: synchronization AND
//    decision-time freshness are independent concepts.
// ---------------------------------------------------------------------

export type QuoteSynchronizationStatus = 'SYNCHRONIZED' | 'DESYNCHRONIZED' | 'TIMESTAMP_UNKNOWN';

export interface QuoteSynchronizationEvidence {
  readonly status: QuoteSynchronizationStatus;
  readonly ageMs: number | null;
}

/** `maxSyncAgeMs` is REQUIRED and caller-supplied -- proves only that two legs were observed near EACH OTHER, never that either is fresh relative to the decision. */
export function quoteSynchronizationStatus(
  shortLegTimestamp: string | null, longLegTimestamp: string | null, maxSyncAgeMs: number,
): QuoteSynchronizationEvidence {
  if (shortLegTimestamp === null || longLegTimestamp === null) return { status: 'TIMESTAMP_UNKNOWN', ageMs: null };
  const ageMs = Math.abs(new Date(shortLegTimestamp).getTime() - new Date(longLegTimestamp).getTime());
  return { status: ageMs <= maxSyncAgeMs ? 'SYNCHRONIZED' : 'DESYNCHRONIZED', ageMs };
}

export type QuoteFreshnessStatus = 'FRESH' | 'STALE' | 'FUTURE_TIMESTAMP' | 'TIMESTAMP_UNKNOWN';

export interface QuoteFreshnessEvidence {
  readonly status: QuoteFreshnessStatus;
  readonly quoteAgeAtDecisionMs: number | null;
}

/** `maxQuoteAgeMs` is REQUIRED and caller-supplied -- proves a quote is fresh relative to `decisionTimestamp`, independent of synchronization with any other leg. A quote observed AFTER the decision (a PIT violation) is `FUTURE_TIMESTAMP`, never silently treated as fresh. */
export function quoteFreshnessAtDecision(quoteTimestamp: string | null, decisionTimestamp: string, maxQuoteAgeMs: number): QuoteFreshnessEvidence {
  if (quoteTimestamp === null) return { status: 'TIMESTAMP_UNKNOWN', quoteAgeAtDecisionMs: null };
  const ageMs = new Date(decisionTimestamp).getTime() - new Date(quoteTimestamp).getTime();
  if (ageMs < 0) return { status: 'FUTURE_TIMESTAMP', quoteAgeAtDecisionMs: ageMs };
  return { status: ageMs <= maxQuoteAgeMs ? 'FRESH' : 'STALE', quoteAgeAtDecisionMs: ageMs };
}

/** Structure-level combined quote state for a two-leg spread -- distinguishes synchronization from freshness rather than collapsing them into one status. */
export type SpreadQuoteState = 'BOTH_FRESH_AND_SYNCHRONIZED' | 'FRESH_BUT_DESYNCHRONIZED' | 'STALE' | 'TIMESTAMP_UNKNOWN' | 'FUTURE_TIMESTAMP';

function combineSpreadQuoteState(shortFreshness: QuoteFreshnessEvidence, longFreshness: QuoteFreshnessEvidence, sync: QuoteSynchronizationEvidence): SpreadQuoteState {
  if (shortFreshness.status === 'TIMESTAMP_UNKNOWN' || longFreshness.status === 'TIMESTAMP_UNKNOWN' || sync.status === 'TIMESTAMP_UNKNOWN') return 'TIMESTAMP_UNKNOWN';
  if (shortFreshness.status === 'FUTURE_TIMESTAMP' || longFreshness.status === 'FUTURE_TIMESTAMP') return 'FUTURE_TIMESTAMP';
  if (shortFreshness.status === 'STALE' || longFreshness.status === 'STALE') return 'STALE';
  return sync.status === 'SYNCHRONIZED' ? 'BOTH_FRESH_AND_SYNCHRONIZED' : 'FRESH_BUT_DESYNCHRONIZED';
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
  readonly freshness: QuoteFreshnessEvidence;
}

export interface SpreadExecutionBurdenEvidence {
  readonly shortLeg: LegExecutionEvidence;
  readonly longLeg: LegExecutionEvidence;
  readonly combinedNetCredit: number | null;
  /** Half-spread cost estimate summed across both legs -- a real, documented estimation convention, never presented as an executed fill. */
  readonly combinedExecutionCostEstimatePerShare: number | null;
  readonly quoteSynchronization: QuoteSynchronizationEvidence;
  readonly quoteState: SpreadQuoteState;
}

export function buildSpreadExecutionBurdenEvidence(
  shortLegId: string, shortLeg: SpreadLegQuote, longLegId: string, longLeg: SpreadLegQuote,
  decisionTimestamp: string, maxSyncAgeMs: number, maxQuoteAgeMs: number,
): SpreadExecutionBurdenEvidence {
  const shortSpread = legSpread(shortLeg.bid, shortLeg.ask);
  const longSpread = legSpread(longLeg.bid, longLeg.ask);
  const combinedNetCredit = shortLeg.bid !== null && longLeg.ask !== null ? shortLeg.bid - longLeg.ask : null;
  const combinedExecutionCostEstimatePerShare = shortSpread !== null && longSpread !== null ? (shortSpread + longSpread) / 2 : null;
  const shortFreshness = quoteFreshnessAtDecision(shortLeg.quoteTimestamp, decisionTimestamp, maxQuoteAgeMs);
  const longFreshness = quoteFreshnessAtDecision(longLeg.quoteTimestamp, decisionTimestamp, maxQuoteAgeMs);
  const quoteSynchronization = quoteSynchronizationStatus(shortLeg.quoteTimestamp, longLeg.quoteTimestamp, maxSyncAgeMs);
  return {
    shortLeg: { legId: shortLegId, bid: shortLeg.bid, ask: shortLeg.ask, quoteTimestamp: shortLeg.quoteTimestamp, spread: shortSpread, freshness: shortFreshness },
    longLeg: { legId: longLegId, bid: longLeg.bid, ask: longLeg.ask, quoteTimestamp: longLeg.quoteTimestamp, spread: longSpread, freshness: longFreshness },
    combinedNetCredit, combinedExecutionCostEstimatePerShare, quoteSynchronization,
    quoteState: combineSpreadQuoteState(shortFreshness, longFreshness, quoteSynchronization),
  };
}

// ---------------------------------------------------------------------
// 4. Candidate builders -- project real raw evidence into the hardened
//    common-horizon contract's CandidateComparisonInput.
// ---------------------------------------------------------------------

function unmodeledLifecycleEmpirical(): EmpiricalForwardEconomics {
  return {
    expectedAfterCostWholeChainPnl: null, probabilityProfitable: null,
    probabilityAssignment: unknownDatum('NOT_YET_MODELED_AT_STRUCTURAL_STAGE'),
    expectedAssignmentBurden: unknownDatum('NOT_YET_MODELED_AT_STRUCTURAL_STAGE'),
    expectedRecoveryDuration: unknownDatum('NOT_YET_MODELED_AT_STRUCTURAL_STAGE'),
    expectedCapitalDays: null, expectedShortfall: null, cvar: null, maxDrawdown: null,
    concentrationImpact: null, expectedTca: null, calibratedUncertainty: null,
  };
}

export type StudyCandidateBuildResult =
  | { readonly status: 'BUILT'; readonly candidate: CandidateComparisonInput }
  | { readonly status: 'REJECTED'; readonly candidateId: string; readonly reason: string };

export interface CspCandidateRawEvidence {
  readonly candidateId: string;
  readonly provenance: CandidateProvenance;
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
  readonly maxQuoteAgeMs: number;
}

export interface CspCandidateBuildResult {
  readonly result: StudyCandidateBuildResult;
  readonly quoteFreshness: QuoteFreshnessEvidence;
}

export function buildCspStudyCandidate(evidence: CspCandidateRawEvidence, context: ComparisonContext): CspCandidateBuildResult {
  const quoteFreshness = quoteFreshnessAtDecision(evidence.quoteTimestamp, context.decisionTimestamp, evidence.maxQuoteAgeMs);
  const reject = (reason: string): CspCandidateBuildResult => ({ result: { status: 'REJECTED', candidateId: evidence.candidateId, reason }, quoteFreshness });

  if (evidence.strike === null) return reject('MISSING_STRIKE');
  if (evidence.bid === null) return reject('MISSING_EXECUTABLE_QUOTE');
  if (evidence.multiplier === null || evidence.quantity === null) return reject('MISSING_MULTIPLIER_OR_QUANTITY');
  if (evidence.multiplier <= 0) return reject('NON_POSITIVE_MULTIPLIER');
  if (evidence.quantity <= 0) return reject('NON_POSITIVE_QUANTITY');

  const maxLoss = cashSecuredPutMaxLossAtZero(evidence.strike, evidence.bid, evidence.multiplier, evidence.quantity);
  const bidAskSpread = legSpread(evidence.bid, evidence.ask);
  const estimatedEntryExecutionCost = bidAskSpread === null ? null : (bidAskSpread / 2) * evidence.multiplier * evidence.quantity;

  return {
    quoteFreshness,
    result: {
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
        empirical: unmodeledLifecycleEmpirical(),
      },
    },
  };
}

export interface DefinedRiskCandidateRawEvidence {
  readonly candidateId: string;
  readonly provenance: CandidateProvenance;
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
  readonly maxQuoteAgeMs: number;
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
    `${evidence.candidateId}:short`, evidence.shortLeg, `${evidence.candidateId}:long`, evidence.longLeg,
    context.decisionTimestamp, evidence.maxSyncAgeMs, evidence.maxQuoteAgeMs,
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
        empirical: unmodeledLifecycleEmpirical(),
      },
    },
    structuralEconomics, executionBurden,
  };
}

// ---------------------------------------------------------------------
// 5. Structural (non-economic-maturity) ranking helpers -- transparent,
//    unweighted. "Highest opening credit" is exactly what it measures,
//    never presented as "best."
// ---------------------------------------------------------------------

function highestOpeningCredit(built: readonly CandidateComparisonInput[]): string | null {
  const withCredit = built.filter((c) => c.deterministic.executableOpenCreditDebit !== null);
  if (withCredit.length === 0) return null;
  return withCredit.reduce((best, c) => (c.deterministic.executableOpenCreditDebit as number) > (best.deterministic.executableOpenCreditDebit as number) ? c : best).candidateId;
}

/**
 * A real, transparent, UNWEIGHTED structural Pareto frontier over:
 * opening credit (MAX), max loss (MIN), capital requirement (MIN),
 * downside cushion (MAX), estimated entry execution cost (MIN). Only
 * candidates with ALL FIVE dimensions known participate; a candidate
 * missing any dimension is excluded from the frontier (never assigned
 * an invented value to force participation).
 */
export function computeStructuralNonDominated(built: readonly CandidateComparisonInput[]): readonly string[] {
  const eligible = built.filter((c) => {
    const d = c.deterministic;
    return d.executableOpenCreditDebit !== null && d.maxLoss !== null && d.capitalRequirement !== null
      && d.downsideCushion !== null && d.estimatedEntryExecutionCost !== null;
  });
  const vectors = eligible.map((c) => ({
    id: c.candidateId,
    vector: [
      c.deterministic.executableOpenCreditDebit as number, -(c.deterministic.maxLoss as number),
      -(c.deterministic.capitalRequirement as number), c.deterministic.downsideCushion as number,
      -(c.deterministic.estimatedEntryExecutionCost as number),
    ],
  }));
  const dominates = (a: readonly number[], b: readonly number[]): boolean =>
    a.every((v, i) => v >= (b[i] as number)) && a.some((v, i) => v > (b[i] as number));
  return vectors.filter((c) => !vectors.some((other) => other.id !== c.id && dominates(other.vector, c.vector))).map((c) => c.id);
}

// ---------------------------------------------------------------------
// 6. Paired study record + readiness classification (delegates to the
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
 * is ever fit or out-of-sample-validated here.
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
  readonly cohort: StudyCohort;
  /** REQUIRED and used only when `cohort === 'COHORT_A_SAME_EXPIRATION'` -- the single DTE every retained candidate on both sides must share. */
  readonly targetDte: number | null;
  readonly cspCandidates: readonly CspCandidateRawEvidence[];
  readonly definedRiskCandidates: readonly DefinedRiskCandidateRawEvidence[];
}

export interface PairedDecisionRecord {
  readonly pairingKey: PairingKey;
  readonly cohort: StudyCohort;
  readonly cspBuildResults: readonly StudyCandidateBuildResult[];
  readonly definedRiskBuildResults: readonly StudyCandidateBuildResult[];
  readonly highestOpeningCreditCspCandidateId: string | null;
  readonly highestOpeningCreditDefinedRiskCandidateId: string | null;
  readonly structuralNonDominatedCandidateIds: readonly string[];
  readonly rejectedCandidateIds: readonly string[];
  readonly missingEvidenceReasons: readonly string[];
  readonly comparison: CrossStrategyComparisonResult | null;
  readonly readiness: PairedStudyReadiness;
}

function builtOf(results: readonly StudyCandidateBuildResult[]): readonly CandidateComparisonInput[] {
  return results.filter((r): r is Extract<StudyCandidateBuildResult, { status: 'BUILT' }> => r.status === 'BUILT').map((r) => r.candidate);
}

/**
 * Builds one full paired-decision record. Every raw candidate's
 * `provenance` is independently re-verified against `input.pairingKey`
 * BEFORE it is built -- a mismatch is rejected as
 * `CANDIDATE_PAIRING_CONTEXT_MISMATCH`, never trusted merely because it
 * appeared inside this container. For `COHORT_A_SAME_EXPIRATION`, a
 * built candidate whose `dte` differs from `targetDte` is additionally
 * rejected as `COHORT_A_EXPIRATION_MISMATCH` -- COHORT_A and COHORT_B
 * results must never be mixed into one undifferentiated set.
 */
export function buildPairedDecisionRecord(input: PairedDecisionRawInput, context: ComparisonContext, profile: ComparisonProfile): PairedDecisionRecord {
  if (input.cohort === 'COHORT_A_SAME_EXPIRATION' && input.targetDte === null) {
    throw new Error('COHORT_A_SAME_EXPIRATION_REQUIRES_A_TARGET_DTE');
  }

  const cspResults: StudyCandidateBuildResult[] = input.cspCandidates.map((c) => {
    if (!provenanceMatchesPairingKey(c.provenance, input.pairingKey)) {
      return { status: 'REJECTED', candidateId: c.candidateId, reason: 'CANDIDATE_PAIRING_CONTEXT_MISMATCH' };
    }
    const built = buildCspStudyCandidate(c, context).result;
    if (built.status === 'BUILT' && input.cohort === 'COHORT_A_SAME_EXPIRATION' && built.candidate.deterministic.dte !== input.targetDte) {
      return { status: 'REJECTED', candidateId: c.candidateId, reason: 'COHORT_A_EXPIRATION_MISMATCH' };
    }
    return built;
  });

  const definedRiskResults: StudyCandidateBuildResult[] = input.definedRiskCandidates.map((c) => {
    if (!provenanceMatchesPairingKey(c.provenance, input.pairingKey)) {
      return { status: 'REJECTED', candidateId: c.candidateId, reason: 'CANDIDATE_PAIRING_CONTEXT_MISMATCH' };
    }
    const built = buildDefinedRiskStudyCandidate(c, context).result;
    if (built.status === 'BUILT' && input.cohort === 'COHORT_A_SAME_EXPIRATION' && built.candidate.deterministic.dte !== input.targetDte) {
      return { status: 'REJECTED', candidateId: c.candidateId, reason: 'COHORT_A_EXPIRATION_MISMATCH' };
    }
    return built;
  });

  const builtCsp = builtOf(cspResults);
  const builtDefinedRisk = builtOf(definedRiskResults);
  const allBuilt = [...builtCsp, ...builtDefinedRisk];

  const rejectedCandidateIds = [...cspResults, ...definedRiskResults]
    .filter((r): r is Extract<StudyCandidateBuildResult, { status: 'REJECTED' }> => r.status === 'REJECTED').map((r) => r.candidateId);
  const missingEvidenceReasons = [...new Set(
    [...cspResults, ...definedRiskResults].filter((r): r is Extract<StudyCandidateBuildResult, { status: 'REJECTED' }> => r.status === 'REJECTED').map((r) => r.reason),
  )];

  const comparison = allBuilt.length === 0 ? null : compareCrossStrategy(allBuilt, profile);
  const readiness = comparison === null ? 'STRUCTURAL_PAIR_NOT_READY' : classifyComparisonReadiness(comparison);

  return {
    pairingKey: input.pairingKey, cohort: input.cohort, cspBuildResults: cspResults, definedRiskBuildResults: definedRiskResults,
    highestOpeningCreditCspCandidateId: highestOpeningCredit(builtCsp),
    highestOpeningCreditDefinedRiskCandidateId: highestOpeningCredit(builtDefinedRisk),
    structuralNonDominatedCandidateIds: computeStructuralNonDominated(allBuilt),
    rejectedCandidateIds, missingEvidenceReasons, comparison, readiness,
  };
}

// ---------------------------------------------------------------------
// 7. Descriptive cohort summary -- no verdict, no preferred branch.
//    COHORT_A and COHORT_B records must be summarized separately by
//    the caller (this function does not merge across `cohort`).
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
// 8. Future outcome contract -- atomic per-candidate observed
//    quantities only; ES/Profit Factor are computed at COHORT level.
//    Defined-Risk leg asymmetry is represented explicitly, never
//    defaulted to "assignment does not apply."
// ---------------------------------------------------------------------

export type DefinedRiskLegOutcomeState =
  | 'NOT_APPLICABLE_SINGLE_LEG'
  | 'BOTH_LEGS_OPEN'
  | 'SHORT_LEG_ASSIGNED_LONG_LEG_OPEN'
  | 'SHORT_LEG_ASSIGNED_LONG_LEG_EXERCISED'
  | 'SHORT_LEG_ASSIGNED_LONG_LEG_SOLD'
  | 'SPREAD_CLOSED_AS_PACKAGE'
  | 'ONE_LEG_CLOSED_EARLY_OTHER_OPEN'
  | 'EXPIRED_ITM_BOTH_LEGS'
  | 'EXPIRED_BETWEEN_STRIKES'
  | 'PIN_RISK_EXPIRATION_UNCERTAIN'
  | 'BROKER_EXERCISE_ASSIGNMENT_PENDING_CONFIRMATION'
  | 'UNKNOWN';

/**
 * One real candidate's eventual future outcome, expressed as ATOMIC
 * observed quantities only -- `ExpectedShortfall`/`CVaR`/`ProfitFactor`/
 * `MaxDrawdown` are distribution/cohort-level statistics and are
 * DELIBERATELY absent here; see `computeCohortOutcomeMetrics`. Every
 * field defaults `null`/`UNKNOWN` until real evidence populates it.
 * `legOutcomeState` is `'NOT_APPLICABLE_SINGLE_LEG'` for a CSP and
 * `'UNKNOWN'` (never a default assumption of no-assignment) for a
 * freshly-opened Defined-Risk candidate.
 */
export interface EntryFutureOutcomeRecord {
  readonly candidateId: string;
  readonly branch: 'THETA_CONVENTIONAL' | 'THETA_DEFINED_RISK';
  readonly wholeChainNetPnl: number | null;
  readonly grossProfitComponent: number | null;
  readonly grossLossComponent: number | null;
  readonly capitalDays: number | null;
  readonly returnPerCapitalDay: number | null;
  readonly maxAdverseExcursion: number | null;
  readonly maxFavorableExcursion: number | null;
  readonly realizedTca: number | null;
  readonly totalFees: number | null;
  readonly assignmentOccurred: boolean | null;
  readonly assignmentApplicability: EmpiricalDatum<boolean>;
  readonly recoveryDurationDays: number | null;
  readonly recoveryApplicability: EmpiricalDatum<number>;
  readonly legOutcomeState: DefinedRiskLegOutcomeState;
}

export function emptyEntryFutureOutcomeRecord(candidateId: string, branch: 'THETA_CONVENTIONAL' | 'THETA_DEFINED_RISK'): EntryFutureOutcomeRecord {
  return {
    candidateId, branch, wholeChainNetPnl: null, grossProfitComponent: null, grossLossComponent: null,
    capitalDays: null, returnPerCapitalDay: null, maxAdverseExcursion: null, maxFavorableExcursion: null,
    realizedTca: null, totalFees: null, assignmentOccurred: null,
    assignmentApplicability: unknownDatum('OUTCOME_NOT_YET_RESOLVED'),
    recoveryDurationDays: null, recoveryApplicability: unknownDatum('OUTCOME_NOT_YET_RESOLVED'),
    legOutcomeState: branch === 'THETA_CONVENTIONAL' ? 'NOT_APPLICABLE_SINGLE_LEG' : 'UNKNOWN',
  };
}

export interface CohortOutcomeMetrics {
  readonly resolvedCount: number;
  readonly profitFactor: number | null;
  readonly expectedShortfall: number | null;
  readonly maxDrawdown: number | null;
}

/**
 * Aggregates a collection of RESOLVED (`wholeChainNetPnl !== null`)
 * atomic records into cohort-level distributional statistics.
 * `ProfitFactor = grossProfitComponent(sum) / abs(grossLossComponent(sum))`;
 * `ExpectedShortfall` here is the mean of the worst
 * `tailFraction`-share of outcomes (a real, documented convention, not
 * an invented figure) -- `tailFraction` is caller-supplied, never a
 * hidden default. Returns `null` fields when fewer than 1 resolved
 * record exists, or (for `expectedShortfall`) when the tail sample
 * would be empty.
 */
export function computeCohortOutcomeMetrics(records: readonly EntryFutureOutcomeRecord[], tailFraction: number): CohortOutcomeMetrics {
  const resolved = records.filter((r) => r.wholeChainNetPnl !== null);
  if (resolved.length === 0) return { resolvedCount: 0, profitFactor: null, expectedShortfall: null, maxDrawdown: null };

  const grossProfitSum = resolved.reduce((sum, r) => sum + Math.max(0, r.grossProfitComponent ?? 0), 0);
  const grossLossSum = resolved.reduce((sum, r) => sum + Math.abs(Math.min(0, r.grossLossComponent ?? 0)), 0);
  const profitFactor = grossLossSum === 0 ? null : grossProfitSum / grossLossSum;

  const sortedPnl = resolved.map((r) => r.wholeChainNetPnl as number).sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.floor(sortedPnl.length * tailFraction));
  const tailSlice = sortedPnl.slice(0, Math.min(tailCount, sortedPnl.length));
  const expectedShortfall = tailSlice.length === 0 ? null : tailSlice.reduce((sum, v) => sum + v, 0) / tailSlice.length;

  const maeValues = resolved.map((r) => r.maxAdverseExcursion).filter((v): v is number => v !== null);
  const maxDrawdown = maeValues.length === 0 ? null : Math.min(...maeValues);

  return { resolvedCount: resolved.length, profitFactor, expectedShortfall, maxDrawdown };
}
