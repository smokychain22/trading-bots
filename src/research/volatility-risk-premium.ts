export const volatilityRiskPremiumVersion = 'theta-volatility-risk-premium-shadow-v1' as const;

/**
 * Research/shadow only. `brokerAuthority: false` always. This module never
 * claims "high IV -> sell premium" -- it only reports the arithmetic
 * relationship between an implied volatility observation and a realized-
 * volatility estimate, honestly UNKNOWN when either input is missing. No
 * caller may treat a positive/negative sign here as a trade signal.
 *
 * `impliedVolatility` is deliberately a plain caller-supplied number, never
 * derived internally from a contract list -- which single contract's IV
 * "represents" an underlying (ATM, nearest-DTE, volume-weighted) is a real
 * methodology choice this module does not make silently. Callers already
 * have this value from `NormalizedOptionContract.iv` or Optionomics'
 * `stocks.metrics` (see `optionomics-feature-engine.ts`'s
 * `volatility.impliedVolatility` `FeatureValue<number>`) and must decide,
 * and name, which contract/aggregate they passed.
 *
 * `realizedVolatility` is expected to come from the already-existing
 * `computeRealizedVolatility` (`underlying-features.ts`) or
 * `buildVolatilityAccelerationEvidence` (`volatility-acceleration.ts`) --
 * this module does not recompute realized volatility itself.
 */
export interface VolatilityRiskPremiumEvidence {
  readonly contractVersion: typeof volatilityRiskPremiumVersion;
  readonly asOf: string;
  readonly impliedVolatility: number | null;
  readonly impliedVolatilitySource: string;
  readonly realizedVolatility: number | null;
  readonly realizedVolatilitySource: string;
  /** IV - RV, in the same decimal-annualized units as both inputs. */
  readonly ivMinusRv: number | null;
  /** IV / RV. `null` (never a fabricated ratio) when RV is exactly 0, even
   * if IV is known -- a zero-realized-vol window makes the ratio undefined,
   * not infinite-and-therefore-omittable. */
  readonly ivToRvRatio: number | null;
  /** Variance-space VRP = IV^2 - RV^2, the convention named in
   * docs/research/THETA_FORMULA_CATALOG.md and the C2 research synthesis --
   * kept separate from the vol-space `ivMinusRv` since the two are not
   * interchangeable and a caller must pick the one their own methodology
   * actually calls for. */
  readonly varianceRiskPremium: number | null;
  readonly state: 'KNOWN' | 'UNKNOWN';
  readonly brokerAuthority: false;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function buildVolatilityRiskPremiumEvidence(input: {
  readonly impliedVolatility: number | null;
  readonly impliedVolatilitySource: string;
  readonly realizedVolatility: number | null;
  readonly realizedVolatilitySource: string;
  readonly asOf: string;
}): VolatilityRiskPremiumEvidence {
  const { impliedVolatility, realizedVolatility } = input;
  const known = finite(impliedVolatility) && finite(realizedVolatility);
  return {
    contractVersion: volatilityRiskPremiumVersion, asOf: input.asOf,
    impliedVolatility, impliedVolatilitySource: input.impliedVolatilitySource,
    realizedVolatility, realizedVolatilitySource: input.realizedVolatilitySource,
    ivMinusRv: known ? impliedVolatility - realizedVolatility : null,
    ivToRvRatio: known && realizedVolatility !== 0 ? impliedVolatility / realizedVolatility : null,
    varianceRiskPremium: known ? impliedVolatility ** 2 - realizedVolatility ** 2 : null,
    state: known ? 'KNOWN' : 'UNKNOWN',
    brokerAuthority: false,
  };
}

/**
 * Convenience wrapper combining this module with the already-existing
 * `VolatilityAccelerationEvidence` (rv5/rv21/rv63) so a caller doesn't have
 * to hand-pick which RV horizon to compare against IV. `rvHorizon` defaults
 * to `rv21` (roughly one month, the most common VRP convention in the
 * literature this module's doc comment cites) but is explicit, never
 * silently assumed by field name alone.
 */
export function buildVolatilityRiskPremiumFromAcceleration(input: {
  readonly impliedVolatility: number | null;
  readonly impliedVolatilitySource: string;
  readonly acceleration: { readonly rv5: number | null; readonly rv21: number | null; readonly rv63: number | null };
  readonly rvHorizon?: 'rv5' | 'rv21' | 'rv63';
  readonly asOf: string;
}): VolatilityRiskPremiumEvidence {
  const horizon = input.rvHorizon ?? 'rv21';
  return buildVolatilityRiskPremiumEvidence({
    impliedVolatility: input.impliedVolatility, impliedVolatilitySource: input.impliedVolatilitySource,
    realizedVolatility: input.acceleration[horizon], realizedVolatilitySource: `volatility-acceleration:${horizon}`,
    asOf: input.asOf,
  });
}
