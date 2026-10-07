// C (THETA_CC) covered-call utility -- SHADOW fix for the all-zero default weights in paper-bootstrap-management-policy.ts
// (DEFAULT_CC_UTILITY_WEIGHTS = 0), under which Production C utility equals premium income alone and the
// highest-premium call always wins (ties by option contract ID).
//
// Shadow utility (per contract, USD):
//   premium (executable bid)
// - expected forfeited upside  E[max(0, S_T - K)] under a lognormal with drift mu (momentum) and the stated volatility
// - half-spread execution cost
// - event / ex-dividend penalty (ex-dividend in window: expected dividend forfeited if the call is ITM by then)
// Under a risk-neutral drift with sigma = IV the expected forfeited upside equals the call's fair value, so a fairly
// priced call has ~zero edge: the call earns only when implied > realized volatility, when drift is non-positive, or when the
// owner explicitly prefers income over upside. HOLD_SHARES_NO_CC is returned when no call has positive edge
// (guide 11.3 / 12.3, OWNER_CURATED_SOURCE_CLAIM; the expectation math is MATH_REPRODUCED).
// Free shares = owned - committed to existing calls - pending call commitments (guide 12.1). Never a naked call.

import { normCdf } from './black-scholes.js';

export const coveredCallShadowUtilityVersion = 'theta-c-shadow-utility-v1' as const;

export interface CallCandidate {
  readonly contractId: string;
  readonly strike: number;
  readonly dte: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly delta: number | null;
  readonly iv: number | null;
}

export interface CoveredCallInventory {
  readonly ownedShares: number;
  readonly sharesCommittedToOpenCalls: number;
  readonly pendingCallCommitmentShares: number;
  readonly multiplier: number;
}

export interface CoveredCallShadowInput {
  readonly inventory: CoveredCallInventory;
  readonly stockMark: number;
  readonly stockCostBasisPerShare: number | null;
  /** Assignment strike - net put premium +/- prior chain adjustments (whole-chain economic basis). */
  readonly wholeChainBasisPerShare: number | null;
  /** Annualized realized volatility of the stock; null falls back to each call's IV (labelled). */
  readonly realizedVolatility: number | null;
  /** Annualized momentum drift estimate (e.g. from the regime engine); null = no drift assumed (labelled). */
  readonly momentumDrift: number | null;
  readonly eventInWindowByContractId: Readonly<Record<string, boolean | null>>;
  readonly exDividendAmountInWindow: number | null;
  readonly candidates: readonly CallCandidate[];
}

export interface CallShadowAssessment {
  readonly contractId: string;
  readonly premiumUsd: number | null;
  readonly expectedForfeitedUpsideUsd: number | null;
  readonly executionCostUsd: number | null;
  readonly eventPenaltyUsd: number;
  readonly dividendForfeitUsd: number;
  readonly edgeUsd: number | null;
  readonly edgePerCapitalDay: number | null;
  readonly callAwayProbabilityProxy: number | null;
  readonly callAwayBelowWholeChainBasis: boolean | null;
  readonly selectable: boolean;
  readonly reasons: readonly string[];
}

