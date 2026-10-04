// Deterministic accelerated simulation of the data platform over many trading sessions. The REAL control plane (archival pipeline, retention, governor, SLO) runs against
// ModelDatabase, whose partition sizes come from MEASURED per-decision byte distributions (docs/operations/THETA_PHASE4_DATA_PLATFORM_MEASUREMENTS_20261003.json).
// It models the post-migration steady state; it does not simulate the one-time handling of today's legacy 3 GiB (a separate governed migration).
import { FaultInjectingArchiveBackend, InMemoryArchiveBackend } from '../../src/storage/data-platform/archive-backend.js';
import { datasetRegistry, partitionKeyFor, type DatasetPolicy } from '../../src/storage/data-platform/dataset-registry.js';
import { archiveQueueState, planRetention } from '../../src/storage/data-platform/retention-manager.js';
import { decideWrite, defaultArchiveQueueLimits, type GovernorAssessment } from '../../src/storage/data-platform/storage-governor.js';
import type { PlatformIncident } from '../../src/storage/data-platform/incidents.js';
import { makeHarness, mulberry32, sessionDates, type Harness } from './data-platform-model.js';

const KIB = 1024;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** median bytes per decision and log-sigma, per partitioned dataset (measured 2026-10-03 on the current-contract decisions; see the measurements document) */
export const perDecisionModel: Readonly<Record<string, { readonly medianBytes: number; readonly sigma: number }>> = {
  'cycle-evidence-blob': { medianBytes: 623 * KIB, sigma: 1.2 },
  'decision-context': { medianBytes: 6 * KIB, sigma: 0.4 },
  'candidate-hot-detail': { medianBytes: 92 * KIB, sigma: 0.8 },
  'candidate-ordinary-rejected': { medianBytes: 2 * KIB, sigma: 0.3 },
  'frontier-summary': { medianBytes: 32 * KIB, sigma: 0.3 },
  'shadow-opportunity': { medianBytes: 2 * KIB, sigma: 0.5 },
  'optionomics-raw-observation': { medianBytes: 2.3 * KIB, sigma: 0.9 },
  'optionomics-feature': { medianBytes: 20 * KIB, sigma: 0.5 },
  'execution-observation': { medianBytes: 5 * KIB, sigma: 0.5 },
  'outcome-observation': { medianBytes: 1 * KIB, sigma: 0.3 },
  'provider-request-history': { medianBytes: 0.5 * KIB, sigma: 0.3 },
};
/** per session (not per decision): diagnostics run on every calendar day, about 5 MiB per day, 7/5 days per session */
export const diagnosticsBytesPerSession = 7 * MIB;
/** permanent compact audit identity per decision plus a fixed per-session operational increment */
export const permanentBytesPerDecision = 1.2 * KIB;
export const permanentBytesPerSession = 200 * KIB;

/** Per-decision bytes MEASURED by the real writer on the most recent real Production decisions (docs/operations/THETA_DATA_PLATFORM_WRITER_MEASUREMENT_20261003.json). Bootstrap-resampled per decision. */
export interface MeasuredWriterSample { readonly blob: number; readonly decisionContext: number; readonly candidate: number; readonly permanent: number; readonly permanentDetail: number }
export interface MeasuredWriterModel {
  readonly label: string;
  readonly samples: readonly MeasuredWriterSample[];
  /** datasets whose real writers write into retiring dp partitions; every other dataset stays in its legacy table (permanent) */
  readonly wiredDatasets: readonly string[];
  /** AS_WIRED and TOMBSTONED reproduce the inherited implementation. BOUNDED routes every historical byte through a finite retention policy. */
  readonly mode: 'AS_WIRED' | 'TOMBSTONED' | 'BOUNDED';
  readonly tombstoneStubBytesPerDecision?: number;
  /** runtime diagnostics growth per session (default: the modeled 7 MiB; a retention proposal sets it to the compact aggregate size) */
  readonly diagnosticsBytesPerSession?: number;
}
export const wiredDatasetIds: readonly string[] = ['cycle-evidence-blob', 'decision-context', 'candidate-hot-detail', 'candidate-ordinary-rejected'];
export const boundedDatasetIds: readonly string[] = [...wiredDatasetIds, 'decision-audit', 'execution-observation', 'outcome-observation', 'provider-request-history', 'runtime-diagnostics', 'session-integrity-manifest', 'runtime-session-aggregate', 'finalized-execution-history', 'final-chain-receipt'];
const measuredFieldFor: Readonly<Record<string, keyof MeasuredWriterSample | 'histogram'>> = { 'cycle-evidence-blob': 'blob', 'decision-context': 'decisionContext', 'candidate-hot-detail': 'candidate', 'candidate-ordinary-rejected': 'histogram', 'decision-audit': 'permanent' };
/** the rejection histogram measured 0.4 KiB per decision */
const histogramBytesPerDecision = 0.4 * KIB;

