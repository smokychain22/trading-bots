import { barsAsOf, type HistoricalBar } from './underlying-history.js';

// R1D/ownership+regime support: real, point-in-time feature computation
// from historical stock bars. Every function here takes an explicit `asOf`
// and filters through barsAsOf() before computing anything -- no function
// in this module can see a bar timestamped after asOf, which is the actual
// no-future-leakage guarantee (proven by tests appending future bars and
// confirming the computed feature is unchanged).
//
// Per docs/quant/phase6_router/BAR_ADJUSTMENT_POLICY.md v1, these features
// are computed from a split-adjusted bar series -- callers are responsible
// for fetching that series (fetchStockBars with adjustment='split'); this
// module does not itself know or enforce which adjustment was used, since
// it operates on whatever HistoricalBar[] it's given.
//
// Every function returns `null` (UNKNOWN) when it does not have enough
// bars to compute a meaningful value -- never a fabricated zero.

const closesAsOf = (bars: readonly HistoricalBar[], asOf: string): readonly number[] =>
  [...barsAsOf(bars, asOf)].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map((b) => b.close);

/** Simple close-to-close return over `lookbackBars` bars ending at asOf. */
export function computeReturn(bars: readonly HistoricalBar[], asOf: string, lookbackBars: number): number | null {
  const closes = closesAsOf(bars, asOf);
  if (closes.length <= lookbackBars) return null;
  const latest = closes[closes.length - 1];
  const past = closes[closes.length - 1 - lookbackBars];
  if (latest === undefined || past === undefined || past === 0) return null;
  return (latest - past) / past;
}

/** Annualized realized volatility (stdev of daily log returns) over the trailing window. */
export function computeRealizedVolatility(bars: readonly HistoricalBar[], asOf: string, windowBars: number): number | null {
  const closes = closesAsOf(bars, asOf);
  if (closes.length <= windowBars) return null;
  const windowCloses = closes.slice(closes.length - windowBars - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < windowCloses.length; i += 1) {
    const prev = windowCloses[i - 1];
    const curr = windowCloses[i];
    if (prev === undefined || curr === undefined || prev <= 0 || curr <= 0) return null;
    logReturns.push(Math.log(curr / prev));
  }
  if (logReturns.length === 0) return null;
  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

/** Annualized downside-only realized volatility (only negative log returns count). */
export function computeDownsideVolatility(bars: readonly HistoricalBar[], asOf: string, windowBars: number): number | null {
  const closes = closesAsOf(bars, asOf);
  if (closes.length <= windowBars) return null;
  const windowCloses = closes.slice(closes.length - windowBars - 1);
  const downsideReturns: number[] = [];
  for (let i = 1; i < windowCloses.length; i += 1) {
    const prev = windowCloses[i - 1];
    const curr = windowCloses[i];
    if (prev === undefined || curr === undefined || prev <= 0 || curr <= 0) return null;
    const logReturn = Math.log(curr / prev);
    if (logReturn < 0) downsideReturns.push(logReturn);
  }
  if (downsideReturns.length === 0) return 0; // genuinely zero downside moves observed -- a real zero, not UNKNOWN
  const meanSquare = downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length;
  return Math.sqrt(meanSquare) * Math.sqrt(252);
}

/** Current drawdown from the running peak within the trailing window, as a <= 0 fraction. */
export function computeCurrentDrawdown(bars: readonly HistoricalBar[], asOf: string, windowBars: number): number | null {
  const closes = closesAsOf(bars, asOf);
  if (closes.length === 0) return null;
  const windowCloses = closes.slice(Math.max(0, closes.length - windowBars));
  const peak = Math.max(...windowCloses);
  const latest = windowCloses[windowCloses.length - 1];
  if (latest === undefined || peak <= 0) return null;
  return (latest - peak) / peak;
}

/** Simple linear-regression slope of close price over the trailing window, normalized by the window's mean price. */
export function computeTrendSlope(bars: readonly HistoricalBar[], asOf: string, windowBars: number): number | null {
  const closes = closesAsOf(bars, asOf);
  if (closes.length <= windowBars) return null;
  const windowCloses = closes.slice(closes.length - windowBars);
  const n = windowCloses.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = windowCloses.reduce((s, y) => s + y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i] as number;
    const y = windowCloses[i] as number;
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  if (denominator === 0 || meanY === 0) return null;
  return numerator / denominator / meanY;
}

/** Fraction of trading days in the window with an overnight gap-down beyond gapThresholdPct. */
export function computeGapFrequency(bars: readonly HistoricalBar[], asOf: string, windowBars: number, gapThresholdPct: number): number | null {
  const relevantBars = [...barsAsOf(bars, asOf)].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (relevantBars.length <= windowBars) return null;
  const windowed = relevantBars.slice(relevantBars.length - windowBars - 1);
  let gapDays = 0;
  for (let i = 1; i < windowed.length; i += 1) {
    const prevClose = windowed[i - 1]?.close;
    const currOpen = windowed[i]?.open;
    if (prevClose === undefined || currOpen === undefined || prevClose <= 0) continue;
    const gap = (currOpen - prevClose) / prevClose;
    if (gap <= -Math.abs(gapThresholdPct)) gapDays += 1;
  }
  return gapDays / (windowed.length - 1);
}

/** Magnitude of the single worst overnight gap-down in the window (a positive number, or 0 if none). */
export function computeMaxAdverseGap(bars: readonly HistoricalBar[], asOf: string, windowBars: number): number | null {
  const relevantBars = [...barsAsOf(bars, asOf)].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (relevantBars.length <= windowBars) return null;
  const windowed = relevantBars.slice(relevantBars.length - windowBars - 1);
  let worst = 0;
  for (let i = 1; i < windowed.length; i += 1) {
    const prevClose = windowed[i - 1]?.close;
    const currOpen = windowed[i]?.open;
    if (prevClose === undefined || currOpen === undefined || prevClose <= 0) continue;
    const gap = (currOpen - prevClose) / prevClose;
    if (gap < 0) worst = Math.min(worst, gap);
  }
  return Math.abs(worst);
}
