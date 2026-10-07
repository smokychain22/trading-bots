// H (THETA_HOLD_STRIKE, short-DTE put) early-warning features and SHADOW management. Not a Q clone: short-DTE convexity
// (gamma, move speed, short realized vol, strike-distance velocity, event proximity, theta/day) drives the record.
//
// Production H policy is NO ROLL (guide 9.3); this module's action type has no ROLL member and records that explicitly.
// Feature math: MATH_REPRODUCED. Warning thresholds: research parameters (replay grids), not Production values.

import { blackScholes } from './black-scholes.js';

export const hEarlyWarningVersion = 'theta-h-early-warning-v1' as const;

export interface PriceBar { readonly at: string; readonly close: number }
export interface HObservation { readonly at: string; readonly spot: number; readonly deltaAbs: number | null }

export interface HSnapshot {
  readonly positionId: string;
  readonly observedAt: string;
  readonly strike: number;
  readonly multiplier: number;
  readonly quantity: number;
  readonly entryCreditPerShare: number;
  readonly hoursToExpiry: number;
  readonly spot: number | null;
  readonly iv: number | null;
  readonly closeAsk: number | null;
  readonly closeBid: number | null;
  /** Recent underlying bars, oldest first (intraday or daily); `barsPerYear` annualizes their realized volatility. */
  readonly recentBars: readonly PriceBar[];
  readonly barsPerYear: number;
  readonly previous: HObservation | null;
  /** Next known event time (earnings/macro) or null when none is known; undefined state is expressed with eventKnown=false. */
  readonly nextEventAt: string | null;
  readonly eventKnown: boolean;
}

export type HFeatureValue = { readonly state: 'KNOWN'; readonly value: number } | { readonly state: 'UNKNOWN'; readonly reason: string }
  | { readonly state: 'NOT_APPLICABLE'; readonly reason: string };
export interface HFeatures {
  readonly H_GAMMA: HFeatureValue;
  readonly H_DOLLAR_GAMMA_PER_1PCT: HFeatureValue;
  readonly H_DELTA_ACCELERATION: HFeatureValue;
  readonly H_MOVE_SPEED: HFeatureValue;
  readonly H_SHORT_RV: HFeatureValue;
  readonly H_DISTANCE_TO_STRIKE: HFeatureValue;
  readonly H_DISTANCE_TO_STRIKE_VELOCITY: HFeatureValue;
  readonly H_EVENT_PROXIMITY: HFeatureValue;
  readonly H_THETA_PER_DAY: HFeatureValue;
  readonly H_SPREAD_PCT: HFeatureValue;
}

export interface HResearchPolicy {
  readonly policyVersion: string;
  readonly profitCaptureTarget: number | null;
  /** TIME_EXIT when hours to expiry fall to this. */
  readonly timeExitHours: number | null;
  readonly maxDeltaAbs: number | null;
  /** Delta increase per hour that raises a warning. */
  readonly deltaAccelerationPerHour: number | null;
  /** Move speed (|recent move| in units of implied move for the same interval) that raises a warning. */
  readonly moveSpeedSigma: number | null;
  /** Short RV / IV ratio that raises a warning (realized running hotter than implied). */
  readonly shortRvToIv: number | null;
  /** Distance-to-strike (fraction of spot) below which a warning is raised. */
  readonly minDistanceToStrike: number | null;
  readonly maxSpreadPct: number | null;
  /** Number of concurrent warnings that makes RISK_CLOSE the recommendation. */
  readonly riskCloseWarningCount: number;
}

export type HManagementAction = 'HOLD' | 'TAKE_PROFIT' | 'RISK_CLOSE' | 'TIME_EXIT' | 'EXPIRY' | 'ASSIGNMENT';

export interface HShadowRecord {
  readonly contractVersion: typeof hEarlyWarningVersion;
  readonly policyVersion: string;
  readonly positionId: string;
  readonly authority: 'SHADOW_RESEARCH_NO_EXECUTION';
  readonly rollPolicy: 'NO_ROLL_PRODUCTION_POLICY';
  readonly features: HFeatures;
  readonly warnings: readonly string[];
  readonly warningLevel: 'NONE' | 'WATCH' | 'WARNING' | 'CRITICAL';
  readonly capturedFraction: number | null;
  readonly recommended: HManagementAction;
  readonly reasons: readonly string[];
}

