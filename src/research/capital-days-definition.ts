/**
 * ONE canonical `CapitalDays`/`ReturnPerCapitalDay` definition, per direct
 * user hardening review: every R8 study that needs capital-days must
 * import and use THIS module, never restate an equivalent-looking
 * formula independently -- two independently-written formulas that
 * happen to agree under one sampling convention can silently diverge
 * under another (e.g. non-uniform capital over time), which is exactly
 * the "alternating between NetPnL/average-capital/days and NetPnL/
 * CapitalDays without proving equivalence" defect this module exists to
 * prevent. Research-only, `brokerAuthority: false`.
 *
 * DEFINITION:
 *   CapitalDays = the discrete daily sum (Riemann sum) of committed
 *   capital over the measurement window: for each day `d` in the
 *   window, `capitalOnDay(d)` dollars were committed; `CapitalDays =
 *   sum over d of capitalOnDay(d)`. A day with zero capital committed
 *   (e.g. between chains, cash idle) contributes exactly `0` to this
 *   sum -- it is INCLUDED in the day count, never silently excluded
 *   from the window, and its zero contribution is real, not an
 *   approximation.
 *
 *   ReturnPerCapitalDay = NetPnL / CapitalDays.
 *
 * This is NOT the same number as `NetPnL / averageCapital / totalDays`
 * UNLESS capital is held constant across every day in the window (in
 * which case `CapitalDays = averageCapital * totalDays` exactly, and the
 * two formulas coincide) -- `capitalDaysFromDailySeries` computes the
 * real sum directly rather than ever taking that shortcut, so it is
 * correct under BOTH the constant-capital case and the general
 * non-uniform case without the caller needing to know which applies.
 */

export const capitalDaysDefinitionVersion = 'theta-capital-days-definition-v1' as const;

export interface DailyCapitalObservation {
  readonly date: string;
  readonly capitalCommitted: number;
}

/**
 * The real, general-case computation: sums `capitalCommitted` across
 * every supplied daily observation. Throws if any `capitalCommitted` is
 * negative (a negative committed-capital figure is never a valid real
 * fact) or non-finite -- this module never silently coerces a bad input
 * into a plausible-looking number.
 */
export function capitalDaysFromDailySeries(series: readonly DailyCapitalObservation[]): number {
  let total = 0;
  for (const day of series) {
    if (!Number.isFinite(day.capitalCommitted) || day.capitalCommitted < 0) {
      throw new Error(`CAPITAL_DAYS_INVALID_DAILY_OBSERVATION:${day.date}`);
    }
    total += day.capitalCommitted;
  }
  return total;
}

/**
 * The constant-capital SPECIAL CASE (capital held flat for the entire
 * window) -- mathematically identical to `capitalDaysFromDailySeries`
 * for a series where every day has the same `capitalCommitted` value,
 * proved by the dedicated test comparing the two. Provided as a
 * convenience ONLY for callers who genuinely have constant capital and
 * do not want to construct a full daily series -- never use this for a
 * position whose capital commitment actually varies over the window
 * (e.g. Hold-Strike's lumpier commitment pattern), which requires the
 * real daily-series computation above.
 */
export function capitalDaysConstant(capitalCommitted: number, days: number): number {
  if (!Number.isFinite(capitalCommitted) || capitalCommitted < 0) throw new Error('CAPITAL_DAYS_INVALID_CAPITAL_COMMITTED');
  if (!Number.isFinite(days) || days < 0) throw new Error('CAPITAL_DAYS_INVALID_DAY_COUNT');
  return capitalCommitted * days;
}

/**
 * `capitalDays === 0` (no capital was ever committed across the whole
 * window) makes `ReturnPerCapitalDay` undefined, not infinite or zero --
 * returns `null` (UNKNOWN) rather than dividing by zero or fabricating a
 * value.
 */
export function returnPerCapitalDay(netPnl: number, capitalDays: number): number | null {
  if (!(capitalDays > 0)) return null;
  return netPnl / capitalDays;
}
