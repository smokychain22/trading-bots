// Nested shared-context normalization: the legacy point-in-time evidence repeated the same large `surface` and `providerMetrics` inside every candidate's
// volatility JSON (measured 82.9x repetition) while a small sibling differed per candidate. Descending one level stores each large nested value once, losslessly.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../src/storage/data-platform/archive-manifest.js';
import { denormalizeDecision, normalizeDecision, verifyNormalization } from '../src/storage/data-platform/decision-context.js';
import { mulberry32 } from './helpers/data-platform-model.js';

const surface = { strikes: Array.from({ length: 80 }, (_, index) => ({ k: 400 + index, iv: 0.2 + index / 1000, vega: 0.01 * index })), expirations: ['2026-11-20', '2026-12-18'] };
const providerMetrics = { vendor: 'ALPACA', values: Array.from({ length: 60 }, (_, index) => ({ n: index, s: `m${index}` })) };

const candidates = (count: number) => Array.from({ length: count }, (_, index) => ({
  candidate_id: `c-${index}`,
  volatility_json: { surface, providerMetrics, contractVolatility: { iv: 0.21 + index / 10_000, strike: 400 + index } },
  event_json: { earnings: null, window: [1, 2, 3] },
}));

test('nested normalization: a surface shared by every candidate is stored once while the small per-candidate sibling stays inline; reconstruction is exact', () => {
  const rows = candidates(83);
  const flat = normalizeDecision(rows);
  const nested = normalizeDecision(rows, { descendObjects: true });
  assert.ok(nested.stats.normalizedBytes < 0.1 * nested.stats.originalBytes, `${nested.stats.normalizedBytes}/${nested.stats.originalBytes}`);
  assert.ok(flat.stats.normalizedBytes > 5 * nested.stats.normalizedBytes, 'without descent the per-candidate sibling defeats deduplication');
  assert.ok(nested.stats.sharedFields.some((field) => field.endsWith('surface')) && nested.stats.sharedFields.some((field) => field.endsWith('providerMetrics')));
  assert.equal(verifyNormalization(rows, nested), true);
  assert.deepEqual(denormalizeDecision(nested).map((row) => canonicalJson(row)), rows.map((row) => canonicalJson(row)));
});

test('nested normalization edge cases: empty objects, objects present in some rows only, small objects, arrays and reserved keys', () => {
  const big = { text: 'x'.repeat(400) };
  const rows: Record<string, unknown>[] = [
    { id: 1, payload: { ...big, extra: { deep: [1, 2] } }, empty: {}, arr: [1, 2, 3], small: { a: 1 } },
    { id: 2, payload: { ...big }, empty: {}, arr: [1, 2, 3] },
    { id: 3, payload: {}, other: null },
    { id: 4 },
  ];
  const normalized = normalizeDecision(rows, { descendObjects: true, minimumBytes: 64 });
  assert.equal(verifyNormalization(rows, normalized), true);
  assert.deepEqual(denormalizeDecision(normalized).map((row) => canonicalJson(row)), rows.map((row) => canonicalJson(row)));
  assert.throws(() => normalizeDecision([{ 'bad\u0001key': 1 }, { a: 1 }], { descendObjects: true }), /RESERVED_KEY/);
  assert.throws(() => normalizeDecision([{ outer: { 'bad\u0002': 1, pad: 'x'.repeat(300) } }], { descendObjects: true }), /RESERVED_KEY/);
});

test('PROPERTY: nested normalization is lossless for random shapes (shared, pooled, unique and absent nested values at several depths)', () => {
  const rng = mulberry32(8301);
  for (let round = 0; round < 150; round += 1) {
    const sharedValue = { data: 'q'.repeat(150 + Math.floor(rng() * 300)), list: [round, { z: round }] };
    const pool = Array.from({ length: 1 + Math.floor(rng() * 3) }, (_, index) => ({ pooled: `p${round}-${index}`, pad: 'w'.repeat(150) }));
    const rows = Array.from({ length: 1 + Math.floor(rng() * 25) }, (_, index) => {
      const nested: Record<string, unknown> = { always: sharedValue };
      if (rng() < 0.7) nested.pooled = pool[Math.floor(rng() * pool.length)];
      if (rng() < 0.5) nested.unique = { u: `u${round}-${index}`, pad: 'e'.repeat(160) };
      if (rng() < 0.2) nested.empty = {};
      const row: Record<string, unknown> = { id: index, nested };
      if (rng() < 0.4) row.flat = { a: index };
      if (rng() < 0.2) row.nothing = null;
      return row;
    });
    const normalized = normalizeDecision(rows, { descendObjects: true });
    assert.equal(verifyNormalization(rows, normalized), true, `round ${round}`);
  }
});
