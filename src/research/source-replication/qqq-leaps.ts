// QQQ_LEAPS_DIP_BUY_V1 — mechanical replication of an OWNER_CURATED_SOURCE_CLAIM (master guide §14). Research only.
//
// Source rule (as curated): after a QQQ down day of at least 1%, buy a ~12-month call of ~0.60 delta; take profit at +50%;
// no ordinary stop; typical hold 3-4 months. Every detail the source does not pin down is an explicit variant labelled
// SOURCE_RULE_UNSPECIFIED, never a silent choice. Two pricing modes:
//  - MODEL_PRICED: Black-Scholes with a labelled IV proxy (realized-vol based) -- needed because historical option prices
//    are not available before 2024; results are MODEL evidence, not market evidence.
//  - MARKET_PRICED: the same rules priced on real daily option closes (caller supplies the price path).
// No broker authority. Results are THETA research only and never recorded as the source's numbers.

import { blackScholes } from '../../theta/strategy-intelligence/option-payoff.js';

export const qqqLeapsReplicationVersion = 'qqq-leaps-dip-buy-replication-v1' as const;

export interface DailyBar { readonly date: string; readonly open: number; readonly close: number }

export type TriggerRule = 'CLOSE_TO_CLOSE_DOWN_1PCT' | 'GAP_DOWN_OPEN_1PCT';
export type Cadence = 'EVERY_TRIGGER' | 'MONTHLY_CAP' | 'NO_OVERLAP';
export type NoTargetExit = 'HOLD_TO_EXPIRY' | 'EXIT_AT_30_DTE';
export type RegimeFilter = 'NONE' | 'CLOSE_ABOVE_SMA200';

export interface LeapsRuleVariant {
  readonly trigger: TriggerRule;
  readonly cadence: Cadence;
  readonly targetDelta: number;
  readonly targetDays: number;
  readonly profitTargetPct: number;
  readonly noTargetExit: NoTargetExit;
  readonly regimeFilter: RegimeFilter;
}

export const sourceMechanicalVariant: LeapsRuleVariant = {
  trigger: 'CLOSE_TO_CLOSE_DOWN_1PCT', // SOURCE_RULE_UNSPECIFIED: close-to-close vs gap-down
  cadence: 'EVERY_TRIGGER',            // SOURCE_RULE_UNSPECIFIED: every -1% day vs monthly cap vs no overlap
  targetDelta: 0.60, targetDays: 365, profitTargetPct: 0.50,
  noTargetExit: 'HOLD_TO_EXPIRY',      // SOURCE_RULE_UNSPECIFIED
  regimeFilter: 'NONE',
};

export interface PricingAssumptions {
  /** Annualized volatility used to price on a date (labelled proxy in MODEL mode). */
  readonly volatilityAt: (index: number) => number | null;
  readonly rate: number;
  /** Fraction of the option price paid as half-spread on each side. */
  readonly halfSpreadPct: number;
  readonly commissionPerContractUsd: number;
  readonly multiplier: number;
}

export interface LeapsTrade {
  readonly entryDate: string; readonly exitDate: string; readonly strike: number; readonly expiration: string;
  readonly entryPrice: number; readonly exitPrice: number; readonly pnlUsd: number; readonly holdDays: number;
  readonly exitReason: 'PROFIT_TARGET' | 'EXPIRY' | 'DTE_30' | 'OPEN_AT_DATA_END';
  readonly entryDelta: number;
}

const dayMs = 86_400_000;
const days = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

/** Third Friday of the month closest to entry + targetDays (standard monthly expiry). */
export function chooseExpiration(entryDate: string, targetDays: number): string {
  const target = new Date(Date.parse(`${entryDate}T00:00:00Z`) + targetDays * dayMs);
  const thirdFriday = (y: number, m: number): Date => {
    const first = new Date(Date.UTC(y, m, 1));
    const offset = (5 - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(y, m, 1 + offset + 14));
  };
  const candidates = [-1, 0, 1].map((k) => thirdFriday(target.getUTCFullYear(), target.getUTCMonth() + k));
  const best = candidates.toSorted((a, b) => Math.abs(a.getTime() - target.getTime()) - Math.abs(b.getTime() - target.getTime())
    || a.getTime() - b.getTime())[0] as Date;
  return best.toISOString().slice(0, 10);
}

/** Strike on the listed grid whose BS call delta is closest to the target (tie: lower strike, i.e. more ITM). */
export function chooseStrike(spot: number, years: number, vol: number, rate: number, targetDelta: number): { strike: number; delta: number } {
  const step = spot >= 100 ? 5 : 1;
  let best = { strike: Math.round(spot / step) * step, delta: Number.NaN, distance: Number.POSITIVE_INFINITY };
  for (let k = Math.floor(spot * 0.6 / step) * step; k <= spot * 1.4; k += step) {
    if (k <= 0) continue;
    const delta = blackScholes('CALL', spot, k, years, vol, rate).delta;
    const distance = Math.abs(delta - targetDelta);
    if (distance < best.distance - 1e-12) best = { strike: k, delta, distance };
  }
  return { strike: best.strike, delta: best.delta };
}

