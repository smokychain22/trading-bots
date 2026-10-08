import { createHash } from 'node:crypto';
import { AlpacaProviderError, fetchMarketCalendar, fetchStockBars, type AlpacaProviderConfig } from '../alpaca-provider.js';
import type { HistoricalBar } from '../underlying-history.js';
import { newYorkSessionTime } from '../../research/alpaca-learning-calendar.js';

export const intradayStructureVersion = 'theta-intraday-structure-shadow-v2' as const;
type Direction = 'ABOVE' | 'BELOW' | 'AT';
interface ClosedBar { readonly start: string; readonly end: string; readonly close: number }
export interface IntradaySession { readonly open: string; readonly close: string }
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
  readonly warmupSessions: readonly IntradaySession[];
  readonly warmupPolicy: 'SESSION_ANCHORED_FULL_BUCKETS_ONLY';
  readonly frames: readonly {
    readonly minutes: 1 | 5 | 15 | 60;
    readonly closedCount: number;
    readonly continuousCount: number;
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
  warmupSessions: [], warmupPolicy: 'SESSION_ANCHORED_FULL_BUCKETS_ONLY',
  sessionVwap: null, vwapRelation: null, vwapTransition: null, alignment: 'INSUFFICIENT',
});

export function buildIntradayStructure(input: Context & { readonly bars: readonly HistoricalBar[]; readonly complete: boolean;
  readonly warmupSessions?: readonly IntradaySession[]; readonly warmupReasons?: readonly string[] }): IntradayStructureReceipt {
  const receipt = base(input);
  const at = Date.parse(input.observedAt), open = Date.parse(input.sessionOpen ?? ''), close = Date.parse(input.sessionClose ?? '');
  const cutoff = Math.min(at, Date.parse(input.requestedAt));
  if (![at, open, close, Date.parse(input.requestedAt)].every(Number.isFinite) || close <= open
    || Date.parse(input.requestedAt) > at) throw new Error('INTRADAY_TIME_BOUNDARY_INVALID');
  if (input.bars.length > 1500 || (input.warmupSessions?.length ?? 0) > 2) throw new Error('INTRADAY_INPUT_BOUND_EXCEEDED');
  const sessions = [...(input.warmupSessions ?? []), { open: input.sessionOpen as string, close: input.sessionClose as string }]
    .map(session => ({ open: Date.parse(session.open), close: Date.parse(session.close) }));
  for (const [index, session] of sessions.entries()) {
    if (![session.open, session.close].every(Number.isFinite) || session.close <= session.open
      || session.open % 60_000 !== 0 || session.close % 60_000 !== 0
      || session.close - session.open > 390 * 60_000
      || (index > 0 && session.open <= (sessions[index - 1] as typeof session).close)) throw new Error('INTRADAY_SESSION_BOUNDARY_INVALID');
  }
  const reasons: string[] = [...(input.warmupReasons ?? [])];
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
  const qualified = ordered.filter(b => sessions.some(s => Date.parse(b.timestamp) >= s.open
    && Date.parse(b.timestamp) + 60_000 <= Math.min(cutoff, s.close)));
  const byStart = new Map(qualified.map(bar => [Date.parse(bar.timestamp), bar]));
  const frames = ([1, 5, 15, 60] as const).map(minutes => {
    const closed: ClosedBar[] = [];
    let tail: ClosedBar[] = [];
    // Walk every EXPECTED bucket, including buckets with no rows. An exchange
    // closure is a known boundary, a missing trading candle resets warmup.
    for (const session of sessions) {
      for (let start = session.open; start + minutes * 60_000 <= Math.min(cutoff, session.close); start += minutes * 60_000) {
        const group = Array.from({ length: minutes }, (_, i) => byStart.get(start + i * 60_000));
        if (group.some(bar => bar === undefined)) {
          reasons.push(`INCOMPLETE_${minutes}M_BUCKET`); tail = []; continue;
        }
        const candle = { start: new Date(start).toISOString(), end: new Date(start + minutes * 60_000).toISOString(),
          close: (group.at(-1) as HistoricalBar).close };
        closed.push(candle); tail.push(candle);
      }
    }
    const relations: Direction[] = [];
    let ema: number | null = null;
    for (let i = 8; i < tail.length; i++) {
      const current = tail[i] as ClosedBar;
      ema = ema === null ? tail.slice(0, 9).reduce((s, b) => s + b.close, 0) / 9 : 0.2 * current.close + 0.8 * ema;
      relations.push(relation(current.close, ema));
    }
    const direction = relations.at(-1) ?? null;
    if (ema === null) reasons.push(`EMA9_${minutes}M_WARMUP_INSUFFICIENT`);
    return { minutes, closedCount: closed.length, continuousCount: tail.length, ema9: ema, lastCloseVsEma9: direction,
      confirmingCloses: relations.length >= 2 && direction !== 'AT' && direction === relations.at(-2) ? 2 as const : 0 as const,
      bars: closed };
  });
  const sides = frames.filter(f => f.minutes !== 1).map(f => f.lastCloseVsEma9);
  let weighted = 0, volume = 0, vwap: number | null = null;
  const vwapSides: Direction[] = [];
  const vwapQualified = input.complete && bars.length > 0
    && bars.length === Math.floor((Math.min(cutoff, close) - open) / 60_000)
    && bars.every(b => b.vwap !== null && Number.isFinite(b.vwap) && b.vwap > 0);
  if (vwapQualified) for (const b of bars) {
    weighted += (b.vwap as number) * b.volume; volume += b.volume;
    vwap = volume > 0 ? weighted / volume : null;
    if (vwap !== null) vwapSides.push(relation(b.close, vwap));
  }
  if (vwap === null) reasons.push('SESSION_VWAP_UNAVAILABLE');
  const side = vwapSides.at(-1) ?? null, prior = vwapSides.at(-2) ?? null;
  return { ...receipt, state: reasons.length ? 'PARTIAL' : 'PRESENT', reasons: [...new Set(reasons)],
    paginationComplete: input.complete, closedMinuteCount: bars.length, excludedDevelopingCount: developing,
    inputHash: createHash('sha256').update(JSON.stringify({ bars: qualified, sessions, complete: input.complete,
      warmupReasons: input.warmupReasons ?? [] })).digest('hex'),
    lastClosedAt: lastEnd === null ? null : new Date(lastEnd).toISOString(), stale, frames,
    warmupSessions: input.warmupSessions ?? [],
    sessionVwap: vwap, vwapRelation: side,
    vwapTransition: side === null || prior === null ? null : side === 'ABOVE' && prior === 'BELOW' ? 'RECLAIM'
      : side === 'BELOW' && prior === 'ABOVE' ? 'REJECT' : 'NONE',
    alignment: sides.some(s => s === null) ? 'INSUFFICIENT' : sides.every(s => s === 'ABOVE') ? 'ALIGNED_UP'
      : sides.every(s => s === 'BELOW') ? 'ALIGNED_DOWN' : 'MIXED',
  };
}

