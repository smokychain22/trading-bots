// DATA_PLATFORM board subsystem and the post-session storage receipt. Pure builders: the board never reads PostgreSQL itself.
import type { PlatformIncident } from './incidents.js';
import type { GovernorAssessment } from './storage-governor.js';

export interface PlatformMetrics {
  readonly observedAt: string;
  readonly hotDbBytes: number;
  readonly planBytes: number;
  readonly sessionPeakBytes: number | null;
  readonly postArchiveBytes: number | null;
  readonly hotBytesPerDecisionP50: number | null;
  readonly hotBytesPerDecisionP95: number | null;
  readonly archiveQueueBytes: number;
  readonly archiveLagSessions: number;
  readonly lastArchiveAt: string | null;
  readonly lastArchiveVerifyAt: string | null;
  readonly lastCompactionAt: string | null;
  readonly lastPartitionRetirementAt: string | null;
  readonly archiveHealth: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
}

export interface DataPlatformBoard {
  readonly subsystem: 'DATA_PLATFORM';
  readonly HOT_DB_GIB: number;
  readonly PLAN_GIB: number;
  readonly UTILIZATION: number;
  readonly SESSION_PEAK_GIB: number | null;
  readonly POST_ARCHIVE_SIZE_GIB: number | null;
  readonly HOT_BYTES_PER_DECISION_P50: number | null;
  readonly HOT_BYTES_PER_DECISION_P95: number | null;
  readonly ARCHIVE_QUEUE_GIB: number;
  readonly ARCHIVE_LAG_SESSIONS: number;
  readonly LAST_ARCHIVE: string | null;
  readonly LAST_ARCHIVE_VERIFY: string | null;
  readonly LAST_COMPACTION: string | null;
  readonly LAST_PARTITION_RETIREMENT: string | null;
  readonly SESSIONS_TO_PRESSURE: number | null;
  readonly NEW_RISK_STORAGE_GATE: GovernorAssessment['newRiskGate'];
  readonly CAPACITY_STATE: GovernorAssessment['state'];
  readonly ARCHIVE_HEALTH: PlatformMetrics['archiveHealth'];
  readonly OPEN_INCIDENTS: readonly PlatformIncident[];
}

const gib = (bytes: number | null): number | null => (bytes === null ? null : +(bytes / 1024 ** 3).toFixed(3));

export function buildBoard(metrics: PlatformMetrics, assessment: GovernorAssessment, incidents: readonly PlatformIncident[], pressureUtilization = 0.55): DataPlatformBoard {
  const perSession = assessment.growthPerSessionBytes;
  const headroom = pressureUtilization * metrics.planBytes - metrics.hotDbBytes;
  return {
    subsystem: 'DATA_PLATFORM', HOT_DB_GIB: gib(metrics.hotDbBytes) ?? 0, PLAN_GIB: gib(metrics.planBytes) ?? 0, UTILIZATION: +(metrics.hotDbBytes / metrics.planBytes).toFixed(4), SESSION_PEAK_GIB: gib(metrics.sessionPeakBytes),
    POST_ARCHIVE_SIZE_GIB: gib(metrics.postArchiveBytes), HOT_BYTES_PER_DECISION_P50: metrics.hotBytesPerDecisionP50, HOT_BYTES_PER_DECISION_P95: metrics.hotBytesPerDecisionP95, ARCHIVE_QUEUE_GIB: gib(metrics.archiveQueueBytes) ?? 0,
    ARCHIVE_LAG_SESSIONS: metrics.archiveLagSessions, LAST_ARCHIVE: metrics.lastArchiveAt, LAST_ARCHIVE_VERIFY: metrics.lastArchiveVerifyAt, LAST_COMPACTION: metrics.lastCompactionAt, LAST_PARTITION_RETIREMENT: metrics.lastPartitionRetirementAt,
    SESSIONS_TO_PRESSURE: perSession > 0 ? Math.max(0, +(headroom / perSession).toFixed(1)) : null, NEW_RISK_STORAGE_GATE: assessment.newRiskGate, CAPACITY_STATE: assessment.state, ARCHIVE_HEALTH: metrics.archiveHealth, OPEN_INCIDENTS: incidents,
  };
}

export interface StorageReceipt {
  readonly receiptVersion: 'theta-storage-receipt-v1';
  readonly sessionDate: string;
  readonly preSessionBytes: number;
  readonly sessionPeakBytes: number;
  readonly postSessionPreArchiveBytes: number;
  readonly postArchiveBytes: number;
  readonly steadyStateDeltaBytes: number;
  readonly archivedPartitions: readonly string[];
  readonly retiredPartitions: readonly string[];
  readonly incidents: readonly PlatformIncident[];
  readonly capacityState: GovernorAssessment['state'];
}

export function buildReceipt(input: Omit<StorageReceipt, 'receiptVersion' | 'steadyStateDeltaBytes'> & { readonly previousPostArchiveBytes: number | null }): StorageReceipt {
  const { previousPostArchiveBytes, ...rest } = input;
  return { receiptVersion: 'theta-storage-receipt-v1', ...rest, steadyStateDeltaBytes: previousPostArchiveBytes === null ? 0 : input.postArchiveBytes - previousPostArchiveBytes };
}
