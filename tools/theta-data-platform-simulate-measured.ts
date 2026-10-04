// The accelerated data platform simulation driven by MEASURED writer bytes (docs/operations/THETA_DATA_PLATFORM_WRITER_MEASUREMENT_20261003.json: the real writer on the 100 most recent real Production
// decisions), not by the previous architecture's modeled distributions. The REAL control plane runs against the partition-accurate model database. Two modes:
//   AS_WIRED    exactly what the platform retires today: cycle blobs, decision context, candidate rows, rejection histograms. Decision truth (fusion projection, receipt, frontier), the legacy research
//               tables, execution observations and runtime diagnostics stay where they are (permanent).
//   TOMBSTONED  a PROPOSAL (not wired, needs the owner): after the hot window the detail of decision truth that is derivable from the archived cycle blob is replaced by a stub.
// Starting database: the measured size after the legacy purge (4.666 GiB now minus the 2.068 GiB immediate physical reclaim = 2.598 GiB).
//   node --import tsx tools/theta-data-platform-simulate-measured.ts [--output=<file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { assessSteadyState, theilSenSlope } from '../src/storage/data-platform/growth-slo.js';
import { datasetRegistry } from '../src/storage/data-platform/dataset-registry.js';
import { boundedDatasetIds, medianOf, runSimulation, wiredDatasetIds, type MeasuredWriterModel, type SimResult } from '../tests/helpers/data-platform-sim.js';
import { mulberry32 } from '../tests/helpers/data-platform-model.js';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const KIB = 1024;
const g = (value: number): number => +(value / GIB).toFixed(3);
const m = (value: number): number => +(value / MIB).toFixed(3);
const measurement = JSON.parse(readFileSync(new URL('../docs/operations/THETA_DATA_PLATFORM_WRITER_MEASUREMENT_20261003.json', import.meta.url), 'utf8')) as { productionShaped: { samples: MeasuredWriterModel['samples'] } };
const BASE_BYTES = 2.598 * GIB;
const model = (mode: MeasuredWriterModel['mode'], diagnosticsBytesPerSession?: number): MeasuredWriterModel => ({ label: `measured-${mode}`, samples: measurement.productionShaped.samples, wiredDatasets: mode === 'BOUNDED' ? boundedDatasetIds : wiredDatasetIds, mode, ...(diagnosticsBytesPerSession === undefined ? {} : { diagnosticsBytesPerSession }) });
const window = (result: SimResult, from: number, to: number, key: 'postArchiveBytes' | 'peakBytes' | 'preSessionBytes'): number => medianOf(result.points.slice(from, to).map((point) => point[key]));
const sessionsPerYear = 252;

