import { computeWholeChainPnl, type WholeChainComponents } from './whole-chain-economics.js';

export const coveredCallLatticeVersion = 'theta-covered-call-lattice-v1' as const;

/**
 * Evaluates ALTERNATIVE covered-call candidates (never blindly picks the
 * highest-premium one) on whole-chain economics. This module consumes an
 * already-identified list of candidates -- it does not enumerate a
 * contract lattice itself, matching the same boundary as
 * roll-incremental-utility.ts: contract discovery belongs to the
 * strategy-router/execution domain, comparison belongs here.
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
  readonly dividendExDateRisk: boolean;
  readonly eventRisk: boolean;
}

export interface CoveredCallAssessment {
  readonly candidate: CoveredCallCandidate;
  readonly premiumIncomeDollars: number | null;
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
}

export interface CoveredCallUtilityResult {
  readonly utility: number | null;
  readonly knownComponents: readonly string[];
  readonly unknownComponents: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * CCUtility = premiumIncome
 *   - upsideSacrificePerDollarWeight * upsideSacrificed   (if known)
 *   - spreadPerDollarWeight * spread                      (execution-risk proxy)
 *   - eventRiskPenalty                                    (if event risk present)
 *   - dividendExDateRiskPenalty                            (if ex-date risk present)
 *   - belowBasisPenalty                                   (if below basis)
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
    & { readonly eventRisk: boolean; readonly dividendExDateRisk: boolean },
  weights: CoveredCallUtilityWeights,
): CoveredCallUtilityResult {
  const knownComponents: string[] = [];
  const unknownComponents: string[] = ['capitalReleaseBenefit', 'recoveryBenefit', 'callAwayProbabilityProxy', 'tailRisk', 'executionUncertaintyBeyondSpread'];
  const reasons: string[] = [];
  if (assessment.premiumIncomeDollars === null) {
    return { utility: null, knownComponents, unknownComponents, reasons: ['PREMIUM_UNKNOWN_CANNOT_RANK'] };
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

  if (assessment.eventRisk) { utility -= weights.eventRiskPenalty; reasons.push(`EVENT_RISK_PENALTY_${weights.eventRiskPenalty.toFixed(2)}`); }
  if (assessment.dividendExDateRisk) { utility -= weights.dividendExDateRiskPenalty; reasons.push(`EX_DATE_RISK_PENALTY_${weights.dividendExDateRiskPenalty.toFixed(2)}`); }
  if (assessment.belowBasis) { utility -= weights.belowBasisPenalty; reasons.push(`BELOW_BASIS_PENALTY_${weights.belowBasisPenalty.toFixed(2)}`); }

  return { utility, knownComponents, unknownComponents, reasons };
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

    const hasQuote = candidate.bid !== null && candidate.ask !== null && Number.isFinite(candidate.bid) && Number.isFinite(candidate.ask);
    const premiumIncomeDollars = hasQuote
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

    if (premiumIncomeDollars !== null) reasons.push(`KNOWN_PREMIUM_${premiumIncomeDollars.toFixed(2)}`);
    else reasons.push('QUOTE_UNKNOWN');
    if (candidate.dividendExDateRisk) reasons.push('DIVIDEND_EX_DATE_RISK_PRESENT');
    if (candidate.eventRisk) reasons.push('EVENT_RISK_PRESENT');

    const utility = computeCoveredCallUtility(
      { premiumIncomeDollars, upsideSacrificedDollars, spreadDollars, belowBasis,
        eventRisk: candidate.eventRisk, dividendExDateRisk: candidate.dividendExDateRisk },
      utilityWeights,
    );

    return {
      candidate, premiumIncomeDollars, callAwayPriceDollars, upsideSacrificedDollars,
      wholeChainPnlIfCalledAway, wholeChainPnlIfNotCalled, belowBasis, spreadDollars, utility,
      reasons: [...reasons, ...utility.reasons],
    };
  });
}

/**
 * Filters out candidates this module will not recommend SELECTING (below-
 * basis when not explicitly allowed, or missing a usable quote) without
 * discarding them from the returned assessment list -- callers can still
 * see why each candidate was excluded.
 */
export function selectableCoveredCallCandidates(
  assessments: readonly CoveredCallAssessment[], belowBasisAllowed = false,
): readonly CoveredCallAssessment[] {
  return assessments.filter((assessment) =>
    assessment.utility.utility !== null && (belowBasisAllowed || !assessment.belowBasis));
}

/**
 * Ranks selectable candidates by CCUtility (never raw premium) and returns
 * the winner, or null when none are selectable. A lower-premium, farther-
 * OTM, tighter-spread, no-event-risk candidate can and should outrank a
 * high-premium, near-the-money, wide-spread, event-risk one here.
 */
export function bestCoveredCallCandidate(
  assessments: readonly CoveredCallAssessment[], belowBasisAllowed = false,
): CoveredCallAssessment | null {
  const selectable = selectableCoveredCallCandidates(assessments, belowBasisAllowed);
  if (selectable.length === 0) return null;
  return selectable.reduce((champion, candidate) =>
    (candidate.utility.utility as number) > (champion.utility.utility as number) ? candidate : champion);
}
