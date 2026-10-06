import type { BrokerOrderSnapshot } from './broker.js';

// The typed lifecycle of ONE native two-leg spread. It is deliberately NOT the Wheel lifecycle (runtime-state.ts): a spread has two legs whose fills, closes and
// expiry events can diverge, and no single-leg state can express that. Everything here derives from per-leg broker truth, never from the parent status alone.

export const definedRiskPositionVersion = 'theta-defined-risk-position-v1' as const;

export type DefinedRiskPositionState = 'PENDING_OPEN' | 'ASYMMETRIC_OPEN' | 'OPEN' | 'CLOSE_PENDING' | 'CLOSED'
  | 'EXPIRED_WORTHLESS' | 'STOCK_FROM_ASSIGNMENT' | 'DIVERGED_EMERGENCY';

export const definedRiskTerminalStates: ReadonlySet<DefinedRiskPositionState> = new Set(['CLOSED', 'EXPIRED_WORTHLESS', 'STOCK_FROM_ASSIGNMENT']);

export interface DefinedRiskLegFills {
  /** contracts of the SHORT (sold, higher strike) leg opened / closed so far, from broker leg truth */
  readonly shortOpened: number;
  readonly longOpened: number;
  readonly shortClosed: number;
  readonly longClosed: number;
}

export interface DefinedRiskExposure {
  /** contracts of the short leg still open at the broker */
  readonly shortOpen: number;
  readonly longOpen: number;
  /** short contracts with no long contract behind them: the dangerous side (an unhedged short put) */
  readonly nakedShortContracts: number;
  /** long contracts with no short behind them: limited to the premium paid, but no longer the structure that was approved */
  readonly excessLongContracts: number;
  /** complete, hedged spreads currently open */
  readonly hedgedSpreads: number;
}

export interface DefinedRiskTerminalEvents {
  /** contracts assigned on the short leg, from broker-confirmed activity only */
  readonly assignedContracts: number;
  /** contracts of the long leg exercised, from broker-confirmed activity only */
  readonly exercisedContracts: number;
  /** a broker-confirmed expiration event was recorded for the package */
  readonly expirationRecorded: boolean;
}

export interface DefinedRiskStateInput extends DefinedRiskLegFills {
  readonly requestedSpreads: number;
  readonly openOrderWorking: boolean;
  readonly closeOrderWorking: boolean;
  readonly events: DefinedRiskTerminalEvents;
}

export interface DefinedRiskStateAssessment {
  readonly state: DefinedRiskPositionState;
  readonly exposure: DefinedRiskExposure;
  /** stock contracts the broker handed us net of exercise (assigned - exercised); negative would be SHORT stock, which the Wheel can not hold */
  readonly netStockContracts: number;
  readonly reasons: readonly string[];
}

const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

export function computeDefinedRiskExposure(fills: DefinedRiskLegFills): DefinedRiskExposure {
  if (![fills.shortOpened, fills.longOpened, fills.shortClosed, fills.longClosed].every(isCount)
    || fills.shortClosed > fills.shortOpened || fills.longClosed > fills.longOpened) throw new Error('DEFINED_RISK_LEG_FILLS_INVALID');
  const shortOpen = fills.shortOpened - fills.shortClosed;
  const longOpen = fills.longOpened - fills.longClosed;
  return { shortOpen, longOpen, nakedShortContracts: Math.max(0, shortOpen - longOpen),
    excessLongContracts: Math.max(0, longOpen - shortOpen), hedgedSpreads: Math.min(shortOpen, longOpen) };
}

/**
 * Pure state derivation. The order of the rules is the safety order: an unhedged short or a short-stock outcome is an emergency no matter which workflow produced it;
 * a terminal outcome is honoured only when no leg is left open at the broker; an asymmetric or partial state is never rounded into OPEN.
 * `shortClosed`/`longClosed` must already include contracts removed by broker-confirmed assignment / exercise / expiration events.
 */
