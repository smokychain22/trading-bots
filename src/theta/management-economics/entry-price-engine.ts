// Entry / exit price engine -- NO-SUBMIT planning only (guide 28, OWNER_CURATED_SOURCE_CLAIM; bounds MATH_REPRODUCED).
//
// SELL_TO_OPEN: a bounded limit ladder favorable (ask) -> midpoint -> toward the bid, never below the MINIMUM ACCEPTABLE
// CREDIT derived from the strategy economics receipt, and only inside the decision TTL, the quote-freshness window and
// the mutation fence. Every step re-builds the economics at its price; the first uneconomic step stops the ladder.
// BUY_TO_CLOSE: favorable (bid) -> midpoint -> toward the ask, never above the MAXIMUM ACCEPTABLE DEBIT, except a typed
// risk-reduction urgency override which may pay up to the ask (recorded). No step is ever submitted from here.

import { evaluateEconomicHurdles, type EconomicHurdlePolicy, type StrategyEconomicsReceipt } from '../strategy-economics.js';

export const priceEngineVersion = 'theta-price-engine-v1' as const;

export interface PriceEngineBounds {
  /** Decision time; the ladder must finish inside decisionAt + decisionTtlMs (Production plan window 45 s). */
  readonly decisionAt: string;
  readonly decisionTtlMs: number;
  /** Quote time; steps are valid only while the quote age stays within maxQuoteAgeMs. */
  readonly quoteAt: string;
  readonly maxQuoteAgeMs: number;
  /** Mutation fence (Production 150 s) measured from decisionAt; the ladder never runs past it. */
  readonly mutationFenceMs: number;
  readonly stepIntervalMs: number;
  readonly maxSteps: number;
}

export interface LadderStep { readonly index: number; readonly limitPrice: number; readonly notBefore: string; readonly reason: string }
export interface LadderPlan {
  readonly contractVersion: typeof priceEngineVersion;
  readonly side: 'SELL_TO_OPEN' | 'BUY_TO_CLOSE';
  readonly authority: 'NO_SUBMIT_PLAN_ONLY';
  readonly boundPrice: number | null;
  readonly boundKind: 'MIN_ACCEPTABLE_CREDIT' | 'MAX_ACCEPTABLE_DEBIT' | 'URGENT_RISK_REDUCTION_CAP';
  readonly deadline: string;
  readonly steps: readonly LadderStep[];
  readonly stopReason: string | null;
}

/** Option tick: $0.01 below $3.00, $0.05 at or above (labelled assumption; penny-pilot classes may differ). */
export const tickFor = (price: number): number => price < 3 ? 0.01 : 0.05;
const roundTo = (price: number, tick: number, mode: 'UP' | 'DOWN') => {
  const units = price / tick;
  return Number(((mode === 'UP' ? Math.ceil(units - 1e-9) : Math.floor(units + 1e-9)) * tick).toFixed(2));
};

/** count points from `from` to `to`, both endpoints included (count >= 1). */
const ramp = (from: number, to: number, count: number): number[] =>
  count <= 1 ? [from] : Array.from({ length: count }, (_, i) => from + (to - from) * i / (count - 1));

function deadlineOf(b: PriceEngineBounds): number {
  const decision = Date.parse(b.decisionAt); const quote = Date.parse(b.quoteAt);
  if (![decision, quote].every(Number.isFinite) || !(b.stepIntervalMs > 0) || !Number.isInteger(b.maxSteps) || b.maxSteps <= 0
    || b.maxSteps > 20) throw new Error('PRICE_ENGINE_BOUNDS_INVALID');
  return Math.min(decision + b.decisionTtlMs, quote + b.maxQuoteAgeMs, decision + b.mutationFenceMs);
}

/**
 * Lowest credit (cent grid) at which the economics still qualify. With hurdles configured: every configured hurdle PASSes.
 * Without hurdles: required evidence stays known and reward-to-stress stays >= decisionRewardToStress x (1 - tolerance).
 * Returns null when even the ask does not qualify.
 */
