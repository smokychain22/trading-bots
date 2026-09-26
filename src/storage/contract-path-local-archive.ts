import type { ContractPathObservationReceipt } from '../research/contract-path-observation-runtime.js';
import { LocalResearchHistorySpool, type LocalResearchBatchReceipt } from './local-research-history-spool.js';

export const contractPathLocalArchiveVersion = 'theta-contract-path-local-archive-v1' as const;

export interface ContractPathLocalArchiveReceipt {
  readonly contractVersion: typeof contractPathLocalArchiveVersion;
  readonly observationId: string;
  readonly observationJobId: string;
  readonly subjectId: string;
  readonly payloadHash: string;
  readonly storageState: LocalResearchBatchReceipt['storageState'];
  readonly executionTruthClass: 'MARKET_OBSERVED';
  readonly brokerAuthority: false;
}

/**
 * Appends an already validated market observation to the local research WAL.
 * The local archive has no Production decision or broker consumer.
 */
export function archiveContractPathObservation(input: {
  readonly spoolPath: string;
  readonly decisionCycleId: string;
  readonly observation: ContractPathObservationReceipt;
}): ContractPathLocalArchiveReceipt {
  const spool = new LocalResearchHistorySpool(input.spoolPath);
  try {
    const receipt = spool.append({
      batchId: input.observation.observationId,
      family: 'CONTRACT_PATH_OBSERVATION',
      sourceSha: input.observation.sourceSha,
      decisionCycleId: input.decisionCycleId,
      snapshotId: input.observation.subjectId,
      observedAt: input.observation.actualObservedAt,
      rowCount: 1,
      payload: [input.observation],
    });
    const verification = spool.verify();
    if (!verification.valid) throw new Error('CONTRACT_PATH_LOCAL_ARCHIVE_VERIFICATION_FAILED');
    return {
      contractVersion: contractPathLocalArchiveVersion,
      observationId: input.observation.observationId,
      observationJobId: input.observation.observationJobId,
      subjectId: input.observation.subjectId,
      payloadHash: receipt.payloadHash,
      storageState: receipt.storageState,
      executionTruthClass: 'MARKET_OBSERVED',
      brokerAuthority: false,
    };
  } finally {
    spool.close();
  }
}
