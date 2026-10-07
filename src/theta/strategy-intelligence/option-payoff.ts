// Generic option payoff + Greeks engine (research/shadow only; never sizes, never submits).
//
// Conventions:
//  - Every leg carries its own exact multiplier. Nothing defaults to 100.
//  - Prices are per unit (per share for options/stock). Cashflows are USD.
//  - Long legs pay their entry price; short legs receive it.
//  - Times are in years from the valuation instant. The evaluation horizon is the
//    EARLIEST option expiry: legs expiring then are worth intrinsic value; any later
//    leg (calendar/diagonal back month) is valued with Black-Scholes at its remaining
//    time and its own IV. That is separate math from single-expiry structures and the
//    profile says which one it used.
//  - Pricing is European Black-Scholes; American early exercise is reported as a path
//    risk elsewhere, never priced in here.

export const optionPayoffEngineVersion = 'theta-option-payoff-v1' as const;

export type LegKind = 'CALL' | 'PUT' | 'STOCK';
export type LegSide = 'LONG' | 'SHORT';

export interface PayoffLeg {
  readonly id: string;
  readonly kind: LegKind;
  readonly side: LegSide;
  /** Positive integer count of contracts (options) or units (stock). */
  readonly quantity: number;
  /** Exact contract multiplier (shares per contract; 1 for a stock leg priced per share and counted in shares). */
  readonly multiplier: number;
  /** Required for options. */
  readonly strike?: number;
  /** Years from valuation to expiry. Required for options. */
  readonly expiryYears?: number;
  /** Entry price per unit (premium per share, or stock price). */
  readonly entryPrice: number;
  /** Annualized implied volatility (decimal) — needed to value the leg before its expiry. */
  readonly iv?: number | null;
  readonly exerciseStyle?: 'AMERICAN' | 'EUROPEAN';
}

const sign = (side: LegSide): 1 | -1 => side === 'LONG' ? 1 : -1;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validateLeg(leg: PayoffLeg): void {
  if (!Number.isInteger(leg.quantity) || leg.quantity <= 0) throw new Error(`PAYOFF_LEG_QUANTITY_INVALID:${leg.id}`);
  if (!finite(leg.multiplier) || leg.multiplier <= 0) throw new Error(`PAYOFF_LEG_MULTIPLIER_REQUIRED:${leg.id}`);
  if (!finite(leg.entryPrice) || leg.entryPrice < 0) throw new Error(`PAYOFF_LEG_ENTRY_PRICE_INVALID:${leg.id}`);
  if (leg.kind !== 'STOCK') {
    if (!finite(leg.strike) || leg.strike <= 0) throw new Error(`PAYOFF_LEG_STRIKE_REQUIRED:${leg.id}`);
    if (!finite(leg.expiryYears) || leg.expiryYears < 0) throw new Error(`PAYOFF_LEG_EXPIRY_REQUIRED:${leg.id}`);
  }
}

/** Net cash at entry: positive = credit received. */
export const entryCashflow = (legs: readonly PayoffLeg[]): number =>
  legs.reduce((sum, leg) => sum - sign(leg.side) * leg.entryPrice * leg.quantity * leg.multiplier, 0);

// ---------------------------------------------------------------- Black-Scholes
// Abramowitz & Stegun 7.1.26 erf approximation (|error| < 1.5e-7).
function erf(x: number): number {
  const s = x < 0 ? -1 : 1; const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export const normCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));
export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export interface UnitGreeks {
  readonly price: number; readonly delta: number; readonly gamma: number;
  /** Per calendar day. */
  readonly thetaPerDay: number;
  /** Per 1 volatility point (0.01). */
  readonly vegaPerPoint: number;
  /** Per 1 rate point (0.01). */
  readonly rhoPerPoint: number;
}

/** European BS value and Greeks per unit. Zero time or zero vol collapses to (discounted) intrinsic with step delta. */
export function blackScholes(kind: 'CALL' | 'PUT', spot: number, strike: number, years: number, vol: number, rate = 0): UnitGreeks {
  if (!(spot >= 0) || !(strike > 0) || !(years >= 0) || !(vol >= 0)) throw new Error('BLACK_SCHOLES_INPUT_INVALID');
  const discountedStrike = strike * Math.exp(-rate * years);
  if (years === 0 || vol === 0 || spot === 0) {
    const callItm = spot > discountedStrike;
    const price = kind === 'CALL' ? Math.max(0, spot - discountedStrike) : Math.max(0, discountedStrike - spot);
    const delta = kind === 'CALL' ? (callItm ? 1 : 0) : (spot < discountedStrike ? -1 : 0);
    return { price, delta, gamma: 0, thetaPerDay: 0, vegaPerPoint: 0, rhoPerPoint: 0 };
  }
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const gamma = normPdf(d1) / (spot * vol * sqrtT);
  const vega = spot * normPdf(d1) * sqrtT;
  if (kind === 'CALL') {
    const theta = -spot * normPdf(d1) * vol / (2 * sqrtT) - rate * discountedStrike * normCdf(d2);
    return { price: spot * normCdf(d1) - discountedStrike * normCdf(d2), delta: normCdf(d1), gamma,
      thetaPerDay: theta / 365, vegaPerPoint: vega / 100, rhoPerPoint: discountedStrike * years * normCdf(d2) / 100 };
  }
  const theta = -spot * normPdf(d1) * vol / (2 * sqrtT) + rate * discountedStrike * normCdf(-d2);
  return { price: discountedStrike * normCdf(-d2) - spot * normCdf(-d1), delta: normCdf(d1) - 1, gamma,
    thetaPerDay: theta / 365, vegaPerPoint: vega / 100, rhoPerPoint: -discountedStrike * years * normCdf(-d2) / 100 };
}

