import { parseOccOptionSymbol } from '../theta/account-exposure.js';

export const definedRiskEconomicsVersion = 'theta-defined-risk-economics-v1' as const;

/**
 * Research/shadow only. `brokerAuthority: false` always. This module does
 * NOT decide which spread should be traded, does not route, and does not
 * carry any eligibility/applicability/promotion verdict of any kind --
 * THETA_DEFINED_RISK's own canonical candidate generation and hard
 * feasibility gates already exist in `canonical-strategy-frontier.ts`'s
 * `definedRiskCandidate` (width/net-credit/max-profit/max-loss, with
 * `INVALID_SPREAD_WIDTH`/`MISMATCHED_EXPIRATION`/`MISMATCHED_MULTIPLIER`/
 * `NON_POSITIVE_NET_CREDIT` hard blockers) -- this module is a SEPARATE,
 * strictly descriptive ENRICHMENT layer for a RECORDED/hypothetical
 * two-leg structure, exposing dimensions that module does not (explicit
 * per-share/per-contract/position unit separation, credit-to-width and
 * credit-to-max-loss ratios, distance to a caller-supplied expected move).
 * It never claims a candidate is `ELIGIBLE`/`TRADE`/`PREFERRED`/`BETTER`.
 *
 * Unit discipline (the exact lesson from `a8143cc`'s rejected comparator,
 * which mixed per-share and per-position quantities): every monetary
 * field name states its own unit explicitly --
 * `*PerShare` (one share/unit of the underlying),
 * `*PerContract` (one option contract, i.e. `*PerShare * multiplier`),
 * `position*` (the full requested quantity, i.e. `*PerContract * quantity`).
 * No field is ever a bare, ambiguous dollar amount.
 */
export type DefinedRiskOptionType = 'PUT' | 'CALL';

export interface DefinedRiskStructureInput {
  readonly underlying: string;
  readonly snapshotId: string | null;
  readonly candidateId: string | null;
  readonly optionType: DefinedRiskOptionType;
  readonly shortExpiration: string;
  readonly longExpiration: string;
  readonly shortOptionSymbol: string;
  readonly longOptionSymbol: string;
  readonly shortStrike: number;
  readonly longStrike: number;
  readonly shortBid: number | null;
  readonly shortAsk: number | null;
  readonly longBid: number | null;
  readonly longAsk: number | null;
  readonly shortMultiplier: number;
  readonly longMultiplier: number;
  readonly quantity: number;
  readonly shortDelta: number | null;
  readonly longDelta: number | null;
  readonly shortImpliedVolatility: number | null;
  readonly longImpliedVolatility: number | null;
  /** Current underlying reference price -- required to relate `breakEven`
   * to a distance from spot; `null` = UNKNOWN. */
  readonly underlyingPrice: number | null;
  /** Caller-supplied expected-move distance (dollars) from the current
   * underlying price -- this module has no expected-move model of its
   * own and never fabricates one. `null` = UNKNOWN. */
  readonly expectedMoveDollars: number | null;
  readonly eventContextKnown: boolean;
  readonly liquidityEvidenceKnown: boolean;
}

export type DefinedRiskStructureValidity = 'VALID' | 'INVALID';
export type DefinedRiskEconomicsState = 'KNOWN' | 'UNKNOWN' | 'INVALID';

