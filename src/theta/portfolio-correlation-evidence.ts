import { createHash } from 'node:crypto';
import { buildCorrelationEvidence } from './correlation-evidence.js';
import type { HistoricalBar } from './underlying-history.js';

export const portfolioCorrelationEvidenceVersion = 'theta-portfolio-correlation-observation-v1' as const;

export interface PortfolioCorrelationPair {
  readonly heldUnderlying: string;
  readonly exposureDollars: number;
  readonly correlation: number | null;
  readonly overlappingReturns: number;
  readonly state: 'KNOWN' | 'DATA_INSUFFICIENT' | 'STALE';
  readonly reason: string | null;
}

export interface PortfolioCorrelationObservation {
  readonly version: typeof portfolioCorrelationEvidenceVersion;
  readonly authority: 'ALPACA_MARKET_OBSERVATION_NO_BROKER_AUTHORITY';
  readonly state: 'NOT_APPLICABLE' | 'KNOWN' | 'DATA_INSUFFICIENT' | 'STALE' | 'PARTIAL_COVERAGE' | 'PROVIDER_ERROR';
  readonly candidateUnderlying: string;
  readonly evaluatedAt: string;
  readonly sourceAvailableAt: string | null;
  readonly decisionAsOf: string;
  readonly usableForDecision: boolean;
  readonly lookbackSessions: number;
  readonly minimumOverlappingReturns: number;
  readonly maxBarAgeCalendarDays: number;
  readonly returnConvention: 'CLOSE_TO_CLOSE_LOG_RETURN_COMPLETED_DAILY_BARS';
  readonly pairs: readonly PortfolioCorrelationPair[];
  readonly maxAbsoluteCorrelation: number | null;
  readonly exposureWeightedCorrelation: number | null;
  readonly knownPairCoverage: number | null;
  readonly sourceBarHash: string | null;
  readonly reason: string;
}

