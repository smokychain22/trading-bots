// MarketRegimeReceipt (research/shadow only) and a point-in-time forward-evidence evaluator.
//
// Every field carries provenance. Missing evidence is UNKNOWN, never coerced. All
// thresholds below are versioned research parameters labelled IMPLEMENTATION_INFERENCE:
// they are NOT validated and must earn promotion through forward evidence.
// OI / PCR / IV are evidence inputs, never direction oracles.

export const marketRegimeVersion = 'theta-market-regime-research-v0' as const;

export interface DailyBar { readonly date: string; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number | null }

export type Provenance = 'COMPUTED_FROM_DAILY_BARS' | 'SUPPLIED_PROVIDER_EVIDENCE' | 'IMPLEMENTATION_INFERENCE';
export type Field<T> = { readonly state: 'KNOWN'; readonly value: T; readonly provenance: Provenance; readonly basis: string }
  | { readonly state: 'UNKNOWN'; readonly reason: string };
const k = <T>(value: T, provenance: Provenance, basis: string): Field<T> => ({ state: 'KNOWN', value, provenance, basis });
const u = <T>(reason: string): Field<T> => ({ state: 'UNKNOWN', reason });
const val = <T>(f: Field<T>): T | null => f.state === 'KNOWN' ? f.value : null;

export type Direction = 'STRONG_UP' | 'MODERATE_UP' | 'WEAK_UP' | 'FLAT' | 'WEAK_DOWN' | 'MODERATE_DOWN' | 'STRONG_DOWN';
export type Movement = 'COMPRESSED' | 'SLOW' | 'NORMAL' | 'FAST' | 'BREAKOUT';
export type VolatilityState = 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANDING' | 'CONTRACTING';
export type StructureState = 'RANGE_BOUND' | 'TRENDING' | 'BREAKOUT_SETUP' | 'MEAN_REVERTING' | 'EVENT_DRIVEN' | 'UNCERTAIN';

/** Research thresholds. IMPLEMENTATION_INFERENCE, not validated. */
export const regimeResearchParameters = Object.freeze({
  parameterVersion: 'theta-regime-thresholds-v0-unvalidated',
  provenance: 'IMPLEMENTATION_INFERENCE' as const,
  trendLookback: 20, shortRvLookback: 5, longRvLookback: 20, atrLookback: 14, volPercentileLookback: 120,
  directionZ: { strong: 1.5, moderate: 0.75, weak: 0.25 },
  movementRatio: { compressed: 0.6, slow: 0.85, fast: 1.25, breakout: 1.8 },
  volPercentile: { low: 0.25, high: 0.75 }, volChangeRatio: { expanding: 1.25, contracting: 0.8 },
  trendR2: 0.5, meanReversionAutocorr: -0.2, eventWindowDays: 5, swingWindow: 2, levelClusterAtr: 0.5,
});

export interface SupportResistanceLevel {
  readonly kind: 'SUPPORT' | 'RESISTANCE'; readonly level: number; readonly touches: number;
  readonly lastTouchBarsAgo: number; readonly distancePct: number; readonly distanceAtr: number | null;
}

export interface OptionalRegimeEvidence {
  readonly iv?: number | null; readonly ivChange5d?: number | null; readonly ivRank?: number | null;
  /** Far IV minus near IV (positive = contango). */
  readonly termStructureSlope?: number | null;
  /** e.g. 25-delta put IV minus 25-delta call IV. */
  readonly skew?: number | null;
  /** Share of total OI in the top strikes (0..1). */
  readonly oiConcentration?: number | null;
  readonly putCallOiRatio?: number | null;
  /** Calendar days to the next known event (earnings etc.); null = UNKNOWN. */
  readonly eventInDays?: number | null;
}