export interface DefinedRiskEconomics {
  readonly contractVersion: typeof definedRiskEconomicsVersion;
  readonly underlying: string;
  readonly snapshotId: string | null;
  readonly candidateId: string | null;
  readonly optionType: DefinedRiskOptionType;
  readonly shortOptionSymbol: string;
  readonly longOptionSymbol: string;
  readonly shortExpiration: string;
  readonly longExpiration: string;
  readonly multiplier: number | null;
  readonly quantity: number | null;
  readonly structureValidity: DefinedRiskStructureValidity;
  /** Named reasons for invalidity -- never a single boolean with no
   * explanation. Non-empty only when `structureValidity === 'INVALID'`. */
  readonly invalidReasons: readonly string[];
  readonly economicsState: DefinedRiskEconomicsState;
  readonly unknownReasons: readonly string[];
  readonly widthPerShare: number | null;
  /** Bid-side-short-minus-ask-side-long, the conservative executable
   * reference already used everywhere else in this codebase for a net
   * credit -- never the midpoint. */
  readonly netCreditPerShare: number | null;
  readonly creditPriceBasis: 'NATURAL_CONSERVATIVE' | null;
  readonly netCreditPerContract: number | null;
  readonly positionNetCredit: number | null;
  readonly maxProfitPerContract: number | null;
  readonly maxLossPerContract: number | null;
  readonly positionMaxProfit: number | null;
  readonly positionMaxLoss: number | null;
  readonly breakEven: number | null;
  /** Structural maximum capital at risk: maximum loss per contract. This
   * module does not claim to know the broker's actual buying-power effect,
   * which must remain separately sourced from broker truth. */
  readonly capitalRequiredPerContract: number | null;
  readonly positionCapitalRequired: number | null;
  /** Non-negative reward-to-risk ratio when both values are known and
   * maxLossPerContract > 0. It may exceed 1, so no false [0,1] bound is
   * claimed. `null` otherwise. */
  readonly creditToMaxLossRatio: number | null;
  readonly creditToWidthRatio: number | null;
  /** Signed distance (dollars) from the current underlying price to
   * `breakEven` -- positive means break-even is above spot, negative
   * means below. Reported as a plain geometric fact; this module does
   * NOT compare it against `expectedMoveDollars` or judge whether the
   * structure is "safe" -- that comparison, if wanted, belongs to the
   * caller. */
  readonly distanceFromSpotToBreakEvenDollars: number | null;
  readonly expectedMoveDollars: number | null;
  readonly shortImpliedVolatility: number | null;
  readonly longImpliedVolatility: number | null;
  /** Plain fact only, per the standing rule against implicitly treating
   * IV/skew differences as a ranking signal -- reported, never scored. */
  readonly shortMinusLongImpliedVolatility: number | null;
  readonly eventContextKnown: boolean;
  readonly liquidityEvidenceKnown: boolean;
  readonly brokerAuthority: false;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

const missing = (value: string): boolean => value.trim().length === 0;
const optionalNonFinite = (value: number | null): boolean => value !== null && !Number.isFinite(value);

/**
 * Computes descriptive economics for one recorded/hypothetical two-leg
 * defined-risk structure. Fails closed (reports `INVALID` with named
 * reasons, never a fabricated number) on: non-finite required inputs,
 * mismatched short/long multipliers or expirations, non-positive width,
 * strikes on the wrong side for the stated option type, invalid quotes,
 * or a non-positive/impossible credit payoff.
 */
export function computeDefinedRiskEconomics(input: DefinedRiskStructureInput): DefinedRiskEconomics {
  const reasons: string[] = [];
  const unknownReasons: string[] = [];
  const requiredFinite: readonly [string, number][] = [
    ['shortStrike', input.shortStrike], ['longStrike', input.longStrike],
    ['shortMultiplier', input.shortMultiplier], ['longMultiplier', input.longMultiplier], ['quantity', input.quantity],
  ];
  for (const [name, value] of requiredFinite) if (!Number.isFinite(value)) reasons.push(`${name.toUpperCase()}_NON_FINITE`);
  if (missing(input.underlying)) reasons.push('UNDERLYING_IDENTITY_MISSING');
  if (missing(input.shortOptionSymbol)) reasons.push('SHORT_CONTRACT_IDENTITY_MISSING');
  if (missing(input.longOptionSymbol)) reasons.push('LONG_CONTRACT_IDENTITY_MISSING');
  if (!missing(input.shortOptionSymbol) && input.shortOptionSymbol === input.longOptionSymbol) reasons.push('DUPLICATE_CONTRACT_IDENTITY');
  const shortContract = missing(input.shortOptionSymbol) ? null : parseOccOptionSymbol(input.shortOptionSymbol);
  const longContract = missing(input.longOptionSymbol) ? null : parseOccOptionSymbol(input.longOptionSymbol);
  if (!missing(input.shortOptionSymbol) && shortContract === null) reasons.push('SHORT_CONTRACT_IDENTITY_INVALID');
  if (!missing(input.longOptionSymbol) && longContract === null) reasons.push('LONG_CONTRACT_IDENTITY_INVALID');
  if (missing(input.shortExpiration) || missing(input.longExpiration)) reasons.push('EXPIRATION_IDENTITY_MISSING');
  else if (input.shortExpiration !== input.longExpiration) reasons.push('MISMATCHED_EXPIRATION');
  if (!['PUT', 'CALL'].includes(input.optionType)) reasons.push('OPTION_TYPE_INVALID');
  if (shortContract !== null) {
    if (shortContract.underlying !== input.underlying) reasons.push('SHORT_CONTRACT_UNDERLYING_MISMATCH');
    if (shortContract.expiration !== input.shortExpiration) reasons.push('SHORT_CONTRACT_EXPIRATION_MISMATCH');
    if (shortContract.optionType !== input.optionType) reasons.push('SHORT_CONTRACT_OPTION_TYPE_MISMATCH');
    if (Math.abs(shortContract.strike - input.shortStrike) > 1e-9) reasons.push('SHORT_CONTRACT_STRIKE_MISMATCH');
  }
  if (longContract !== null) {
    if (longContract.underlying !== input.underlying) reasons.push('LONG_CONTRACT_UNDERLYING_MISMATCH');
    if (longContract.expiration !== input.longExpiration) reasons.push('LONG_CONTRACT_EXPIRATION_MISMATCH');
    if (longContract.optionType !== input.optionType) reasons.push('LONG_CONTRACT_OPTION_TYPE_MISMATCH');
    if (Math.abs(longContract.strike - input.longStrike) > 1e-9) reasons.push('LONG_CONTRACT_STRIKE_MISMATCH');
  }
  if (input.shortMultiplier !== input.longMultiplier) reasons.push('MISMATCHED_MULTIPLIER');
  if (!Number.isInteger(input.shortMultiplier) || input.shortMultiplier <= 0
    || !Number.isInteger(input.longMultiplier) || input.longMultiplier <= 0) reasons.push('MULTIPLIER_NOT_POSITIVE_INTEGER');
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) reasons.push('QUANTITY_NOT_POSITIVE_INTEGER');
  for (const [name, value] of [
    ['SHORT_BID', input.shortBid], ['SHORT_ASK', input.shortAsk], ['LONG_BID', input.longBid], ['LONG_ASK', input.longAsk],
    ['UNDERLYING_PRICE', input.underlyingPrice], ['EXPECTED_MOVE', input.expectedMoveDollars],
    ['SHORT_DELTA', input.shortDelta], ['LONG_DELTA', input.longDelta],
    ['SHORT_IV', input.shortImpliedVolatility], ['LONG_IV', input.longImpliedVolatility],
  ] as const) if (optionalNonFinite(value)) reasons.push(`${name}_NON_FINITE`);
  if (finite(input.underlyingPrice) && input.underlyingPrice <= 0) reasons.push('UNDERLYING_PRICE_NOT_POSITIVE');
  if (finite(input.expectedMoveDollars) && input.expectedMoveDollars < 0) reasons.push('EXPECTED_MOVE_NEGATIVE');
  if (finite(input.shortImpliedVolatility) && input.shortImpliedVolatility < 0) reasons.push('SHORT_IV_NEGATIVE');
  if (finite(input.longImpliedVolatility) && input.longImpliedVolatility < 0) reasons.push('LONG_IV_NEGATIVE');
  if (finite(input.shortDelta) && Math.abs(input.shortDelta) > 1) reasons.push('SHORT_DELTA_OUT_OF_RANGE');
  if (finite(input.longDelta) && Math.abs(input.longDelta) > 1) reasons.push('LONG_DELTA_OUT_OF_RANGE');