export function assessPortfolioCorrelation(input: {
  readonly candidateUnderlying: string;
  readonly currentExposureByUnderlying: Readonly<Record<string, number>>;
  readonly bars: readonly HistoricalBar[];
  readonly providerState: 'COMPLETE' | 'INCOMPLETE' | 'ERROR';
  readonly decisionAsOf: string;
  readonly evaluatedAt: string;
  readonly lookbackSessions: number;
  readonly minimumOverlappingReturns: number;
  readonly maxBarAgeCalendarDays: number;
}): PortfolioCorrelationObservation {
  const decisionMs = Date.parse(input.decisionAsOf);
  const evaluatedMs = Date.parse(input.evaluatedAt);
  if (!input.candidateUnderlying || input.candidateUnderlying.length > 64 || !Number.isFinite(decisionMs)
    || !Number.isFinite(evaluatedMs) || evaluatedMs < decisionMs
    || !Number.isInteger(input.lookbackSessions) || input.lookbackSessions < 2
    || !Number.isInteger(input.minimumOverlappingReturns) || input.minimumOverlappingReturns < 2
    || input.minimumOverlappingReturns > input.lookbackSessions
    || !Number.isInteger(input.maxBarAgeCalendarDays) || input.maxBarAgeCalendarDays < 1
    || Object.entries(input.currentExposureByUnderlying).some(([symbol, value]) =>
      !symbol || symbol.length > 64 || !Number.isFinite(value) || value < 0)) {
    throw new Error('PORTFOLIO_CORRELATION_INPUT_INVALID');
  }
  const held = Object.entries(input.currentExposureByUnderlying)
    .filter(([, value]) => value > 0).sort(([left], [right]) => left.localeCompare(right));
  const base = {
    version: portfolioCorrelationEvidenceVersion,
    authority: 'ALPACA_MARKET_OBSERVATION_NO_BROKER_AUTHORITY' as const,
    candidateUnderlying: input.candidateUnderlying, evaluatedAt: input.evaluatedAt,
    decisionAsOf: input.decisionAsOf, lookbackSessions: input.lookbackSessions,
    minimumOverlappingReturns: input.minimumOverlappingReturns,
    maxBarAgeCalendarDays: input.maxBarAgeCalendarDays,
    returnConvention: 'CLOSE_TO_CLOSE_LOG_RETURN_COMPLETED_DAILY_BARS' as const,
  };
  if (held.length === 0) return {
    ...base, state: 'NOT_APPLICABLE', sourceAvailableAt: null, usableForDecision: true,
    pairs: [], maxAbsoluteCorrelation: null, exposureWeightedCorrelation: null,
    knownPairCoverage: null, sourceBarHash: null, reason: 'NO_CURRENT_RISKY_UNDERLYING',
  };
  if (held.every(([symbol]) => symbol === input.candidateUnderlying)) return {
    ...base, state: 'KNOWN', sourceAvailableAt: null, usableForDecision: true,
    pairs: held.map(([heldUnderlying, exposureDollars]) => ({ heldUnderlying, exposureDollars,
      correlation: 1, overlappingReturns: 0, state: 'KNOWN' as const, reason: 'SAME_UNDERLYING_IDENTITY' })),
    maxAbsoluteCorrelation: 1, exposureWeightedCorrelation: 1,
    knownPairCoverage: 1, sourceBarHash: null, reason: 'SAME_UNDERLYING_IDENTITY',
  };
  const completedBars = input.bars.filter((bar) => bar.timestamp.slice(0, 10) < input.evaluatedAt.slice(0, 10)
    && Date.parse(bar.timestamp) <= evaluatedMs && Date.parse(bar.receivedAt) <= evaluatedMs);
  const relevantSymbols = new Set([input.candidateUnderlying, ...held.map(([symbol]) => symbol)]);
  const relevantBars = completedBars.filter((bar) => relevantSymbols.has(bar.symbol));
  const receivedTimes = relevantBars.map((bar) => Date.parse(bar.receivedAt));
  const sourceAvailableAt = receivedTimes.length === 0 ? null : new Date(Math.max(...receivedTimes)).toISOString();
  const usableForDecision = sourceAvailableAt === null || Date.parse(sourceAvailableAt) <= decisionMs;
  const sourceBarHash = relevantBars.length === 0 ? null : createHash('sha256').update(JSON.stringify(
    relevantBars.map((bar) => [bar.symbol, bar.timestamp, bar.close, bar.feed, bar.receivedAt])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  )).digest('hex');
  if (input.providerState !== 'COMPLETE') return {
    ...base, state: input.providerState === 'ERROR' ? 'PROVIDER_ERROR' : 'PARTIAL_COVERAGE',
    sourceAvailableAt, usableForDecision: false,
    pairs: [], maxAbsoluteCorrelation: null, exposureWeightedCorrelation: null,
    knownPairCoverage: null, sourceBarHash,
    reason: input.providerState === 'ERROR' ? 'ALPACA_BARS_PROVIDER_ERROR' : 'ALPACA_BARS_PAGINATION_INCOMPLETE',
  };
  const correlation = buildCorrelationEvidence(relevantBars, {
    asOf: input.evaluatedAt, lookbackBars: input.lookbackSessions,
    evidenceVersion: portfolioCorrelationEvidenceVersion, dataVersion: 'alpaca-completed-daily-bars-v1',
  });
  const pairs: PortfolioCorrelationPair[] = held.map(([symbol, exposureDollars]) => {
    if (symbol === input.candidateUnderlying) return {
      heldUnderlying: symbol, exposureDollars, correlation: 1, overlappingReturns: 0,
      state: 'KNOWN', reason: 'SAME_UNDERLYING_IDENTITY',
    };
    const candidateBars = relevantBars.filter((bar) => bar.symbol === input.candidateUnderlying);
    const heldBars = relevantBars.filter((bar) => bar.symbol === symbol);
    const newest = [candidateBars, heldBars].map((symbolBars) => symbolBars.length === 0 ? null
      : Math.max(...symbolBars.map((bar) => Date.parse(bar.timestamp))));
    if (newest.some((time) => time === null || !Number.isFinite(time)
      || evaluatedMs - time > input.maxBarAgeCalendarDays * 86_400_000)) return {
      heldUnderlying: symbol, exposureDollars, correlation: null, overlappingReturns: 0,
      state: 'STALE', reason: 'COMPLETED_DAILY_BAR_STALE_OR_MISSING',
    };
    const pair = correlation.pairs.find((item) => item.left === symbol && item.right === input.candidateUnderlying
      || item.right === symbol && item.left === input.candidateUnderlying);
    if (pair?.state !== 'KNOWN' || pair.overlappingReturnCount < input.minimumOverlappingReturns) return {
      heldUnderlying: symbol, exposureDollars, correlation: null,
      overlappingReturns: pair?.overlappingReturnCount ?? 0, state: 'DATA_INSUFFICIENT',
      reason: pair?.missingReason ?? 'MINIMUM_SYNCHRONIZED_RETURNS_NOT_MET',
    };
    return { heldUnderlying: symbol, exposureDollars, correlation: pair.correlation,
      overlappingReturns: pair.overlappingReturnCount, state: 'KNOWN', reason: null };
  });
  const known = pairs.filter((pair) => pair.state === 'KNOWN' && pair.correlation !== null);
  const state = pairs.some((pair) => pair.state === 'STALE') ? 'STALE'
    : known.length !== pairs.length ? 'DATA_INSUFFICIENT' : 'KNOWN';
  const totalExposure = known.reduce((sum, pair) => sum + pair.exposureDollars, 0);
  return {
    ...base, state, sourceAvailableAt, usableForDecision: state === 'KNOWN' && usableForDecision,
    pairs,
    maxAbsoluteCorrelation: state === 'KNOWN' ? Math.max(...known.map((pair) => Math.abs(pair.correlation as number))) : null,
    exposureWeightedCorrelation: state === 'KNOWN' && totalExposure > 0
      ? known.reduce((sum, pair) => sum + (pair.correlation as number) * pair.exposureDollars, 0) / totalExposure : null,
    knownPairCoverage: known.length / pairs.length, sourceBarHash,
    reason: state === 'KNOWN' ? (usableForDecision ? 'COMPLETE_CORRELATION_OBSERVATION' : 'OBSERVED_AFTER_DECISION')
      : state === 'STALE' ? 'BAR_STALENESS_BLOCKS_PORTFOLIO_CORRELATION' : 'PAIR_COVERAGE_INCOMPLETE',
  };
}
