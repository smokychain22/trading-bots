import { createHash } from 'node:crypto';
import { LocalObservationJobScheduler } from '../storage/local-observation-job-scheduler.js';
import { LocalResearchHistorySpool } from '../storage/local-research-history-spool.js';
import { canonicalJson } from './point-in-time-evidence.js';
import type { ContractPathObservationReceipt } from './contract-path-observation-runtime.js';
import { runRealDataArrivalPipelineFromCommand5A } from './real-data-arrival-harness.js';
import type { ContractPathOutcomeRow } from './contract-path-outcome-dataset.js';

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
  readonly executionTruthClass: 'MARKET_PATH_ONLY';
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
        censored += 1;
        count(reasons, `PRIMARY_COMMON_HORIZON_${primary.state}`);
        continue;
      }
      try {
        const batches = spool.readDecisionCycleBatches<unknown>({
          decisionCycleId: subject.decisionCycleId,
          family: 'CONTRACT_PATH_OBSERVATION',
          limit: 256,
        });
        const observations = batches.flatMap((batch) => batch.payload)
          .filter(isObservation)
          .filter((receipt) => receipt.subjectId === subject.subjectId)
          .sort((a, b) => a.targetAt.localeCompare(b.targetAt)
            || a.observationJobId.localeCompare(b.observationJobId));
        const byJob = new Map(observations.map((receipt) => [receipt.observationJobId, receipt]));
        const observedJobs = jobs.filter((job) => job.state === 'OBSERVED');
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
        const record: Command5aMaturedDatasetRecord = {
          contractVersion: command5aLocalMaturationVersion,
          subjectId: subject.subjectId,
          decisionCycleId: subject.decisionCycleId,
          primaryObservationJobId: primary.observationJobId,
          observationIds: observations.map((receipt) => receipt.observationId),
          dataset: result.dataset,
          unknownFields: result.unknownAudit,
          materializedAt: new Date(asOfMs).toISOString(),
          sourceSha: subject.sourceSha,
          workerSha: subject.workerSha,
          executionTruthClass: 'MARKET_PATH_ONLY',
          brokerAuthority: false,
          orderSubmissions: 0,
          brokerMutations: 0,
        };
        const batchId = createHash('sha256').update(canonicalJson(record)).digest('hex');
        const existed = spool.hasBatch(batchId);
        spool.append({
          botNamespace: 'THETA',
          batchId,
          family: 'CONTRACT_PATH_DATASET',
          sourceSha: subject.sourceSha,
          decisionCycleId: subject.decisionCycleId,
          snapshotId: subject.episode.snapshotId,
          observedAt: primaryObservation.actualObservedAt,
          rowCount: 1,
          payload: [record],
        });
        if (!spool.verifyBatch(batchId)) throw new Error('COMMAND5A_MATURATION_BATCH_VERIFICATION_FAILED');
        datasetBatchIds.push(batchId);
        if (existed) alreadyMaterialized += 1;
        else materialized += 1;
      } catch {
        failedRetryable += 1;
        count(reasons, 'MATURATION_FAILED_RETRYABLE');
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
