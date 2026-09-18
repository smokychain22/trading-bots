import { computeWholeChainPnl, type WholeChainComponents } from './whole-chain-economics.js';
import { eventRiskPenaltyContribution, isEventRiskUnknown, type EventRiskState } from './event-risk-state.js';

export const coveredCallLatticeVersion = 'theta-covered-call-lattice-v2' as const;

/**
 * Evaluates ALTERNATIVE covered-call candidates (never blindly picks the
 * highest-premium one) on whole-chain economics. This module consumes an
 * already-identified list of candidates -- it does not enumerate a
 * contract lattice itself, matching the same boundary as
 * roll-incremental-utility.ts: contract discovery belongs to the
 * strategy-router/execution domain, comparison belongs here.
 *
 * Pipeline (the directive's required shape):
 *   CANDIDATES -> HARD FEASIBILITY (`selectableCoveredCallCandidates`)
 *   -> PARETO / NONDOMINATED SET (`nondominatedCoveredCallCandidates`)
 *   -> VERSIONED UTILITY (`computeCoveredCallUtility`, whose result carries
 *      `weightsProvenance` + this module's own `coveredCallLatticeVersion`)
 *   -> BEST CANDIDATE (`bestCoveredCallCandidate`).
 */
export interface CoveredCallCandidate {
  readonly symbol: string;
  readonly optionContractId: string;
  readonly strike: number;
  readonly expiration: string;
  readonly delta: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly multiplier: number;
  readonly quantity: number;
  readonly openInterest: number | null;
  readonly volume: number | null;
  readonly dividendExDateRisk: EventRiskState;
  readonly eventRisk: EventRiskState;
}

export interface CoveredCallAssessment {
  readonly candidate: CoveredCallCandidate;
  /**
   * The CONSERVATIVE, executable premium reference -- computed from the
   * BID side (what a seller could actually expect to receive posting at
   * or near the bid), never the midpoint. This is the value fed into
   * `computeCoveredCallUtility`/`wholeChainPnlIfCalledAway`/
   * `wholeChainPnlIfNotCalled` -- i.e., the only value this module treats
   * as "deterministic economics" for ranking/selection purposes. It is
   * still NOT a realized fill -- BROKER ACTUAL FILL remains the only
   * truth for whole-chain accounting once a real order exists; this is
   * the pre-fill reference used to decide WHETHER to act.
   */
  readonly premiumIncomeDollars: number | null;
  /**
   * The midpoint premium ((bid+ask)/2) -- an ANALYTICAL/research
   * reference only. Never fed into utility, ranking, or whole-chain P&L.
   * Exists so a reviewer can see the gap between "what mid suggests" and
   * "what this module conservatively assumes is actually executable."
   */
  readonly midReferenceDollars: number | null;
  readonly callAwayPriceDollars: number | null;
  /** Only computed when the caller supplies a reference upside price
   * (e.g. a target the operator names) -- this module has no price
   * forecast of its own, so this stays null (never fabricated) otherwise. */
  readonly upsideSacrificedDollars: number | null;
  readonly wholeChainPnlIfCalledAway: number | null;
  readonly wholeChainPnlIfNotCalled: number | null;
  readonly belowBasis: boolean;
  readonly spreadDollars: number | null;
  readonly utility: CoveredCallUtilityResult;
  readonly reasons: readonly string[];
}

/**
 * Provenance metadata for the weight configuration actually used to score
 * a candidate. Required on every `CoveredCallUtilityWeights` -- a non-zero
 * production weight must always be traceable to WHICH policy version,
 * WHICH configuration, and WHY it was set, never a bare magic number with
 * no history. This adds domain-type metadata only; it does not require a
 * database migration or persistence layer.
 */
export interface CoveredCallWeightProvenance {
  readonly policyVersion: string;
  readonly configurationId: string;
  readonly effectiveVersion: string;
  readonly sourceReason: string;
}

