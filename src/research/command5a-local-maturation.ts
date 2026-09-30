import { createHash } from 'node:crypto';
import { LocalObservationJobScheduler } from '../storage/local-observation-job-scheduler.js';
import { LocalResearchHistorySpool } from '../storage/local-research-history-spool.js';
import { canonicalJson } from './point-in-time-evidence.js';
import type { ContractPathObservationReceipt } from './contract-path-observation-runtime.js';
import { runRealDataArrivalPipelineFromCommand5A } from './real-data-arrival-harness.js';
import {
  buildContractPathOutcomeRow,
  type ContractPathOutcomeRow,
} from './contract-path-outcome-dataset.js';

export const command5aLocalMaturationVersion = 'theta-command5a-local-maturation-v1' as const;

export interface Command5aMaturedDatasetRecord {
  readonly contractVersion: typeof command5aLocalMaturationVersion;
  readonly subjectId: string;
  readonly decisionCycleId: string;
  readonly primaryObservationJobId: string;
  readonly observationIds: readonly string[];
  readonly dataset: ContractPathOutcomeRow;
  readonly unknownFields: readonly { readonly rowIndex: number; readonly field: string; readonly reason: string }[];
  readonly materializedAt: string;
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly executionTruthClass: 'MARKET_PATH_ONLY' | 'CENSORED_NO_MARKET_PATH';
  readonly brokerAuthority: false;
  readonly orderSubmissions: 0;
  readonly brokerMutations: 0;
}

export interface Command5aMaturationReport {
  readonly contractVersion: typeof command5aLocalMaturationVersion;
  readonly subjectsScanned: number;
  readonly materialized: number;
  readonly alreadyMaterialized: number;
  readonly pending: number;
  readonly censored: number;
  readonly waitNotApplicable: number;
  readonly failedRetryable: number;
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly datasetBatchIds: readonly string[];
  readonly brokerAuthority: false;
  readonly orderSubmissions: 0;
  readonly brokerMutations: 0;
}

function count(reasons: Map<string, number>, reason: string): void {
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}

function maturationFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const code = message.split(':', 1)[0] ?? '';
  return /^(?:COMMAND5A|CONTRACT_PATH|RAW_OBSERVATION_BUNDLE|RESEARCH_DATASET|LOCAL_RESEARCH)_[A-Z0-9_]{2,160}$/.test(code)
    ? code : 'MATURATION_FAILED_RETRYABLE_UNCLASSIFIED';
}

function isObservation(value: unknown): value is ContractPathObservationReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.contractVersion === 'theta-contract-path-observation-runtime-v1'
    && typeof row.observationId === 'string'
    && typeof row.observationJobId === 'string'
    && typeof row.subjectId === 'string'
    && row.jobState === 'OBSERVED'
    && row.executionTruthClass === 'MARKET_OBSERVED'
    && Array.isArray(row.legs)
    && row.brokerAuthority === false;
}

function appendDatasetRecord(input: {
  readonly spool: LocalResearchHistorySpool;
  readonly record: Command5aMaturedDatasetRecord;
  readonly snapshotId: string;
  readonly observedAt: string;
}): { readonly batchId: string; readonly existed: boolean } {
  const batchId = createHash('sha256').update(canonicalJson(input.record)).digest('hex');
  const existed = input.spool.hasBatch(batchId);
  input.spool.append({
    botNamespace: 'THETA',
    batchId,
    family: 'CONTRACT_PATH_DATASET',
    sourceSha: input.record.sourceSha,
    decisionCycleId: input.record.decisionCycleId,
    snapshotId: input.snapshotId,
    observedAt: input.observedAt,
    rowCount: 1,
    payload: [input.record],
  });
  if (!input.spool.verifyBatch(batchId)) throw new Error('COMMAND5A_MATURATION_BATCH_VERIFICATION_FAILED');
  return { batchId, existed };
}

/**
 * Converts a completed primary-horizon market path into a durable local
 * research dataset. It never creates a factual trade label. Every Command-5A
 * episode is shadow-only, so a later market mark remains NOT_IDENTIFIABLE as
 * realized P&L until real execution and whole-chain evidence exist.
 */
