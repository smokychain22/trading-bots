import type { ExecutionOptionQuote } from './execution-option-quote.js';

export const adaptiveLimitPolicyVersion = 'theta-adaptive-limit-v1' as const;

export interface AdaptiveLimitPolicy {
  readonly waitIntervalMs: number;
  readonly maxAttempts: number;
  readonly concessionFractions: readonly number[];
  readonly tickSize: number;
}

export interface AdaptiveLimitDecision {
  readonly policyVersion: typeof adaptiveLimitPolicyVersion;
  readonly action: 'PLACE' | 'REPLACE' | 'KEEP' | 'CANCEL';
  readonly limitPrice: number | null;
  readonly mid: number | null;
  readonly spread: number | null;
  readonly spreadPct: number | null;
  readonly microprice: number | null;
  readonly reason: string;
}

const roundedTick = (value: number, tick: number, side: 'BUY' | 'SELL'): number => {
  const ticks = value / tick;
  const rounded = side === 'SELL' ? Math.ceil(ticks - 1e-10) : Math.floor(ticks + 1e-10);
  return Number((rounded * tick).toFixed(8));
};

function validatePolicy(policy: AdaptiveLimitPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts <= 0
    || !Number.isFinite(policy.waitIntervalMs) || policy.waitIntervalMs < 0
    || !Number.isFinite(policy.tickSize) || policy.tickSize <= 0
    || policy.concessionFractions.length !== policy.maxAttempts
    || policy.concessionFractions.some((x, index) => !Number.isFinite(x) || x < 0 || x > 1
      || (index > 0 && x < (policy.concessionFractions[index - 1] ?? 0)))) {
    throw new Error('ADAPTIVE_LIMIT_POLICY_INVALID');
  }
}

export function decideAdaptiveLimit(input: {
  readonly side: 'BUY' | 'SELL';
  readonly quote: ExecutionOptionQuote;
  readonly attempt: number;
  readonly previousLimit: number | null;
  readonly economicBoundary: number;
  readonly economicsRemainPositive: boolean;
  readonly policy: AdaptiveLimitPolicy;
}): AdaptiveLimitDecision {
  validatePolicy(input.policy);
  const { bid, ask, bidSize, askSize } = input.quote;
  // A BUY (buy-to-close, risk reducing) needs only a valid ask; a zero bid is a valid worthless-short quote. SELL always
  // requires a strictly positive two-sided quote.
  const bidInvalid = input.side === 'BUY' ? bid < 0 : bid <= 0;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bidInvalid || ask <= 0 || bid > ask) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid: null, spread: null, spreadPct: null, microprice: null, reason: 'QUOTE_INVALID' };
  }
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const spreadPct = mid > 0 ? spread / mid : null;
  const trustedSizes = bidSize !== null && askSize !== null && bidSize > 0 && askSize > 0
    && Number.isFinite(bidSize) && Number.isFinite(askSize);
  const microprice = trustedSizes ? ((ask * bidSize) + (bid * askSize)) / (bidSize + askSize) : null;
  if (!input.economicsRemainPositive) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid, spread, spreadPct, microprice, reason: 'ECONOMICS_DISAPPEARED' };
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 0 || input.attempt >= input.policy.maxAttempts) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid, spread, spreadPct, microprice, reason: 'MAX_ATTEMPTS_REACHED' };
  }
  if (!Number.isFinite(input.economicBoundary) || input.economicBoundary <= 0) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid, spread, spreadPct, microprice, reason: 'ECONOMIC_BOUNDARY_INVALID' };
  }
  if (input.side === 'SELL' && input.economicBoundary > ask
    || input.side === 'BUY' && input.economicBoundary < bid) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid, spread, spreadPct, microprice, reason: 'ECONOMIC_BOUNDARY_UNREACHABLE' };
  }
  const fraction = input.policy.concessionFractions[input.attempt] ?? 0;
  const favorable = input.side === 'SELL' ? ask : bid;
  const towardMarket = input.side === 'SELL' ? favorable - spread * fraction : favorable + spread * fraction;
  const bounded = input.side === 'SELL'
    ? Math.max(towardMarket, input.economicBoundary, bid)
    : Math.min(towardMarket, input.economicBoundary, ask);
  let limitPrice = roundedTick(bounded, input.policy.tickSize, input.side);
  // A zero bid floors a BUY at 0; an order needs a positive limit, so use one tick (still bounded by boundary and ask below).
  if (input.side === 'BUY' && limitPrice <= 0) limitPrice = input.policy.tickSize;
  // Tick rounding (SELL rounds up) can lift the limit above a sub-tick ask: not placeable inside the BBO, so cancel (never throw later).
  if ((input.side === 'BUY' || input.side === 'SELL') && limitPrice > ask) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid, spread, spreadPct, microprice, reason: 'ECONOMIC_BOUNDARY_UNREACHABLE' };
  }
  // Every placed limit must sit inside the quoted BBO (the command assembler rejects anything outside). Tick rounding of a
  // sub-tick quote can push a BUY below the bid; that is typed CANCEL here, never an uncaught assembly exception later.
  if (limitPrice < bid - 1e-9 || limitPrice > ask + 1e-9) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid, spread, spreadPct, microprice, reason: 'LIMIT_OUTSIDE_QUOTED_BBO' };
  }
  if (input.side === 'SELL' && limitPrice < input.economicBoundary
    || input.side === 'BUY' && limitPrice > input.economicBoundary) {
    return { policyVersion: adaptiveLimitPolicyVersion, action: 'CANCEL', limitPrice: null,
      mid, spread, spreadPct, microprice, reason: 'ECONOMIC_BOUNDARY_UNREACHABLE' };
  }
  const action = input.previousLimit === null ? 'PLACE'
    : input.previousLimit === limitPrice ? 'KEEP' : 'REPLACE';
  return { policyVersion: adaptiveLimitPolicyVersion, action, limitPrice, mid, spread,
    spreadPct, microprice, reason: input.attempt === 0 ? 'INITIAL_FAVORABLE_LIMIT' : 'BOUNDED_CONCESSION' };
}
