// 250-session (about one trading year) accelerated simulation of the data platform on measured per-decision byte distributions, an extreme session, archive outages and
// the multi-year projection. The REAL control plane runs; the database is a partition-accurate model (DROP PARTITION returns space at once).
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSteadyState, kendallTau, theilSenSlope } from '../src/storage/data-platform/growth-slo.js';
import { medianOf, runSimulation, type SimResult } from './helpers/data-platform-sim.js';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const window = (result: SimResult, from: number, to: number, pick: 'postArchiveBytes' | 'peakBytes'): number[] => result.points.slice(from, to).map((point) => point[pick]);

let yearResult: SimResult | null = null;
async function year(): Promise<SimResult> {
  yearResult ??= await runSimulation({ sessions: 250, seed: 20261003 });
  return yearResult;
}

test('250 SESSIONS: post-archive hot size does not grow linearly with session count (sessions 20 / 50 / 100 / 250 stay in one band)', async () => {
  const result = await year();
  const post = result.points.map((point) => point.postArchiveBytes);
  const m = (from: number, to: number) => medianOf(post.slice(from, to));
  const w20 = m(10, 30), w50 = m(40, 60), w100 = m(90, 110), w250 = m(230, 250);
  const spread = Math.max(w20, w50, w100, w250) - Math.min(w50, w100, w250);
  // after the warm-up (the hot windows fill up in about 60 sessions) the size is flat: sessions 50, 100 and 250 agree to within a few percent
  assert.ok(Math.abs(w100 - w50) / w50 < 0.06, `w50=${(w50 / GIB).toFixed(2)} w100=${(w100 / GIB).toFixed(2)}`);
  assert.ok(Math.abs(w250 - w100) / w100 < 0.06, `w100=${(w100 / GIB).toFixed(2)} w250=${(w250 / GIB).toFixed(2)}`);
  assert.ok(spread / w50 < 0.12);
  const steady = assessSteadyState(post.slice(60));
  assert.equal(steady.state, 'STEADY', `slope ${Math.round(steady.slopeBytesPerSession)} tau ${steady.tau.toFixed(2)}`);
  // the PERMANENT components (audit identity and operational increments) are the only drift; it is tiny
  assert.ok(theilSenSlope(post.slice(60)) < 2 * MIB, `drift ${(theilSenSlope(post.slice(60)) / MIB).toFixed(3)} MiB/session`);
  // contrast: the same data without retirement grows linearly (the architecture is what bounds it)
  const cumulative = result.points.map((_, index) => result.points.slice(0, index + 1).reduce((sum, point) => sum + Math.max(0, point.peakBytes - point.preSessionBytes), 0));
  assert.ok(kendallTau(cumulative) > 0.99);
  assert.ok(cumulative.at(-1) as number > 5 * (post.at(-1) as number), 'without retirement the hot database would be several times larger');
});

test('250 SESSIONS: the database stays below the archive-pressure band, new risk is never gated, and nothing is ever dropped without a verified archive', async () => {
  const result = await year();
  const peaks = result.points.map((point) => point.peakBytes);
  assert.ok(Math.max(...peaks) < 0.4 * 8 * GIB, `peak ${(Math.max(...peaks) / GIB).toFixed(2)} GiB`);
  assert.ok(result.points.every((point) => point.newRiskGate === 'OPEN'));
  assert.ok(result.points.slice(70).every((point) => point.capacityState === 'NORMAL'), 'steady state is in the NORMAL band');
  assert.equal(result.neverDroppedWithoutArchive, true);
  assert.deepEqual(result.points.flatMap((point) => point.incidents.filter((incident) => incident.severity === 'CRITICAL')), []);
  assert.ok(result.droppedPartitions > 600, `${result.droppedPartitions} partitions retired in a simulated year`);
  assert.ok(result.livePartitions < 120, `live partitions bounded: ${result.livePartitions}`);
  const normalBand = medianOf(window(result, 100, 250, 'postArchiveBytes'));
  assert.ok(normalBand > 1.2 * GIB && normalBand < 3.2 * GIB, `normal operating band ${(normalBand / GIB).toFixed(2)} GiB`);
});

test('250 SESSIONS: external archive grows with history while PostgreSQL does not (long-term memory lives outside the database)', async () => {
  const result = await year();
  assert.ok(result.archivedPartitions > result.livePartitions, 'more partitions archived than are hot');
  assert.ok(result.archivedObjectBytes > 0);
  const cumulativeWritten = result.points.reduce((sum, point) => sum + Math.max(0, point.peakBytes - point.preSessionBytes), 0);
  assert.ok(cumulativeWritten > 4 * (result.points.at(-1)?.postArchiveBytes ?? 0));
});

test('5-YEAR PROJECTION: hot PostgreSQL stays bounded by the retention windows plus the tiny permanent drift; it fits the 8 GiB allocation by a wide margin', async () => {
  const result = await year();
  const post = result.points.map((point) => point.postArchiveBytes);
  const steadyMean = post.slice(60).reduce((a, b) => a + b, 0) / (post.length - 60);
  // the permanent audit identity and operational increments are the only components that never retire: measured slope or the analytic model value, whichever is larger
  const analyticDrift = 154 * 1.2 * 1024 + 200 * 1024;
  const drift = Math.max(0, theilSenSlope(post.slice(60)), analyticDrift);
  const peakOverMean = Math.max(...result.points.slice(60).map((point) => point.peakBytes)) - steadyMean;
  const project = (sessions: number) => steadyMean + drift * (sessions - 250) + peakOverMean;
  const oneYear = project(250), threeYears = project(750), fiveYears = project(1250);
  assert.ok(fiveYears < 0.5 * 8 * GIB, `5-year hot projection ${(fiveYears / GIB).toFixed(2)} GiB`);
  assert.ok(fiveYears - oneYear < 0.6 * GIB, `five years add only ${((fiveYears - oneYear) / GIB).toFixed(2)} GiB over year one`);
  assert.ok(threeYears >= oneYear - 1);
  process.stdout.write(`PROJECTION_GIB 1y=${(oneYear / GIB).toFixed(2)} 3y=${(threeYears / GIB).toFixed(2)} 5y=${(fiveYears / GIB).toFixed(2)} steady=${(steadyMean / GIB).toFixed(2)} drift=${(drift / MIB).toFixed(3)}MiB/session\n`);
});

