// Persistence of partition lifecycle records. The production implementation (dp.partition_state in PostgreSQL) lives in postgres-partition-store.ts; this file holds
// the interface and the in-memory implementation used by simulation and tests. Writes are whole-record upserts so a crash can never leave a half-written step.
import type { PartitionRecord } from './partition-lifecycle.js';

export interface PartitionStateStore {
  get(dataset: string, partition: string): Promise<PartitionRecord | null>;
  put(record: PartitionRecord): Promise<void>;
  list(dataset?: string): Promise<readonly PartitionRecord[]>;
}

export class InMemoryPartitionStore implements PartitionStateStore {
  private readonly records = new Map<string, PartitionRecord>();
  private key(dataset: string, partition: string): string { return `${dataset}\u0000${partition}`; }
  async get(dataset: string, partition: string): Promise<PartitionRecord | null> { const found = this.records.get(this.key(dataset, partition)); return found === undefined ? null : structuredClone(found); }
  async put(record: PartitionRecord): Promise<void> { this.records.set(this.key(record.dataset, record.partition), structuredClone(record)); }
  async list(dataset?: string): Promise<readonly PartitionRecord[]> {
    return [...this.records.values()].filter((record) => dataset === undefined || record.dataset === dataset).sort((a, b) => (a.dataset + a.partition).localeCompare(b.dataset + b.partition)).map((record) => structuredClone(record));
  }
}