export interface MarketRegimeReceipt {
  readonly version: typeof marketRegimeVersion;
  readonly parameterVersion: string;
  readonly asOf: string;
  readonly direction: Field<Direction>;
  readonly movement: Field<Movement>;
  readonly volatility: Field<VolatilityState>;
  readonly structure: Field<StructureState>;
  readonly event: Field<'EVENT_IN_WINDOW' | 'NO_KNOWN_EVENT_IN_WINDOW'>;
  readonly confidence: Field<number>;
  readonly evidence: {
    readonly trendZ: Field<number>; readonly trendSlopePerDay: Field<number>; readonly trendR2: Field<number>;
    readonly acceleration: Field<number>; readonly atr: Field<number>; readonly normalizedAtr: Field<number>;
    readonly rvShort: Field<number>; readonly rvLong: Field<number>; readonly rvPercentile: Field<number>;
    readonly lag1Autocorrelation: Field<number>; readonly levels: Field<readonly SupportResistanceLevel[]>;
    readonly iv: Field<number>; readonly ivChange5d: Field<number>; readonly ivRank: Field<number>; readonly ivMinusRv: Field<number>;
    readonly termStructureSlope: Field<number>; readonly skew: Field<number>; readonly oiConcentration: Field<number>; readonly putCallOiRatio: Field<number>;
  };
}

const logReturns = (closes: readonly number[]): number[] => closes.slice(1).map((c, i) => Math.log(c / (closes[i] as number)));
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: readonly number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const annualized = (xs: readonly number[]) => stdev(xs) * Math.sqrt(252);

function realizedVol(bars: readonly DailyBar[], lookback: number): number | null {
  if (bars.length < lookback + 1) return null;
  return annualized(logReturns(bars.slice(-(lookback + 1)).map((b) => b.close)));
}

function atr(bars: readonly DailyBar[], lookback: number): number | null {
  if (bars.length < lookback + 1) return null;
  const trs = bars.slice(-lookback).map((b, i) => {
    const prev = bars[bars.length - lookback - 1 + i] as DailyBar;
    return Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close));
  });
  return mean(trs);
}