export function matureCommand5aLocalObservations(input: {
  readonly scheduler: LocalObservationJobScheduler;
  readonly spoolPath: string;
  readonly asOf: string;
  readonly limit?: number;
}): Command5aMaturationReport {
  const asOfMs = Date.parse(input.asOf);
  if (!Number.isFinite(asOfMs)) throw new Error('COMMAND5A_MATURATION_AS_OF_INVALID');
  const spool = new LocalResearchHistorySpool(input.spoolPath);
  const reasons = new Map<string, number>();
  const datasetBatchIds: string[] = [];
  let materialized = 0, alreadyMaterialized = 0, pending = 0, censored = 0;
  let waitNotApplicable = 0, failedRetryable = 0;
  const subjects = input.scheduler.nextMaturationSubjects(input.limit ?? 64);
  try {
    for (const subject of subjects) {
      if (subject.episode.candidateId === null || subject.episode.legs.length === 0) {
        waitNotApplicable += 1;
        count(reasons, 'WAIT_SUBJECT_HAS_NO_CONTRACT_PATH');
        continue;
      }
      const jobs = input.scheduler.jobsForSubject(subject.subjectId);
      const primary = jobs.find((job) => job.horizonCode === 'PRIMARY_COMMON_HORIZON');
      if (primary === undefined) {
        pending += 1;
        count(reasons, 'PRIMARY_COMMON_HORIZON_NOT_SCHEDULED');
        continue;
      }
      if (['PENDING', 'DUE', 'IN_PROGRESS', 'DEFERRED_PROVIDER', 'DEFERRED_MARKET'].includes(primary.state)) {
        pending += 1;
        count(reasons, `PRIMARY_COMMON_HORIZON_${primary.state}`);
        continue;
      }
      if (primary.state !== 'OBSERVED') {
        const reason = primary.reasonCode ?? `PRIMARY_COMMON_HORIZON_${primary.state}`;
        const materializedAt = primary.resolvedAt ?? primary.targetAt;
        const record: Command5aMaturedDatasetRecord = {
          contractVersion: command5aLocalMaturationVersion,
          subjectId: subject.subjectId,
          decisionCycleId: subject.decisionCycleId,
          primaryObservationJobId: primary.observationJobId,
          observationIds: [],
          dataset: buildContractPathOutcomeRow({
            subjectId: subject.subjectId,
            decisionAt: subject.episode.decisionAt,
            wasSelected: subject.episode.selectedAtDecision,
            wasShadowOnly: true,
            identifiabilityStatus: 'NOT_IDENTIFIABLE',
            path: [],
            statistics: {
              maximumAdverseExcursion: null, maximumFavorableExcursion: null,
              peakProfit: null, worstProfit: null, giveback: null, timeToPeakSeconds: null,
              capitalDays: null, assignmentState: 'RIGHT_CENSORED', recoveryState: null,
              terminalState: 'CHAIN_CENSORED',
            },
          }),
          unknownFields: [{ rowIndex: -1, field: 'primaryObservation', reason }],
          materializedAt,
          sourceSha: subject.sourceSha,
          workerSha: subject.workerSha,
          executionTruthClass: 'CENSORED_NO_MARKET_PATH',
          brokerAuthority: false,
          orderSubmissions: 0,
          brokerMutations: 0,
        };
        const appended = appendDatasetRecord({ spool, record, snapshotId: subject.episode.snapshotId,
          observedAt: materializedAt });
        datasetBatchIds.push(appended.batchId);
        if (appended.existed) alreadyMaterialized += 1;
        else censored += 1;
        count(reasons, reason);
        continue;
      }
      try {
        const batches = spool.readDecisionCycleBatches<unknown>({
          decisionCycleId: subject.decisionCycleId,
          family: 'CONTRACT_PATH_OBSERVATION',
          // Contract-path archives use subjectId as snapshotId. Scope before
          // applying the bound so unrelated subjects cannot hide this path.
          snapshotId: subject.subjectId,
          limit: 256,
        });
        // The primary common horizon is the terminal cutoff for this dataset
        // version. A later expiration mark for a longer-DTE contract is useful
        // evidence, but adding it to an already materialized primary-horizon
        // row would create a second payload hash for the same episode and could
        // inflate independent N downstream. Include only jobs in the factual
        // path at or before the frozen primary target.
        const pathJobs = jobs.filter((job) => job.targetAt <= primary.targetAt);
        const pathJobIds = new Set(pathJobs.map((job) => job.observationJobId));
        const observations = batches.flatMap((batch) => batch.payload)
          .filter(isObservation)
          .filter((receipt) => receipt.subjectId === subject.subjectId)
          .filter((receipt) => pathJobIds.has(receipt.observationJobId))
          .sort((a, b) => a.targetAt.localeCompare(b.targetAt)
            || a.observationJobId.localeCompare(b.observationJobId));
        const byJob = new Map(observations.map((receipt) => [receipt.observationJobId, receipt]));
        const observedJobs = pathJobs.filter((job) => job.state === 'OBSERVED');
        const missingArchive = observedJobs.find((job) => !byJob.has(job.observationJobId));
        if (missingArchive !== undefined) throw new Error(`COMMAND5A_OBSERVED_JOB_ARCHIVE_MISSING:${missingArchive.observationJobId}`);
        const primaryObservation = byJob.get(primary.observationJobId);
        if (primaryObservation === undefined) throw new Error('COMMAND5A_PRIMARY_OBSERVATION_ARCHIVE_MISSING');
        const legIdentities = subject.episode.legs.map((leg) => ({
          optionSymbol: leg.optionSymbol,
          side: leg.positionIntent === 'SELL_TO_OPEN' ? 'SHORT' as const : 'LONG' as const,
        }));
        const result = runRealDataArrivalPipelineFromCommand5A({
          bundleId: `command5a:${subject.subjectId}:${primary.observationJobId}`,
          decisionAt: subject.episode.decisionAt,
          subject: {
            subjectId: subject.subjectId,
            wasSelected: subject.episode.selectedAtDecision,
            wasShadowOnly: true,
          },
          observations: observations.map((receipt) => ({ receipt, legIdentities })),
        });
        if (!result.schemaValid || !result.pitValid || result.dataset === null) {
          throw new Error('COMMAND5A_MATURATION_DATASET_INVALID');
        }
        if (result.dataset.identifiabilityStatus !== 'NOT_IDENTIFIABLE') {
          throw new Error('COMMAND5A_SHADOW_DATASET_TRUTH_CLASS_INVALID');
        }
        const evidenceAvailableAt = observations.reduce((latest, receipt) =>
          receipt.actualObservedAt > latest ? receipt.actualObservedAt : latest,
        primaryObservation.actualObservedAt);
        const record: Command5aMaturedDatasetRecord = {
          contractVersion: command5aLocalMaturationVersion,
          subjectId: subject.subjectId,
          decisionCycleId: subject.decisionCycleId,
          primaryObservationJobId: primary.observationJobId,
          observationIds: observations.map((receipt) => receipt.observationId),
          dataset: result.dataset,
          unknownFields: result.unknownAudit,
          // This is evidence availability, not wall-clock worker execution.
          // Reprocessing the same immutable observations at a later time must
          // produce the same batch identity instead of unbounded duplicates.
          materializedAt: evidenceAvailableAt,
          sourceSha: subject.sourceSha,
          workerSha: subject.workerSha,
          executionTruthClass: 'MARKET_PATH_ONLY',
          brokerAuthority: false,
          orderSubmissions: 0,
          brokerMutations: 0,
        };
        const appended = appendDatasetRecord({ spool, record, snapshotId: subject.episode.snapshotId,
          observedAt: primaryObservation.actualObservedAt });
        datasetBatchIds.push(appended.batchId);
        if (appended.existed) alreadyMaterialized += 1;
        else materialized += 1;
      } catch (error) {
        failedRetryable += 1;
        count(reasons, maturationFailureCode(error));
      }
    }
    return {
      contractVersion: command5aLocalMaturationVersion,
      subjectsScanned: subjects.length,
      materialized,
      alreadyMaterialized,
      pending,
      censored,
      waitNotApplicable,
      failedRetryable,
      reasonCounts: Object.fromEntries(reasons),
      datasetBatchIds,
      brokerAuthority: false,
      orderSubmissions: 0,
      brokerMutations: 0,
    };
  } finally {
    spool.close();
  }
}