export const BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE: CoveredCallWeightProvenance = {
  policyVersion: coveredCallLatticeVersion, configurationId: 'BOOTSTRAP_DEFAULT_ALL_ZERO',
  effectiveVersion: coveredCallLatticeVersion, sourceReason: 'NO_CALLER_JUSTIFIED_WEIGHTS_SUPPLIED_NEUTRAL_DEFAULT',
};

/**
 * Every weight is caller-supplied and caller-justified -- never invented
 * internally. A weight of 0 is valid (that penalty term ignored entirely)
 * if the caller has justified that choice. This is a MULTI-FACTOR utility,
 * never a "highest premium wins" rule: a lower-premium, farther-OTM,
 * tighter-spread, no-event-risk candidate can and should outrank a
 * high-premium, near-the-money, wide-spread, event-risk candidate.
 */
export interface CoveredCallUtilityWeights {
  readonly upsideSacrificePerDollarWeight: number;
  readonly spreadPerDollarWeight: number;
  readonly eventRiskPenalty: number;
  readonly dividendExDateRiskPenalty: number;
  readonly belowBasisPenalty: number;
  readonly provenance: CoveredCallWeightProvenance;
}

export interface CoveredCallUtilityResult {
  readonly utility: number | null;
  readonly knownComponents: readonly string[];
  readonly unknownComponents: readonly string[];
  readonly reasons: readonly string[];
  readonly weightsProvenance: CoveredCallWeightProvenance;
  readonly utilityVersion: typeof coveredCallLatticeVersion;
}

/**
 * CCUtility = premiumIncome
 *   - upsideSacrificePerDollarWeight * upsideSacrificed   (if known)
 *   - spreadPerDollarWeight * spread                      (execution-risk proxy)
 *   - eventRiskPenalty                                    (only when eventRisk === PRESENT)
 *   - dividendExDateRiskPenalty                            (only when dividendExDateRisk === PRESENT)
 *   - belowBasisPenalty                                   (if below basis)
 *
 * A tri-state risk of UNKNOWN never silently applies the penalty (that
 * would be fabricating a known-present risk) but also never behaves like
 * a confirmed-absent risk -- it is named explicitly in `reasons` as an
 * uncertainty signal so "we don't know" is never read as "it's safe."
 *
 * Every OTHER factor named in the wider CCUtility concept
 * (capital-release benefit, recovery benefit, call-away-regret, tail risk,
 * a real call-away-probability proxy, execution uncertainty beyond spread)
 * has no data source in this codebase yet and is NEVER fabricated here --
 * `unknownComponents` names each one explicitly so a reviewer or a future
 * richer model knows exactly what this deterministic version does not yet
 * account for. `utility` itself is null (not rankable) only when the core
 * premium income is unknown -- every other component degrades gracefully
 * by simply not contributing, never by blocking the whole computation.
 */