const known = (value: number): HFeatureValue => Number.isFinite(value) ? { state: 'KNOWN', value: Number(value.toFixed(8)) } : { state: 'UNKNOWN', reason: 'NON_FINITE' };
const unknown = (reason: string): HFeatureValue => ({ state: 'UNKNOWN', reason });
const val = (f: HFeatureValue): number | null => f.state === 'KNOWN' ? f.value : null;
const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

export function computeHFeatures(s: HSnapshot): HFeatures {
  const spot = s.spot !== null && s.spot > 0 ? s.spot : null;
  const iv = s.iv !== null && s.iv > 0 ? s.iv : null;
  const years = Math.max(s.hoursToExpiry, 0) / (24 * 365);
  const size = s.multiplier * s.quantity;
  const bs = spot !== null && iv !== null ? blackScholes('PUT', spot, s.strike, years, iv) : null;
  const deltaNow = bs === null ? null : Math.abs(bs.delta);
  const returns = s.recentBars.slice(1).map((bar, i) => Math.log(bar.close / (s.recentBars[i] as PriceBar).close));
  const shortRv = returns.length >= 3 ? (() => {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    return Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1) * s.barsPerYear);
  })() : null;
  const first = s.recentBars[0]; const last = s.recentBars.at(-1);
  const interval = first !== undefined && last !== undefined ? hoursBetween(first.at, last.at) : 0;
  const moveSpeed = first !== undefined && last !== undefined && iv !== null && interval > 0
    ? Math.abs(Math.log(last.close / first.close)) / (iv * Math.sqrt(interval / (24 * 365))) : null;
  const prevHours = s.previous === null ? null : hoursBetween(s.previous.at, s.observedAt);
  const prevDelta = s.previous?.deltaAbs ?? null;
  return {
    H_GAMMA: bs === null ? unknown('SPOT_OR_IV_UNKNOWN') : known(bs.gamma * size),
    H_DOLLAR_GAMMA_PER_1PCT: bs === null || spot === null ? unknown('SPOT_OR_IV_UNKNOWN') : known(0.5 * bs.gamma * (spot * 0.01) ** 2 * size),
    H_DELTA_ACCELERATION: deltaNow === null || prevDelta === null || prevHours === null || prevHours <= 0
      ? unknown('PREVIOUS_DELTA_OR_TIME_UNKNOWN') : known((deltaNow - prevDelta) / prevHours),
    H_MOVE_SPEED: moveSpeed === null ? unknown(iv === null ? 'IV_UNKNOWN' : 'INSUFFICIENT_BARS') : known(moveSpeed),
    H_SHORT_RV: shortRv === null ? unknown('INSUFFICIENT_BARS') : known(shortRv),
    H_DISTANCE_TO_STRIKE: spot === null ? unknown('SPOT_UNKNOWN') : known((spot - s.strike) / spot),
    H_DISTANCE_TO_STRIKE_VELOCITY: spot === null || s.previous === null || prevHours === null || prevHours <= 0
      ? unknown('PREVIOUS_OBSERVATION_UNKNOWN')
      : known(((spot - s.strike) / spot - (s.previous.spot - s.strike) / s.previous.spot) / prevHours),
    H_EVENT_PROXIMITY: !s.eventKnown ? unknown('EVENT_CALENDAR_UNKNOWN')
      : s.nextEventAt === null ? { state: 'NOT_APPLICABLE', reason: 'NO_KNOWN_EVENT_SCHEDULED' }
        : known(hoursBetween(s.observedAt, s.nextEventAt)),
    H_THETA_PER_DAY: bs === null ? unknown('SPOT_OR_IV_UNKNOWN') : known(-bs.thetaPerDay * size),
    H_SPREAD_PCT: s.closeAsk !== null && s.closeBid !== null && s.closeAsk > 0 && s.closeAsk >= s.closeBid
      ? known((s.closeAsk - s.closeBid) / ((s.closeAsk + s.closeBid) / 2 || s.closeAsk)) : unknown('QUOTE_INCOMPLETE'),
  };
}

