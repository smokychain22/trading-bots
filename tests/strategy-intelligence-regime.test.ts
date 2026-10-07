import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketRegimeReceipt, evaluateForwardEvidence, supportResistance, type DailyBar } from '../src/theta/strategy-intelligence/market-regime.js';

// Deterministic synthetic bars (no market data): closes from a path function plus seeded noise.
function bars(n: number, path: (i: number) => number, noise = 0.004, seed = 7): DailyBar[] {
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 - 0.5; };
  return Array.from({ length: n }, (_, i) => {
    const close = path(i) * (1 + noise * rnd());
    const span = close * (0.004 + Math.abs(noise) * Math.abs(rnd()));
    return { date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10), open: close, high: close + span, low: close - span, close, volume: 1e6 };
  });
}

test('a steady uptrend is classified up and trending, with provenance on every field', () => {
  const r = buildMarketRegimeReceipt(bars(200, (i) => 100 * Math.exp(0.006 * i)));
  assert.ok(r.direction.state === 'KNOWN' && ['STRONG_UP', 'MODERATE_UP'].includes(r.direction.value), JSON.stringify(r.direction));
  assert.ok(r.structure.state === 'KNOWN' && r.structure.value === 'TRENDING');
  assert.ok(r.direction.state === 'KNOWN' && r.direction.provenance === 'IMPLEMENTATION_INFERENCE');
  assert.ok(r.evidence.rvLong.state === 'KNOWN' && r.evidence.rvLong.provenance === 'COMPUTED_FROM_DAILY_BARS');
  assert.equal(r.parameterVersion, 'theta-regime-thresholds-v0-unvalidated');
});

test('a downtrend is down; a flat oscillation is flat and not trending', () => {
  const down = buildMarketRegimeReceipt(bars(200, (i) => 100 * Math.exp(-0.006 * i)));
  assert.ok(down.direction.state === 'KNOWN' && down.direction.value.endsWith('_DOWN'));
  const flat = buildMarketRegimeReceipt(bars(200, (i) => 100 + 2 * Math.sin(2 * Math.PI * i / 20), 0.002));
  assert.ok(flat.direction.state === 'KNOWN' && ['FLAT', 'WEAK_UP', 'WEAK_DOWN'].includes(flat.direction.value));
  assert.ok(flat.structure.state === 'KNOWN' && flat.structure.value !== 'TRENDING');
});

test('compression after a volatile period is COMPRESSED and volatility CONTRACTING', () => {
  const series = bars(200, () => 100, 0.04).map((b, i) => i >= 194 ? { ...b, close: 100 + (i % 2) * 0.01, high: 100.05, low: 99.95, open: 100 } : b);
  const r = buildMarketRegimeReceipt(series);
  assert.ok(r.movement.state === 'KNOWN' && r.movement.value === 'COMPRESSED');
  assert.ok(r.volatility.state === 'KNOWN' && r.volatility.value === 'CONTRACTING');
});

test('optional option evidence is UNKNOWN unless supplied; never coerced to zero; events drive structure', () => {
  const series = bars(200, (i) => 100 + i * 0.01);
  const plain = buildMarketRegimeReceipt(series);
  assert.deepEqual(plain.evidence.iv, { state: 'UNKNOWN', reason: 'NOT_SUPPLIED' });
  assert.deepEqual(plain.evidence.putCallOiRatio, { state: 'UNKNOWN', reason: 'NOT_SUPPLIED' });
  assert.equal(plain.event.state, 'UNKNOWN');
  const rich = buildMarketRegimeReceipt(series, { iv: 0.3, putCallOiRatio: 1.4, eventInDays: 2 });
  assert.ok(rich.evidence.ivMinusRv.state === 'KNOWN');
  assert.ok(rich.structure.state === 'KNOWN' && rich.structure.value === 'EVENT_DRIVEN');
  assert.ok(rich.confidence.state === 'KNOWN' && plain.confidence.state === 'KNOWN' && rich.confidence.value > plain.confidence.value);
});

test('insufficient history yields UNKNOWN fields, not defaults', () => {
  const r = buildMarketRegimeReceipt(bars(8, () => 100));
  assert.equal(r.direction.state, 'UNKNOWN'); assert.equal(r.movement.state, 'UNKNOWN'); assert.equal(r.structure.state, 'UNKNOWN');
});

test('support/resistance: swing levels below/above the close with touches and distance', () => {
  const series = bars(120, (i) => 100 + 5 * Math.sin(i / 4), 0.001);
  const levels = supportResistance(series, 1);
  assert.ok(levels.some((l) => l.kind === 'SUPPORT' && l.level < (series.at(-1) as DailyBar).close && l.touches >= 2));
  assert.ok(levels.every((l) => l.kind === 'SUPPORT' ? l.distancePct >= 0 : l.distancePct <= 0));
});

test('forward evidence is point-in-time: future bars can change outcomes but never the signal', () => {
  const series = bars(160, (i) => 100 + 3 * Math.sin(i / 5), 0.01);
  const seen: string[] = [];
  const signal = (history: readonly DailyBar[]) => { seen.push((history.at(-1) as DailyBar).date); return history.length % 3 === 0; };
  const a = evaluateForwardEvidence(series, signal);
  const recordedA = [...seen]; seen.length = 0;
  const tampered = series.map((b, i) => i > 100 ? { ...b, close: b.close * 1.5 } : b);
  const b = evaluateForwardEvidence(tampered, signal);
  assert.deepEqual(seen.slice(0, 70), recordedA.slice(0, 70)); // identical histories up to the tamper point
  assert.equal(a.signalOn, b.signalOn); assert.equal(a.observations, 160 - 21 - 5);
  assert.notDeepEqual(a.meanAbsMove, b.meanAbsMove);
  // The last history passed is bar n-6: nothing after the final scoreable bar is ever shown to the signal.
  assert.equal(recordedA.at(-1), (series[160 - 6] as DailyBar).date);
  const directional = evaluateForwardEvidence(bars(160, (i) => 100 * Math.exp(0.01 * i), 0.002), () => 'UP');
  assert.equal(directional.directionalAccuracy, 1);
  assert.ok(directional.falsePositiveRate !== null);
});
