// RetentionManager: decides, per dataset, which partitions to close, archive and retire given the session calendar and the dataset's hot window. Pure.
import { hotPartitionsFor, partitionKeyFor, type DatasetPolicy } from './dataset-registry.js';
import type { PartitionRecord } from './partition-lifecycle.js';
import { partitionsPastHotWindow } from './partition-lifecycle.js';
import type { ArchiveQueueState } from './storage-governor.js';

export interface RetentionPlan {
  readonly dataset: string;
  readonly close: readonly string[];
  readonly archive: readonly string[];
  readonly retire: readonly string[];
}

/**
 * `sessions` are trading-session dates (ascending). `nextSession` is the session that will receive writes next (null: none, everything is closed; undefined: the last
 * listed session is still open). A partition is CLOSED when it no longer receives writes, so a weekly partition closes only when the next session falls in another week.
 * Closed partitions are archived at once; retirement waits for the hot window (counted in partitions of the dataset's granularity) and a verified archive.
 */
export function planRetention(policy: DatasetPolicy, sessions: readonly string[], records: readonly PartitionRecord[], nextSession?: string | null): RetentionPlan {
  if (policy.coldPolicy === 'NEVER_LEAVES_POSTGRES' || policy.partition.granularity === 'NONE') return { dataset: policy.id, close: [], archive: [], retire: [] };
  const granularity = policy.partition.granularity;
  const ordered = [...sessions].sort();
  const keys = [...new Set(ordered.map((session) => partitionKeyFor(session, granularity)))];
  const openKey = nextSession === undefined ? keys.at(-1) ?? null : nextSession === null ? null : partitionKeyFor(nextSession, granularity);
  const byPartition = new Map(records.filter((record) => record.dataset === policy.id).map((record) => [record.partition, record]));
  const closed = keys.filter((key) => key !== openKey);
  const stateOf = (key: string) => byPartition.get(key)?.state ?? 'ACTIVE_HOT';
  const close = closed.filter((key) => stateOf(key) === 'ACTIVE_HOT');
  const archive = closed.filter((key) => ['ACTIVE_HOT', 'CLOSED_HOT', 'ARCHIVE_PENDING'].includes(stateOf(key)));
  const pastHot = new Set(partitionsPastHotWindow(closed, hotPartitionsFor(policy)));
  const retire = closed.filter((key) => pastHot.has(key) && ['ARCHIVED_VERIFIED', 'DETACH_ELIGIBLE', 'DETACHED'].includes(stateOf(key)));
  return { dataset: policy.id, close, archive, retire };
}

/** Archive queue as the governor sees it: closed partitions not yet ARCHIVED_VERIFIED. */
export function archiveQueueState(records: readonly PartitionRecord[], partitionBytes: (record: PartitionRecord) => number, sessions: readonly string[]): ArchiveQueueState {
  const pending = records.filter((record) => record.state === 'CLOSED_HOT' || record.state === 'ARCHIVE_PENDING');
  const ordered = [...sessions].sort();
  const oldest = pending.map((record) => record.partition).sort()[0];
  const lag = oldest === undefined ? 0 : Math.max(0, ordered.length - 1 - ordered.indexOf(oldest));
  return { queueBytes: pending.reduce((sum, record) => sum + partitionBytes(record), 0), queuePartitions: pending.length, lagSessions: lag };
}
