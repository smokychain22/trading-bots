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
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || bid > ask) {
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
  const limitPrice = roundedTick(bounded, input.policy.tickSize, input.side);
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
