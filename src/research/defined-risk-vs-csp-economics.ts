import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import type { DefinedRiskEconomics } from './defined-risk-economics.js';

/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO applicability/eligibility/routing/promotion authority and never
 * claims `DEFINED_RISK_IS_BETTER` or any winner of any kind. Defined-Risk
 * descriptive economics already exist and are canonical
 * (`defined-risk-economics.ts`'s `computeDefinedRiskEconomics`) -- this
 * module does not rebuild that. It adds only the missing PAIRED
 * comparison against a Conventional cash-secured put recorded at the
 * SAME underlying and snapshot, per the directive's "same underlying,
 * timestamp/snapshot, expiry context where meaningful; no winner" rule.
 *
 * Unit discipline mirrors `defined-risk-economics.ts` exactly (the
 * standing lesson from the rejected `a8143cc` comparator, which mixed
 * per-share/per-contract/position quantities): every monetary field
 * states its own unit -- `*PerShare` / `*PerContract` / `position*`.
 * CSP collateral reuses the exact canonical formula already used by
 * `canonical-strategy-frontier.ts` (`collateral = strike * multiplier`)
 * -- never re-derived differently here.
 */
export const definedRiskVsCspEconomicsVersion = 'theta-defined-risk-vs-csp-economics-v1' as const;

export interface ConventionalCspStructureInput {
  readonly underlying: string;
  readonly snapshotId: string | null;
  readonly candidateId: string | null;
  readonly expiration: string;
  readonly optionSymbol: string;
  readonly strike: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly multiplier: number;
  readonly quantity: number;
  readonly delta: number | null;
  readonly impliedVolatility: number | null;
  readonly underlyingPrice: number | null;
  readonly expectedMoveDollars: number | null;
}

export type ConventionalCspStructureValidity = 'VALID' | 'INVALID';

export interface ConventionalCspEconomics {
  readonly contractVersion: typeof definedRiskVsCspEconomicsVersion;
  readonly underlying: string;
  readonly snapshotId: string | null;
  readonly candidateId: string | null;
  readonly optionSymbol: string;
  readonly expiration: string;
  readonly structureValidity: ConventionalCspStructureValidity;
  readonly invalidReasons: readonly string[];
  readonly multiplier: number | null;
  readonly quantity: number | null;
  readonly premiumPerShare: number | null;
  readonly premiumPerContract: number | null;
  readonly positionPremium: number | null;
  /** `strike * multiplier` -- the exact canonical CSP collateral formula
   * already used in `canonical-strategy-frontier.ts`, reused verbatim. */
  readonly collateralPerContract: number | null;
  readonly positionCollateral: number | null;
  /** Conventional textbook maximum loss for a naked short put: stock
   * goes to zero, i.e. `collateralPerContract - premiumPerContract`. This
   * is a bounding assumption, not empirical evidence, and is reported as
   * such -- never claimed to equal a broker's actual worst-case margin. */
  readonly maxLossPerContract: number | null;
  readonly positionMaxLoss: number | null;
  readonly maxProfitPerContract: number | null;
  readonly breakEven: number | null;
  readonly distanceFromSpotToBreakEvenDollars: number | null;
  readonly creditToCollateralRatio: number | null;
  readonly delta: number | null;
  readonly impliedVolatility: number | null;
  readonly expectedMoveDollars: number | null;
  readonly brokerAuthority: false;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function computeConventionalCspEconomics(input: ConventionalCspStructureInput): ConventionalCspEconomics {
  const reasons: string[] = [];
  if (!Number.isFinite(input.strike) || input.strike <= 0) reasons.push('STRIKE_NON_FINITE_OR_NON_POSITIVE');
  if (!Number.isInteger(input.multiplier) || input.multiplier <= 0) reasons.push('MULTIPLIER_INVALID');
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) reasons.push('QUANTITY_NOT_POSITIVE_INTEGER');
  if (input.underlying.trim().length === 0) reasons.push('UNDERLYING_REQUIRED');
  if (input.optionSymbol.trim().length === 0) reasons.push('OPTION_SYMBOL_REQUIRED');

  const parsedContract = reasons.length === 0 ? parseOccOptionSymbol(input.optionSymbol) : null;
  if (reasons.length === 0) {
    if (parsedContract === null) reasons.push('OPTION_SYMBOL_INVALID');
    else {
      if (parsedContract.underlying !== input.underlying) reasons.push('CONTRACT_UNDERLYING_MISMATCH');
      if (parsedContract.optionType !== 'PUT') reasons.push('CONTRACT_NOT_PUT');
      if (parsedContract.expiration !== input.expiration) reasons.push('CONTRACT_EXPIRATION_MISMATCH');
      if (Math.abs(parsedContract.strike - input.strike) > 1e-9) reasons.push('CONTRACT_STRIKE_MISMATCH');
    }
  }

  if (reasons.length > 0) {
    return {
      contractVersion: definedRiskVsCspEconomicsVersion, underlying: input.underlying, snapshotId: input.snapshotId,
      candidateId: input.candidateId, optionSymbol: input.optionSymbol, expiration: input.expiration,
      structureValidity: 'INVALID', invalidReasons: [...new Set(reasons)].sort(),
      multiplier: null, quantity: null, premiumPerShare: null, premiumPerContract: null, positionPremium: null,
      collateralPerContract: null, positionCollateral: null, maxLossPerContract: null, positionMaxLoss: null,
      maxProfitPerContract: null, breakEven: null, distanceFromSpotToBreakEvenDollars: null, creditToCollateralRatio: null,
      delta: input.delta, impliedVolatility: input.impliedVolatility, expectedMoveDollars: input.expectedMoveDollars,
      brokerAuthority: false,
    };
  }

  const hasQuote = finite(input.bid) && finite(input.ask) && input.bid >= 0 && input.ask >= input.bid;
  const premiumPerShare = hasQuote ? (input.bid as number) : null;
  const premiumPerContract = premiumPerShare !== null ? premiumPerShare * input.multiplier : null;
  const positionPremium = premiumPerContract !== null ? premiumPerContract * input.quantity : null;
  const collateralPerContract = input.strike * input.multiplier;
  const positionCollateral = collateralPerContract * input.quantity;
  const maxLossPerContract = premiumPerContract !== null ? collateralPerContract - premiumPerContract : null;
  const positionMaxLoss = maxLossPerContract !== null ? maxLossPerContract * input.quantity : null;
  const breakEven = premiumPerShare !== null ? input.strike - premiumPerShare : null;
  const distanceFromSpotToBreakEvenDollars = breakEven !== null && finite(input.underlyingPrice) ? breakEven - input.underlyingPrice : null;
  const creditToCollateralRatio = premiumPerContract !== null && collateralPerContract > 0 ? premiumPerContract / collateralPerContract : null;

  return {
    contractVersion: definedRiskVsCspEconomicsVersion, underlying: input.underlying, snapshotId: input.snapshotId,
    candidateId: input.candidateId, optionSymbol: input.optionSymbol, expiration: input.expiration,
    structureValidity: 'VALID', invalidReasons: [],
    multiplier: input.multiplier, quantity: input.quantity, premiumPerShare, premiumPerContract, positionPremium,
    collateralPerContract, positionCollateral, maxLossPerContract, positionMaxLoss, maxProfitPerContract: premiumPerContract,
    breakEven, distanceFromSpotToBreakEvenDollars, creditToCollateralRatio,
    delta: input.delta, impliedVolatility: input.impliedVolatility, expectedMoveDollars: input.expectedMoveDollars,
    brokerAuthority: false,
  };
}

export type DefinedRiskVsCspDimension = 'netCreditPerContract' | 'capitalRequiredPerContract' | 'maxLossPerContract' | 'breakEven' | 'creditToCapitalRatio';

export interface DefinedRiskVsCspDimensionalDifference {
  readonly dimension: DefinedRiskVsCspDimension;
  readonly definedRiskValue: number;
  readonly cspValue: number;
  readonly difference: number;
}

export interface DefinedRiskVsCspComparison {
  readonly pairable: boolean;
  readonly unpairableReason: 'UNDERLYING_MISMATCH' | 'SNAPSHOT_MISMATCH' | null;
  /** Defined-Risk-only context with no CSP analog (a long leg has no
   * counterpart in a naked short put) -- reported as a plain fact, never
   * part of the dimensional-difference comparison below. */
  readonly definedRiskLongLegCostPerContract: number | null;
  readonly differences: readonly DefinedRiskVsCspDimensionalDifference[];
  readonly brokerAuthority: false;
}

/**
 * Compares a Defined-Risk structure's economics to a Conventional CSP's
 * economics recorded at the SAME underlying and snapshot only. Reports
 * only signed numeric differences per named dimension -- no
 * DEFINED_RISK_IS_BETTER, no score, no ranking of any kind.
 */
export function compareDefinedRiskToConventionalCsp(
  definedRisk: DefinedRiskEconomics, csp: ConventionalCspEconomics, definedRiskLongLegAsk: number | null,
): DefinedRiskVsCspComparison {
  if (definedRisk.underlying !== csp.underlying) {
    return { pairable: false, unpairableReason: 'UNDERLYING_MISMATCH', definedRiskLongLegCostPerContract: null, differences: [], brokerAuthority: false };
  }
  if (definedRisk.snapshotId !== csp.snapshotId) {
    return { pairable: false, unpairableReason: 'SNAPSHOT_MISMATCH', definedRiskLongLegCostPerContract: null, differences: [], brokerAuthority: false };
  }

  const definedRiskLongLegCostPerContract = finite(definedRiskLongLegAsk) && finite(definedRisk.multiplier)
    ? definedRiskLongLegAsk * (definedRisk.multiplier as number) : null;

  const dims: readonly [DefinedRiskVsCspDimension, number | null, number | null][] = [
    ['netCreditPerContract', definedRisk.netCreditPerContract, csp.premiumPerContract],
    ['capitalRequiredPerContract', definedRisk.capitalRequiredPerContract, csp.collateralPerContract],
    ['maxLossPerContract', definedRisk.maxLossPerContract, csp.maxLossPerContract],
    ['breakEven', definedRisk.breakEven, csp.breakEven],
    ['creditToCapitalRatio', definedRisk.creditToMaxLossRatio, csp.creditToCollateralRatio],
  ];
  const differences: DefinedRiskVsCspDimensionalDifference[] = [];
  for (const [dimension, definedRiskValue, cspValue] of dims) {
    if (!finite(definedRiskValue) || !finite(cspValue)) continue;
    const difference = definedRiskValue - cspValue;
    if (Number.isFinite(difference)) differences.push({ dimension, definedRiskValue, cspValue, difference });
  }
  return { pairable: true, unpairableReason: null, definedRiskLongLegCostPerContract, differences, brokerAuthority: false };
}
