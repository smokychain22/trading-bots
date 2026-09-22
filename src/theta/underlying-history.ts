// R1B/R1D-F support: typed, pure Alpaca historical stock-bars adapter.
// Alpaca DOES document historical stock bars (GET /v2/stocks/bars,
// GET /v2/stocks/{symbol}/bars) -- per the standing DATA_GAP register
// correction, this is an IMPLEMENTATION gap, not a provider/vendor gap.
// This module contains the pure parsing/pagination-loop logic only; the
// actual fetch() call is injected by the caller so this stays fully
// testable without live credentials or network access.

export interface HistoricalBar {
  readonly symbol: string;
  readonly timestamp: string; // Alpaca's own bar-start timestamp, verbatim
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly tradeCount: number | null;
  readonly vwap: number | null;
  readonly provider: 'ALPACA';
  readonly feed: string | null;
  readonly receivedAt: string;
}

// Minimal shape of Alpaca's actual documented multi-symbol bars response --
// `bars` keyed by symbol, each an array of raw bar objects, plus an
// optional pagination token. Single-symbol responses are normalized to the
// same shape by the caller before reaching parseAlpacaBarsPage (Alpaca's
// single-symbol endpoint nests bars as a flat array under one `bars` key
// plus a top-level `symbol` field instead of the multi-symbol map).
export interface RawAlpacaBar {
  readonly t: string;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
  readonly n?: number;
  readonly vw?: number;
}

export interface RawAlpacaBarsPage {
  readonly bars: Readonly<Record<string, readonly RawAlpacaBar[]>>;
  readonly next_page_token: string | null;
}

export function parseAlpacaBarsPage(raw: RawAlpacaBarsPage, feed: string | null, receivedAt: string): {
  readonly bars: readonly HistoricalBar[];
  readonly nextPageToken: string | null;
} {
  const page = raw as unknown as Record<string, unknown>;
  if (page === null || typeof page !== 'object' || Array.isArray(page)
    || page.bars === null || typeof page.bars !== 'object' || Array.isArray(page.bars)
    || (page.next_page_token !== null && page.next_page_token !== undefined && typeof page.next_page_token !== 'string')) {
    throw new Error('ALPACA_BARS_MALFORMED_PAGE');
  }
  const finite = (value: unknown): number | null => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const bars: HistoricalBar[] = [];
  for (const [symbol, rawBars] of Object.entries(page.bars)) {
    if (!symbol || !Array.isArray(rawBars)) throw new Error('ALPACA_BARS_MALFORMED_SYMBOL_ROWS');
    for (const entry of rawBars) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('ALPACA_BARS_MALFORMED_ROW');
      const bar = entry as Record<string, unknown>;
      const open = finite(bar.o), high = finite(bar.h), low = finite(bar.l), close = finite(bar.c);
      const volume = finite(bar.v), tradeCount = bar.n == null ? null : finite(bar.n);
      const vwap = bar.vw == null ? null : finite(bar.vw);
      if (typeof bar.t !== 'string' || !Number.isFinite(Date.parse(bar.t)))
        throw new Error('ALPACA_BARS_MALFORMED_TIMESTAMP');
      if (open === null || high === null || low === null || close === null
        || open <= 0 || high <= 0 || low <= 0 || close <= 0
        || high < low || open > high || open < low || close > high || close < low)
        throw new Error('ALPACA_BARS_MALFORMED_OHLC');
      if (volume === null || volume < 0) throw new Error('ALPACA_BARS_MALFORMED_VOLUME');
      if (bar.n != null && (tradeCount === null || !Number.isSafeInteger(tradeCount) || tradeCount < 0))
        throw new Error('ALPACA_BARS_MALFORMED_TRADE_COUNT');
      if (bar.vw != null && (vwap === null || vwap <= 0)) throw new Error('ALPACA_BARS_MALFORMED_VWAP');
      bars.push({
        symbol,
        timestamp: bar.t,
        open, high, low, close, volume, tradeCount, vwap,
        provider: 'ALPACA',
        feed,
        receivedAt,
      });
    }
  }
  return { bars, nextPageToken: page.next_page_token as string | null | undefined ?? null };
}

export interface FetchHistoricalBarsParams {
  readonly symbols: readonly string[];
  readonly timeframe: string; // e.g. '1Day', Alpaca's own timeframe syntax, passed through verbatim
  readonly start: string; // RFC3339
  readonly end: string; // RFC3339
  readonly feed: string | null;
  readonly maxPages: number; // safety bound -- never loop on next_page_token forever
}

export type FetchBarsPage = (pageToken: string | null) => Promise<RawAlpacaBarsPage>;

/**
 * Follows Alpaca's next_page_token pagination to completion (bounded by
 * maxPages, never an unbounded loop), never silently truncating a
 * multi-symbol request early. `fetchPage` is injected so this function
 * performs no network I/O itself and is fully testable with a mock.
 */
export async function fetchAllHistoricalBars(
  fetchPage: FetchBarsPage,
  receivedAt: string,
  feed: string | null,
  maxPages: number,
): Promise<readonly HistoricalBar[]> {
  const allBars: HistoricalBar[] = [];
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const raw = await fetchPage(pageToken);
    const { bars, nextPageToken } = parseAlpacaBarsPage(raw, feed, receivedAt);
    allBars.push(...bars);
    pageToken = nextPageToken;
    pages += 1;
    if (pages >= maxPages && pageToken !== null) {
      throw new Error(`fetchAllHistoricalBars: exceeded maxPages=${maxPages} with more pages remaining -- refusing to silently truncate.`);
    }
  } while (pageToken !== null);

  return allBars;
}

/**
 * No-future-leakage filter: only bars with timestamp <= asOf survive. This
 * is deliberately timeframe-naive -- it does not itself know a given
 * timeframe's bar-close offset (e.g. whether a daily bar timestamped at
 * market open is "closed" the moment its timestamp arrives or only at
 * session close) -- callers computing point-in-time features MUST supply
 * an `asOf` that already accounts for their timeframe's close semantics.
 * Flagged explicitly rather than silently assumed correct for every
 * timeframe.
 */
export function barsAsOf(bars: readonly HistoricalBar[], asOf: string): readonly HistoricalBar[] {
  const asOfMs = new Date(asOf).getTime();
  return bars.filter((bar) => new Date(bar.timestamp).getTime() <= asOfMs);
}
