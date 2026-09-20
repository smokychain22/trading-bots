import { barsAsOf, type HistoricalBar } from './underlying-history.js';

export interface CorrelationEvidenceConfig {
  readonly asOf: string;
  readonly lookbackBars: number;
  readonly evidenceVersion: string;
  readonly dataVersion: string;
}

export interface PairwiseCorrelationEvidence {
  readonly left: string;
  readonly right: string;
  readonly correlation: number | null;
  readonly overlappingReturnCount: number;
  readonly state: 'KNOWN' | 'UNKNOWN';
  readonly missingReason: string | null;
}

export interface CorrelationEvidence {
  readonly asOf: string;
  readonly lookbackBars: number;
  readonly evidenceVersion: string;
  readonly dataVersion: string;
  readonly provider: 'ALPACA';
  readonly feeds: readonly (string | null)[];
  readonly symbols: readonly string[];
  readonly pairs: readonly PairwiseCorrelationEvidence[];
  readonly knownPairCoverage: number | null;
}

function returnsByTimestamp(bars: readonly HistoricalBar[], asOf: string, lookbackBars: number): Map<string, number> {
  const ordered = [...barsAsOf(bars, asOf)].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const windowed = ordered.slice(-(lookbackBars + 1));
  const values = new Map<string, number>();
  for (let index = 1; index < windowed.length; index += 1) {
    const previous = windowed[index - 1];
    const current = windowed[index];
    if (previous === undefined || current === undefined || previous.close <= 0 || current.close <= 0) continue;
    values.set(current.timestamp, Math.log(current.close / previous.close));
  }
  return values;
}

function pearson(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = (left[index] as number) - leftMean;
    const rightDelta = (right[index] as number) - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? null : numerator / denominator;
}

export function buildCorrelationEvidence(
  bars: readonly HistoricalBar[],
  config: CorrelationEvidenceConfig,
): CorrelationEvidence {
  if (!Number.isInteger(config.lookbackBars) || config.lookbackBars < 2) throw new Error('lookbackBars must be at least 2');
  if (!config.evidenceVersion || !config.dataVersion) throw new Error('evidence and data versions are required');
  const symbols = [...new Set(bars.map((item) => item.symbol))].sort();
  const returns = new Map(symbols.map((symbol) => [symbol, returnsByTimestamp(
    bars.filter((item) => item.symbol === symbol), config.asOf, config.lookbackBars,
  )]));
  const pairs: PairwiseCorrelationEvidence[] = [];
  for (let leftIndex = 0; leftIndex < symbols.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < symbols.length; rightIndex += 1) {
      const left = symbols[leftIndex] as string;
      const right = symbols[rightIndex] as string;
      const leftReturns = returns.get(left) ?? new Map<string, number>();
      const rightReturns = returns.get(right) ?? new Map<string, number>();
      const timestamps = [...leftReturns.keys()].filter((timestamp) => rightReturns.has(timestamp)).sort();
      const correlation = pearson(
        timestamps.map((timestamp) => leftReturns.get(timestamp) as number),
        timestamps.map((timestamp) => rightReturns.get(timestamp) as number),
      );
      pairs.push({
        left,
        right,
        correlation,
        overlappingReturnCount: timestamps.length,
        state: correlation === null ? 'UNKNOWN' : 'KNOWN',
        missingReason: correlation === null ? (timestamps.length < 2 ? 'INSUFFICIENT_SYNCHRONIZED_RETURNS' : 'ZERO_VARIANCE') : null,
      });
    }
  }
  const known = pairs.filter((item) => item.state === 'KNOWN').length;
  return {
    asOf: config.asOf,
    lookbackBars: config.lookbackBars,
    evidenceVersion: config.evidenceVersion,
    dataVersion: config.dataVersion,
    provider: 'ALPACA',
    feeds: [...new Set(bars.map((item) => item.feed))].sort((a, b) => String(a).localeCompare(String(b))),
    symbols,
    pairs,
    knownPairCoverage: pairs.length === 0 ? null : known / pairs.length,
  };
}
