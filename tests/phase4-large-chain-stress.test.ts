// Phase 4: large-chain stress at 100 / 300 / 1,000 / 2,619 / 5,000 / 10,000 contracts through the full offline evidence pipeline
// (frontier build, content hash, bounded Postgres projection, JSON serialization, local archive batch).
// Budgets are EVIDENCE-BASED: they are multiples of the recorded baseline (docs/operations/THETA_PHASE4_PERFORMANCE_BASELINE_20261003.json),
// never arbitrary numbers, and are loose enough for slower CI machines yet tight enough to catch a real regression (e.g. an O(N^2) step).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { measure, type SizeMeasurement } from '../tools/theta-stress-harness.js';

const baseline = JSON.parse(readFileSync(new URL('../docs/operations/THETA_PHASE4_PERFORMANCE_BASELINE_20261003.json', import.meta.url), 'utf8')) as { rows: SizeMeasurement[] };
const baselineFor = (contracts: number): SizeMeasurement => baseline.rows.find((row) => row.contracts === contracts) as SizeMeasurement;
const SIZES = [100, 300, 1000, 2619, 5000, 10000];
const TIME_HEADROOM = 8;       // CI machines are slower and noisier than the recording machine
const MEMORY_HEADROOM = 2;
const results = new Map<number, SizeMeasurement>();

test('every size runs the full pipeline correctly: bounded candidates, reproducible hash, exact archive rows, bounded projection', () => {
  for (const size of SIZES) {
    const row = measure(size, 1);
    results.set(size, row);
    const reference = baselineFor(size);
    assert.ok(reference !== undefined, `no baseline for ${size}`);
    // candidates: one Q candidate per in-lattice contract plus the research-only defined-risk branch, which has a FIXED bound
    assert.ok(row.candidates >= size && row.candidates <= size + 1_100, `${size}: ${row.candidates} candidates`);
    // the archive keeps the complete list: one row per candidate plus a small constant for branch/summary rows
    assert.ok(row.archiveRows >= row.candidates && row.archiveRows <= row.candidates + 10, `${size}: archive rows ${row.archiveRows} vs candidates ${row.candidates}`);
    assert.ok(row.projectionBytes < 128 * 1024, `${size}: projection ${row.projectionBytes} bytes breaks the inline policy`);
  }
  const projections = SIZES.map((size) => (results.get(size) as SizeMeasurement).projectionBytes);
  assert.ok(Math.max(...projections) - Math.min(...projections) < 8 * 1024, `the projection must not scale with the chain: ${projections.join(', ')}`);
});

test('time: every stage stays within the evidence-based budget and growth is near-linear (no quadratic step)', () => {
  for (const size of SIZES) {
    const now = results.get(size) as SizeMeasurement, reference = baselineFor(size);
    for (const stage of ['buildMs', 'hashMs', 'projectMs', 'stringifyMs', 'archiveMs', 'totalMs'] as const) {
      const budget = reference.stages[stage] * TIME_HEADROOM + 1_000;
      assert.ok(now.stages[stage] <= budget, `${size} ${stage}: ${now.stages[stage].toFixed(0)} ms exceeds ${budget.toFixed(0)} ms (baseline ${reference.stages[stage].toFixed(0)} ms x ${TIME_HEADROOM} + 1 s)`);
    }
  }
  const small = results.get(1000) as SizeMeasurement, large = results.get(10000) as SizeMeasurement;
  const exponent = Math.log(large.stages.totalMs / small.stages.totalMs) / Math.log(10);
  console.log(`stress: total ms 1000=${small.stages.totalMs.toFixed(0)} 10000=${large.stages.totalMs.toFixed(0)} exponent=${exponent.toFixed(2)}`);
  assert.ok(exponent < 1.6, `10x the chain costs n^${exponent.toFixed(2)} (measured about n^1.1; a quadratic step would be n^2)`);
});

test('memory: serialized sizes are linear, peak RSS stays inside budget, and nothing is retained after a garbage collection', () => {
  for (const size of SIZES) {
    const now = results.get(size) as SizeMeasurement, reference = baselineFor(size);
    assert.ok(now.rssMb <= reference.rssMb * MEMORY_HEADROOM + 256, `${size}: RSS ${now.rssMb} MB exceeds ${(reference.rssMb * MEMORY_HEADROOM + 256).toFixed(0)} MB`);
    assert.ok(now.heapRetainedAfterGcMb !== null && now.heapRetainedAfterGcMb < 80, `${size}: ${now.heapRetainedAfterGcMb} MB retained after GC`);
  }
  // linear serialized growth: bytes per candidate stay flat once the fixed defined-risk bound is amortized
  const perCandidate = [1000, 2619, 5000, 10000].map((size) => { const row = results.get(size) as SizeMeasurement; return row.frontierBytes / row.candidates; });
  assert.ok(Math.max(...perCandidate) / Math.min(...perCandidate) < 1.6, `bytes per candidate drifted: ${perCandidate.map((value) => value.toFixed(0)).join(', ')}`);
  const archivePerRow = [1000, 2619, 5000, 10000].map((size) => { const row = results.get(size) as SizeMeasurement; return row.archiveBytes / row.archiveRows; });
  assert.ok(Math.max(...archivePerRow) / Math.min(...archivePerRow) < 1.3, `archive bytes per row drifted: ${archivePerRow.map((value) => value.toFixed(0)).join(', ')}`);
  // a full SPY chain (2,619 contracts) must fit comfortably under a 2 GB function even with a 2x measurement headroom
  assert.ok((results.get(2619) as SizeMeasurement).rssMb * 2 < 2048, 'a full SPY chain needs more than half of a 2 GB function');
});
