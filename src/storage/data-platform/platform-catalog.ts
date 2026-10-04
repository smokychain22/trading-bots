// The partitioned datasets of the data platform: dataset id (from the governed registry) to its PostgreSQL parent table, partition key and export order. One list shared by the
// automation, the tests and the tools, so a dataset can not be archived under one name and read under another.
import { datasetRegistry, partitionKeyFor, type DatasetPolicy } from './dataset-registry.js';
import type { PartitionedDataset } from './postgres-partitions.js';

const dayAfter = (date: string): string => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** inclusive start and exclusive end date of a partition key (a session date, an ISO week, or a month) */
export function partitionRange(partitionKey: string): { readonly from: string; readonly to: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(partitionKey)) return { from: partitionKey, to: dayAfter(partitionKey) };
  const week = /^(\d{4})-W(\d{2})$/.exec(partitionKey);
  if (week !== null) {
    const jan4 = new Date(Date.UTC(Number(week[1]), 0, 4, 12));
    const mondayOfWeek1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000);
    const from = new Date(mondayOfWeek1.getTime() + (Number(week[2]) - 1) * 7 * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: new Date(from.getTime() + 7 * 86_400_000).toISOString().slice(0, 10) };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(partitionKey);
  if (month !== null) {
    const from = `${month[1]}-${month[2]}-01`; const next = new Date(Date.UTC(Number(month[1]), Number(month[2]), 1, 12));
    return { from, to: next.toISOString().slice(0, 10) };
  }
  throw new Error('INVALID_PARTITION_KEY');
}

interface CatalogEntry { readonly id: string; readonly parent: string; readonly orderBy: string }
const ENTRIES: readonly CatalogEntry[] = [
  { id: 'cycle-evidence-blob', parent: 'dp.cycle_evidence_blob', orderBy: 'fusion_snapshot_id' },
  { id: 'decision-context', parent: 'dp.decision_context', orderBy: 'decision_context_id' },
  { id: 'candidate-hot-detail', parent: 'dp.pit_candidate', orderBy: 'candidate_id' },
  { id: 'candidate-ordinary-rejected', parent: 'dp.rejection_histogram', orderBy: 'decision_id' },
  { id: 'optionomics-raw-observation', parent: 'dp.payload_observation', orderBy: 'observation_id' },
  { id: 'optionomics-payload-blob', parent: 'dp.payload_blob', orderBy: 'content_hash' },
  { id: 'decision-audit', parent: 'dp.recent_decision_audit', orderBy: 'decision_id' },
  { id: 'finalized-execution-history', parent: 'dp.finalized_execution_history', orderBy: 'chain_id' },
  { id: 'final-chain-receipt', parent: 'dp.final_chain_receipt', orderBy: 'chain_id' },
  { id: 'session-integrity-manifest', parent: 'dp.session_integrity_manifest', orderBy: 'session_id' },
  { id: 'runtime-session-aggregate', parent: 'dp.runtime_session_aggregate', orderBy: 'session_date' },
];

export const platformCatalog: readonly PartitionedDataset[] = ENTRIES.map((entry) => ({ dataset: entry.id, parent: entry.parent, keyColumn: 'session_date', orderBy: entry.orderBy, range: partitionRange }));

export function catalogFor(ids: readonly string[]): readonly PartitionedDataset[] { return platformCatalog.filter((entry) => ids.includes(entry.dataset)); }
export function registryFor(ids: readonly string[]): readonly DatasetPolicy[] { return datasetRegistry.filter((policy) => ids.includes(policy.id)); }
export function granularityOf(dataset: string): 'SESSION_DATE' | 'WEEK' | 'MONTH' {
  const policy = datasetRegistry.find((entry) => entry.id === dataset);
  if (policy === undefined || policy.partition.granularity === 'NONE') throw new Error(`DATASET_NOT_PARTITIONED:${dataset}`);
  return policy.partition.granularity;
}
/** the partition key a calendar date belongs to for a dataset */
export const partitionKeyOf = (dataset: string, date: string): string => partitionKeyFor(date, granularityOf(dataset));
