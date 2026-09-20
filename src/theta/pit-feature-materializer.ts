import {
  computeAverageVolume,
  computeCurrentDrawdown,
  computeDownsideSemivariance,
  computeGapFrequency,
  computeMaxAdverseGap,
  computeRealizedVolatility,
  computeReturn,
  computeTrendSlope,
} from './underlying-features.js';
import { barsAsOf, type HistoricalBar } from './underlying-history.js';

export interface PitFeatureMaterializerConfig {
  readonly featureVersion: string;
  readonly asOf: string;
  readonly returnWindows: readonly number[];
  readonly movingAverageWindows: readonly number[];
  readonly realizedVolatilityWindows: readonly number[];
  readonly trendWindow: number;
  readonly drawdownWindow: number;
  readonly gapWindow: number;
  readonly gapThresholdFraction: number;
  readonly downsideSemivarianceWindow: number;
  readonly averageVolumeWindow: number;
  readonly adjustment: 'SPLIT_ADJUSTED' | 'ALL_ADJUSTED';
  readonly dataVersion: string;
}

export interface PitFeatureSnapshot {
  readonly underlying: string;
  readonly asOf: string;
  readonly featureAvailableAt: string;
  readonly featureVersion: string;
  readonly provider: 'ALPACA';
  readonly feed: string | null;
  readonly retrievedAt: string;
  readonly dataVersion: string;
  readonly adjustment: 'SPLIT_ADJUSTED' | 'ALL_ADJUSTED';
  readonly values: Readonly<Record<string, number | null>>;
  readonly missingFeatures: readonly string[];
  readonly barCount: number;
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function simpleMovingAverage(bars: readonly HistoricalBar[], asOf: string, window: number): number | null {
  const values = [...barsAsOf(bars, asOf)]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-window)
    .map((item) => item.close);
  if (values.length < window || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function materializePitFeatureSnapshot(
  underlying: string,
  bars: readonly HistoricalBar[],
  config: PitFeatureMaterializerConfig,
): PitFeatureSnapshot {
  if (!underlying || !config.featureVersion || !config.dataVersion) throw new Error('underlying and versions are required');
  if (!Number.isFinite(Date.parse(config.asOf))) throw new Error('asOf must be a valid instant');
  for (const window of [
    ...config.returnWindows,
    ...config.movingAverageWindows,
    ...config.realizedVolatilityWindows,
    config.trendWindow,
    config.drawdownWindow,
    config.gapWindow,
    config.downsideSemivarianceWindow,
    config.averageVolumeWindow,
  ]) requirePositiveInteger('feature window', window);
  if (!Number.isFinite(config.gapThresholdFraction) || config.gapThresholdFraction <= 0) {
    throw new Error('gapThresholdFraction must be positive');
  }

  const relevant = barsAsOf(bars.filter((item) => item.symbol === underlying), config.asOf);
  const feeds = new Set(relevant.map((item) => item.feed));
  if (feeds.size > 1) throw new Error('mixed Alpaca feeds require separate feature snapshots');
  const retrievedAt = relevant.reduce(
    (latest, item) => Date.parse(item.receivedAt) > Date.parse(latest) ? item.receivedAt : latest,
    '1970-01-01T00:00:00.000Z',
  );
  const values: Record<string, number | null> = {};
  for (const window of config.returnWindows) values[`return_${window}d`] = computeReturn(relevant, config.asOf, window);
  for (const window of config.movingAverageWindows) values[`ma_${window}`] = simpleMovingAverage(relevant, config.asOf, window);
  for (const window of config.realizedVolatilityWindows) {
    values[`realized_volatility_${window}d`] = computeRealizedVolatility(relevant, config.asOf, window);
  }
  values[`trend_slope_${config.trendWindow}d`] = computeTrendSlope(relevant, config.asOf, config.trendWindow);
  values[`drawdown_${config.drawdownWindow}d`] = computeCurrentDrawdown(relevant, config.asOf, config.drawdownWindow);
  values[`max_adverse_gap_${config.gapWindow}d`] = computeMaxAdverseGap(relevant, config.asOf, config.gapWindow);
  values[`gap_frequency_${config.gapWindow}d`] = computeGapFrequency(
    relevant, config.asOf, config.gapWindow, config.gapThresholdFraction,
  );
  values[`downside_semivariance_${config.downsideSemivarianceWindow}d`] = computeDownsideSemivariance(
    relevant, config.asOf, config.downsideSemivarianceWindow,
  );
  values[`average_volume_${config.averageVolumeWindow}d`] = computeAverageVolume(
    relevant, config.asOf, config.averageVolumeWindow,
  );

  return {
    underlying,
    asOf: config.asOf,
    featureAvailableAt: config.asOf,
    featureVersion: config.featureVersion,
    provider: 'ALPACA',
    feed: feeds.values().next().value ?? null,
    retrievedAt,
    dataVersion: config.dataVersion,
    adjustment: config.adjustment,
    values,
    missingFeatures: Object.entries(values).filter(([, value]) => value === null).map(([name]) => name).sort(),
    barCount: relevant.length,
  };
}