export function minimumAcceptableCredit(input: {
  readonly receiptAt: (creditPerShare: number) => StrategyEconomicsReceipt;
  readonly ask: number;
  readonly policy: EconomicHurdlePolicy | null;
  readonly decisionRewardToStress: number | null;
  readonly tolerance: number;
}): { readonly credit: number | null; readonly basis: string } {
  const configured = input.policy !== null && Object.entries(input.policy).some(([k, v]) => k !== 'policyVersion' && v !== null && v !== undefined);
  const qualifies = (credit: number): boolean => {
    const r = input.receiptAt(credit);
    if (configured) return evaluateEconomicHurdles(r, input.policy, 'SHADOW').verdict === 'PASS';
    if (input.decisionRewardToStress === null) return false;
    return r.rewardToStressRisk.state === 'KNOWN' && r.rewardToStressRisk.value >= input.decisionRewardToStress * (1 - input.tolerance);
  };
  const basis = configured ? 'CONFIGURED_HURDLES_PASS' : 'REWARD_TO_STRESS_WITHIN_TOLERANCE_OF_DECISION';
  if (!(input.ask > 0) || !qualifies(input.ask)) return { credit: null, basis: `${basis}:NOT_MET_EVEN_AT_ASK` };
  // Economics are monotone non-decreasing in credit for a short premium package: binary search on the cent grid.
  let lo = 1; let hi = Math.round(input.ask * 100);
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (qualifies(mid / 100)) hi = mid; else lo = mid + 1; }
  return { credit: hi / 100, basis };
}

export function planSellToOpenLadder(input: { readonly bid: number; readonly ask: number; readonly minCredit: number | null; readonly bounds: PriceEngineBounds;
  readonly now: string }): LadderPlan {
  const deadline = deadlineOf(input.bounds);
  const base = { contractVersion: priceEngineVersion, side: 'SELL_TO_OPEN' as const, authority: 'NO_SUBMIT_PLAN_ONLY' as const,
    boundPrice: input.minCredit, boundKind: 'MIN_ACCEPTABLE_CREDIT' as const, deadline: new Date(deadline).toISOString() };
  if (!(input.bid >= 0) || !(input.ask > 0) || input.ask < input.bid) return { ...base, steps: [], stopReason: 'QUOTE_INVALID' };
  if (input.minCredit === null) return { ...base, steps: [], stopReason: 'NO_ECONOMIC_CREDIT_EXISTS' };
  const mid = (input.bid + input.ask) / 2;
  // ask first, then midpoint, then the remaining steps ramp from mid to the bid (inclusive).
  const raw = input.bounds.maxSteps === 1 ? [input.ask] : [input.ask, ...ramp(mid, input.bid, input.bounds.maxSteps - 1)];
  const steps: LadderStep[] = [];
  let stopReason: string | null = null;
  const start = Date.parse(input.now);
  for (const price of raw) {
    if (steps.length >= input.bounds.maxSteps) { stopReason = 'MAX_STEPS'; break; }
    const limit = roundTo(price, tickFor(price), 'UP'); // a sell limit rounds toward the more favorable (higher) credit
    if (limit < input.minCredit) { stopReason = 'NEXT_STEP_BELOW_MIN_ACCEPTABLE_CREDIT'; break; }
    if (steps.at(-1)?.limitPrice === limit) continue;
    const at = start + steps.length * input.bounds.stepIntervalMs;
    if (at >= deadline) { stopReason = 'DEADLINE_DECISION_TTL_QUOTE_AGE_OR_FENCE'; break; }
    steps.push({ index: steps.length, limitPrice: limit, notBefore: new Date(at).toISOString(),
      reason: steps.length === 0 ? 'FAVORABLE_ASK' : limit >= roundTo(mid, tickFor(mid), 'UP') ? 'MIDPOINT' : 'TOWARD_BID_WITHIN_MIN_CREDIT' });
  }
  return { ...base, steps, stopReason };
}

export type CloseUrgency = { readonly kind: 'NONE' } | { readonly kind: 'RISK_REDUCTION'; readonly reason: string };