export interface SimConfig {
  readonly measured?: MeasuredWriterModel;
  readonly sessions: number;
  readonly seed: number;
  readonly decisionsMean?: number;
  readonly decisionsSd?: number;
  /** operational base after migration (everything that is never retired) */
  readonly operationalBytes?: number;
  readonly planBytes?: number;
  /** archive backend unavailable for sessions [from, to] inclusive (0-based) */
  readonly archiveOutage?: { readonly from: number; readonly to: number };
  /** an extreme session: blob bytes multiplied and decisions multiplied */
  readonly extremeSession?: { readonly index: number; readonly blobFactor: number; readonly decisionsFactor: number };
  readonly start?: string;
  /** archive retire capacity per session used by the governor forecast when the archive is healthy */
  readonly archiveRetireBytesPerSession?: number;
}

export interface SessionPoint {
  readonly session: number;
  readonly date: string;
  readonly preSessionBytes: number;
  readonly peakBytes: number;
  readonly postSessionPreArchiveBytes: number;
  readonly postArchiveBytes: number;
  readonly decisions: number;
  readonly hotBytesPerDecision: number;
  /** bytes written into retiring (archivable) partitions this session: what the cold archive receives */
  readonly writtenBytes: number;
  readonly newRiskGate: GovernorAssessment['newRiskGate'];
  readonly capacityState: GovernorAssessment['state'];
  readonly researchGate: GovernorAssessment['researchGate'];
  readonly incidents: readonly PlatformIncident[];
  readonly queueBytes: number;
  readonly lagSessions: number;
  /** research bytes diverted to the local archive spool instead of PostgreSQL this session */
  readonly spooledBytes: number;
  /** research bytes skipped (with an explicit EVIDENCE_SKIPPED record) this session */
  readonly skippedBytes: number;
  readonly skippedRecords: number;
}

export interface SimResult {
  readonly points: readonly SessionPoint[];
  readonly archivedObjectBytes: number;
  readonly archivedPartitions: number;
  readonly droppedPartitions: number;
  readonly livePartitions: number;
  readonly harness: Harness;
  readonly neverDroppedWithoutArchive: boolean;
}

