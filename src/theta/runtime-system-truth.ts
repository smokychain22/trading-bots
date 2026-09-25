/** Runtime observations are separate from the source-controlled capability review. */
import { runtimeSchemaMinimum } from './runtime-schema-compatibility.js';
export interface RuntimeTruthInputs {
  readonly sourceSha: string;
  readonly sourceDirty: boolean;
  readonly workerSha: string | null;
  readonly activeWorkerLeases: number | null;
  readonly workerHeartbeat: string | null;
  readonly workerMode: string | null;
  readonly executionGate: string | null;
  readonly migrationHead: string | null;
  readonly requiredMigrationPresent: boolean | null;
  readonly observedAt: string;
}

export type RuntimeMismatch =
  | 'SOURCE_SHA_NE_WORKER_SHA' | 'MULTIPLE_ACTIVE_WORKERS' | 'WORKER_STALE'
  | 'WORKER_MODE_UNEXPECTED' | 'EXECUTION_GATE_NOT_LOCKED'
  | 'MIGRATION_MISMATCH' | 'RUNTIME_EVIDENCE_UNAVAILABLE' | 'RUNTIME_EVIDENCE_PARTIAL'
  | 'UNRELEASED_SOURCE_CHANGES';

// The supervisor intentionally rests for 60 seconds and a bounded evidence
// operation may run for up to 290 seconds. Treat the status as stale just
// before the six-minute lease expires, not during normal work or rest.
export const maximumWorkerHeartbeatAgeMs = 300_000;

export function deriveDatabaseRuntimeMismatches(input: {
  readonly databaseReachable: boolean;
  readonly databaseEvidenceComplete: boolean;
}): RuntimeMismatch[] {
  if (!input.databaseReachable) return ['RUNTIME_EVIDENCE_UNAVAILABLE'];
  return input.databaseEvidenceComplete ? [] : ['RUNTIME_EVIDENCE_PARTIAL'];
}

export function deriveRuntimeMismatches(input: RuntimeTruthInputs): RuntimeMismatch[] {
  const mismatches: RuntimeMismatch[] = [];
  if (input.sourceDirty) mismatches.push('UNRELEASED_SOURCE_CHANGES');
  if (input.activeWorkerLeases === null || input.workerSha === null || input.workerHeartbeat === null
    || input.workerMode === null || input.executionGate === null || input.requiredMigrationPresent === null) {
    mismatches.push('RUNTIME_EVIDENCE_UNAVAILABLE');
  }
  if (input.workerSha !== null && input.workerSha !== input.sourceSha) mismatches.push('SOURCE_SHA_NE_WORKER_SHA');
  if (input.activeWorkerLeases !== null && input.activeWorkerLeases > 1) mismatches.push('MULTIPLE_ACTIVE_WORKERS');
  const heartbeatAgeMs = input.workerHeartbeat === null ? null
    : Date.parse(input.observedAt) - Date.parse(input.workerHeartbeat);
  if (input.activeWorkerLeases === 0 || (heartbeatAgeMs !== null
    && (!Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs > maximumWorkerHeartbeatAgeMs)))
    mismatches.push('WORKER_STALE');
  if (input.workerMode !== null && input.workerMode !== 'MASTER_THETA_PAPER') mismatches.push('WORKER_MODE_UNEXPECTED');
  if (input.executionGate !== null && input.executionGate !== 'LOCKED') mismatches.push('EXECUTION_GATE_NOT_LOCKED');
  if (input.requiredMigrationPresent === false || (input.migrationHead !== null
    && input.migrationHead < runtimeSchemaMinimum)) mismatches.push('MIGRATION_MISMATCH');
  return mismatches;
}
