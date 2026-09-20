import { createHash } from 'node:crypto';
import { barsAsOf, type HistoricalBar } from './underlying-history.js';

export interface HistoricalBarExtractionRequest {
  readonly eligibleUnderlyings: readonly string[];
  readonly requestWindow: { readonly start: string; readonly end: string };
  readonly asOf: string;
  readonly retrievedAt: string;
  readonly feed: string | null;
  readonly timeframe: string;
  readonly adjustment: 'SPLIT_ADJUSTED' | 'ALL_ADJUSTED';
  readonly dataVersion: string;
}

export interface HistoricalBarExtraction {
  readonly source: 'ALPACA';
  readonly request: HistoricalBarExtractionRequest;
  readonly bars: readonly HistoricalBar[];
  readonly missingUnderlyings: readonly string[];
  readonly observedDatesByUnderlying: Readonly<Record<string, readonly string[]>>;
  readonly contentHash: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function extractHistoricalBars(
  availableBars: readonly HistoricalBar[],
  request: HistoricalBarExtractionRequest,
): HistoricalBarExtraction {
  const start = Date.parse(request.requestWindow.start);
  const end = Date.parse(request.requestWindow.end);
  const asOf = Date.parse(request.asOf);
  const retrievedAt = Date.parse(request.retrievedAt);
  if (![start, end, asOf, retrievedAt].every(Number.isFinite) || start > end || end > asOf || asOf > retrievedAt) {
    throw new Error('historical extraction timestamps must satisfy start <= end <= asOf <= retrievedAt');
  }
  if (!request.dataVersion || !request.timeframe || request.eligibleUnderlyings.length === 0) {
    throw new Error('historical extraction identity is incomplete');
  }
  const eligible = [...new Set(request.eligibleUnderlyings)].sort();
  const eligibleSet = new Set(eligible);
  const filtered = barsAsOf(availableBars, request.asOf)
    .filter((bar) => eligibleSet.has(bar.symbol)
      && Date.parse(bar.timestamp) >= start
      && Date.parse(bar.timestamp) <= end
      && bar.feed === request.feed)
    .sort((left, right) => left.symbol.localeCompare(right.symbol) || Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const observedDatesByUnderlying = Object.fromEntries(eligible.map((symbol) => [symbol,
    [...new Set(filtered.filter((item) => item.symbol === symbol).map((item) => item.timestamp.slice(0, 10)))].sort(),
  ]));
  const missingUnderlyings = eligible.filter((symbol) => observedDatesByUnderlying[symbol]?.length === 0);
  const identity = { source: 'ALPACA', request: { ...request, eligibleUnderlyings: eligible }, bars: filtered };
  return {
    source: 'ALPACA',
    request: { ...request, eligibleUnderlyings: eligible },
    bars: filtered,
    missingUnderlyings,
    observedDatesByUnderlying,
    contentHash: createHash('sha256').update(canonicalJson(identity)).digest('hex'),
  };
}
