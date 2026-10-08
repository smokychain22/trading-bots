import { createHash } from 'node:crypto';
import { AlpacaProviderError, fetchStockBars, type AlpacaProviderConfig } from '../alpaca-provider.js';
import type { HistoricalBar } from '../underlying-history.js';
import { newYorkSessionTime } from '../../research/alpaca-learning-calendar.js';

export const intradayStructureVersion = 'theta-intraday-structure-shadow-v1' as const;
type Direction = 'ABOVE' | 'BELOW' | 'AT';
interface ClosedBar { readonly start: string; readonly end: string; readonly close: number }
export interface IntradayStructureReceipt {
  readonly version: typeof intradayStructureVersion;
  readonly underlying: string;
  readonly observedAt: string;
  readonly requestedAt: string;
  readonly sessionOpen: string | null;
  readonly sessionClose: string | null;
  readonly state: 'PRESENT' | 'PARTIAL' | 'NOT_APPLICABLE' | 'PROVIDER_ERROR';
  readonly reasons: readonly string[];
  readonly provider: 'ALPACA';
  readonly feed: 'iex';
  readonly authority: 'SHADOW_CONTEXT';
  readonly brokerAuthority: false;
  readonly paginationComplete: boolean | null;
  readonly closedMinuteCount: number;
  readonly excludedDevelopingCount: number;
  readonly inputHash: string | null;
  readonly lastClosedAt: string | null;
  readonly stale: boolean | null;
  readonly frames: readonly {
    readonly minutes: 1 | 5 | 15 | 60;
    readonly closedCount: number;
    readonly ema9: number | null;
    readonly lastCloseVsEma9: Direction | null;
    readonly confirmingCloses: 0 | 2;
    /** Compact deterministic replay inputs. No partial or future candles. */
    readonly bars: readonly ClosedBar[];
  }[];
  readonly sessionVwap: number | null;
  readonly vwapRelation: Direction | null;
  readonly vwapTransition: 'RECLAIM' | 'REJECT' | 'NONE' | null;
  readonly alignment: 'ALIGNED_UP' | 'ALIGNED_DOWN' | 'MIXED' | 'INSUFFICIENT';
}
type Context = { readonly underlying: string; readonly requestedAt: string; readonly observedAt: string;
  readonly sessionOpen: string | null; readonly sessionClose: string | null };
const relation = (a: number, b: number): Direction => a > b ? 'ABOVE' : a < b ? 'BELOW' : 'AT';
const base = (input: Context): IntradayStructureReceipt => ({
  version: intradayStructureVersion, underlying: input.underlying, requestedAt: input.requestedAt,
  observedAt: input.observedAt, sessionOpen: input.sessionOpen, sessionClose: input.sessionClose,
  state: 'PARTIAL', reasons: [], provider: 'ALPACA', feed: 'iex',
  authority: 'SHADOW_CONTEXT', brokerAuthority: false, paginationComplete: null, closedMinuteCount: 0,
  excludedDevelopingCount: 0, inputHash: null, lastClosedAt: null, stale: null, frames: [],
  sessionVwap: null, vwapRelation: null, vwapTransition: null, alignment: 'INSUFFICIENT',
});