const sma = (bars: readonly DailyBar[], index: number, n: number): number | null => {
  if (index + 1 < n) return null;
  let sum = 0;
  for (let i = index - n + 1; i <= index; i++) sum += (bars[i] as DailyBar).close;
  return sum / n;
};

function triggered(bars: readonly DailyBar[], i: number, rule: TriggerRule): boolean {
  if (i === 0) return false;
  const prev = (bars[i - 1] as DailyBar).close; const bar = bars[i] as DailyBar;
  return rule === 'CLOSE_TO_CLOSE_DOWN_1PCT' ? bar.close / prev - 1 <= -0.01 : bar.open / prev - 1 <= -0.01;
}

/**
 * Simulates the rule over daily bars. `optionMark` prices the chosen contract at a bar index (MODEL: BS with proxy vol;
 * MARKET: a real close, or null when no print exists that day -- then no exit can trigger that day).
 */
export function simulateLeaps(bars: readonly DailyBar[], variant: LeapsRuleVariant, pricing: PricingAssumptions,
  optionMark: (index: number, strike: number, expiration: string) => number | null,
  contractChoice?: (index: number) => { strike: number; expiration: string; delta: number } | null): {
    readonly trades: readonly LeapsTrade[]; readonly dailyEquity: readonly { date: string; equity: number }[]; readonly skippedEntries: number } {
  type Open = { entryIndex: number; strike: number; expiration: string; entryPrice: number; delta: number };
  const open: Open[] = [];
  const trades: LeapsTrade[] = [];
  const dailyEquity: { date: string; equity: number }[] = [];
  let realized = 0; let skipped = 0; let lastEntryMonth = '';
  const cost = (price: number) => price * pricing.halfSpreadPct * pricing.multiplier + pricing.commissionPerContractUsd;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i] as DailyBar;
    // Exits first (a position entered today cannot exit today).
    for (let p = open.length - 1; p >= 0; p--) {
      const pos = open[p] as Open;
      const dte = days(bar.date, pos.expiration);
      const mark = dte <= 0 ? Math.max(0, bar.close - pos.strike) : optionMark(i, pos.strike, pos.expiration);
      let reason: LeapsTrade['exitReason'] | null = null;
      if (mark !== null && mark >= pos.entryPrice * (1 + variant.profitTargetPct)) reason = 'PROFIT_TARGET';
      else if (dte <= 0) reason = 'EXPIRY';
      else if (variant.noTargetExit === 'EXIT_AT_30_DTE' && dte <= 30 && mark !== null) reason = 'DTE_30';
      if (reason !== null && mark !== null) {
        const exitCost = reason === 'EXPIRY' ? 0 : cost(mark);
        const pnl = (mark - pos.entryPrice) * pricing.multiplier - cost(pos.entryPrice) - exitCost;
        realized += pnl;
        trades.push({ entryDate: (bars[pos.entryIndex] as DailyBar).date, exitDate: bar.date, strike: pos.strike, expiration: pos.expiration,
          entryPrice: pos.entryPrice, exitPrice: mark, pnlUsd: Number(pnl.toFixed(2)), holdDays: days((bars[pos.entryIndex] as DailyBar).date, bar.date),
          exitReason: reason, entryDelta: pos.delta });
        open.splice(p, 1);
      }
    }
    // Entry at the trigger day's close (SOURCE_RULE_UNSPECIFIED: entry time).
    const month = bar.date.slice(0, 7);
    const regimeOk = variant.regimeFilter === 'NONE' || ((): boolean => { const s = sma(bars, i, 200); return s !== null && bar.close > s; })();
    const cadenceOk = variant.cadence === 'EVERY_TRIGGER' || (variant.cadence === 'MONTHLY_CAP' ? month !== lastEntryMonth : open.length === 0);
    if (triggered(bars, i, variant.trigger) && regimeOk && cadenceOk) {
      const vol = pricing.volatilityAt(i);
      const expiration = chooseExpiration(bar.date, variant.targetDays);
      const years = days(bar.date, expiration) / 365;
      const chosen = contractChoice?.(i) ?? (vol === null ? null : { ...chooseStrike(bar.close, years, vol, pricing.rate, variant.targetDelta), expiration });
      const price = chosen === null ? null : optionMark(i, chosen.strike, chosen.expiration);
      if (chosen === null || price === null || !(price > 0)) skipped++;
      else { open.push({ entryIndex: i, strike: chosen.strike, expiration: chosen.expiration, entryPrice: price, delta: chosen.delta }); lastEntryMonth = month; }
    }
    // Mark-to-market equity: realized + open marks (entry costs included at entry).
    let unrealized = 0;
    for (const pos of open) {
      const m = optionMark(i, pos.strike, pos.expiration);
      unrealized += ((m ?? pos.entryPrice) - pos.entryPrice) * pricing.multiplier - cost(pos.entryPrice);
    }
    dailyEquity.push({ date: bar.date, equity: Number((realized + unrealized).toFixed(2)) });
  }
  const last = bars[bars.length - 1];
  for (const pos of open) {
    if (last === undefined) break;
    const m = optionMark(bars.length - 1, pos.strike, pos.expiration) ?? pos.entryPrice;
    trades.push({ entryDate: (bars[pos.entryIndex] as DailyBar).date, exitDate: last.date, strike: pos.strike, expiration: pos.expiration,
      entryPrice: pos.entryPrice, exitPrice: m, pnlUsd: Number(((m - pos.entryPrice) * pricing.multiplier - cost(pos.entryPrice)).toFixed(2)),
      holdDays: days((bars[pos.entryIndex] as DailyBar).date, last.date), exitReason: 'OPEN_AT_DATA_END', entryDelta: pos.delta });
  }
  return { trades, dailyEquity, skippedEntries: skipped };
}

