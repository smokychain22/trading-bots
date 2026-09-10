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
  const bars: HistoricalBar[] = [];
  for (const [symbol, rawBars] of Object.entries(raw.bars)) {
    for (const bar of rawBars) {
      bars.push({
        symbol,
        timestamp: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        tradeCount: bar.n ?? null,
        vwap: bar.vw ?? null,
        provider: 'ALPACA',
        feed,
        receivedAt,
      });
    }
  }
  return { bars, nextPageToken: raw.next_page_token };
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