export function assessDefinedRiskState(input: DefinedRiskStateInput): DefinedRiskStateAssessment {
  const exposure = computeDefinedRiskExposure(input);
  if (!Number.isSafeInteger(input.requestedSpreads) || input.requestedSpreads <= 0) throw new Error('DEFINED_RISK_REQUESTED_QUANTITY_INVALID');
  if (!isCount(input.events.assignedContracts) || !isCount(input.events.exercisedContracts)) throw new Error('DEFINED_RISK_EVENT_COUNT_INVALID');
  const netStockContracts = input.events.assignedContracts - input.events.exercisedContracts;
  const base = { exposure, netStockContracts };
  if (netStockContracts < 0) return { ...base, state: 'DIVERGED_EMERGENCY', reasons: ['SHORT_STOCK_FROM_LONG_LEG_EXERCISE_WITHOUT_ASSIGNMENT'] };
  if (exposure.nakedShortContracts > 0) return { ...base, state: 'DIVERGED_EMERGENCY', reasons: ['NAKED_SHORT_PUT_EXPOSURE'] };
  const everOpened = input.shortOpened > 0 || input.longOpened > 0;
  if (!everOpened) return { ...base, state: 'PENDING_OPEN', reasons: ['NO_LEG_FILLED'] };
  if (exposure.excessLongContracts > 0) {
    return { ...base, state: 'ASYMMETRIC_OPEN', reasons: input.events.assignedContracts > 0 ? ['SHORT_LEG_ASSIGNED_LONG_LEG_STILL_OPEN'] : ['LONG_LEG_WITHOUT_SHORT_LEG'] };
  }
  if (exposure.hedgedSpreads === 0) {
    if (netStockContracts > 0) return { ...base, state: 'STOCK_FROM_ASSIGNMENT', reasons: ['BROKER_CONFIRMED_ASSIGNMENT'] };
    if (input.events.assignedContracts > 0) return { ...base, state: 'CLOSED', reasons: ['ASSIGNED_AND_EXERCISED_NET_FLAT'] };
    if (input.events.expirationRecorded) return { ...base, state: 'EXPIRED_WORTHLESS', reasons: ['BROKER_CONFIRMED_EXPIRATION'] };
    return { ...base, state: 'CLOSED', reasons: ['BOTH_LEGS_CLOSED'] };
  }
  if (input.closeOrderWorking || input.shortClosed > 0 || input.longClosed > 0) return { ...base, state: 'CLOSE_PENDING', reasons: ['CLOSE_IN_PROGRESS'] };
  if (input.openOrderWorking && exposure.hedgedSpreads < input.requestedSpreads) return { ...base, state: 'PENDING_OPEN', reasons: ['OPEN_ORDER_STILL_WORKING_PARTIAL_HEDGED_FILL'] };
  return { ...base, state: 'OPEN', reasons: exposure.hedgedSpreads < input.requestedSpreads ? ['OPEN_FILLED_BELOW_REQUESTED_QUANTITY'] : [] };
}

export interface DefinedRiskActualOpeningEconomics {
  readonly netCreditPerShare: number | null;
  readonly reason: 'ACTUAL_LEG_FILLS' | 'LEG_FILL_PRICE_UNKNOWN' | 'NOT_FULLY_FILLED';
}

/** Opening net credit from the ACTUAL per-leg average fills (never from the requested limit). Unknown leg prices stay unknown, never zero. */
export function actualOpeningEconomics(parent: BrokerOrderSnapshot): DefinedRiskActualOpeningEconomics {
  const short = parent.legs?.find((leg) => leg.positionIntent === 'sell_to_open');
  const long = parent.legs?.find((leg) => leg.positionIntent === 'buy_to_open');
  if (short === undefined || long === undefined || short.filledQty <= 0 || long.filledQty <= 0) return { netCreditPerShare: null, reason: 'NOT_FULLY_FILLED' };
  if (short.filledAvgPrice === null || long.filledAvgPrice === null || !Number.isFinite(short.filledAvgPrice) || !Number.isFinite(long.filledAvgPrice)) {
    return { netCreditPerShare: null, reason: 'LEG_FILL_PRICE_UNKNOWN' };
  }
  return { netCreditPerShare: Number((short.filledAvgPrice - long.filledAvgPrice).toFixed(4)), reason: 'ACTUAL_LEG_FILLS' };
}

export function actualClosingDebitPerShare(parent: BrokerOrderSnapshot): number | null {
  const short = parent.legs?.find((leg) => leg.positionIntent === 'buy_to_close');
  const long = parent.legs?.find((leg) => leg.positionIntent === 'sell_to_close');
  if (short === undefined || long === undefined || short.filledQty <= 0 || long.filledQty <= 0
    || short.filledAvgPrice === null || long.filledAvgPrice === null) return null;
  return Number((short.filledAvgPrice - long.filledAvgPrice).toFixed(4));
}