export function computeCoveredCallUtility(
  assessment: Pick<CoveredCallAssessment, 'premiumIncomeDollars' | 'upsideSacrificedDollars' | 'spreadDollars' | 'belowBasis'>
    & { readonly eventRisk: EventRiskState; readonly dividendExDateRisk: EventRiskState },
  weights: CoveredCallUtilityWeights,
): CoveredCallUtilityResult {
  const knownComponents: string[] = [];
  const unknownComponents: string[] = ['capitalReleaseBenefit', 'recoveryBenefit', 'callAwayProbabilityProxy', 'tailRisk', 'executionUncertaintyBeyondSpread'];
  const reasons: string[] = [];
  if (assessment.premiumIncomeDollars === null) {
    return {
      utility: null, knownComponents, unknownComponents, reasons: ['PREMIUM_UNKNOWN_CANNOT_RANK'],
      weightsProvenance: weights.provenance, utilityVersion: coveredCallLatticeVersion,
    };
  }
  let utility = assessment.premiumIncomeDollars;
  knownComponents.push('premiumIncomeDollars');
  reasons.push(`PREMIUM_${assessment.premiumIncomeDollars.toFixed(2)}`);

  if (assessment.upsideSacrificedDollars !== null) {
    utility -= weights.upsideSacrificePerDollarWeight * assessment.upsideSacrificedDollars;
    knownComponents.push('upsideSacrificedDollars');
    reasons.push(`UPSIDE_SACRIFICE_PENALTY_${(weights.upsideSacrificePerDollarWeight * assessment.upsideSacrificedDollars).toFixed(2)}`);
  } else unknownComponents.push('upsideSacrificedDollars');

  if (assessment.spreadDollars !== null) {
    utility -= weights.spreadPerDollarWeight * assessment.spreadDollars;
    knownComponents.push('spreadDollars');
    reasons.push(`SPREAD_PENALTY_${(weights.spreadPerDollarWeight * assessment.spreadDollars).toFixed(2)}`);
  } else unknownComponents.push('spreadDollars');

  utility -= eventRiskPenaltyContribution(assessment.eventRisk, weights.eventRiskPenalty);
  if (assessment.eventRisk === 'PRESENT') reasons.push(`EVENT_RISK_PENALTY_${weights.eventRiskPenalty.toFixed(2)}`);
  else if (isEventRiskUnknown(assessment.eventRisk)) reasons.push('EVENT_RISK_UNKNOWN_NOT_TREATED_AS_SAFE');
  else reasons.push('EVENT_RISK_ABSENT_VERIFIED');

  utility -= eventRiskPenaltyContribution(assessment.dividendExDateRisk, weights.dividendExDateRiskPenalty);
  if (assessment.dividendExDateRisk === 'PRESENT') reasons.push(`EX_DATE_RISK_PENALTY_${weights.dividendExDateRiskPenalty.toFixed(2)}`);
  else if (isEventRiskUnknown(assessment.dividendExDateRisk)) reasons.push('EX_DATE_RISK_UNKNOWN_NOT_TREATED_AS_SAFE');
  else reasons.push('EX_DATE_RISK_ABSENT_VERIFIED');

  if (assessment.belowBasis) { utility -= weights.belowBasisPenalty; reasons.push(`BELOW_BASIS_PENALTY_${weights.belowBasisPenalty.toFixed(2)}`); }

  return {
    utility, knownComponents, unknownComponents, reasons,
    weightsProvenance: weights.provenance, utilityVersion: coveredCallLatticeVersion,
  };
}

/**
 * `basisPerShare`/`sharesHeld` describe the stock position this CC would
 * cover. `referenceUpsidePrice` is optional and caller-supplied -- omitted,
 * upsideSacrificed stays honestly null rather than assuming a price target
 * this module has no basis to invent. `belowBasisAllowed` defaults to
 * false (the conservative bootstrap-Paper posture) but is NOT hardcoded as
 * an eternal universal rule -- a caller with a specifically justified
 * recovery policy may pass true to allow evaluating (never automatically
 * SELECTING) below-basis candidates.
 */