// ---------------------------------------------------------------- Valuation
export interface MarketState {
  readonly spot: number;
  /** Years elapsed since valuation (all legs age together). */
  readonly elapsedYears?: number;
  /** Absolute IV shift applied to every leg's IV (e.g. +0.10). */
  readonly ivShift?: number;
  readonly rate?: number;
}

export type LegValue = { readonly state: 'KNOWN'; readonly unit: UnitGreeks } | { readonly state: 'UNKNOWN'; readonly reason: string };

export function legUnitValue(leg: PayoffLeg, market: MarketState): LegValue {
  validateLeg(leg);
  if (leg.kind === 'STOCK') return { state: 'KNOWN', unit: { price: market.spot, delta: 1, gamma: 0, thetaPerDay: 0, vegaPerPoint: 0, rhoPerPoint: 0 } };
  const remaining = Math.max(0, (leg.expiryYears as number) - (market.elapsedYears ?? 0));
  if (remaining === 0) return { state: 'KNOWN', unit: blackScholes(leg.kind, market.spot, leg.strike as number, 0, 0, market.rate ?? 0) };
  if (!finite(leg.iv) || leg.iv <= 0) return { state: 'UNKNOWN', reason: `LEG_IV_REQUIRED_BEFORE_EXPIRY:${leg.id}` };
  const vol = Math.max(0.0001, leg.iv + (market.ivShift ?? 0));
  return { state: 'KNOWN', unit: blackScholes(leg.kind, market.spot, leg.strike as number, remaining, vol, market.rate ?? 0) };
}

export interface PositionGreeks {
  readonly state: 'KNOWN';
  readonly value: number; readonly delta: number; readonly gamma: number;
  readonly thetaPerDay: number; readonly vegaPerPoint: number; readonly rhoPerPoint: number;
  /** Mark-to-market P&L versus entry prices (lifetime, excludes fees). */
  readonly pnl: number;
}

/** Position-level value, P&L and Greeks (USD, multiplier and quantity applied). Recomputable at any spot/IV/time. */
export function positionGreeks(legs: readonly PayoffLeg[], market: MarketState): PositionGreeks | { readonly state: 'UNKNOWN'; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  let value = 0; let delta = 0; let gamma = 0; let theta = 0; let vega = 0; let rho = 0;
  for (const leg of legs) {
    const v = legUnitValue(leg, market);
    if (v.state === 'UNKNOWN') { reasons.push(v.reason); continue; }
    const k = sign(leg.side) * leg.quantity * leg.multiplier;
    value += k * v.unit.price; delta += k * v.unit.delta; gamma += k * v.unit.gamma;
    theta += k * v.unit.thetaPerDay; vega += k * v.unit.vegaPerPoint; rho += k * v.unit.rhoPerPoint;
  }
  if (reasons.length > 0) return { state: 'UNKNOWN', reasons };
  return { state: 'KNOWN', value, delta, gamma, thetaPerDay: theta, vegaPerPoint: vega, rhoPerPoint: rho, pnl: value + entryCashflow(legs) };
}

// ---------------------------------------------------------------- Expiry profile
export type Bound = number | 'UNBOUNDED';

export interface ExpiryProfile {
  readonly engineVersion: typeof optionPayoffEngineVersion;
  readonly horizonYears: number;
  readonly method: 'COMMON_EXPIRY_PIECEWISE_LINEAR_EXACT' | 'FRONT_EXPIRY_WITH_BLACK_SCHOLES_BACK_LEGS_NUMERIC';
  readonly entryCashflow: number;
  readonly grid: readonly { readonly spot: number; readonly pnl: number }[];
  readonly minPnl: number | '-UNBOUNDED';
  readonly minPnlAtSpot: number | null;
  readonly maxPnl: number | 'UNBOUNDED';
  /** Max profit (positive) and max loss (positive number = dollars lost) over spot in [0, infinity). */
  readonly maxProfit: Bound;
  readonly maxLoss: Bound;
  readonly breakevens: readonly number[];
  /** dPnL/dSpot as spot -> infinity (USD per $1). */
  readonly upsideSlope: number;
}

const round = (value: number, places = 8): number => Number(value.toFixed(places));

