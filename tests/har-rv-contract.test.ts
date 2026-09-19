import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHarRvResponse } from '../src/theta/har-rv-contract.js';

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-har-rv-runtime-v1',
  snapshotId: 'snap-1',
  timestamp: '2026-09-19T00:00:00.000Z',
  asOf: '2026-09-19T00:00:00.000Z',
  modelVersion: 'theta-har-rv-shadow-v1',
  horizonDays: 1,
  forecastRealizedVariance: 0.0002,
  forecastRealizedVolatility: 0.224,
  trainingObservationCount: 100,
  dataQuality: 'KNOWN',
  reason: null,
  ...overrides,
});

test('a KNOWN response with both forecast fields present parses cleanly', () => {
  const response = parseHarRvResponse(basePayload());
  assert.equal(response.dataQuality, 'KNOWN');
  assert.equal(response.forecastRealizedVariance, 0.0002);
});

test('a KNOWN response missing a forecast value is rejected -- KNOWN and null forecasts are mutually exclusive', () => {
  assert.throws(() => parseHarRvResponse(basePayload({ forecastRealizedVariance: null })));
});

test('an UNKNOWN/INSUFFICIENT_HISTORY response with a non-null forecast is rejected -- never a fabricated forecast alongside an honest UNKNOWN state', () => {
  assert.throws(() => parseHarRvResponse(basePayload({
    dataQuality: 'INSUFFICIENT_HISTORY', forecastRealizedVariance: 0.0002, reason: 'not enough history',
  })));
});

test('an UNKNOWN response with both forecast fields null parses cleanly', () => {
  const response = parseHarRvResponse(basePayload({
    dataQuality: 'UNKNOWN', forecastRealizedVariance: null, forecastRealizedVolatility: null, reason: 'ols fit failed',
  }));
  assert.equal(response.dataQuality, 'UNKNOWN');
  assert.equal(response.forecastRealizedVariance, null);
});

test('a negative forecast is rejected -- realized variance/volatility can never be negative', () => {
  assert.throws(() => parseHarRvResponse(basePayload({ forecastRealizedVariance: -0.001 })));
});

test('wrong contractVersion is rejected', () => {
  assert.throws(() => parseHarRvResponse(basePayload({ contractVersion: 'wrong-version' })));
});