export function evaluateCoveredCallCandidates(
  basisPerShare: number | null, currentStockPrice: number | null, sharesHeld: number,
  wholeChainBase: Omit<WholeChainComponents, 'coveredCallPremium' | 'coveredCallCloseCosts' | 'stockSaleOrCallAwayProceeds' | 'currentStockMarkPerShare' | 'openStockShares'>,
  candidates: readonly CoveredCallCandidate[], utilityWeights: CoveredCallUtilityWeights,
  referenceUpsidePrice: number | null = null, belowBasisAllowed = false,
): readonly CoveredCallAssessment[] {
  return candidates.map((candidate): CoveredCallAssessment => {
    const reasons: string[] = [];
    const belowBasis = basisPerShare !== null && candidate.strike < basisPerShare;
    if (belowBasis) {
      reasons.push(belowBasisAllowed
        ? 'BELOW_BASIS_EVALUATED_UNDER_CALLER_JUSTIFIED_POLICY' : 'BELOW_BASIS_CC_REJECTED_BY_BOOTSTRAP_POLICY');
    }

    const hasQuote = candidate.bid !== null && candidate.ask !== null && Number.isFinite(candidate.bid) && Number.isFinite(candidate.ask)
      && (candidate.bid as number) >= 0 && (candidate.ask as number) >= (candidate.bid as number);
    // Conservative, executable reference: the BID side, never the
    // midpoint -- a midpoint is not a guaranteed fill, and this module
    // must never let an optimistic mid silently become the number that
    // decides whether a covered call gets sold.
    const premiumIncomeDollars = hasQuote
      ? (candidate.bid as number) * candidate.multiplier * candidate.quantity : null;
    const midReferenceDollars = hasQuote
      ? ((candidate.bid as number) + (candidate.ask as number)) / 2 * candidate.multiplier * candidate.quantity : null;
    const spreadDollars = hasQuote ? ((candidate.ask as number) - (candidate.bid as number)) * candidate.multiplier : null;
    const callAwayPriceDollars = candidate.strike * candidate.multiplier * candidate.quantity;

    const upsideSacrificedDollars = referenceUpsidePrice !== null && referenceUpsidePrice > candidate.strike
      ? (referenceUpsidePrice - candidate.strike) * sharesHeld : referenceUpsidePrice !== null ? 0 : null;

    const wholeChainPnlIfCalledAway = premiumIncomeDollars === null ? null : computeWholeChainPnl({
      ...wholeChainBase, coveredCallPremium: premiumIncomeDollars, coveredCallCloseCosts: 0,
      stockSaleOrCallAwayProceeds: callAwayPriceDollars, currentStockMarkPerShare: null, openStockShares: 0,
    }).wholeChainPnl;
    const wholeChainPnlIfNotCalled = premiumIncomeDollars === null ? null : computeWholeChainPnl({
      ...wholeChainBase, coveredCallPremium: premiumIncomeDollars, coveredCallCloseCosts: 0,
      stockSaleOrCallAwayProceeds: null, currentStockMarkPerShare: currentStockPrice, openStockShares: sharesHeld,
    }).wholeChainPnl;

    if (premiumIncomeDollars !== null) {
      reasons.push(`BID_SIDE_EXECUTABLE_REFERENCE_${premiumIncomeDollars.toFixed(2)}`,
        `MID_REFERENCE_ANALYTICAL_ONLY_${(midReferenceDollars as number).toFixed(2)}`);
    } else reasons.push('QUOTE_UNKNOWN');
    if (candidate.dividendExDateRisk === 'PRESENT') reasons.push('DIVIDEND_EX_DATE_RISK_PRESENT');
    else if (isEventRiskUnknown(candidate.dividendExDateRisk)) reasons.push('DIVIDEND_EX_DATE_RISK_UNKNOWN');
    if (candidate.eventRisk === 'PRESENT') reasons.push('EVENT_RISK_PRESENT');
    else if (isEventRiskUnknown(candidate.eventRisk)) reasons.push('EVENT_RISK_UNKNOWN');

    const utility = computeCoveredCallUtility(
      { premiumIncomeDollars, upsideSacrificedDollars, spreadDollars, belowBasis,
        eventRisk: candidate.eventRisk, dividendExDateRisk: candidate.dividendExDateRisk },
      utilityWeights,
    );

    return {
      candidate, premiumIncomeDollars, midReferenceDollars, callAwayPriceDollars, upsideSacrificedDollars,
      wholeChainPnlIfCalledAway, wholeChainPnlIfNotCalled, belowBasis, spreadDollars, utility,
      reasons: [...reasons, ...utility.reasons],
    };
  });
}

/**
 * Filters out candidates this module will not recommend SELECTING (below-
 * basis when not explicitly allowed, or missing a usable quote) without
 * discarding them from the returned assessment list -- callers can still
 * see why each candidate was excluded. This is the HARD FEASIBILITY stage.
 */
export function selectableCoveredCallCandidates(
  assessments: readonly CoveredCallAssessment[], belowBasisAllowed = false,
): readonly CoveredCallAssessment[] {
  return assessments.filter((assessment) =>
    assessment.utility.utility !== null && (belowBasisAllowed || !assessment.belowBasis));
}