  // For a PUT credit spread, width = shortStrike - longStrike is positive
  // if and only if the short strike is genuinely above the long strike
  // (the correct side for a PUT credit spread); the mirror holds for a
  // CALL credit spread. The sign of this one quantity therefore already
  // encodes both "is the width positive" and "are the strikes on the
  // correct side" -- there is no case where the strikes are mis-ordered
  // for the stated option type AND this width computes positive, so a
  // single named reason covers both failure descriptions honestly.
  const width = input.optionType === 'PUT' ? input.shortStrike - input.longStrike : input.longStrike - input.shortStrike;
  if (Number.isFinite(width) && width <= 0) {
    reasons.push(`WIDTH_NOT_POSITIVE_OR_STRIKES_MISORDERED_FOR_${input.optionType}_CREDIT_SPREAD`);
  }

  const quoteFields = [input.shortBid, input.shortAsk, input.longBid, input.longAsk];
  const hasAllQuoteFields = quoteFields.every(finite);
  if (!hasAllQuoteFields && !quoteFields.some(optionalNonFinite)) unknownReasons.push('TWO_LEG_QUOTE_INCOMPLETE');
  if (hasAllQuoteFields && ((input.shortBid as number) < 0 || (input.shortAsk as number) < 0
    || (input.longBid as number) < 0 || (input.longAsk as number) < 0)) reasons.push('NEGATIVE_OPTION_QUOTE');
  if (hasAllQuoteFields && (input.shortAsk as number) < (input.shortBid as number)) reasons.push('SHORT_QUOTE_CROSSED');
  if (hasAllQuoteFields && (input.longAsk as number) < (input.longBid as number)) reasons.push('LONG_QUOTE_CROSSED');
  const hasQuote = hasAllQuoteFields && !reasons.some((reason) => ['NEGATIVE_OPTION_QUOTE', 'SHORT_QUOTE_CROSSED', 'LONG_QUOTE_CROSSED'].includes(reason));
  const netCreditPerShare = hasQuote ? (input.shortBid as number) - (input.longAsk as number) : null;
  if (netCreditPerShare !== null && netCreditPerShare <= 0) reasons.push('NON_POSITIVE_NET_CREDIT');
  if (Number.isFinite(width) && netCreditPerShare !== null && netCreditPerShare >= width) {
    reasons.push('NET_CREDIT_NOT_LESS_THAN_WIDTH');
  }

