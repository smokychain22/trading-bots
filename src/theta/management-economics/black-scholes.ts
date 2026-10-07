// European Black-Scholes pricing and Greeks (no dividends) used by the SHADOW management-economics modules.
// MATH_REPRODUCED: standard closed form; American early exercise is not modeled (labelled at call sites).

export type OptionRight = 'PUT' | 'CALL';

export interface BsGreeks {
  readonly price: number;
  readonly delta: number;
  readonly gamma: number;
  /** Per calendar day. */
  readonly thetaPerDay: number;
  /** Per 1.00 (100 vol points) change in volatility. */
  readonly vega: number;
}

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT2PI;

/** Normal CDF, Abramowitz & Stegun 26.2.17 (|error| < 7.5e-8): adequate for pricing at cent precision. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = normPdf(x) * poly;
  return x >= 0 ? 1 - tail : tail;
}

/**
 * @param years time to expiry in years; <= 0 returns intrinsic value and step delta.
 * @param vol annualized volatility (decimal); must be > 0 when years > 0.
 */
export function blackScholes(right: OptionRight, spot: number, strike: number, years: number, vol: number, rate = 0): BsGreeks {
  if (!(spot > 0) || !(strike > 0) || !Number.isFinite(years) || !Number.isFinite(rate)) throw new Error('BS_INPUT_INVALID');
  if (years <= 0) {
    const intrinsic = right === 'PUT' ? Math.max(0, strike - spot) : Math.max(0, spot - strike);
    const delta = right === 'PUT' ? (spot < strike ? -1 : 0) : (spot > strike ? 1 : 0);
    return { price: intrinsic, delta, gamma: 0, thetaPerDay: 0, vega: 0 };
  }
  if (!(vol > 0) || !Number.isFinite(vol)) throw new Error('BS_VOL_INVALID');
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const discount = Math.exp(-rate * years);
  const pdf = normPdf(d1);
  const gamma = pdf / (spot * vol * sqrtT);
  const vega = spot * pdf * sqrtT;
  if (right === 'PUT') {
    const price = strike * discount * normCdf(-d2) - spot * normCdf(-d1);
    const thetaYear = -spot * pdf * vol / (2 * sqrtT) + rate * strike * discount * normCdf(-d2);
    return { price: Math.max(0, price), delta: normCdf(d1) - 1, gamma, thetaPerDay: thetaYear / 365, vega };
  }
  const price = spot * normCdf(d1) - strike * discount * normCdf(d2);
  const thetaYear = -spot * pdf * vol / (2 * sqrtT) - rate * strike * discount * normCdf(d2);
  return { price: Math.max(0, price), delta: normCdf(d1), gamma, thetaPerDay: thetaYear / 365, vega };
}

export const yearsFromDays = (days: number): number => days / 365;