export interface LeapsMetrics {
  readonly closedTrades: number; readonly openAtEnd: number; readonly wins: number; readonly losses: number;
  readonly winRate: number | null; readonly totalPnlUsd: number; readonly profitFactor: number | null;
  readonly avgWinUsd: number | null; readonly avgLossUsd: number | null; readonly expectancyUsd: number | null;
  readonly maxDrawdownClosedUsd: number; readonly maxDrawdownMarkToMarketUsd: number; readonly avgHoldDays: number | null;
  readonly expectedShortfall5PctUsd: number | null;
}

export function leapsMetrics(result: ReturnType<typeof simulateLeaps>): LeapsMetrics {
  const closed = result.trades.filter((t) => t.exitReason !== 'OPEN_AT_DATA_END');
  const wins = closed.filter((t) => t.pnlUsd > 0); const losses = closed.filter((t) => t.pnlUsd <= 0);
  const sum = (xs: readonly LeapsTrade[]) => xs.reduce((a, t) => a + t.pnlUsd, 0);
  let peak = 0; let equity = 0; let ddClosed = 0;
  for (const t of closed.toSorted((a, b) => a.exitDate.localeCompare(b.exitDate))) { equity += t.pnlUsd; peak = Math.max(peak, equity); ddClosed = Math.max(ddClosed, peak - equity); }
  let mtmPeak = 0; let ddMtm = 0;
  for (const point of result.dailyEquity) { mtmPeak = Math.max(mtmPeak, point.equity); ddMtm = Math.max(ddMtm, mtmPeak - point.equity); }
  const sorted = closed.map((t) => t.pnlUsd).toSorted((a, b) => a - b);
  const tail = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)));
  const r = (x: number) => Number(x.toFixed(2));
  return {
    closedTrades: closed.length, openAtEnd: result.trades.length - closed.length, wins: wins.length, losses: losses.length,
    winRate: closed.length === 0 ? null : r(wins.length / closed.length * 100) / 100,
    totalPnlUsd: r(sum(closed)), profitFactor: losses.length === 0 || sum(losses) === 0 ? null : r(sum(wins) / -sum(losses)),
    avgWinUsd: wins.length === 0 ? null : r(sum(wins) / wins.length), avgLossUsd: losses.length === 0 ? null : r(sum(losses) / losses.length),
    expectancyUsd: closed.length === 0 ? null : r(sum(closed) / closed.length),
    maxDrawdownClosedUsd: r(ddClosed), maxDrawdownMarkToMarketUsd: r(ddMtm),
    avgHoldDays: closed.length === 0 ? null : r(closed.reduce((a, t) => a + t.holdDays, 0) / closed.length),
    expectedShortfall5PctUsd: sorted.length === 0 ? null : r(tail.reduce((a, b) => a + b, 0) / tail.length),
  };
}

/** Labelled IV proxy for MODEL mode: trailing 60-session realized vol x multiplier, clamped. Not market IV. */
export function realizedVolProxy(bars: readonly DailyBar[], lookback = 60, multiplier = 1.1, floor = 0.12, cap = 0.6): (index: number) => number | null {
  const logReturns = bars.map((b, i) => (i === 0 ? 0 : Math.log(b.close / (bars[i - 1] as DailyBar).close)));
  return (index: number) => {
    if (index < lookback) return null;
    const window = logReturns.slice(index - lookback + 1, index + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
    return Math.min(cap, Math.max(floor, Math.sqrt(variance * 252) * multiplier));
  };
}