  const multiplier = input.shortMultiplier;
  const widthPerShare = reasons.length === 0 ? width : null;
  const maxLossPerContractRaw = widthPerShare !== null && netCreditPerShare !== null
    ? (widthPerShare - netCreditPerShare) * multiplier : null;
  if (maxLossPerContractRaw !== null && maxLossPerContractRaw <= 0) reasons.push('MAX_LOSS_NOT_POSITIVE');

  const structureValidity: DefinedRiskStructureValidity = reasons.length === 0 ? 'VALID' : 'INVALID';
  if (structureValidity === 'INVALID') {
    return {
      contractVersion: definedRiskEconomicsVersion, underlying: input.underlying, snapshotId: input.snapshotId,
      candidateId: input.candidateId, optionType: input.optionType, shortOptionSymbol: input.shortOptionSymbol,
      longOptionSymbol: input.longOptionSymbol, shortExpiration: input.shortExpiration, longExpiration: input.longExpiration,
      multiplier: null, quantity: Number.isInteger(input.quantity) && input.quantity > 0 ? input.quantity : null,
      structureValidity, invalidReasons: [...new Set(reasons)].sort(),
      economicsState: 'INVALID', unknownReasons: [...new Set(unknownReasons)].sort(),
      widthPerShare: null, netCreditPerShare: null, creditPriceBasis: null, netCreditPerContract: null, positionNetCredit: null,
      maxProfitPerContract: null, maxLossPerContract: null, positionMaxProfit: null, positionMaxLoss: null, breakEven: null,
      capitalRequiredPerContract: null, positionCapitalRequired: null, creditToMaxLossRatio: null, creditToWidthRatio: null,
      distanceFromSpotToBreakEvenDollars: null,
      expectedMoveDollars: finite(input.expectedMoveDollars) && input.expectedMoveDollars >= 0 ? input.expectedMoveDollars : null,
      shortImpliedVolatility: finite(input.shortImpliedVolatility) && input.shortImpliedVolatility >= 0 ? input.shortImpliedVolatility : null,
      longImpliedVolatility: finite(input.longImpliedVolatility) && input.longImpliedVolatility >= 0 ? input.longImpliedVolatility : null,
      shortMinusLongImpliedVolatility: null,
      eventContextKnown: input.eventContextKnown, liquidityEvidenceKnown: input.liquidityEvidenceKnown, brokerAuthority: false,
    };
  }

  const netCreditPerContract = netCreditPerShare !== null ? netCreditPerShare * multiplier : null;
  const maxProfitPerContract = netCreditPerContract;
  const maxLossPerContract = maxLossPerContractRaw;
  const capitalRequiredPerContract = maxLossPerContract;
  const breakEven = netCreditPerShare !== null
    ? input.optionType === 'PUT' ? input.shortStrike - netCreditPerShare : input.shortStrike + netCreditPerShare
    : null;
  const ivKnown = finite(input.shortImpliedVolatility) && finite(input.longImpliedVolatility);