const gaussian = (rng: () => number): number => { const u = Math.max(1e-12, rng()); const v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const lognormal = (rng: () => number, median: number, sigma: number): number => median * Math.exp(sigma * gaussian(rng));

export async function runSimulation(config: SimConfig): Promise<SimResult> {
  const rng = mulberry32(config.seed);
  const dates = sessionDates(config.sessions + 1, config.start ?? '2026-10-05');
  let outage = false;
  const memory = new InMemoryArchiveBackend();
  const backend = new FaultInjectingArchiveBackend(memory, { unavailable: () => outage });
  const harness = makeHarness({ operationalBytes: config.operationalBytes ?? 400 * MIB, planBytes: config.planBytes ?? 8 * GIB, backend });
  const partitionedPolicies: readonly DatasetPolicy[] = datasetRegistry.filter((policy) => policy.coldPolicy !== 'NEVER_LEAVES_POSTGRES' && policy.partition.granularity !== 'NONE');
  const diagnostics = partitionedPolicies.find((policy) => policy.id === 'runtime-diagnostics');
  const points: SessionPoint[] = [];
  let neverDroppedWithoutArchive = true;
  let spool = 0;

  for (let index = 0; index < config.sessions; index += 1) {
    const date = dates[index] as string;
    const next = dates[index + 1] ?? null;
    outage = config.archiveOutage !== undefined && index >= config.archiveOutage.from && index <= config.archiveOutage.to;
    const extreme = config.extremeSession?.index === index ? config.extremeSession : null;
    const sessionsSoFar = dates.slice(0, index + 1);

    // pre-session: governor assessment from measured state
    const records = await harness.store.list();
    const retirable = partitionedPolicies.reduce((sum, policy) => sum + planRetention(policy, sessionsSoFar, records.filter((record) => record.dataset === policy.id), date).retire
      .reduce((inner, partition) => inner + harness.db.hotBytesFor(policy.id, partition), 0), 0);
    const queue = archiveQueueState(records, (record) => harness.db.hotBytesFor(record.dataset, record.partition), sessionsSoFar);
    const preBytes = harness.db.physicalBytes();
    const decisionsFactor = extreme?.decisionsFactor ?? 1;
    const gate = await harness.plane.preSession({ archiveRetireBytesPerSession: outage ? 0 : (config.archiveRetireBytesPerSession ?? 600 * MIB), retirableBytesNow: retirable, queue, expectedVolumeFactor: extreme === null ? 1 : decisionsFactor * (extreme?.blobFactor ?? 1) / 2 },
      { archiveHealthy: !outage, previousMaintenanceCompleted: true, transactionalReserveBytes: 700 * MIB, requiredTransactionalReserveBytes: 300 * MIB });

    // the session: decisions and their rows
    const decisions = Math.max(40, Math.min(260, Math.round((config.decisionsMean ?? 154) + (config.decisionsSd ?? 43) * gaussian(rng)))) * decisionsFactor;
    const perDatasetBytes = new Map<string, number>();
    let hot = 0;
    let sessionSpooled = 0, sessionSkipped = 0, sessionSkippedRecords = 0;
    const measured = config.measured;
    // measured mode: the wired datasets are drawn from the real per-decision samples; decision truth and every other legacy dataset is permanent growth
    const drawn = measured === undefined ? [] : Array.from({ length: Math.round(decisions) }, () => measured.samples[Math.floor(rng() * measured.samples.length)] as MeasuredWriterSample);
    let permanentFromMeasured = 0;
    if (measured !== undefined && measured.mode !== 'BOUNDED') {
      const stub = measured.tombstoneStubBytesPerDecision ?? 3 * KIB;
      for (const sample of drawn) permanentFromMeasured += measured.mode === 'TOMBSTONED' ? sample.permanent - sample.permanentDetail + stub : sample.permanent;
      // legacy datasets the wired writers do not move (execution observations, outcome labels, provider requests): their MODELED bytes are permanent
      for (const id of ['execution-observation', 'outcome-observation', 'provider-request-history']) { const model = perDecisionModel[id]; if (model !== undefined) permanentFromMeasured += model.medianBytes * decisions; }
      permanentFromMeasured += measured.diagnosticsBytesPerSession ?? diagnosticsBytesPerSession;
    }
    for (const policy of partitionedPolicies) {
      const model = perDecisionModel[policy.id];
      if (measured !== undefined && !measured.wiredDatasets.includes(policy.id)) continue;
      if (measured === undefined && model === undefined && policy.id !== 'runtime-diagnostics') continue;
      let bytes = 0;
      if (measured !== undefined) {
        const field = measuredFieldFor[policy.id];
        if (policy.id === 'runtime-diagnostics') bytes = measured.diagnosticsBytesPerSession ?? diagnosticsBytesPerSession;
        else if (policy.id === 'session-integrity-manifest' || policy.id === 'runtime-session-aggregate') bytes = 8 * KIB;
        else if (policy.id === 'finalized-execution-history' || policy.id === 'final-chain-receipt') bytes = 0;
        else if (field === undefined) bytes = (perDecisionModel[policy.id]?.medianBytes ?? 0) * decisions;
        else for (const sample of drawn) bytes += (field === 'histogram' ? histogramBytesPerDecision : (sample[field] as number)) * (policy.id === 'cycle-evidence-blob' ? (extreme?.blobFactor ?? 1) : 1);
      } else if (policy.id === 'runtime-diagnostics') bytes = diagnosticsBytesPerSession;
      else if (model !== undefined) for (let decision = 0; decision < decisions; decision += 1) bytes += lognormal(rng, model.medianBytes, model.sigma) * (policy.id === 'cycle-evidence-blob' ? (extreme?.blobFactor ?? 1) : 1);
      perDatasetBytes.set(policy.id, bytes);
      // StoragePressureGate: the producer asks before writing; P0 is always written, lower priorities degrade in order and every skip is recorded
      let decision = decideWrite(gate.assessment, policy.writePriority, `${policy.id}/${date}`, harness.clock.value.toString());
      if (decision.disposition === 'QUEUE_FOR_ARCHIVE_ONLY') {
        if (outage && spool + bytes > defaultArchiveQueueLimits.maxQueueBytes) decision = { allow: false, disposition: 'SKIP_WITH_RECORD', record: { kind: 'EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE', priority: policy.writePriority, scope: `${policy.id}/${date}`, state: gate.assessment.state, observedAt: date } };
        else { sessionSpooled += bytes; spool += bytes; continue; }
      }
      if (decision.disposition === 'SKIP_WITH_RECORD') { sessionSkipped += bytes; sessionSkippedRecords += 1; continue; }
      hot += policy.id === 'runtime-diagnostics' && measured?.mode !== 'BOUNDED' ? 0 : bytes;
      const partition = partitionKeyFor(date, policy.partition.granularity);
      harness.db.write(policy.id, partition, [JSON.stringify({ session: date, n: decisions })], bytes);
    }
    harness.db.operationalBytes += measured === undefined ? decisions * permanentBytesPerDecision + permanentBytesPerSession : measured.mode === 'BOUNDED' ? 0 : permanentFromMeasured + permanentBytesPerSession;
    const peak = harness.db.physicalBytes();
    harness.clock.value += 24 * 3600 * 1000;

    const run = await harness.plane.postSession(date, sessionsSoFar, { preSessionBytes: preBytes, sessionPeakBytes: peak }, next);
    // invariant: a dropped partition always has a verified archive record
    for (const [key, part] of harness.db.partitions) {
      if (!part.dropped) continue;
      const [dataset, partition] = key.split('\u0000') as [string, string];
      const record = await harness.store.get(dataset, partition);
      if (record === null || record.verifiedAt === null || record.uploaded === null) neverDroppedWithoutArchive = false;
    }
    const after = await harness.store.list();
    const queueAfter = archiveQueueState(after, (record) => harness.db.hotBytesFor(record.dataset, record.partition), sessionsSoFar);
    points.push({ session: index, date, preSessionBytes: preBytes, peakBytes: peak, postSessionPreArchiveBytes: run.receipt.postSessionPreArchiveBytes, postArchiveBytes: run.receipt.postArchiveBytes, decisions,
      hotBytesPerDecision: decisions === 0 ? 0 : (hot + (diagnostics === undefined ? 0 : 0)) / decisions, writtenBytes: hot, newRiskGate: gate.newRisk.newRisk, capacityState: gate.assessment.state, researchGate: gate.assessment.researchGate, incidents: run.incidents,
      queueBytes: queueAfter.queueBytes, lagSessions: queueAfter.lagSessions, spooledBytes: sessionSpooled, skippedBytes: sessionSkipped, skippedRecords: sessionSkippedRecords });
    if (!outage) spool = 0;
    void perDatasetBytes;
  }
  const all = await harness.store.list();
  let archivedBytes = 0;
  for (const [key, value] of memory.objects) if (key.startsWith('data/')) archivedBytes += value.length;
  return { points, archivedObjectBytes: archivedBytes, archivedPartitions: all.filter((record) => record.manifest !== null).length, droppedPartitions: all.filter((record) => record.state === 'DROPPED').length,
    livePartitions: [...harness.db.partitions.values()].filter((part) => !part.dropped).length, harness, neverDroppedWithoutArchive };
}

export const medianOf = (values: readonly number[]): number => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : (((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2); };
