import assert from 'node:assert/strict';
import test from 'node:test';
import { materializePitFeatureSnapshot, type PitFeatureMaterializerConfig } from '../src/theta/pit-feature-materializer.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const instant = (day: number): string => new Date(Date.UTC(2025, 0, day)).toISOString();
const bars = (count: number): HistoricalBar[] => Array.from({ length: count }, (_, index) => ({
  symbol: 'SPY', timestamp: instant(index + 1), open: 100 + index, high: 102 + index, low: 99 + index,
  close: 101 + index, volume: 1_000 + index, tradeCount: 10, vwap: 100.5 + index,
  provider: 'ALPACA', feed: 'iex', receivedAt: instant(index + 1),
}));
const config: PitFeatureMaterializerConfig = {
  featureVersion: 'pit-v1', asOf: instant(210), returnWindows: [1, 5, 20, 60],
  movingAverageWindows: [20, 50, 200], realizedVolatilityWindows: [10, 20, 60], trendWindow: 20,
  drawdownWindow: 60, gapWindow: 60, gapThresholdFraction: 0.02, downsideSemivarianceWindow: 20,
  averageVolumeWindow: 20, adjustment: 'SPLIT_ADJUSTED', dataVersion: 'alpaca-bars-v1',
};

test('materializes requested PIT features with source metadata', () => {
  const result = materializePitFeatureSnapshot('SPY', bars(220), config);
  assert.equal(result.observedAt, instant(210));
  assert.equal(result.featureAvailableAt, instant(210));
  assert.equal(result.provider, 'ALPACA');
  assert.equal(result.feed, 'iex');
  assert.equal(result.values.ma_200, 210.5);
  assert.equal(result.missingFeatures.length, 0);
});

test('future bars cannot alter a point-in-time feature snapshot', () => {
  const all = bars(220);
  const asOfOnly = all.filter((item) => Date.parse(item.timestamp) <= Date.parse(config.asOf));
  assert.deepEqual(
    materializePitFeatureSnapshot('SPY', all, config).values,
    materializePitFeatureSnapshot('SPY', asOfOnly, config).values,
  );
});

test('a bar observed before T0 but retrieved after T0 is rejected as future evidence', () => {
  const leaked = [{ ...(bars(1)[0] as HistoricalBar), receivedAt: instant(211) }];
  assert.throws(() => materializePitFeatureSnapshot('SPY', leaked, config), /PIT_FEATURE_FUTURE_RETRIEVAL/);
});

test('retrieval cannot precede the provider observation', () => {
  const invalid = [{ ...(bars(2)[1] as HistoricalBar), receivedAt: instant(1) }];
  assert.throws(() => materializePitFeatureSnapshot('SPY', invalid, config), /PIT_FEATURE_RETRIEVAL_PRECEDES_OBSERVATION/);
});

test('missing history remains explicit and mixed feeds are rejected', () => {
  const short = materializePitFeatureSnapshot('SPY', bars(5), { ...config, asOf: instant(5) });
  assert.ok(short.missingFeatures.includes('ma_200'));
  assert.throws(() => materializePitFeatureSnapshot('SPY', [
    ...bars(5), { ...(bars(1)[0] as HistoricalBar), timestamp: instant(6), receivedAt:instant(6), feed: 'sip' },
  ], { ...config, asOf: instant(6) }), /mixed Alpaca feeds/);
});