  return {
    contractVersion: definedRiskEconomicsVersion, underlying: input.underlying, snapshotId: input.snapshotId,
    candidateId: input.candidateId, optionType: input.optionType, shortOptionSymbol: input.shortOptionSymbol,
    longOptionSymbol: input.longOptionSymbol, shortExpiration: input.shortExpiration, longExpiration: input.longExpiration,
    multiplier, quantity: input.quantity, structureValidity, invalidReasons: [],
    economicsState: netCreditPerShare === null ? 'UNKNOWN' : 'KNOWN', unknownReasons: [...new Set(unknownReasons)].sort(),
    widthPerShare, netCreditPerShare, creditPriceBasis: netCreditPerShare === null ? null : 'NATURAL_CONSERVATIVE',
    netCreditPerContract, positionNetCredit: netCreditPerContract !== null ? netCreditPerContract * input.quantity : null,
    maxProfitPerContract, maxLossPerContract, positionMaxProfit: maxProfitPerContract !== null ? maxProfitPerContract * input.quantity : null,
    positionMaxLoss: maxLossPerContract !== null ? maxLossPerContract * input.quantity : null, breakEven,
    capitalRequiredPerContract,
    positionCapitalRequired: capitalRequiredPerContract === null ? null : capitalRequiredPerContract * input.quantity,
    creditToMaxLossRatio: maxLossPerContract !== null && maxLossPerContract > 0 && netCreditPerContract !== null
      ? netCreditPerContract / maxLossPerContract : null,
    creditToWidthRatio: netCreditPerShare !== null && widthPerShare !== null && widthPerShare > 0 ? netCreditPerShare / widthPerShare : null,
    distanceFromSpotToBreakEvenDollars: breakEven !== null && finite(input.underlyingPrice)
      ? breakEven - input.underlyingPrice : null,
    expectedMoveDollars: input.expectedMoveDollars,
    shortImpliedVolatility: input.shortImpliedVolatility, longImpliedVolatility: input.longImpliedVolatility,
    shortMinusLongImpliedVolatility: ivKnown ? (input.shortImpliedVolatility as number) - (input.longImpliedVolatility as number) : null,
    eventContextKnown: input.eventContextKnown, liquidityEvidenceKnown: input.liquidityEvidenceKnown, brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Dimensional comparison -- named differences ONLY, never a winner/score.
// ---------------------------------------------------------------------

export interface DefinedRiskDimensionalDifference {
  readonly dimension: 'netCreditPerContract' | 'maxLossPerContract' | 'capitalRequiredPerContract' | 'breakEven' | 'creditToMaxLossRatio';
  readonly aValue: number;
  readonly bValue: number;
  readonly difference: number;
}

export interface DefinedRiskStructureComparison {
  readonly comparisonState: 'COMPARABLE' | 'NOT_COMPARABLE';
  readonly reasons: readonly string[];
  readonly differences: readonly DefinedRiskDimensionalDifference[];
  readonly brokerAuthority: false;
}

/**
 * Reports the exact numeric difference on each comparable dimension
 * between two VALID structures -- never a "winner," never an aggregate
 * score, never a recommendation. A dimension unknown on either side is
 * skipped, never assumed equal.
 */
export function compareDefinedRiskStructures(a: DefinedRiskEconomics, b: DefinedRiskEconomics): DefinedRiskStructureComparison {
  const reasons: string[] = [];
  if (a.structureValidity !== 'VALID' || b.structureValidity !== 'VALID') reasons.push('INVALID_STRUCTURE');
  if (a.underlying !== b.underlying) reasons.push('MISMATCHED_UNDERLYING');
  if (a.optionType !== b.optionType) reasons.push('MISMATCHED_OPTION_TYPE');
  if (a.shortExpiration !== b.shortExpiration || a.longExpiration !== b.longExpiration) reasons.push('MISMATCHED_EXPIRATION');
  if (a.multiplier !== b.multiplier) reasons.push('MISMATCHED_MULTIPLIER');
  if (reasons.length > 0) {
    return { comparisonState: 'NOT_COMPARABLE', reasons: [...new Set(reasons)].sort(), differences: [], brokerAuthority: false };
  }
  const dims: readonly [DefinedRiskDimensionalDifference['dimension'], number | null, number | null][] = [
    ['netCreditPerContract', a.netCreditPerContract, b.netCreditPerContract],
    ['maxLossPerContract', a.maxLossPerContract, b.maxLossPerContract],
    ['capitalRequiredPerContract', a.capitalRequiredPerContract, b.capitalRequiredPerContract],
    ['breakEven', a.breakEven, b.breakEven],
    ['creditToMaxLossRatio', a.creditToMaxLossRatio, b.creditToMaxLossRatio],
  ];
  const differences: DefinedRiskDimensionalDifference[] = [];
  for (const [dimension, aValue, bValue] of dims) {
    if (!finite(aValue) || !finite(bValue)) continue;
    differences.push({ dimension, aValue, bValue, difference: aValue - bValue });
  }
  return { comparisonState: 'COMPARABLE', reasons: [], differences, brokerAuthority: false };
}
