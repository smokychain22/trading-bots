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
  readonly expiration: string;
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

export interface DefinedRiskEconomics {
  readonly contractVersion: typeof definedRiskEconomicsVersion;
  readonly underlying: string;
  readonly snapshotId: string | null;
  readonly candidateId: string | null;
  readonly optionType: DefinedRiskOptionType;
  readonly structureValidity: DefinedRiskStructureValidity;
  /** Named reasons for invalidity -- never a single boolean with no
   * explanation. Non-empty only when `structureValidity === 'INVALID'`. */
  readonly invalidReasons: readonly string[];
  readonly widthPerShare: number | null;
  /** Bid-side-short-minus-ask-side-long, the conservative executable
   * reference already used everywhere else in this codebase for a net
   * credit -- never the midpoint. */
  readonly netCreditPerShare: number | null;
  readonly netCreditPerContract: number | null;
  readonly positionNetCredit: number | null;
  readonly maxProfitPerContract: number | null;
  readonly maxLossPerContract: number | null;
  readonly positionMaxProfit: number | null;
  readonly positionMaxLoss: number | null;
  readonly breakEven: number | null;
  /** Standard regulatory approximation for a credit spread's capital
   * requirement: width * multiplier. This module does not claim to know
   * the caller's actual broker margin requirement, which may differ. */
  readonly capitalRequiredPerContract: number | null;
  readonly positionCapitalRequired: number | null;
  /** In [0,1] when both are known and maxLossPerContract > 0; `null`
   * otherwise -- never a fabricated ratio. */
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

/**
 * Computes descriptive economics for one recorded/hypothetical two-leg
 * defined-risk structure. Fails closed (reports `INVALID` with named
 * reasons, never a fabricated number) on: non-finite required inputs,
 * mismatched short/long multipliers, non-positive width, strikes on the
 * wrong side for the stated option type, or a net credit that would make
 * `maxLossPerContract` negative (an impossible payoff, not merely an
 * unattractive one).
 */
export function computeDefinedRiskEconomics(input: DefinedRiskStructureInput): DefinedRiskEconomics {
  const reasons: string[] = [];
  const requiredFinite: readonly [string, number][] = [
    ['shortStrike', input.shortStrike], ['longStrike', input.longStrike],
    ['shortMultiplier', input.shortMultiplier], ['longMultiplier', input.longMultiplier], ['quantity', input.quantity],
  ];
  for (const [name, value] of requiredFinite) if (!Number.isFinite(value)) reasons.push(`${name.toUpperCase()}_NON_FINITE`);
  if (input.shortMultiplier !== input.longMultiplier) reasons.push('MISMATCHED_MULTIPLIER');
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) reasons.push('QUANTITY_NOT_POSITIVE_INTEGER');

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

  const hasQuote = finite(input.shortBid) && finite(input.shortAsk) && finite(input.longBid) && finite(input.longAsk)
    && input.shortBid >= 0 && input.shortAsk >= input.shortBid && input.longBid >= 0 && input.longAsk >= input.longBid;
  const netCreditPerShare = hasQuote ? (input.shortBid as number) - (input.longAsk as number) : null;

  const multiplier = input.shortMultiplier;
  const widthPerShare = reasons.length === 0 ? width : null;
  const maxLossPerContractRaw = widthPerShare !== null && netCreditPerShare !== null
    ? (widthPerShare - netCreditPerShare) * multiplier : null;
  if (maxLossPerContractRaw !== null && maxLossPerContractRaw < 0) reasons.push('NET_CREDIT_EXCEEDS_WIDTH_IMPOSSIBLE_MAX_LOSS');

  const structureValidity: DefinedRiskStructureValidity = reasons.length === 0 ? 'VALID' : 'INVALID';
  if (structureValidity === 'INVALID') {
    return {
      contractVersion: definedRiskEconomicsVersion, underlying: input.underlying, snapshotId: input.snapshotId,
      candidateId: input.candidateId, optionType: input.optionType, structureValidity, invalidReasons: [...new Set(reasons)].sort(),
      widthPerShare: null, netCreditPerShare: null, netCreditPerContract: null, positionNetCredit: null,
      maxProfitPerContract: null, maxLossPerContract: null, positionMaxProfit: null, positionMaxLoss: null, breakEven: null,
      capitalRequiredPerContract: null, positionCapitalRequired: null, creditToMaxLossRatio: null, creditToWidthRatio: null,
      distanceFromSpotToBreakEvenDollars: null, expectedMoveDollars: input.expectedMoveDollars,
      shortImpliedVolatility: input.shortImpliedVolatility,
      longImpliedVolatility: input.longImpliedVolatility, shortMinusLongImpliedVolatility: null,
      eventContextKnown: input.eventContextKnown, liquidityEvidenceKnown: input.liquidityEvidenceKnown, brokerAuthority: false,
    };
  }

  const netCreditPerContract = netCreditPerShare !== null ? netCreditPerShare * multiplier : null;
  const maxProfitPerContract = netCreditPerContract;
  const maxLossPerContract = maxLossPerContractRaw;
  const capitalRequiredPerContract = (widthPerShare as number) * multiplier;
  const breakEven = netCreditPerShare !== null
    ? input.optionType === 'PUT' ? input.shortStrike - netCreditPerShare : input.shortStrike + netCreditPerShare
    : null;
  const ivKnown = finite(input.shortImpliedVolatility) && finite(input.longImpliedVolatility);

  return {
    contractVersion: definedRiskEconomicsVersion, underlying: input.underlying, snapshotId: input.snapshotId,
    candidateId: input.candidateId, optionType: input.optionType, structureValidity, invalidReasons: [],
    widthPerShare, netCreditPerShare, netCreditPerContract, positionNetCredit: netCreditPerContract !== null ? netCreditPerContract * input.quantity : null,
    maxProfitPerContract, maxLossPerContract, positionMaxProfit: maxProfitPerContract !== null ? maxProfitPerContract * input.quantity : null,
    positionMaxLoss: maxLossPerContract !== null ? maxLossPerContract * input.quantity : null, breakEven,
    capitalRequiredPerContract, positionCapitalRequired: capitalRequiredPerContract * input.quantity,
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

/**
 * Reports the exact numeric difference on each comparable dimension
 * between two VALID structures -- never a "winner," never an aggregate
 * score, never a recommendation. A dimension unknown on either side is
 * skipped, never assumed equal.
 */
export function compareDefinedRiskStructures(a: DefinedRiskEconomics, b: DefinedRiskEconomics): readonly DefinedRiskDimensionalDifference[] {
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
  return differences;
}