export function planBuyToCloseLadder(input: { readonly bid: number; readonly ask: number; readonly maxDebit: number; readonly urgency: CloseUrgency;
  readonly bounds: PriceEngineBounds; readonly now: string }): LadderPlan {
  const deadline = deadlineOf(input.bounds);
  const urgent = input.urgency.kind === 'RISK_REDUCTION';
  const cap = urgent ? Math.max(input.maxDebit, input.ask) : input.maxDebit;
  const base = { contractVersion: priceEngineVersion, side: 'BUY_TO_CLOSE' as const, authority: 'NO_SUBMIT_PLAN_ONLY' as const,
    boundPrice: cap, boundKind: urgent && cap > input.maxDebit ? 'URGENT_RISK_REDUCTION_CAP' as const : 'MAX_ACCEPTABLE_DEBIT' as const,
    deadline: new Date(deadline).toISOString() };
  if (!(input.bid >= 0) || !(input.ask > 0) || input.ask < input.bid || !(input.maxDebit > 0)) return { ...base, steps: [], stopReason: 'QUOTE_OR_BOUND_INVALID' };
  const mid = (input.bid + input.ask) / 2;
  // Urgent risk reduction starts at the midpoint (time matters more than price improvement).
  const raw = urgent ? ramp(mid, input.ask, input.bounds.maxSteps)
    : input.bounds.maxSteps === 1 ? [input.bid] : [input.bid, ...ramp(mid, input.ask, input.bounds.maxSteps - 1)];
  const steps: LadderStep[] = [];
  let stopReason: string | null = null;
  const start = Date.parse(input.now);
  for (const price of raw) {
    if (steps.length >= input.bounds.maxSteps) { stopReason = 'MAX_STEPS'; break; }
    const limit = roundTo(price, tickFor(price), 'DOWN'); // a buy limit rounds toward the more favorable (lower) debit
    if (limit > cap) { stopReason = urgent ? 'URGENT_CAP_REACHED' : 'NEXT_STEP_ABOVE_MAX_ACCEPTABLE_DEBIT'; break; }
    if (steps.at(-1)?.limitPrice === limit) continue;
    const at = start + steps.length * input.bounds.stepIntervalMs;
    if (at >= deadline) { stopReason = 'DEADLINE_DECISION_TTL_QUOTE_AGE_OR_FENCE'; break; }
    steps.push({ index: steps.length, limitPrice: limit, notBefore: new Date(at).toISOString(),
      reason: urgent ? `URGENT_RISK_REDUCTION:${(input.urgency as { reason: string }).reason}` : steps.length === 0 ? 'FAVORABLE_BID' : 'TOWARD_ASK_WITHIN_MAX_DEBIT' });
  }
  return { ...base, steps, stopReason };
}

/** Per-step revalidation against a FRESH quote: economics at the step price must still qualify; otherwise reevaluate. */
export function revalidateSellStep(input: { readonly step: LadderStep; readonly freshBid: number; readonly freshAsk: number;
  readonly freshQuoteAt: string; readonly now: string; readonly maxQuoteAgeMs: number; readonly minCredit: number | null }):
  { readonly state: 'PROCEED' | 'INVALIDATE_AND_REEVALUATE'; readonly reason: string } {
  const age = Date.parse(input.now) - Date.parse(input.freshQuoteAt);
  if (!Number.isFinite(age) || age < 0 || age > input.maxQuoteAgeMs) return { state: 'INVALIDATE_AND_REEVALUATE', reason: 'QUOTE_STALE' };
  if (input.minCredit === null || input.step.limitPrice < input.minCredit) return { state: 'INVALIDATE_AND_REEVALUATE', reason: 'STEP_BELOW_MIN_CREDIT' };
  if (input.freshAsk < input.minCredit) return { state: 'INVALIDATE_AND_REEVALUATE', reason: 'MARKET_MOVED_ASK_BELOW_MIN_CREDIT' };
  if (input.step.limitPrice > input.freshAsk + tickFor(input.freshAsk) * 5) return { state: 'INVALIDATE_AND_REEVALUATE', reason: 'STEP_FAR_ABOVE_FRESH_ASK_REPRICE_FROM_FRESH_BBO' };
  return { state: 'PROCEED', reason: 'ECONOMICS_HOLD_AT_FRESH_QUOTE' };
}
