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
  readonly reasons: readonly string[];
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
  candidates: readonly CoveredCallCandidate[], referenceUpsidePrice: number | null = null, belowBasisAllowed = false,
): readonly CoveredCallAssessment[] {
  return candidates.map((candidate): CoveredCallAssessment => {
    const reasons: string[] = [];
    const belowBasis = basisPerShare !== null && candidate.strike < basisPerShare;
    if (belowBasis) reasons.push(belowBasisAllowed ? 'BELOW_BASIS_EVALUATED_UNDER_CALLER_JUSTIFIED_POLICY' : 'BELOW_BASIS_REJECTED_BY_DEFAULT_CONSERVATIVE_POSTURE');

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

    return {
      candidate, premiumIncomeDollars, callAwayPriceDollars, upsideSacrificedDollars,
      wholeChainPnlIfCalledAway, wholeChainPnlIfNotCalled, belowBasis, spreadDollars, reasons,
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
    assessment.premiumIncomeDollars !== null && (belowBasisAllowed || !assessment.belowBasis));
}
