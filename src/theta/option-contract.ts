import { z } from 'zod';

// Canonical normalized option-contract representation. Strategy logic
// (candidate generation, opportunity frontier, management) consumes ONLY
// this shape -- never raw Alpaca/Optionomics response bodies directly --
// so every downstream consumer sees the same UNKNOWN-preserving,
// provenance-tagged contract regardless of which provider call produced it.
//
// UNKNOWN fields remain UNKNOWN (null) throughout. Nothing here coerces a
// missing bid/ask/Greek/IV to zero, and `midpointReference` is explicitly
// never treated as an executable price (see `executable`/`nonExecutableReason`
// below) -- consistent with the charter's non-negotiable rules.

export const optionContractVersion = 'theta-option-contract-v1' as const;

export const optionType = z.enum(['CALL', 'PUT']);
export type OptionType = z.infer<typeof optionType>;

export const feedType = z.enum(['OPRA', 'INDICATIVE']);
export type FeedType = z.infer<typeof feedType>;

export const dataQuality = z.enum(['GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED']);
export type DataQuality = z.infer<typeof dataQuality>;

const nullableFiniteNumber = z.number().finite().nullable();
const nullableNonNegativeInt = z.number().int().nonnegative().nullable();
const nullableTimestamp = z.string().datetime({ offset: true }).nullable();

export const normalizedOptionContractSchema = z.object({
  contractVersion: z.literal(optionContractVersion),

  // Identity
  underlying: z.string().min(1),
  optionSymbol: z.string().min(1),
  occSymbol: z.string().min(1).nullable(),
  optionType,
  strike: z.number().finite().positive(),
  expiration: z.string().date(),
  dte: z.number().int(),
  multiplier: z.number().finite().positive(),

  // Underlying reference state
  underlyingBid: nullableFiniteNumber,
  underlyingAsk: nullableFiniteNumber,
  underlyingLast: nullableFiniteNumber,
  underlyingReferencePrice: nullableFiniteNumber,
  underlyingTimestamp: nullableTimestamp,

  // Option quote
  bid: nullableFiniteNumber,
  ask: nullableFiniteNumber,
  bidSize: nullableNonNegativeInt,
  askSize: nullableNonNegativeInt,
  lastTradePrice: nullableFiniteNumber,
  lastTradeSize: nullableNonNegativeInt,
  quoteTimestamp: nullableTimestamp,
  tradeTimestamp: nullableTimestamp,

  // Derived quote fields -- computed by normalizeOptionContract, never
  // supplied raw, so they can never silently disagree with bid/ask.
  midpointReference: nullableFiniteNumber,
  spread: nullableFiniteNumber,
  spreadPct: nullableFiniteNumber,
  moneyness: nullableFiniteNumber, // (underlyingReferencePrice - strike) / strike, sign convention documented at call site
  distanceToStrikePct: nullableFiniteNumber,
  breakEven: nullableFiniteNumber, // CSP: strike - bid (credit received); documented per candidate type at call site

  // Market activity
  volume: nullableNonNegativeInt,
  openInterest: nullableNonNegativeInt,

  // Greeks -- legitimately unavailable depending on entitlement; never
  // fabricated when missing.
  iv: nullableFiniteNumber,
  delta: nullableFiniteNumber,
  gamma: nullableFiniteNumber,
  theta: nullableFiniteNumber,
  vega: nullableFiniteNumber,
  rho: nullableFiniteNumber,
  greeksTimestamp: nullableTimestamp,

  // Provenance
  source: z.literal('ALPACA'),
  feed: feedType.nullable(),
  dataQuality,
  receivedAt: z.string().datetime({ offset: true }),
  dataAgeSeconds: nullableFiniteNumber,

  // Execution
  executable: z.boolean(),
  nonExecutableReason: z.string().min(1).nullable(),
}).superRefine((contract, context) => {
  if (contract.executable && contract.nonExecutableReason !== null) {
    context.addIssue({ code: 'custom', message: 'executable contracts must not carry a nonExecutableReason' });
  }
  if (!contract.executable && contract.nonExecutableReason === null) {
    context.addIssue({ code: 'custom', message: 'a non-executable contract must state why' });
  }
  // Delta is never treated as probability of profit -- this contract only
  // ever carries the raw Greek; enforcing that discipline is a strategy-
  // layer concern (theta_q_baseline.py etc.), not a schema-level check this
  // type can meaningfully make. Documented here so the invariant is visible
  // at the one place every consumer of this contract reads first.
});

export type NormalizedOptionContract = z.infer<typeof normalizedOptionContractSchema>;