interface DominanceDimension {
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly value: number | null;
}

function ordinal(state: EventRiskState): number | null {
  // Lower is better (less risk); UNKNOWN is deliberately null -- it must
  // never be treated as either better or worse than a verified state, so
  // it is simply excluded from any pairwise dominance comparison on this
  // dimension, never assumed to favor either candidate.
  return state === 'PRESENT' ? 1 : state === 'ABSENT_VERIFIED' ? 0 : null;
}

function dominanceDimensions(assessment: CoveredCallAssessment): readonly DominanceDimension[] {
  return [
    { label: 'premiumIncomeDollars', higherIsBetter: true, value: assessment.premiumIncomeDollars },
    { label: 'upsideSacrificedDollars', higherIsBetter: false, value: assessment.upsideSacrificedDollars },
    { label: 'spreadDollars', higherIsBetter: false, value: assessment.spreadDollars },
    { label: 'eventRiskOrdinal', higherIsBetter: false, value: ordinal(assessment.candidate.eventRisk) },
    { label: 'dividendExDateRiskOrdinal', higherIsBetter: false, value: ordinal(assessment.candidate.dividendExDateRisk) },
  ];
}

/**
 * Conservative dominance: `a` dominates `b` only on dimensions BOTH know
 * (a dimension unknown to either side is simply skipped for that pair --
 * it can never manufacture false dominance either way), and only when `a`
 * is at least as good on every shared-known dimension and strictly better
 * on at least one. A candidate with no shared-known dimensions at all
 * dominates nothing.
 */
function dominates(a: CoveredCallAssessment, b: CoveredCallAssessment): boolean {
  const dimsA = dominanceDimensions(a), dimsB = dominanceDimensions(b);
  let comparedAny = false, strictlyBetterSomewhere = false;
  for (let index = 0; index < dimsA.length; index += 1) {
    const dimA = dimsA[index] as DominanceDimension, dimB = dimsB[index] as DominanceDimension;
    if (dimA.value === null || dimB.value === null) continue;
    comparedAny = true;
    const normA = dimA.higherIsBetter ? dimA.value : -dimA.value;
    const normB = dimB.higherIsBetter ? dimB.value : -dimB.value;
    if (normA < normB) return false;
    if (normA > normB) strictlyBetterSomewhere = true;
  }
  return comparedAny && strictlyBetterSomewhere;
}

/**
 * The PARETO / NONDOMINATED SET stage. Removes only candidates for which
 * some OTHER candidate is unambiguously at least as good on every
 * shared-known dimension and strictly better on one -- never removes a
 * candidate merely because it scores lower on the FINAL weighted utility
 * (that ranking happens strictly afterward, in `bestCoveredCallCandidate`).
 * A lower-premium, farther-OTM, tighter-spread, no-known-event-risk
 * candidate is never removed here merely for having lower premium --
 * dominance requires being WORSE on every known dimension, not just one.
 */
export function nondominatedCoveredCallCandidates(
  assessments: readonly CoveredCallAssessment[],
): readonly CoveredCallAssessment[] {
  return assessments.filter((candidate) => !assessments.some((other) => other !== candidate && dominates(other, candidate)));
}

/**
 * Ranks selectable, nondominated candidates by CCUtility (never raw
 * premium) and returns the winner, or null when none are selectable. A
 * lower-premium, farther-OTM, tighter-spread, no-event-risk candidate can
 * and should outrank a high-premium, near-the-money, wide-spread,
 * event-risk one here.
 */
export function bestCoveredCallCandidate(
  assessments: readonly CoveredCallAssessment[], belowBasisAllowed = false,
): CoveredCallAssessment | null {
  const selectable = selectableCoveredCallCandidates(assessments, belowBasisAllowed);
  const nondominated = nondominatedCoveredCallCandidates(selectable);
  if (nondominated.length === 0) return null;
  return nondominated.reduce((champion, candidate) =>
    (candidate.utility.utility as number) > (champion.utility.utility as number) ? candidate : champion);
}