function regression(ys: readonly number[]): { slope: number; r2: number } {
  const xs = ys.map((_, i) => i); const mx = mean(xs); const my = mean(ys);
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * ((ys[i] as number) - my), 0); const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = sxy / sxx; const ssTot = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const ssRes = ys.reduce((a, y, i) => a + (y - (my + slope * ((xs[i] as number) - mx))) ** 2, 0);
  return { slope, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

export function supportResistance(bars: readonly DailyBar[], atrValue: number | null, window = regimeResearchParameters.swingWindow): SupportResistanceLevel[] {
  const last = bars.at(-1); if (last === undefined) return [];
  const tol = atrValue === null ? last.close * 0.01 : atrValue * regimeResearchParameters.levelClusterAtr;
  const swings: { kind: 'SUPPORT' | 'RESISTANCE'; price: number; index: number }[] = [];
  for (let i = window; i < bars.length - window; i++) {
    const b = bars[i] as DailyBar; const around = bars.slice(i - window, i + window + 1);
    if (around.every((x) => x.low >= b.low)) swings.push({ kind: 'SUPPORT', price: b.low, index: i });
    if (around.every((x) => x.high <= b.high)) swings.push({ kind: 'RESISTANCE', price: b.high, index: i });
  }
  const levels: SupportResistanceLevel[] = [];
  for (const kind of ['SUPPORT', 'RESISTANCE'] as const) {
    const clusters: { prices: number[]; last: number }[] = [];
    for (const sw of swings.filter((x) => x.kind === kind)) {
      const c = clusters.find((cl) => Math.abs(mean(cl.prices) - sw.price) <= tol);
      if (c) { c.prices.push(sw.price); c.last = Math.max(c.last, sw.index); } else clusters.push({ prices: [sw.price], last: sw.index });
    }
    for (const c of clusters) {
      const level = mean(c.prices);
      // Classify relative to the current close: a broken support is no longer support.
      if (kind === 'SUPPORT' && level > last.close) continue;
      if (kind === 'RESISTANCE' && level < last.close) continue;
      levels.push({ kind, level: Number(level.toFixed(4)), touches: c.prices.length, lastTouchBarsAgo: bars.length - 1 - c.last,
        distancePct: Number(((last.close - level) / last.close).toFixed(6)), distanceAtr: atrValue === null ? null : Number(((last.close - level) / atrValue).toFixed(4)) });
    }
  }
  return levels.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
}

const opt = (value: number | null | undefined, basis: string): Field<number> =>
  typeof value === 'number' && Number.isFinite(value) ? k(value, 'SUPPLIED_PROVIDER_EVIDENCE', basis) : u('NOT_SUPPLIED');

/** Builds the receipt from bars that END at the decision instant (callers must never pass future bars). */
export function buildMarketRegimeReceipt(bars: readonly DailyBar[], extra: OptionalRegimeEvidence = {}): MarketRegimeReceipt {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i] as DailyBar;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(b.date))
      || new Date(b.date).toISOString().slice(0, 10) !== b.date
      || ![b.open, b.high, b.low, b.close].every(v => Number.isFinite(v) && v > 0)
      || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close)
      || (b.volume !== null && (!Number.isFinite(b.volume) || b.volume < 0)))
      throw new Error('MARKET_REGIME_BAR_INVALID');
    if (i > 0 && (bars[i - 1] as DailyBar).date >= b.date) throw new Error('MARKET_REGIME_BAR_ORDER_INVALID');
  }
  const P = regimeResearchParameters;
  const last = bars.at(-1);
  const closes = bars.map((b) => b.close);
  const rvS = realizedVol(bars, P.shortRvLookback); const rvL = realizedVol(bars, P.longRvLookback);
  const atrV = atr(bars, P.atrLookback);
  let trendZ: Field<number> = u('INSUFFICIENT_BARS'); let slope: Field<number> = u('INSUFFICIENT_BARS'); let r2: Field<number> = u('INSUFFICIENT_BARS');
  if (bars.length >= P.trendLookback + 1 && rvL !== null && rvL > 0) {
    const window = closes.slice(-(P.trendLookback + 1));
    const ret = Math.log((window.at(-1) as number) / (window[0] as number));
    const z = ret / (rvL / Math.sqrt(252) * Math.sqrt(P.trendLookback));
    const reg = regression(window.map(Math.log));
    trendZ = k(z, 'COMPUTED_FROM_DAILY_BARS', `LOG_RETURN_${P.trendLookback}D_OVER_RV${P.longRvLookback}_SCALED`);
    slope = k(reg.slope, 'COMPUTED_FROM_DAILY_BARS', 'OLS_SLOPE_LOG_CLOSE_PER_DAY'); r2 = k(reg.r2, 'COMPUTED_FROM_DAILY_BARS', 'OLS_R2_LOG_CLOSE');
  }
  let accel: Field<number> = u('INSUFFICIENT_BARS');
  if (bars.length >= 11 && rvL !== null && rvL > 0) {
    const r5 = Math.log((closes.at(-1) as number) / (closes.at(-6) as number)); const p5 = Math.log((closes.at(-6) as number) / (closes.at(-11) as number));
    accel = k((r5 - p5) / (rvL / Math.sqrt(252) * Math.sqrt(5)), 'COMPUTED_FROM_DAILY_BARS', '5D_RETURN_MINUS_PRIOR_5D_SCALED');
  }
  let rvPct: Field<number> = u('INSUFFICIENT_BARS_FOR_RV_PERCENTILE');
  if (rvL !== null && bars.length >= P.volPercentileLookback + P.longRvLookback + 1) {
    const hist: number[] = [];
    for (let end = bars.length - P.volPercentileLookback; end <= bars.length; end++) {
      const v = realizedVol(bars.slice(0, end), P.longRvLookback); if (v !== null) hist.push(v);
    }
    rvPct = k(hist.filter((v) => v <= rvL).length / hist.length, 'COMPUTED_FROM_DAILY_BARS', `RV20_PERCENTILE_OVER_${P.volPercentileLookback}D`);
  }
  let ac: Field<number> = u('INSUFFICIENT_BARS');
  if (bars.length >= 41) {
    const r = logReturns(closes.slice(-41)); const a = r.slice(0, -1); const b = r.slice(1); const ma = mean(a); const mb = mean(b);
    const num = a.reduce((s, x, i) => s + (x - ma) * ((b[i] as number) - mb), 0);
    const den = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
    ac = den === 0 ? u('ZERO_VARIANCE_AUTOCORRELATION_UNDEFINED')
      : k(num / den, 'COMPUTED_FROM_DAILY_BARS', 'LAG1_AUTOCORR_40D');
  }
  const levels = last === undefined ? u<readonly SupportResistanceLevel[]>('NO_BARS')
    : k<readonly SupportResistanceLevel[]>(supportResistance(bars, atrV), 'COMPUTED_FROM_DAILY_BARS', 'SWING_FRACTALS_CLUSTERED_BY_HALF_ATR');

  // --- classification (IMPLEMENTATION_INFERENCE thresholds)
  const z = val(trendZ);
  const direction: Field<Direction> = z === null ? u('TREND_UNKNOWN') : k<Direction>(
    z >= P.directionZ.strong ? 'STRONG_UP' : z >= P.directionZ.moderate ? 'MODERATE_UP' : z >= P.directionZ.weak ? 'WEAK_UP'
      : z > -P.directionZ.weak ? 'FLAT' : z > -P.directionZ.moderate ? 'WEAK_DOWN' : z > -P.directionZ.strong ? 'MODERATE_DOWN' : 'STRONG_DOWN',
    'IMPLEMENTATION_INFERENCE', `TREND_Z_BANDS_${P.parameterVersion}`);
  const ratio = rvS !== null && rvL !== null && rvL > 0 ? rvS / rvL : null;
  const lastRange = bars.slice(-21, -1);
  const brokeRange = last !== undefined && lastRange.length === 20
    && (last.close > Math.max(...lastRange.map((b) => b.high)) || last.close < Math.min(...lastRange.map((b) => b.low)));
  const movement: Field<Movement> = ratio === null ? u('RV_UNKNOWN') : k<Movement>(
    ratio >= P.movementRatio.breakout || (brokeRange && ratio >= P.movementRatio.fast) ? 'BREAKOUT'
      : ratio >= P.movementRatio.fast ? 'FAST' : ratio < P.movementRatio.compressed ? 'COMPRESSED' : ratio < P.movementRatio.slow ? 'SLOW' : 'NORMAL',
    'IMPLEMENTATION_INFERENCE', 'RV5_OVER_RV20_BANDS_PLUS_20D_RANGE_BREAK');
  const ivChange = typeof extra.ivChange5d === 'number' && Number.isFinite(extra.ivChange5d) ? extra.ivChange5d : null;
  const pct = val(rvPct);
  const volatility: Field<VolatilityState> = ratio === null && pct === null ? u('VOLATILITY_EVIDENCE_UNKNOWN') : k<VolatilityState>(
    (ratio !== null && ratio >= P.volChangeRatio.expanding) || (ivChange !== null && ivChange > 0.03) ? 'EXPANDING'
      : (ratio !== null && ratio <= P.volChangeRatio.contracting) || (ivChange !== null && ivChange < -0.03) ? 'CONTRACTING'
        : pct === null ? 'NORMAL' : pct <= P.volPercentile.low ? 'LOW' : pct >= P.volPercentile.high ? 'HIGH' : 'NORMAL',
    'IMPLEMENTATION_INFERENCE', 'RV_RATIO_IV_CHANGE_RV_PERCENTILE');
  const eventIn = extra.eventInDays;
  const event = eventIn === undefined || eventIn === null ? u<'EVENT_IN_WINDOW' | 'NO_KNOWN_EVENT_IN_WINDOW'>('EVENT_CALENDAR_NOT_SUPPLIED')
    : !Number.isFinite(eventIn) || eventIn < 0 ? u<'EVENT_IN_WINDOW' | 'NO_KNOWN_EVENT_IN_WINDOW'>('EVENT_DISTANCE_INVALID')
    : k(eventIn <= P.eventWindowDays ? 'EVENT_IN_WINDOW' as const : 'NO_KNOWN_EVENT_IN_WINDOW' as const, 'SUPPLIED_PROVIDER_EVIDENCE', `EVENT_WITHIN_${P.eventWindowDays}D`);
  const lv = val(levels) ?? [];
  const nearSup = lv.find((l) => l.kind === 'SUPPORT'); const nearRes = lv.find((l) => l.kind === 'RESISTANCE');
  const mv = val(movement); const acv = val(ac); const r2v = val(r2);
  let structure: Field<StructureState>;
  if (val(event) === 'EVENT_IN_WINDOW') structure = k('EVENT_DRIVEN', 'IMPLEMENTATION_INFERENCE', 'EVENT_IN_WINDOW');
  else if (z === null || mv === null) structure = u('CORE_EVIDENCE_UNKNOWN');
  else if (mv === 'BREAKOUT') structure = k('TRENDING', 'IMPLEMENTATION_INFERENCE', 'BREAKOUT_MOVEMENT');
  else if (Math.abs(z) >= P.directionZ.moderate && r2v !== null && r2v >= P.trendR2) structure = k('TRENDING', 'IMPLEMENTATION_INFERENCE', 'TREND_Z_AND_R2');
  else if (mv === 'COMPRESSED' && ((nearSup?.distanceAtr ?? Infinity) <= 1 || Math.abs(nearRes?.distanceAtr ?? Infinity) <= 1))
    structure = k('BREAKOUT_SETUP', 'IMPLEMENTATION_INFERENCE', 'COMPRESSION_NEAR_LEVEL');
  else if (acv !== null && acv <= P.meanReversionAutocorr) structure = k('MEAN_REVERTING', 'IMPLEMENTATION_INFERENCE', 'NEGATIVE_LAG1_AUTOCORR');
  else if (Math.abs(z) < 0.5 && (nearSup?.touches ?? 0) >= 2 && (nearRes?.touches ?? 0) >= 2) structure = k('RANGE_BOUND', 'IMPLEMENTATION_INFERENCE', 'FLAT_TREND_BETWEEN_TESTED_LEVELS');
  else structure = k('UNCERTAIN', 'IMPLEMENTATION_INFERENCE', 'NO_RULE_MATCHED');
  const core = [trendZ, r2, accel, rvPct, ac, movement, volatility, event];
  const confidence = k(Number((core.filter((f) => f.state === 'KNOWN').length / core.length).toFixed(4)), 'IMPLEMENTATION_INFERENCE',
    'SHARE_OF_CORE_EVIDENCE_KNOWN_NOT_A_PROBABILITY');
  const iv = opt(extra.iv, 'SUPPLIED_ATM_IV');
  return {
    version: marketRegimeVersion, parameterVersion: P.parameterVersion, asOf: last?.date ?? 'NO_BARS',
    direction, movement, volatility, structure, event, confidence,
    evidence: {
      trendZ, trendSlopePerDay: slope, trendR2: r2, acceleration: accel,
      atr: atrV === null ? u('INSUFFICIENT_BARS') : k(atrV, 'COMPUTED_FROM_DAILY_BARS', `ATR${P.atrLookback}`),
      normalizedAtr: atrV === null || last === undefined ? u('INSUFFICIENT_BARS') : k(atrV / last.close, 'COMPUTED_FROM_DAILY_BARS', 'ATR_OVER_CLOSE'),
      rvShort: rvS === null ? u('INSUFFICIENT_BARS') : k(rvS, 'COMPUTED_FROM_DAILY_BARS', `RV${P.shortRvLookback}`),
      rvLong: rvL === null ? u('INSUFFICIENT_BARS') : k(rvL, 'COMPUTED_FROM_DAILY_BARS', `RV${P.longRvLookback}`),
      rvPercentile: rvPct, lag1Autocorrelation: ac, levels,
      iv, ivChange5d: opt(extra.ivChange5d, 'SUPPLIED_IV_CHANGE_5D'), ivRank: opt(extra.ivRank, 'SUPPLIED_IV_RANK'),
      ivMinusRv: iv.state === 'KNOWN' && rvL !== null ? k(iv.value - rvL, 'COMPUTED_FROM_DAILY_BARS', 'SUPPLIED_IV_MINUS_RV20') : u(iv.state === 'KNOWN' ? 'RV_UNKNOWN' : 'IV_NOT_SUPPLIED'),
      termStructureSlope: opt(extra.termStructureSlope, 'SUPPLIED_FAR_MINUS_NEAR_IV'), skew: opt(extra.skew, 'SUPPLIED_PUT_MINUS_CALL_IV'),
      oiConcentration: opt(extra.oiConcentration, 'SUPPLIED_TOP_STRIKE_OI_SHARE'), putCallOiRatio: opt(extra.putCallOiRatio, 'SUPPLIED_PUT_CALL_OI_RATIO'),
    },
  };
}

