/**
 * UNIFIED TAKEOVER GAPS 2 + 3: mark-price and multi-leg IV semantics for
 * Command 5A observation evidence.
 *
 * GAP 2 (mark-price): Codex's `ContractPathObservationReceipt` carries
 * only per-leg bid/ask (`legs: readonly ContractPathQuoteObservation[]`) --
 * there is no single aggregated mark field on the producer side. This
 * module defines and versions that aggregation rather than inventing
 * `mark = midpoint` ad hoc at a call site:
 *   - single-leg (Q/H): mark = mid(bid, ask), reusing this codebase's own
 *     established mark convention (`transaction-cost-analysis.ts`'s
 *     `mid()`, real, already-tested).
 *   - multi-leg (D): NEVER average leg mids. A defined-risk package's
 *     bid/ask is constructed from the same conservative-side net-credit
 *     convention already established for D's real economics
 *     (`canonical-strategy-frontier.ts`'s `definedRiskCandidate()`:
 *     `netCredit = shortPut.bid - longPut.ask`) -- the package's
 *     "sellable now" price uses the short leg's bid and the long leg's
 *     ask (worst case for opening), and its "buyable to close" price uses
 *     the short leg's ask and the long leg's bid (worst case for
 *     closing). Package mark is the mid of those two only when both are
 *     defined; otherwise `NOT_IDENTIFIABLE`, never zero, never promoted to
 *     BROKER_ACTUAL.
 *
 * GAP 3 (multi-leg IV): no single "spread IV" is manufactured. Leg-level
 * IV/Greeks are preserved and returned separately for D; only a single
 * scalar is returned for genuinely single-leg subjects, and only because
 * the underlying quote itself already carries exactly one IV value.
 */
import type { ContractPathQuoteObservation } from './contract-path-observation-runtime.js';

export const command5aMarkSemanticsVersion = 'theta-command5a-mark-semantics-v1' as const;

export type MarkIdentifiability = 'PRESENT_VALID' | 'NOT_IDENTIFIABLE';

export interface LegIdentityForMark {
  readonly optionSymbol: string;
  /** `SHORT` = sold-to-open (credit leg), `LONG` = bought-to-open
   * (protection leg) -- matches `ContractPathLegIdentity.side` /
   * `ShadowEpisodeContract.legs[].positionIntent` semantics. */
  readonly side: 'SHORT' | 'LONG';
}

export interface PackageMarkResult {
  readonly contractVersion: typeof command5aMarkSemanticsVersion;
  readonly markType: 'SINGLE_LEG_MID' | 'DEFINED_RISK_PACKAGE_MID';
  readonly markModelVersion: typeof command5aMarkSemanticsVersion;
  readonly legCount: number;
  readonly legMarks: readonly { readonly optionSymbol: string; readonly mid: number | null; readonly impliedVolatility: number | null }[];
  readonly packageMark: number | null;
  readonly packageBidIfDefined: number | null;
  readonly packageAskIfDefined: number | null;
  readonly quality: 'GOOD' | 'PARTIAL' | 'STALE' | 'INVALID';
  readonly identifiability: MarkIdentifiability;
  /** Single scalar IV, present only for genuinely single-leg subjects. */
  readonly singleLegImpliedVolatility: number | null;
  /** Leg-level IV/Greeks, always present for multi-leg subjects and never
   * averaged into one scalar. */
  readonly shortLegImpliedVolatility: number | null;
  readonly longLegImpliedVolatility: number | null;
}

function mid(bid: number | null, ask: number | null): number | null {
  if (bid === null || ask === null) return null;
  return (bid + ask) / 2;
}

function worstQuality(quotes: readonly ContractPathQuoteObservation[]): 'GOOD' | 'PARTIAL' | 'STALE' | 'INVALID' {
  const rank: Readonly<Record<ContractPathQuoteObservation['quality'], number>> = { GOOD: 0, PARTIAL: 1, STALE: 2, INVALID: 3 };
  return quotes.reduce((worst, q) => (rank[q.quality] > rank[worst] ? q.quality : worst), 'GOOD' as ContractPathQuoteObservation['quality']);
}

