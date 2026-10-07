// European Black-Scholes put pricing, Greeks and implied-volatility inversion for the Q replay.
// q = 0 (dividends ignored) and a fixed risk-free rate supplied by the caller; both are labelled replay assumptions.
// Inputs come from daily trade-print closes, not quotes, so the inverted IV is an approximation (see the replay report).

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT_2PI;
/** Abramowitz-Stegun 7.1.26 based CDF (|error| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = normPdf(x) * poly;
  return x >= 0 ? 1 - tail : tail;
}

export interface PutGreeks {
  readonly price: number;
  readonly delta: number;
  readonly gamma: number;
  /** Per calendar day, in price units per share. */
  readonly thetaPerDay: number;
  /** Per 1.00 change in volatility, in price units per share. */
  readonly vega: number;
}

/** t in years; returns intrinsic-bounded values at t <= 0 or sigma <= 0. */
export function blackScholesPut(spot: number, strike: number, t: number, sigma: number, rate: number): PutGreeks {
  if (!(spot > 0) || !(strike > 0)) throw new Error('BS_INPUT_INVALID');
  if (t <= 0 || sigma <= 0) {
    const itm = strike > spot;
    return { price: Math.max(0, strike - spot), delta: itm ? -1 : 0, gamma: 0, thetaPerDay: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discount = Math.exp(-rate * t);
  const price = strike * discount * normCdf(-d2) - spot * normCdf(-d1);
  const delta = normCdf(d1) - 1;
  const gamma = normPdf(d1) / (spot * sigma * sqrtT);
  const thetaYear = -(spot * normPdf(d1) * sigma) / (2 * sqrtT) + rate * strike * discount * normCdf(-d2);
  const vega = spot * normPdf(d1) * sqrtT;
  return { price, delta, gamma, thetaPerDay: thetaYear / 365, vega };
}

/**
 * Bisection IV inversion. Null when the price is outside no-arbitrage bounds (below discounted intrinsic or above the
 * discounted strike) or the solution is outside [0.01, 5.0]; never a coerced value.
 */
export function impliedPutVolatility(price: number, spot: number, strike: number, t: number, rate: number): number | null {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(t > 0)) return null;
  const lower = Math.max(0, strike * Math.exp(-rate * t) - spot);
  if (price <= lower + 1e-9 || price >= strike * Math.exp(-rate * t)) return null;
  let lo = 0.01, hi = 5.0;
  if (blackScholesPut(spot, strike, t, lo, rate).price > price || blackScholesPut(spot, strike, t, hi, rate).price < price) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (blackScholesPut(spot, strike, t, mid, rate).price > price) hi = mid; else lo = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}