// ---------------------------------------------------------------- Forward evidence
export type SignalValue = boolean | 'UP' | 'DOWN' | null;

export interface ForwardEvidenceSummary {
  readonly observations: number; readonly signalOn: number; readonly signalOff: number;
  readonly meanAbsMove: { readonly on: Record<'d1' | 'd3' | 'd5', number | null>; readonly off: Record<'d1' | 'd3' | 'd5', number | null> };
  /** Share with |5d move| > breakoutSigma x PIT RV20-implied 5d sigma. */
  readonly breakoutRateOn: number | null; readonly breakoutRateOff: number | null;
  /** On signals that predicted a breakout (truthy) but none happened. */
  readonly falsePositiveRate: number | null;
  /** Directional signals only: share whose 5d move had the predicted sign. */
  readonly directionalAccuracy: number | null;
  readonly method: 'PIT_SLICE_SIGNAL_THEN_FORWARD_OUTCOME';
}

/**
 * Point-in-time evaluation: the signal is called with bars[0..i] ONLY (a copy), and its
 * outcome is measured on bars i+1..i+5. A signal cannot see the future by construction.
 */
export function evaluateForwardEvidence(bars: readonly DailyBar[], signal: (history: readonly DailyBar[]) => SignalValue,
  options: { readonly warmup?: number; readonly breakoutSigma?: number } = {}): ForwardEvidenceSummary {
  const warmup = options.warmup ?? 21; const sigmaK = options.breakoutSigma ?? 1.5;
  const rows: { s: SignalValue; d1: number; d3: number; d5: number; signed5: number; breakout: boolean }[] = [];
  for (let i = warmup; i + 5 < bars.length; i++) {
    const history = bars.slice(0, i + 1);
    const s = signal(history);
    const c0 = (bars[i] as DailyBar).close;
    const move = (d: number) => Math.log((bars[i + d] as DailyBar).close / c0);
    const rv = realizedVol(history, 20);
    const sigma5 = rv === null ? null : rv / Math.sqrt(252) * Math.sqrt(5);
    rows.push({ s, d1: Math.abs(move(1)), d3: Math.abs(move(3)), d5: Math.abs(move(5)), signed5: move(5), breakout: sigma5 !== null && Math.abs(move(5)) > sigmaK * sigma5 });
  }
  const on = rows.filter((r) => r.s !== null && r.s !== false); const off = rows.filter((r) => r.s === false);
  const avg = (xs: typeof rows, key: 'd1' | 'd3' | 'd5') => xs.length === 0 ? null : mean(xs.map((r) => r[key]));
  const rate = (xs: typeof rows) => xs.length === 0 ? null : xs.filter((r) => r.breakout).length / xs.length;
  const dir = on.filter((r) => r.s === 'UP' || r.s === 'DOWN');
  return {
    observations: rows.length, signalOn: on.length, signalOff: off.length,
    meanAbsMove: { on: { d1: avg(on, 'd1'), d3: avg(on, 'd3'), d5: avg(on, 'd5') }, off: { d1: avg(off, 'd1'), d3: avg(off, 'd3'), d5: avg(off, 'd5') } },
    breakoutRateOn: rate(on), breakoutRateOff: rate(off),
    falsePositiveRate: on.length === 0 ? null : on.filter((r) => !r.breakout).length / on.length,
    directionalAccuracy: dir.length === 0 ? null : dir.filter((r) => (r.s === 'UP') === (r.signed5 > 0)).length / dir.length,
    method: 'PIT_SLICE_SIGNAL_THEN_FORWARD_OUTCOME',
  };
}