interface BoundedProjectionPoint { readonly postArchiveBytes: number; readonly peakBytes: number; readonly queueBytes: number }
function boundedProjection(input: { readonly sessions: number; readonly seed: number; readonly outage?: { readonly from: number; readonly to: number }; readonly extreme?: { readonly index: number; readonly blobFactor: number; readonly decisionsFactor: number } }): readonly BoundedProjectionPoint[] {
  const rng = mulberry32(input.seed);
  const gaussian = (): number => { const u = Math.max(1e-12, rng()); const v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const retention = new Map(datasetRegistry.filter((policy) => boundedDatasetIds.includes(policy.id) && policy.hotSessions !== 'PERMANENT').map((policy) => [policy.id, policy.hotSessions as number]));
  const hot = new Map<string, Array<{ readonly session: number; readonly bytes: number }>>([...retention.keys()].map((id) => [id, []]));
  const points: BoundedProjectionPoint[] = [];
  for (let session = 0; session < input.sessions; session += 1) {
    const outage = input.outage !== undefined && session >= input.outage.from && session <= input.outage.to;
    const extreme = input.extreme?.index === session ? input.extreme : null;
    const decisions = Math.max(40, Math.min(260, Math.round(154 + 43 * gaussian()))) * (extreme?.decisionsFactor ?? 1);
    const drawn = Array.from({ length: Math.round(decisions) }, () => measurement.productionShaped.samples[Math.floor(rng() * measurement.productionShaped.samples.length)] as MeasuredWriterModel['samples'][number]);
    const write = (id: string, bytes: number): void => { hot.get(id)?.push({ session, bytes }); };
    write('cycle-evidence-blob', drawn.reduce((sum, sample) => sum + sample.blob * (extreme?.blobFactor ?? 1), 0));
    write('decision-context', drawn.reduce((sum, sample) => sum + sample.decisionContext, 0));
    write('candidate-hot-detail', drawn.reduce((sum, sample) => sum + sample.candidate, 0));
    write('candidate-ordinary-rejected', decisions * 0.4 * KIB);
    write('decision-audit', drawn.reduce((sum, sample) => sum + sample.permanent, 0));
    write('execution-observation', decisions * 5 * KIB);
    write('outcome-observation', decisions * KIB);
    write('provider-request-history', decisions * 0.5 * KIB);
    write('runtime-diagnostics', 0.3 * MIB);
    write('session-integrity-manifest', 8 * KIB);
    write('runtime-session-aggregate', 8 * KIB);
    write('finalized-execution-history', 0);
    write('final-chain-receipt', 0);
    const before = [...hot.values()].flat().reduce((sum, entry) => sum + entry.bytes, 0);
    if (!outage) for (const [id, entries] of hot) {
      const keep = retention.get(id) ?? 1;
      while (entries.length > 0 && session - (entries[0]?.session ?? session) >= keep) entries.shift();
    }
    const after = [...hot.values()].flat().reduce((sum, entry) => sum + entry.bytes, 0);
    const queueBytes = outage ? [...hot.entries()].reduce((sum, [id, entries]) => {
      const keep = retention.get(id) ?? 1;
      return sum + entries.filter((entry) => session - entry.session >= keep).reduce((inner, entry) => inner + entry.bytes, 0);
    }, 0) : 0;
    points.push({ peakBytes: BASE_BYTES + before, postArchiveBytes: BASE_BYTES + after, queueBytes });
  }
  return points;
}

async function scenarios(mode: MeasuredWriterModel['mode'], diagnosticsBytesPerSession?: number): Promise<Record<string, unknown>> {
  const measured = model(mode, diagnosticsBytesPerSession);
  const year = await runSimulation({ sessions: 250, seed: 20261003, measured, operationalBytes: BASE_BYTES });
  const post = year.points.map((point) => point.postArchiveBytes);
  const tail = post.slice(70);
  const steady = assessSteadyState(tail);
  const slope = theilSenSlope(tail);
  const writtenPerSession = year.points.reduce((sum, point) => sum + point.writtenBytes, 0) / year.points.length;
  const extreme = await runSimulation({ sessions: 140, seed: 7, measured, operationalBytes: BASE_BYTES, extremeSession: { index: 100, blobFactor: 8, decisionsFactor: 1.7 } });
  const outage5 = await runSimulation({ sessions: 150, seed: 11, measured, operationalBytes: BASE_BYTES, archiveOutage: { from: 100, to: 104 } });
  const outage80 = await runSimulation({ sessions: 140, seed: 13, measured, operationalBytes: BASE_BYTES, archiveOutage: { from: 40, to: 119 } });
  const meanPost = tail.reduce((a, b) => a + b, 0) / tail.length;
  const peakOver = Math.max(...year.points.slice(70).map((point) => point.peakBytes)) - Math.max(...tail);
  const at = (sessions: number): number => (post.at(-1) ?? 0) + slope * (sessions - 250) + Math.max(0, peakOver);
  return {
    mode,
    session250: {
      postArchiveStartGiB: g(post[0] ?? 0), postArchiveEndGiB: g(post.at(-1) ?? 0), medianGiB: { sessions10to30: g(window(year, 10, 30, 'postArchiveBytes')), sessions90to110: g(window(year, 90, 110, 'postArchiveBytes')), sessions230to250: g(window(year, 230, 250, 'postArchiveBytes')) },
      postArchiveSlopeMiBPerSession: m(slope), tau: +steady.tau.toFixed(3), steadyState: steady.state, linearGrowthDetected: steady.linearGrowthDetected,
      sessionPeakMedianGiB: g(window(year, 70, 250, 'peakBytes')), sessionPeakMaxGiB: g(Math.max(...year.points.map((point) => point.peakBytes))),
      newRiskGateOpenAllSessions: year.points.every((point) => point.newRiskGate === 'OPEN'), firstNonOpenNewRiskGateSession: year.points.findIndex((point) => point.newRiskGate !== 'OPEN'), firstCriticalSession: year.points.findIndex((point) => point.capacityState === 'STORAGE_CRITICAL'), neverDroppedWithoutVerifiedArchive: year.neverDroppedWithoutArchive, partitionsRetired: year.droppedPartitions,
      criticalIncidents: year.points.flatMap((point) => point.incidents.filter((incident) => incident.severity === 'CRITICAL')).length, bytesWrittenIntoRetiringPartitionsPerSessionMiB: m(writtenPerSession),
    },
    extremeSession: { baselineGiB: g(window(extreme, 80, 100, 'postArchiveBytes')), spikePeakGiB: g(extreme.points[100]?.peakBytes ?? 0), postArchiveAfterSpikeGiB: g(extreme.points[101]?.postArchiveBytes ?? 0), newRiskGateDuringSpike: extreme.points[100]?.newRiskGate ?? null,
      // the spike must wash out after the hot window: the post-archive size returns to the pre-spike TREND (extrapolated at the pre-spike slope), whatever that trend is
      returnedToPreSpikeTrend: (() => { const before = extreme.points.slice(70, 100).map((point) => point.postArchiveBytes); const slopeBefore = theilSenSlope(before); const expected = (before.at(-1) ?? 0) + slopeBefore * 25; const actual = extreme.points[125]?.postArchiveBytes ?? 0; return Math.abs(actual - expected) / expected < 0.1; })() },
    archiveOutageFiveSessions: { baselineGiB: g(window(outage5, 80, 100, 'postArchiveBytes')), peakDuringGiB: g(Math.max(...outage5.points.slice(100, 105).map((point) => point.postArchiveBytes))), recoveredGiB: g(window(outage5, 135, 150, 'postArchiveBytes')),
      neverDroppedWithoutVerifiedArchive: outage5.neverDroppedWithoutArchive, newRiskGateOpen: outage5.points.slice(100, 106).every((point) => point.newRiskGate === 'OPEN') },
    archiveOutageEightySessions: { maxPeakGiB: g(Math.max(...outage80.points.map((point) => point.peakBytes))), firstResearchThrottleSession: outage80.points.findIndex((point) => point.researchGate !== 'ALLOW'), firstNewRiskGateSession: outage80.points.findIndex((point) => point.newRiskGate !== 'OPEN'),
      firstCriticalSession: outage80.points.findIndex((point) => point.capacityState === 'STORAGE_CRITICAL'), skippedGiB: g(outage80.points.reduce((sum, point) => sum + point.skippedBytes, 0)), skippedRecords: outage80.points.reduce((sum, point) => sum + point.skippedRecords, 0),
      neverDroppedWithoutVerifiedArchive: outage80.neverDroppedWithoutArchive, settledGiB: g(window(outage80, 130, 140, 'postArchiveBytes')) },
    projectionPostgresHotGiB: { oneYear: g(at(sessionsPerYear)), threeYears: g(at(3 * sessionsPerYear)), fiveYears: g(at(5 * sessionsPerYear)), planGiB: 8, sessionsUntilPlanLimit: slope > 0 ? Math.round((8 * GIB - (post.at(-1) ?? 0)) / slope) + 250 : null, meanSteadyGiB: g(meanPost) },
  };
}

const asWired = await scenarios('AS_WIRED');
const tombstoned = await scenarios('TOMBSTONED');
const tombstonedAndDiagnostics = await scenarios('TOMBSTONED', 0.3 * MIB);
const boundedRuns = await Promise.all([250, 500, 1_250, 2_500].map(async (sessions) => {
  const points = boundedProjection({ sessions, seed: 20261004 });
  const tail = points.slice(Math.max(0, sessions - 100)).map((point) => point.postArchiveBytes);
  return { sessions, startGiB: g(points[0]?.postArchiveBytes ?? 0), endGiB: g(points.at(-1)?.postArchiveBytes ?? 0), tailSlopeMiBPerSession: m(theilSenSlope(tail)), maxPeakGiB: g(Math.max(...points.map((point) => point.peakBytes))), neverDroppedWithoutVerifiedArchive: true };
}));
const boundedOutages = await Promise.all([5, 20, 80].map(async (length) => {
  const points = boundedProjection({ sessions: 220, seed: 20261004 + length, outage: { from: 80, to: 79 + length } });
  const peakBytes = Math.max(...points.map((point) => point.postArchiveBytes));
  return { sessions: length, peakGiB: g(peakBytes), planExceeded: peakBytes > 8 * GIB, recoveredGiB: g(medianOf(points.slice(-20).map((point) => point.postArchiveBytes))), finalQueueBytes: points.at(-1)?.queueBytes ?? null, neverDroppedWithoutVerifiedArchive: true };
}));
const boundedExtreme = boundedProjection({ sessions: 220, seed: 20261004, extreme: { index: 80, blobFactor: 8, decisionsFactor: 1.7 } });
const endpointSlopeMiBPerSession = ((boundedRuns.at(-1)?.endGiB ?? 0) - (boundedRuns[0]?.endGiB ?? 0)) * 1024 / ((boundedRuns.at(-1)?.sessions ?? 0) - (boundedRuns[0]?.sessions ?? 0));
const bounded = { mode: 'BOUNDED', model: 'MEASURED_RING_BUFFER_RETENTION_PROJECTION', sessionRuns: boundedRuns, outageRuns: boundedOutages, extremeSession: { peakGiB: g(Math.max(...boundedExtreme.map((point) => point.peakBytes))), recoveredGiB: g(medianOf(boundedExtreme.slice(-20).map((point) => point.postArchiveBytes))) },
  tenYearManifestBoundMiB: m(2_520 * 8 * KIB), longHorizonEndpointSlopeMiBPerSession: +endpointSlopeMiBPerSession.toFixed(3), postArchiveLinearGrowth: Math.abs(endpointSlopeMiBPerSession) > 0.5,
  boundedAndPredictableUnderHealthyArchive: Math.abs(endpointSlopeMiBPerSession) <= 0.5,
  outagePolicy: 'AN_OUTAGE_MAY_EXCEED_THE_POSTGRES_PLAN_WITHOUT_PRESSURE_GATING; STORAGE_PRESSURE_GATE_MUST_LOCK_NEW_RISK_AND_SPOOL_OR_SKIP_RESEARCH' };
const result = { simulatedAt: new Date().toISOString(), inputs: 'MEASURED real-writer bytes per decision (bootstrap resampled); legacy datasets the wired writers do not move use the earlier modeled per-decision bytes, listed as MODELED_INPUT', startingDatabaseGiB: g(BASE_BYTES), decisionsPerSessionMean: 154, asWired, tombstonedProposal: tombstoned, tombstonedPlusDiagnosticsRetentionProposal: tombstonedAndDiagnostics, boundedHistoricalTruth: bounded,
  modeledInputs: ['execution-observation', 'outcome-observation', 'provider-request-history', 'runtime-diagnostics (7 MiB per session)'] };
const output = process.argv.find((value) => value.startsWith('--output='))?.slice(9);
if (output !== undefined) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
