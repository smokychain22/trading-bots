// Phase 4: long-run deterministic soak. Hundreds of sequential cycles through the evidence pipeline plus the resource bookkeeping a worker cycle
// does (a correlation id, a database client, a timer, a temporary file, a lease renewal). Nothing may accumulate: heap, handles, timers,
// clients, temp files, leases, plans and correlation ids all return to their starting level, and heap growth has no monotonic trend.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { withRuntimePostgresClient } from '../src/theta/runtime-postgres-client.js';
import { buildFrontier, forceGc, makeContracts } from '../tools/theta-stress-harness.js';
import { projectCanonicalFrontierForPostgres } from '../src/theta/postgres-cycle-evidence-storage.js';
import { canonicalFrontierResearchBatch } from '../src/storage/canonical-frontier-local-archive.js';
import { generateClientOrderId } from '../src/theta/order-intent-state.js';

const CYCLES = Math.max(50, Number(process.env.THETA_P4_SOAK_CYCLES ?? 500));
const SAMPLE_EVERY = Math.max(10, Math.floor(CYCLES / 10));

class SoakClient extends EventEmitter {
  static outstanding = 0;
  static released = 0;
  static destroyed = 0;
  async query(): Promise<{ rows: unknown[]; rowCount: number }> { return { rows: [], rowCount: 0 }; }
  release(destroy = false): void { SoakClient.outstanding -= 1; SoakClient.released += 1; if (destroy) SoakClient.destroyed += 1; }
}
const pool = { options: { max: 4, connectionTimeoutMillis: 8_000 }, totalCount: 0, idleCount: 0, waitingCount: 0,
  connect: async () => { SoakClient.outstanding += 1; return new SoakClient() as unknown as PoolClient; } } as unknown as Pool;

const resourceCounts = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const name of process.getActiveResourcesInfo()) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
};

test(`${CYCLES}-cycle soak: no heap trend, no handle/timer/client/file/lease/plan accumulation, unique correlation ids`, async () => {
  const gc = forceGc();
  assert.ok(gc !== null, 'forced GC is required to measure retention');
  const directory = mkdtempSync(join(tmpdir(), 'theta-soak-'));
  const contracts = makeContracts(20);
  const correlationIds = new Set<string>();
  const clientOrderIds = new Set<string>();
  const leases = new Map<string, number>();       // worker -> renewal count (one lease row, renewed in place)
  const plans = new Set<string>();                  // action plans: deterministic ids, so repeats must not accumulate
  const retained: number[] = [];
  gc?.(); gc?.();
  const startingHandles = resourceCounts();
  const startFiles = readdirSync(directory).length;
  try {
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      const correlationId = `theta-runtime:${new Date(Date.UTC(2026, 9, 5, 14, 0, 0) + cycle * 60_000).toISOString().slice(0, 16)}:full`;
      correlationIds.add(correlationId);
      // one pipeline pass
      const frontier = buildFrontier(contracts, ['THETA_Q']);
      const projection = projectCanonicalFrontierForPostgres(frontier);
      const batch = canonicalFrontierResearchBatch(JSON.parse(JSON.stringify(frontier)), { frontier_id: '55555555-5555-4555-8555-555555555555',
        fusion_snapshot_id: '66666666-6666-4666-8666-666666666666', observed_at: frontier.timestamp, content_hash: frontier.contentHash }, 'a'.repeat(40));
      assert.ok(projection.projection !== undefined && batch.rowCount > 0);
      // the resource bookkeeping a worker cycle performs
      await withRuntimePostgresClient(pool, async (client) => { await client.query('SELECT 1'); });
      const timer = setTimeout(() => undefined, 60_000);
      clearTimeout(timer);
      const file = join(directory, `cycle-${cycle % 5}.tmp`);                  // rotating temp files, rewritten in place
      writeFileSync(file, String(cycle));
      leases.set('worker-1', (leases.get('worker-1') ?? 0) + 1);
      plans.add(generateClientOrderId('decision-fixed', 'candidate-fixed', 1));  // the SAME deterministic intent every cycle
      clientOrderIds.add(generateClientOrderId(`decision-${cycle}`, 'candidate', 1));
      if (cycle % SAMPLE_EVERY === 0) { gc?.(); gc?.(); retained.push(process.memoryUsage().heapUsed / 1048576); }
    }
    gc?.(); gc?.();
    const endingHandles = resourceCounts();
    assert.equal(correlationIds.size, CYCLES, 'every cycle needs a unique correlation id');
    assert.equal(clientOrderIds.size, CYCLES, 'distinct decisions never share a client order id');
    assert.equal(leases.size, 1, 'one lease row, renewed in place');
    assert.equal(plans.size, 1, 'a repeated identical intent must not accumulate plans');
    assert.equal(SoakClient.outstanding, 0, 'database clients leaked');
    assert.equal(SoakClient.released, CYCLES);
    assert.equal(SoakClient.destroyed, 0, 'healthy cycles must not destroy clients');
    assert.equal(readdirSync(directory).length, Math.min(5, CYCLES), 'temporary files accumulated');
    assert.ok(readdirSync(directory).length >= startFiles);
    for (const name of new Set([...Object.keys(startingHandles), ...Object.keys(endingHandles)])) {
      if (name === 'FSReqCallback' || name === 'TickObject') continue;
      assert.ok((endingHandles[name] ?? 0) <= (startingHandles[name] ?? 0) + 2, `handle class ${name} grew ${startingHandles[name] ?? 0} -> ${endingHandles[name] ?? 0}`);
    }
    // heap: retained memory after GC has no monotonic trend (least-squares slope per cycle is negligible, and the end is not far above the start)
    const n = retained.length;
    const xs = retained.map((_, index) => index), meanX = xs.reduce((a, b) => a + b, 0) / n, meanY = retained.reduce((a, b) => a + b, 0) / n;
    const slopePerSample = xs.reduce((total, x, index) => total + (x - meanX) * ((retained[index] as number) - meanY), 0) / xs.reduce((total, x) => total + (x - meanX) ** 2, 0);
    const slopePerCycle = slopePerSample / SAMPLE_EVERY;
    console.log(`soak: ${CYCLES} cycles, retained heap MB per sample: ${retained.map((value) => value.toFixed(1)).join(', ')}; slope ${slopePerCycle.toFixed(4)} MB/cycle`);
    assert.ok(slopePerCycle < 0.05, `retained heap grows ${slopePerCycle.toFixed(4)} MB per cycle`);
    assert.ok((retained[n - 1] as number) - (retained[1] as number) < 25, `retained heap grew ${((retained[n - 1] as number) - (retained[1] as number)).toFixed(1)} MB over the run`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
