// Runs the accelerated data platform simulation scenarios and prints their measured results as JSON (used to build the final receipt).
// The REAL control plane runs against a partition-accurate model database fed by measured per-decision byte distributions; see tests/helpers/data-platform-sim.ts.
import { writeFileSync } from 'node:fs';
import { assessSteadyState, theilSenSlope } from '../src/storage/data-platform/growth-slo.js';
import { medianOf, runSimulation, type SimResult } from '../tests/helpers/data-platform-sim.js';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const g = (value: number): number => +(value / GIB).toFixed(3);
const window = (result: SimResult, from: number, to: number, key: 'postArchiveBytes' | 'peakBytes' | 'preSessionBytes'): number => medianOf(result.points.slice(from, to).map((point) => point[key]));

const year = await runSimulation({ sessions: 250, seed: 20261003 });
const post = year.points.map((point) => point.postArchiveBytes);
const steady = assessSteadyState(post.slice(70));
const analyticDrift = 154 * 1.2 * 1024 + 200 * 1024;
const drift = Math.max(0, theilSenSlope(post.slice(70)), analyticDrift);
const steadyMean = post.slice(70).reduce((a, b) => a + b, 0) / (post.length - 70);
const peakOverMean = Math.max(...year.points.slice(70).map((point) => point.peakBytes)) - steadyMean;
const projection = (sessions: number): number => steadyMean + drift * (sessions - 250) + peakOverMean;
const extreme = await runSimulation({ sessions: 140, seed: 7, extremeSession: { index: 100, blobFactor: 8, decisionsFactor: 1.7 } });
const outage5 = await runSimulation({ sessions: 150, seed: 11, archiveOutage: { from: 100, to: 104 } });
const outage80 = await runSimulation({ sessions: 140, seed: 13, archiveOutage: { from: 40, to: 119 } });

const result = {
  scenario250: {
    postArchiveMedianGiB: { sessions10to30: g(window(year, 10, 30, 'postArchiveBytes')), sessions40to60: g(window(year, 40, 60, 'postArchiveBytes')), sessions90to110: g(window(year, 90, 110, 'postArchiveBytes')), sessions230to250: g(window(year, 230, 250, 'postArchiveBytes')) },
    session1PostArchiveGiB: g(post[0] ?? 0), session250PostArchiveGiB: g(post.at(-1) ?? 0),
    preSessionMedianGiB: g(window(year, 70, 250, 'preSessionBytes')), sessionPeakMedianGiB: g(window(year, 70, 250, 'peakBytes')), sessionPeakMaxGiB: g(Math.max(...year.points.map((point) => point.peakBytes))),
    steadyState: { state: steady.state, slopeMiBPerSession: +(steady.slopeBytesPerSession / MIB).toFixed(4), tau: +steady.tau.toFixed(3), meanGiB: g(steady.meanBytes) },
    linearGrowthDetected: steady.linearGrowthDetected, newRiskGateOpenAllSessions: year.points.every((point) => point.newRiskGate === 'OPEN'), capacityStateNormalAfterWarmup: year.points.slice(70).every((point) => point.capacityState === 'NORMAL'),
    partitionsRetired: year.droppedPartitions, livePartitions: year.livePartitions, archivedPartitions: year.archivedPartitions, externalArchiveGiB: g(year.archivedObjectBytes), neverDroppedWithoutVerifiedArchive: year.neverDroppedWithoutArchive,
    criticalIncidents: year.points.flatMap((point) => point.incidents.filter((incident) => incident.severity === 'CRITICAL')).length,
  },
  projectionHotGiB: { oneYear: g(projection(250)), threeYears: g(projection(750)), fiveYears: g(projection(1250)), permanentDriftMiBPerSession: +(drift / MIB).toFixed(3) },
  extremeSession: { baselineGiB: g(window(extreme, 80, 100, 'postArchiveBytes')), spikePeakGiB: g((extreme.points[100]?.peakBytes ?? 0)), postArchiveAfterSpikeGiB: g(extreme.points[101]?.postArchiveBytes ?? 0), recoveredGiB: g(window(extreme, 125, 140, 'postArchiveBytes')), newRiskLocked: extreme.points.some((point) => point.newRiskGate === 'LOCKED') },
  archiveOutageFiveSessions: { baselineGiB: g(window(outage5, 80, 100, 'postArchiveBytes')), peakDuringGiB: g(Math.max(...outage5.points.slice(100, 105).map((point) => point.postArchiveBytes))), recoveredGiB: g(window(outage5, 135, 150, 'postArchiveBytes')), newRiskOpenDuring: outage5.points.slice(100, 106).every((point) => point.newRiskGate === 'OPEN'), backlogIncidentEverySession: outage5.points.slice(100, 105).every((point) => point.incidents.some((incident) => incident.kind === 'ARCHIVE_BACKLOG')) },
  archiveOutageEightySessions: { maxPeakGiB: g(Math.max(...outage80.points.map((point) => point.peakBytes))), criticalBandGiB: g(0.825 * 8 * GIB), firstResearchThrottleSession: outage80.points.findIndex((point) => point.researchGate !== 'ALLOW'), firstNewRiskGateSession: outage80.points.findIndex((point) => point.newRiskGate !== 'OPEN'),
    spooledGiB: g(outage80.points.reduce((sum, point) => sum + point.spooledBytes, 0)), skippedGiB: g(outage80.points.reduce((sum, point) => sum + point.skippedBytes, 0)), skippedRecords: outage80.points.reduce((sum, point) => sum + point.skippedRecords, 0), neverDroppedWithoutVerifiedArchive: outage80.neverDroppedWithoutArchive },
};
const output = process.argv.find((value) => value.startsWith('--output='))?.slice(9);
if (output !== undefined) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