export function buildIntradayStructure(input: Context & { readonly bars: readonly HistoricalBar[]; readonly complete: boolean }): IntradayStructureReceipt {
  const receipt = base(input);
  const at = Date.parse(input.observedAt), open = Date.parse(input.sessionOpen ?? ''), close = Date.parse(input.sessionClose ?? '');
  const cutoff = Math.min(at, Date.parse(input.requestedAt));
  if (![at, open, close, Date.parse(input.requestedAt)].every(Number.isFinite) || close <= open
    || Date.parse(input.requestedAt) > at) throw new Error('INTRADAY_TIME_BOUNDARY_INVALID');
  if (input.bars.length > 500) throw new Error('INTRADAY_INPUT_BOUND_EXCEEDED');
  const reasons: string[] = [];
  const ordered = [...input.bars].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const seen = new Set<number>();
  for (const b of ordered) {
    const start = Date.parse(b.timestamp), received = Date.parse(b.receivedAt);
    if (b.symbol !== input.underlying || b.feed !== 'iex' || b.provider !== 'ALPACA'
      || ![start, received].every(Number.isFinite) || received > at || start % 60_000 !== 0
      || ![b.open, b.high, b.low, b.close].every(v => Number.isFinite(v) && v > 0)
      || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close)
      || !Number.isFinite(b.volume) || b.volume < 0 || seen.has(start)) throw new Error('INTRADAY_BAR_INVALID');
    seen.add(start);
  }
  const bars = ordered.filter(b => Date.parse(b.timestamp) >= open && Date.parse(b.timestamp) + 60_000 <= Math.min(cutoff, close));
  const developing = ordered.filter(b => Date.parse(b.timestamp) <= cutoff && Date.parse(b.timestamp) + 60_000 > cutoff).length;
  if (!input.complete) reasons.push('PAGINATION_INCOMPLETE');
  if (bars.length === 0) reasons.push('NO_CLOSED_SESSION_BARS');
  const last = bars.at(-1);
  const lastEnd = last ? Date.parse(last.timestamp) + 60_000 : null;
  const stale = lastEnd === null ? null : at - lastEnd > 120_000;
  if (stale) reasons.push('LAST_CLOSED_BAR_STALE');
  const frames = ([1, 5, 15, 60] as const).map(minutes => {
    const groups = new Map<number, HistoricalBar[]>();
    for (const bar of bars) {
      const key = Math.floor((Date.parse(bar.timestamp) - open) / (minutes * 60_000));
      const group = groups.get(key) ?? []; group.push(bar); groups.set(key, group);
    }
    const closed: ClosedBar[] = [];
    for (const [key, group] of groups) {
      const start = open + key * minutes * 60_000, end = start + minutes * 60_000;
      if (end > Math.min(cutoff, close)) continue;
      if (group.length !== minutes || group.some((b, index) => Date.parse(b.timestamp) !== start + index * 60_000)) {
        reasons.push(`INCOMPLETE_${minutes}M_BUCKET`); continue;
      }
      closed.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), close: (group.at(-1) as HistoricalBar).close });
    }
    // Never splice separated candles into an apparently continuous EMA.
    let tail = closed;
    for (let i = closed.length - 1; i > 0; i--) if ((closed[i] as ClosedBar).start !== (closed[i - 1] as ClosedBar).end) { tail = closed.slice(i); break; }
    const relations: Direction[] = [];
    let ema: number | null = null;
    for (let i = 8; i < tail.length; i++) {
      const current = tail[i] as ClosedBar;
      ema = ema === null ? tail.slice(0, 9).reduce((s, b) => s + b.close, 0) / 9 : 0.2 * current.close + 0.8 * ema;
      relations.push(relation(current.close, ema));
    }
    const direction = relations.at(-1) ?? null;
    return { minutes, closedCount: closed.length, ema9: ema, lastCloseVsEma9: direction,
      confirmingCloses: relations.length >= 2 && direction !== 'AT' && direction === relations.at(-2) ? 2 as const : 0 as const,
      bars: closed };
  });
  const sides = frames.filter(f => f.minutes !== 1).map(f => f.lastCloseVsEma9);
  let weighted = 0, volume = 0, vwap: number | null = null;
  const vwapSides: Direction[] = [];
  const vwapQualified = input.complete && bars.length > 0 && bars.every(b => b.vwap !== null && Number.isFinite(b.vwap) && b.vwap > 0);
  if (vwapQualified) for (const b of bars) {
    weighted += (b.vwap as number) * b.volume; volume += b.volume;
    vwap = volume > 0 ? weighted / volume : null;
    if (vwap !== null) vwapSides.push(relation(b.close, vwap));
  }
  if (vwap === null) reasons.push('SESSION_VWAP_UNAVAILABLE');
  const side = vwapSides.at(-1) ?? null, prior = vwapSides.at(-2) ?? null;
  return { ...receipt, state: reasons.length ? 'PARTIAL' : 'PRESENT', reasons: [...new Set(reasons)],
    paginationComplete: input.complete, closedMinuteCount: bars.length, excludedDevelopingCount: developing,
    inputHash: createHash('sha256').update(JSON.stringify(bars)).digest('hex'),
    lastClosedAt: lastEnd === null ? null : new Date(lastEnd).toISOString(), stale, frames,
    sessionVwap: vwap, vwapRelation: side,
    vwapTransition: side === null || prior === null ? null : side === 'ABOVE' && prior === 'BELOW' ? 'RECLAIM'
      : side === 'BELOW' && prior === 'ABOVE' ? 'REJECT' : 'NONE',
    alignment: sides.some(s => s === null) ? 'INSUFFICIENT' : sides.every(s => s === 'ABOVE') ? 'ALIGNED_UP'
      : sides.every(s => s === 'BELOW') ? 'ALIGNED_DOWN' : 'MIXED',
  };
}

/** Single bounded optional GET before candidate quotes. Failures never alter trading gates. */
export async function observeIntradayStructure(input: Omit<Context, 'observedAt'> & {
  readonly alpaca: AlpacaProviderConfig; readonly marketOpen: boolean; readonly now: () => string;
  readonly calendarDate?: string;
}): Promise<IntradayStructureReceipt> {
  let context = { underlying: input.underlying, requestedAt: input.requestedAt, observedAt: input.now(),
    sessionOpen: input.sessionOpen, sessionClose: input.sessionClose };
  if (!input.marketOpen) return { ...base(context), state: 'NOT_APPLICABLE', reasons: ['MARKET_NOT_CONFIRMED_OPEN'] };
  if (input.sessionOpen === null || input.sessionClose === null) return { ...base(context), reasons: ['SESSION_BOUNDARIES_MISSING'] };
  try {
    if (input.calendarDate !== undefined) context = { ...context,
      sessionOpen: newYorkSessionTime(input.calendarDate, input.sessionOpen),
      sessionClose: newYorkSessionTime(input.calendarDate, input.sessionClose) };
    const result = await fetchStockBars({ ...input.alpaca, requestTimeoutMs: Math.min(input.alpaca.requestTimeoutMs ?? 2_000, 2_000),
      readRetry: { policy: { maxRetries: 0 } } }, { symbols: [input.underlying], timeframe: '1Min',
      start: context.sessionOpen as string, end: input.requestedAt, feed: 'iex', maxPages: 1, adjustment: 'raw' }, input.requestedAt);
    const observedAt = input.now();
    return buildIntradayStructure({ ...context, observedAt, complete: result.complete,
      bars: result.bars.map(b => ({ ...b, receivedAt: observedAt })) });
  } catch (error) {
    const code = error instanceof AlpacaProviderError ? error.errorClass
      : error instanceof Error && /^INTRADAY_[A-Z_]+$/.test(error.message) ? error.message : 'UNCLASSIFIED_PROVIDER_FAILURE';
    return { ...base({ ...context, observedAt: input.now() }), state: 'PROVIDER_ERROR', reasons: [code] };
  }
}