/**
 * Computes real mark/IV semantics from Codex's observed per-leg quotes,
 * joined by `optionSymbol` against the real leg identity (side) known
 * from the shadow episode contract at decision time. Never coerces a
 * missing value to zero; a package mark that cannot be constructed from
 * real bid/ask stays `null` with `identifiability: 'NOT_IDENTIFIABLE'`.
 */
export function computePackageMark(input: {
  readonly legIdentities: readonly LegIdentityForMark[];
  readonly quotes: readonly ContractPathQuoteObservation[];
}): PackageMarkResult {
  if (input.legIdentities.length === 0 || input.quotes.length !== input.legIdentities.length) {
    throw new Error('COMMAND5A_MARK_LEG_COVERAGE_INVALID');
  }
  const bySymbol = new Map(input.quotes.map((q) => [q.optionSymbol, q] as const));
  const joined = input.legIdentities.map((identity) => {
    const quote = bySymbol.get(identity.optionSymbol);
    if (quote === undefined) throw new Error(`COMMAND5A_MARK_LEG_NOT_OBSERVED:${identity.optionSymbol}`);
    return { identity, quote };
  });
  const legMarks = joined.map(({ identity, quote }) => ({
    optionSymbol: identity.optionSymbol, mid: mid(quote.bid, quote.ask), impliedVolatility: quote.impliedVolatility,
  }));
  const quality = worstQuality(input.quotes);

  if (input.legIdentities.length === 1) {
    const only = joined[0];
    if (only === undefined) throw new Error('COMMAND5A_MARK_INTERNAL_EMPTY');
    const singleMid = mid(only.quote.bid, only.quote.ask);
    return {
      contractVersion: command5aMarkSemanticsVersion, markType: 'SINGLE_LEG_MID', markModelVersion: command5aMarkSemanticsVersion,
      legCount: 1, legMarks, packageMark: singleMid, packageBidIfDefined: only.quote.bid, packageAskIfDefined: only.quote.ask,
      quality, identifiability: singleMid === null ? 'NOT_IDENTIFIABLE' : 'PRESENT_VALID',
      singleLegImpliedVolatility: only.quote.impliedVolatility, shortLegImpliedVolatility: null, longLegImpliedVolatility: null,
    };
  }

  if (input.legIdentities.length !== 2) throw new Error('COMMAND5A_MARK_UNSUPPORTED_LEG_COUNT');
  const short = joined.find((j) => j.identity.side === 'SHORT');
  const long = joined.find((j) => j.identity.side === 'LONG');
  if (short === undefined || long === undefined) throw new Error('COMMAND5A_MARK_DEFINED_RISK_ROLE_MISSING');

  // Conservative-side package pricing, matching definedRiskCandidate()'s
  // real netCredit = shortPut.bid - longPut.ask convention exactly.
  const packageBidIfDefined = short.quote.bid !== null && long.quote.ask !== null ? short.quote.bid - long.quote.ask : null;
  const packageAskIfDefined = short.quote.ask !== null && long.quote.bid !== null ? short.quote.ask - long.quote.bid : null;
  const packageMark = mid(packageBidIfDefined, packageAskIfDefined);

  return {
    contractVersion: command5aMarkSemanticsVersion, markType: 'DEFINED_RISK_PACKAGE_MID', markModelVersion: command5aMarkSemanticsVersion,
    legCount: 2, legMarks, packageMark, packageBidIfDefined, packageAskIfDefined, quality,
    identifiability: packageMark === null ? 'NOT_IDENTIFIABLE' : 'PRESENT_VALID',
    singleLegImpliedVolatility: null,
    shortLegImpliedVolatility: short.quote.impliedVolatility, longLegImpliedVolatility: long.quote.impliedVolatility,
  };
}