export interface RawOptionQuoteInput {
  readonly underlying: string;
  readonly optionSymbol: string;
  readonly occSymbol: string | null;
  readonly optionType: OptionType;
  readonly strike: number;
  readonly expiration: string; // YYYY-MM-DD
  readonly asOfDate: string; // YYYY-MM-DD, for DTE computation
  readonly multiplier: number;
  readonly underlyingBid: number | null;
  readonly underlyingAsk: number | null;
  readonly underlyingLast: number | null;
  readonly underlyingTimestamp: string | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly bidSize: number | null;
  readonly askSize: number | null;
  readonly lastTradePrice: number | null;
  readonly lastTradeSize: number | null;
  readonly quoteTimestamp: string | null;
  readonly tradeTimestamp: string | null;
  readonly volume: number | null;
  readonly openInterest: number | null;
  readonly iv: number | null;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly rho: number | null;
  readonly greeksTimestamp: string | null;
  readonly feed: FeedType | null;
  readonly dataQuality: DataQuality;
  readonly maxQuoteAgeSecondsForExecutable: number;
  readonly maxSpreadPctForExecutable: number;
}

const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);

/**
 * Normalizes a raw provider quote into the canonical contract shape.
 * Computes ONLY the derived fields this module owns (spread, moneyness,
 * distance-to-strike, break-even, midpoint-reference-for-context,
 * executability) -- never recomputes a Greek or reinterprets a quote value,
 * since those come from the provider (or, for Greeks, may need to come
 * from a quant model when the provider doesn't supply them -- out of scope
 * for this normalization layer, which only shapes what it's given).
 */
export function normalizeOptionContract(raw: RawOptionQuoteInput, receivedAt: string): NormalizedOptionContract {
  const underlyingReferencePrice =
    raw.underlyingLast ?? (raw.underlyingBid !== null && raw.underlyingAsk !== null ? (raw.underlyingBid + raw.underlyingAsk) / 2 : null);

  const spread = raw.bid !== null && raw.ask !== null ? raw.ask - raw.bid : null;
  const midpointReference = raw.bid !== null && raw.ask !== null ? (raw.bid + raw.ask) / 2 : null;
  const spreadPct = spread !== null && midpointReference !== null && midpointReference > 0 ? spread / midpointReference : null;

  const moneyness = underlyingReferencePrice !== null ? (underlyingReferencePrice - raw.strike) / raw.strike : null;
  const distanceToStrikePct = underlyingReferencePrice !== null ? Math.abs(underlyingReferencePrice - raw.strike) / raw.strike : null;

  // CSP break-even convention: Strike - EntryPremiumPerShare, using the bid
  // (what a seller would actually receive), per FORMULA_REGISTRY.md.
  const breakEven = raw.optionType === 'PUT' && raw.bid !== null ? raw.strike - raw.bid : null;

  const dte = daysBetween(raw.asOfDate, raw.expiration);

  const quoteAgeSeconds = raw.quoteTimestamp !== null ? (new Date(receivedAt).getTime() - new Date(raw.quoteTimestamp).getTime()) / 1000 : null;

  const reasons: string[] = [];
  if (raw.bid === null || raw.ask === null) reasons.push('quote unavailable');
  if (quoteAgeSeconds === null) reasons.push('quote age unknown');
  else if (quoteAgeSeconds > raw.maxQuoteAgeSecondsForExecutable) reasons.push('quote stale');
  if (spreadPct === null) reasons.push('spread unknown');
  else if (spreadPct > raw.maxSpreadPctForExecutable) reasons.push('spread too wide');
  if (raw.dataQuality !== 'GOOD') reasons.push(`data quality is ${raw.dataQuality}`);

  const executable = reasons.length === 0;

  return normalizedOptionContractSchema.parse({
    contractVersion: optionContractVersion,
    underlying: raw.underlying,
    optionSymbol: raw.optionSymbol,
    occSymbol: raw.occSymbol,
    optionType: raw.optionType,
    strike: raw.strike,
    expiration: raw.expiration,
    dte,
    multiplier: raw.multiplier,
    underlyingBid: raw.underlyingBid,
    underlyingAsk: raw.underlyingAsk,
    underlyingLast: raw.underlyingLast,
    underlyingReferencePrice,
    underlyingTimestamp: raw.underlyingTimestamp,
    bid: raw.bid,
    ask: raw.ask,
    bidSize: raw.bidSize,
    askSize: raw.askSize,
    lastTradePrice: raw.lastTradePrice,
    lastTradeSize: raw.lastTradeSize,
    quoteTimestamp: raw.quoteTimestamp,
    tradeTimestamp: raw.tradeTimestamp,
    midpointReference,
    spread,
    spreadPct,
    moneyness,
    distanceToStrikePct,
    breakEven,
    volume: raw.volume,
    openInterest: raw.openInterest,
    iv: raw.iv,
    delta: raw.delta,
    gamma: raw.gamma,
    theta: raw.theta,
    vega: raw.vega,
    rho: raw.rho,
    greeksTimestamp: raw.greeksTimestamp,
    source: 'ALPACA',
    feed: raw.feed,
    dataQuality: raw.dataQuality,
    receivedAt,
    dataAgeSeconds: quoteAgeSeconds,
    executable,
    nonExecutableReason: executable ? null : reasons.join('; '),
  });
}
