import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('provider performance probe executes all bounded adapter feature and local persistence stages', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'tools/theta-provider-performance-probe.ts'],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.synthetic, true);
  assert.equal(report.providerRequests, 0);
  assert.equal(report.brokerMutations, 0);
  assert.deepEqual(report.omittedStages, ['PRODUCTION_POSTGRES_LATENCY']);
  assert.deepEqual(report.results.map((row: { contracts: number }) => row.contracts), [2601, 5000, 10000]);
  for (const row of report.results) {
    assert.equal(row.samples, 5);
    assert.equal(row.deterministicHash, true);
    assert.equal(row.memoryMeasurement, 'STAGE_SAMPLES_NOT_PROCESS_PEAK');
    assert.ok(Number.isFinite(row.sampledHeapMaxMb));
    for (const stage of ['collectionMs', 'decodeMs', 'eventMs', 'featureNormalizationMs',
      'featureCalculationMs', 'serializeHashMs', 'localPersistenceMs', 'localReadbackMs']) {
      const timing = row.timings[stage];
      assert.ok(Number.isFinite(timing.p50) && timing.p50 >= 0, stage);
      assert.ok(timing.p50 <= timing.p95 && timing.p95 <= timing.max, stage);
    }
  }
});