export function expiryProfile(legs: readonly PayoffLeg[], options: { readonly spot: number; readonly gridMaxMultiple?: number; readonly gridPoints?: number; readonly rate?: number }): ExpiryProfile {
  if (legs.length === 0) throw new Error('PAYOFF_NO_LEGS');
  legs.forEach(validateLeg);
  if (!(options.spot > 0)) throw new Error('PAYOFF_SPOT_INVALID');
  const optionLegs = legs.filter((leg) => leg.kind !== 'STOCK');
  const horizon = optionLegs.length === 0 ? 0 : Math.min(...optionLegs.map((leg) => leg.expiryYears as number));
  const multiExpiry = optionLegs.some((leg) => (leg.expiryYears as number) > horizon);
  const rate = options.rate ?? 0;
  const pnlAt = (spot: number): number => {
    const greeks = positionGreeks(legs, { spot, elapsedYears: horizon, rate });
    if (greeks.state === 'UNKNOWN') throw new Error(`PAYOFF_BACK_LEG_UNVALUED:${greeks.reasons.join(',')}`);
    return greeks.pnl;
  };
  const strikes = [...new Set(optionLegs.map((leg) => leg.strike as number))].sort((a, b) => a - b);
  const top = Math.max(options.spot, ...strikes) * (options.gridMaxMultiple ?? 5);
  const points = new Set<number>([0, top, options.spot]);
  const n = options.gridPoints ?? (multiExpiry ? 2000 : 200);
  for (let i = 1; i < n; i++) points.add(round(top * i / n, 6));
  for (let i = 0; i < strikes.length; i++) {
    const strike = strikes[i] as number;
    points.add(strike);
    const next = strikes[i + 1];
    if (next !== undefined) points.add(round((strike + next) / 2, 6));
  }
  const spots = [...points].sort((a, b) => a - b);
  const grid = spots.map((spot) => ({ spot, pnl: round(pnlAt(spot), 6) }));
  // Asymptotic slope: calls and stock contribute their full units as spot -> infinity (BS call delta -> 1); puts contribute 0.
  const upsideSlope = legs.reduce((sum, leg) => sum + (leg.kind === 'PUT' ? 0 : sign(leg.side) * leg.quantity * leg.multiplier), 0);
  let min = grid[0] as { spot: number; pnl: number }; let max = min;
  for (const point of grid) { if (point.pnl < min.pnl) min = point; if (point.pnl > max.pnl) max = point; }
  const minPnl = upsideSlope < 0 ? '-UNBOUNDED' as const : min.pnl;
  const maxPnl = upsideSlope > 0 ? 'UNBOUNDED' as const : max.pnl;
  const breakevens: number[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = grid[i - 1] as { spot: number; pnl: number }; const b = grid[i] as { spot: number; pnl: number };
    if (a.pnl === 0 && (i === 1 || (grid[i - 2] as { pnl: number }).pnl !== 0)) { if (!breakevens.includes(a.spot)) breakevens.push(a.spot); continue; }
    if ((a.pnl < 0 && b.pnl > 0) || (a.pnl > 0 && b.pnl < 0)) {
      if (!multiExpiry) breakevens.push(round(a.spot + (b.spot - a.spot) * (-a.pnl) / (b.pnl - a.pnl), 6));
      else { // bisection on the smooth function
        let lo = a.spot; let hi = b.spot; const loSign = Math.sign(a.pnl);
        for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (Math.sign(pnlAt(mid)) === loSign) lo = mid; else hi = mid; }
        breakevens.push(round((lo + hi) / 2, 6));
      }
    }
  }
  return {
    engineVersion: optionPayoffEngineVersion, horizonYears: horizon,
    method: multiExpiry ? 'FRONT_EXPIRY_WITH_BLACK_SCHOLES_BACK_LEGS_NUMERIC' : 'COMMON_EXPIRY_PIECEWISE_LINEAR_EXACT',
    entryCashflow: round(entryCashflow(legs), 6), grid,
    minPnl, minPnlAtSpot: minPnl === '-UNBOUNDED' ? null : min.spot, maxPnl,
    maxProfit: maxPnl === 'UNBOUNDED' ? 'UNBOUNDED' : Math.max(0, maxPnl),
    maxLoss: minPnl === '-UNBOUNDED' ? 'UNBOUNDED' : Math.max(0, -minPnl),
    breakevens, upsideSlope,
  };
}

/** Exact P&L at the horizon for one spot (same math as the profile). */
export function pnlAtHorizon(legs: readonly PayoffLeg[], spot: number, rate = 0): number {
  const optionLegs = legs.filter((leg) => leg.kind !== 'STOCK');
  const horizon = optionLegs.length === 0 ? 0 : Math.min(...optionLegs.map((leg) => leg.expiryYears as number));
  const greeks = positionGreeks(legs, { spot, elapsedYears: horizon, rate });
  if (greeks.state === 'UNKNOWN') throw new Error(`PAYOFF_BACK_LEG_UNVALUED:${greeks.reasons.join(',')}`);
  return greeks.pnl;
}