export interface CoveredCallShadowRecord {
  readonly contractVersion: typeof coveredCallShadowUtilityVersion;
  readonly authority: 'SHADOW_RESEARCH_NO_EXECUTION';
  readonly freeShares: number;
  readonly coverableContracts: number;
  readonly decision: 'SELL_CC' | 'HOLD_SHARES_NO_CC' | 'NO_FREE_SHARES';
  readonly shadowSelectedContractId: string | null;
  /** Current Production behaviour with zero weights: highest premium, ties by contract ID. */
  readonly legacyZeroWeightContractId: string | null;
  readonly divergesFromLegacy: boolean;
  readonly assessments: readonly CallShadowAssessment[];
  readonly assumptions: readonly string[];
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const r4 = (v: number) => Number(v.toFixed(4));

/** E[max(0, S_T - K)] for lognormal S_T with drift mu and volatility sigma over t years (undiscounted). */
export function expectedCallPayoff(spot: number, strike: number, years: number, sigma: number, mu: number): number {
  if (years <= 0) return Math.max(0, spot - strike);
  const forward = spot * Math.exp(mu * years);
  const sd = sigma * Math.sqrt(years);
  const d1 = (Math.log(forward / strike) + 0.5 * sd * sd) / sd;
  return forward * normCdf(d1) - strike * normCdf(d1 - sd);
}

export function evaluateCoveredCallShadow(input: CoveredCallShadowInput): CoveredCallShadowRecord {
  const inv = input.inventory;
  if (!(inv.multiplier > 0) || !(input.stockMark > 0)) throw new Error('CC_SHADOW_INPUT_INVALID');
  const freeShares = Math.max(0, inv.ownedShares - inv.sharesCommittedToOpenCalls - inv.pendingCallCommitmentShares);
  const coverable = Math.floor(freeShares / inv.multiplier);
  const assumptions = [input.realizedVolatility === null ? 'VOL_FALLBACK_TO_CALL_IV' : 'VOL_REALIZED',
    input.momentumDrift === null ? 'NO_DRIFT_ASSUMED' : 'MOMENTUM_DRIFT_SUPPLIED'];
  const mu = input.momentumDrift ?? 0;
  const assessments: CallShadowAssessment[] = input.candidates.map((c) => {
    const reasons: string[] = [];
    const premium = finite(c.bid) && c.bid > 0 ? r4(c.bid * inv.multiplier) : null;
    if (premium === null) reasons.push('PREMIUM_UNKNOWN_OR_ZERO');
    const sigma = input.realizedVolatility ?? c.iv;
    const years = c.dte / 365;
    const forfeited = finite(sigma) && sigma > 0 && c.dte >= 0 ? r4(expectedCallPayoff(input.stockMark, c.strike, years, sigma, mu) * inv.multiplier) : null;
    if (forfeited === null) reasons.push('VOLATILITY_UNKNOWN');
    const cost = finite(c.bid) && finite(c.ask) && c.ask >= c.bid ? r4((c.ask - c.bid) / 2 * inv.multiplier) : null;
    if (cost === null) reasons.push('SPREAD_UNKNOWN');
    const event = input.eventInWindowByContractId[c.contractId] ?? null;
    if (event === null) reasons.push('EVENT_STATE_UNKNOWN_NOT_TREATED_AS_SAFE');
    // An event in window widens the upside distribution; charged as the extra expected payoff of a 1.25x vol call.
    const eventPenalty = event === true && finite(sigma) && sigma > 0
      ? r4((expectedCallPayoff(input.stockMark, c.strike, years, sigma * 1.25, mu) - expectedCallPayoff(input.stockMark, c.strike, years, sigma, mu)) * inv.multiplier) : 0;
    const itmProb = finite(sigma) && sigma > 0 && years > 0
      ? normCdf((Math.log(input.stockMark * Math.exp(mu * years) / c.strike) - 0.5 * sigma * sigma * years) / (sigma * Math.sqrt(years))) : null;
    const dividendForfeit = finite(input.exDividendAmountInWindow) && itmProb !== null ? r4(input.exDividendAmountInWindow * itmProb * inv.multiplier) : 0;
    const belowBasis = input.wholeChainBasisPerShare === null ? null : c.strike < input.wholeChainBasisPerShare;
    if (belowBasis === true) reasons.push('CALL_AWAY_BELOW_WHOLE_CHAIN_BASIS_LOCKS_LOSS');
    const edge = premium === null || forfeited === null || cost === null || event === null ? null
      : r4(premium - forfeited - cost - eventPenalty - dividendForfeit);
    const capital = input.stockMark * inv.multiplier;
    return {
      contractId: c.contractId, premiumUsd: premium, expectedForfeitedUpsideUsd: forfeited, executionCostUsd: cost,
      eventPenaltyUsd: eventPenalty, dividendForfeitUsd: dividendForfeit, edgeUsd: edge,
      edgePerCapitalDay: edge === null || c.dte <= 0 ? null : Number((edge / capital / c.dte).toFixed(10)),
      callAwayProbabilityProxy: itmProb === null ? (finite(c.delta) ? r4(Math.abs(c.delta)) : null) : r4(itmProb),
      callAwayBelowWholeChainBasis: belowBasis,
      selectable: edge !== null && belowBasis !== true && c.dte > 0,
      reasons,
    };
  });
  const legacy = input.candidates.filter((c) => finite(c.bid) && c.bid > 0)
    .toSorted((a, b) => (b.bid as number) - (a.bid as number) || a.contractId.localeCompare(b.contractId))[0]?.contractId ?? null;
  const best = assessments.filter((a) => a.selectable && (a.edgePerCapitalDay ?? 0) > 0)
    .toSorted((a, b) => (b.edgePerCapitalDay as number) - (a.edgePerCapitalDay as number) || a.contractId.localeCompare(b.contractId))[0] ?? null;
  const decision = coverable === 0 ? 'NO_FREE_SHARES' : best === null ? 'HOLD_SHARES_NO_CC' : 'SELL_CC';
  const selected = decision === 'SELL_CC' ? best?.contractId ?? null : null;
  return {
    contractVersion: coveredCallShadowUtilityVersion, authority: 'SHADOW_RESEARCH_NO_EXECUTION', freeShares, coverableContracts: coverable,
    decision, shadowSelectedContractId: selected, legacyZeroWeightContractId: coverable === 0 ? null : legacy,
    divergesFromLegacy: coverable > 0 && selected !== legacy, assessments, assumptions,
  };
}