/** Optional, bounded current-session read plus at most two prior session reads
 * and one calendar read. No retry and no trading authority. */
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
    const provider = { ...input.alpaca, requestTimeoutMs: Math.min(input.alpaca.requestTimeoutMs ?? 2_000, 2_000),
      readRetry: { policy: { maxRetries: 0 } } };
    const result = await fetchStockBars(provider, { symbols: [input.underlying], timeframe: '1Min',
      start: context.sessionOpen as string, end: input.requestedAt, feed: 'iex', maxPages: 1, adjustment: 'raw' }, input.requestedAt);
    const warmupSessions: IntradaySession[] = [], warmupBars: HistoricalBar[] = [], warmupReasons: string[] = [];
    try {
      const start = new Date(Date.parse(context.sessionOpen as string)); start.setUTCDate(start.getUTCDate() - 10);
      const end = new Date(Date.parse(context.sessionOpen as string)); end.setUTCDate(end.getUTCDate() - 1);
      const calendar = await fetchMarketCalendar(provider, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
      const prior = calendar.filter(s => s.date >= start.toISOString().slice(0, 10) && s.date <= end.toISOString().slice(0, 10))
        .sort((a, b) => a.date.localeCompare(b.date)).slice(-2);
      // A malformed calendar row must not be silently removed and bridge an
      // unknown trading session. Duplicate/overlapping sessions fail validation.
      for (const session of prior) {
        if (session.open === null || session.close === null) throw new Error('INTRADAY_SESSION_BOUNDARY_INVALID');
        warmupSessions.push({ open: newYorkSessionTime(session.date, session.open), close: newYorkSessionTime(session.date, session.close) });
      }
      if (warmupSessions.length < 2) warmupReasons.push('WARMUP_CALENDAR_INSUFFICIENT');
      for (const session of warmupSessions) {
        try {
          const history = await fetchStockBars(provider, { symbols: [input.underlying], timeframe: '1Min',
            start: session.open, end: session.close, feed: 'iex', maxPages: 1, adjustment: 'raw' }, input.requestedAt);
          if (history.complete) warmupBars.push(...history.bars);
          else warmupReasons.push('WARMUP_PAGINATION_INCOMPLETE');
        } catch { warmupReasons.push('WARMUP_PROVIDER_ERROR'); }
      }
    } catch {
      warmupSessions.length = 0; warmupBars.length = 0;
      warmupReasons.push('WARMUP_CALENDAR_UNAVAILABLE');
    }
    const observedAt = input.now();
    return buildIntradayStructure({ ...context, observedAt, complete: result.complete,
      warmupSessions, warmupReasons,
      bars: [...warmupBars, ...result.bars].map(b => ({ ...b, receivedAt: observedAt })) });
  } catch (error) {
    const code = error instanceof AlpacaProviderError ? error.errorClass
      : error instanceof Error && /^INTRADAY_[A-Z_]+$/.test(error.message) ? error.message : 'UNCLASSIFIED_PROVIDER_FAILURE';
    return { ...base({ ...context, observedAt: input.now() }), state: 'PROVIDER_ERROR', reasons: [code] };
  }
}
