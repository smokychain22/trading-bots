// Normalized point-in-time evidence: exact reconstruction on random decisions, including empty objects, absent children, nulls and array columns.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../src/storage/data-platform/archive-manifest.js';
import { PIT_ARRAY_COLUMNS, PIT_JSON_COLUMNS, PIT_OBJECT_COLUMNS, PIT_SCALAR_COLUMNS, normalizePitRows, reconstructPitRows, decisionContextId, type PitEvidenceRow } from '../src/storage/data-platform/pit-storage.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function randomDecision(seed: number, candidates: number, perturb = true): PitEvidenceRow[] {
  const rand = mulberry32(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const shared: Record<string, Record<string, unknown>> = {};
  for (const column of PIT_OBJECT_COLUMNS) {
    shared[column] = {};
    const n = Math.floor(rand() * 6);
    for (let i = 0; i < n; i += 1) shared[column][`k${i}`] = pick([rand(), 'text', null, true, { nested: [1, 2, { a: rand() }] }, [], {}]);
  }
  const sharedArrays: Record<string, unknown[]> = {};
  for (const column of PIT_ARRAY_COLUMNS) sharedArrays[column] = rand() < 0.5 ? [] : [{ source: 'x', v: rand() }];
  return Array.from({ length: candidates }, (_, index) => {
    const row: Record<string, unknown> = {};
    for (const column of PIT_SCALAR_COLUMNS) row[column] = `${column}-${index}-${rand().toFixed(6)}`;
    for (const column of PIT_OBJECT_COLUMNS) {
      const own: Record<string, unknown> = { ...shared[column] };
      if (perturb && rand() < 0.4) own[`own${Math.floor(rand() * 3)}`] = pick([rand(), 'x', null]);
      if (perturb && rand() < 0.2) delete own.k0;
      if (perturb && rand() < 0.1) own.k1 = rand();
      row[column] = own;
    }
    for (const column of PIT_ARRAY_COLUMNS) row[column] = rand() < 0.2 ? [{ own: index }] : sharedArrays[column];
    return row as PitEvidenceRow;
  });
}

test('PIT normalization reconstructs every row exactly across 300 random decisions', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rows = randomDecision(seed, 1 + (seed % 17));
    const normalized = normalizePitRows(rows);
    const rebuilt = reconstructPitRows(normalized);
    assert.equal(rebuilt.length, rows.length);
    rows.forEach((row, index) => assert.equal(canonicalJson(rebuilt[index]), canonicalJson(row), `seed ${seed} row ${index}`));
  }
});

test('PIT normalization survives a JSON round trip (what the database stores) and shrinks a shared-context decision', () => {
  const rows = randomDecision(7, 200, false).map((row, index) => ({ ...row, contract_json: { ...(row.contract_json as object), strike: 100 + index }, volatility_json: { surface: 'x'.repeat(400), own: index }, technical_json: { series: Array.from({ length: 40 }, (_, k) => k * 1.5) } }) as PitEvidenceRow);
  const normalized = normalizePitRows(rows);
  const stored = JSON.parse(JSON.stringify({ context: normalized.context, rows: normalized.rows })) as Parameters<typeof reconstructPitRows>[0];
  const rebuilt = reconstructPitRows(stored);
  rows.forEach((row, index) => assert.equal(canonicalJson(rebuilt[index]), canonicalJson(row)));
  assert.ok(normalized.stats.normalizedBytes < normalized.stats.originalBytes / 1.5, 'shared context is stored once');
});

test('PIT normalization handles a single candidate, an empty decision, and column coverage', () => {
  assert.equal(normalizePitRows([]).rows.length, 0);
  const [only] = randomDecision(3, 1);
  assert.equal(canonicalJson(reconstructPitRows(normalizePitRows([only as PitEvidenceRow]))[0]), canonicalJson(only));
  assert.equal(PIT_JSON_COLUMNS.length, 16);
  assert.match(decisionContextId('a', 'b'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(decisionContextId('a', 'b'), decisionContextId('a', 'b'));
});