export function evaluateHShadow(s: HSnapshot, p: HResearchPolicy): HShadowRecord {
  if (!(s.strike > 0) || !(s.entryCreditPerShare > 0) || !Number.isInteger(s.quantity) || s.quantity <= 0 || !(s.multiplier > 0)) {
    throw new Error('H_SNAPSHOT_INVALID');
  }
  const f = computeHFeatures(s);
  const warnings: string[] = [];
  const iv = s.iv !== null && s.iv > 0 ? s.iv : null;
  const deltaNow = s.spot !== null && iv !== null ? Math.abs(blackScholes('PUT', s.spot, s.strike, Math.max(s.hoursToExpiry, 0) / 8760, iv).delta) : null;
  if (p.maxDeltaAbs !== null && deltaNow !== null && deltaNow >= p.maxDeltaAbs) warnings.push('DELTA_LIMIT');
  if (p.deltaAccelerationPerHour !== null && (val(f.H_DELTA_ACCELERATION) ?? -Infinity) >= p.deltaAccelerationPerHour) warnings.push('DELTA_ACCELERATING');
  if (p.moveSpeedSigma !== null && (val(f.H_MOVE_SPEED) ?? -Infinity) >= p.moveSpeedSigma) warnings.push('FAST_MOVE');
  if (p.shortRvToIv !== null && iv !== null && (val(f.H_SHORT_RV) ?? -Infinity) / iv >= p.shortRvToIv) warnings.push('REALIZED_HOTTER_THAN_IMPLIED');
  if (p.minDistanceToStrike !== null && (val(f.H_DISTANCE_TO_STRIKE) ?? Infinity) <= p.minDistanceToStrike) warnings.push('NEAR_STRIKE');
  const eventHours = val(f.H_EVENT_PROXIMITY);
  if (eventHours !== null && eventHours <= s.hoursToExpiry) warnings.push('EVENT_BEFORE_EXPIRY');
  if (p.maxSpreadPct !== null && (val(f.H_SPREAD_PCT) ?? -Infinity) > p.maxSpreadPct) warnings.push('LIQUIDITY_DEGRADED');
  const warningLevel = warnings.length === 0 ? 'NONE' : warnings.length === 1 ? 'WATCH'
    : warnings.length < p.riskCloseWarningCount ? 'WARNING' : 'CRITICAL';
  const captured = s.closeAsk === null ? null : Number(((s.entryCreditPerShare - s.closeAsk) / s.entryCreditPerShare).toFixed(6));
  const base = { contractVersion: hEarlyWarningVersion, policyVersion: p.policyVersion, positionId: s.positionId,
    authority: 'SHADOW_RESEARCH_NO_EXECUTION' as const, rollPolicy: 'NO_ROLL_PRODUCTION_POLICY' as const, features: f, warnings,
    warningLevel: warningLevel as HShadowRecord['warningLevel'], capturedFraction: captured };
  if (s.hoursToExpiry <= 0) {
    const itm = s.spot !== null && s.spot < s.strike;
    return { ...base, recommended: itm ? 'ASSIGNMENT' : 'EXPIRY', reasons: [itm ? 'EXPIRED_ITM_ASSIGNMENT_EXPECTED' : 'EXPIRED_OTM'] };
  }
  if (s.closeAsk === null) return { ...base, recommended: 'HOLD', reasons: ['CLOSE_QUOTE_UNKNOWN_NO_ACTION_ON_MISSING_DATA'] };
  if (warnings.length >= p.riskCloseWarningCount) return { ...base, recommended: 'RISK_CLOSE', reasons: warnings };
  if (p.profitCaptureTarget !== null && captured !== null && captured >= p.profitCaptureTarget) return { ...base, recommended: 'TAKE_PROFIT', reasons: ['CREDIT_CAPTURE_TARGET_REACHED'] };
  if (p.timeExitHours !== null && s.hoursToExpiry <= p.timeExitHours) return { ...base, recommended: 'TIME_EXIT', reasons: ['HOURS_TO_EXPIRY_AT_OR_BELOW_EXIT'] };
  return { ...base, recommended: 'HOLD', reasons: warnings.length > 0 ? ['WARNINGS_BELOW_RISK_CLOSE_COUNT', ...warnings] : ['NO_RULE_FIRED'] };
}