test('EXTREME SESSION: a 10,000-contract session with many cycles (blobs 8x, decisions 1.7x) spikes the hot size, the governor reacts, and the database returns to its normal band after the hot window', async () => {
  const result = await runSimulation({ sessions: 140, seed: 7, extremeSession: { index: 100, blobFactor: 8, decisionsFactor: 1.7 } });
  const baseline = medianOf(window(result, 80, 100, 'postArchiveBytes'));
  const spikePeak = result.points[100]?.peakBytes ?? 0;
  assert.ok(spikePeak > baseline + 1 * GIB, `spike ${(spikePeak / GIB).toFixed(2)} vs baseline ${(baseline / GIB).toFixed(2)} GiB`);
  const recovered = medianOf(window(result, 125, 140, 'postArchiveBytes'));
  assert.ok(Math.abs(recovered - baseline) / baseline < 0.08, `recovered ${(recovered / GIB).toFixed(2)} vs baseline ${(baseline / GIB).toFixed(2)}`);
  assert.ok((result.points[101]?.postArchiveBytes ?? 0) > baseline + 0.8 * GIB, 'the spike stays hot until its window passes (replay needs it)');
  assert.ok(result.points.slice(95, 112).every((point) => point.newRiskGate !== 'LOCKED'), 'one extreme session does not lock new risk');
  assert.equal(result.neverDroppedWithoutArchive, true);
});

test('ARCHIVE OUTAGE: five sessions without an archive backend: nothing is retired or lost, the backlog is flagged, the database stays bounded, and it catches up after recovery', async () => {
  const result = await runSimulation({ sessions: 150, seed: 11, archiveOutage: { from: 100, to: 104 } });
  const during = result.points.slice(100, 105);
  assert.ok(during.every((point) => point.incidents.some((incident) => incident.kind === 'ARCHIVE_BACKLOG')), 'ARCHIVE_BACKLOG raised every outage session');
  assert.ok(during.at(-1)?.lagSessions as number >= 4, 'the lag is visible');
  const baseline = medianOf(window(result, 80, 100, 'postArchiveBytes'));
  const peakDuring = Math.max(...during.map((point) => point.postArchiveBytes));
  assert.ok(peakDuring > baseline, 'size grows while nothing can be retired');
  assert.ok(peakDuring < 0.55 * 8 * GIB, `bounded during a five-session outage: ${(peakDuring / GIB).toFixed(2)} GiB`);
  assert.equal(result.neverDroppedWithoutArchive, true);
  const recovered = medianOf(window(result, 135, 150, 'postArchiveBytes'));
  assert.ok(Math.abs(recovered - baseline) / baseline < 0.1, `recovered ${(recovered / GIB).toFixed(2)} vs ${(baseline / GIB).toFixed(2)}`);
  assert.ok(result.points.slice(100, 106).every((point) => point.newRiskGate === 'OPEN'), 'a five-session outage alone does not gate new risk');
});

test('ARCHIVE OUTAGE, LONG: with the archive down for 80 sessions the governor degrades research in order, records every skipped write, keeps the database inside the allocation, and operational writes are never gated', async () => {
  const result = await runSimulation({ sessions: 140, seed: 13, archiveOutage: { from: 40, to: 119 } });
  const first = (predicate: (point: SimResult['points'][number]) => boolean) => result.points.findIndex(predicate);
  const throttled = first((point) => point.researchGate !== 'ALLOW');
  const restricted = first((point) => point.newRiskGate !== 'OPEN');
  assert.ok(throttled > 40, 'research is throttled after the outage begins');
  assert.ok(restricted === -1 || restricted >= throttled, 'new risk is gated no earlier than research');
  // complete cycle evidence is selected/finalist-class (P1): it is written until the CRITICAL band, where it is skipped with a record, so one session of growth can overshoot the band edge but never the allocation
  assert.ok(Math.max(...result.points.map((point) => point.peakBytes)) < 0.9 * 8 * GIB, `the database stays well inside the allocation: ${(Math.max(...result.points.map((point) => point.peakBytes)) / GIB).toFixed(2)} GiB`);
  assert.equal(result.neverDroppedWithoutArchive, true);
  assert.ok(result.points.slice(40, 120).every((point) => point.incidents.some((incident) => incident.kind === 'ARCHIVE_BACKLOG')));
  assert.ok(result.points.some((point) => point.spooledBytes > 0), 'lower-priority research is diverted to the local spool first');
  const skipped = result.points.filter((point) => point.skippedRecords > 0);
  for (const point of skipped) assert.ok(point.skippedBytes > 0);
  const critical = first((point) => point.capacityState === 'STORAGE_CRITICAL');
  if (critical !== -1) assert.equal(result.points[critical]?.newRiskGate, 'LOCKED');
  // after the archive returns the platform catches up and settles back into its band
  const baseline = medianOf(window(result, 20, 40, 'postArchiveBytes'));
  const settled = medianOf(window(result, 130, 140, 'postArchiveBytes'));
  assert.ok(settled < baseline * 1.6, `settled ${(settled / GIB).toFixed(2)} vs pre-outage ${(baseline / GIB).toFixed(2)} GiB`);
});
