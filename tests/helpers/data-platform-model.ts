// Test/simulation support for the data platform: an in-memory "database" whose partitions hold real (small) rows plus a modeled byte weight, so the REAL
// archival pipeline, governor and lifecycle run against a database whose size responds to retention exactly as partitioned PostgreSQL does (DROP PARTITION returns the
// space immediately; row deletes would not).
import { encodeNdjsonGzip, ndjsonGzipCodec } from '../../src/storage/data-platform/ndjson-codec.js';
import { InMemoryArchiveBackend, type ArchiveBackend } from '../../src/storage/data-platform/archive-backend.js';
import { DataControlPlane, type ControlPlaneDeps } from '../../src/storage/data-platform/control-plane.js';
import { InMemoryPartitionStore } from '../../src/storage/data-platform/partition-store.js';
import type { ArchiveCodec, PartitionOps, ReplayVerifier } from '../../src/storage/data-platform/archival-pipeline.js';
import { datasetRegistry, type DatasetPolicy } from '../../src/storage/data-platform/dataset-registry.js';

export interface ModelPartition { rows: string[]; bytes: number; attached: boolean; dropped: boolean }

export class ModelDatabase implements PartitionOps {
  readonly partitions = new Map<string, ModelPartition>();
  /** non-partitioned, always-hot operational base (orders, fills, reconciliation, audit identities...) */
  operationalBytes: number;
  failures: { detach?: () => boolean; drop?: () => boolean; export?: () => boolean; count?: () => boolean } = {};
  calls = { export: 0, detach: 0, drop: 0 };
  constructor(operationalBytes: number) { this.operationalBytes = operationalBytes; }
  private key(dataset: string, partition: string): string { return `${dataset}\u0000${partition}`; }
  write(dataset: string, partition: string, rows: readonly string[], bytes: number): void {
    const existing = this.partitions.get(this.key(dataset, partition));
    if (existing?.dropped === true) throw new Error('WRITE_TO_DROPPED_PARTITION');
    if (existing === undefined) this.partitions.set(this.key(dataset, partition), { rows: [...rows], bytes, attached: true, dropped: false });
    else { existing.rows.push(...rows); existing.bytes += bytes; }
  }
  get(dataset: string, partition: string): ModelPartition | undefined { return this.partitions.get(this.key(dataset, partition)); }
  /** physical database size: every partition that still exists on disk (attached or detached-not-yet-dropped) plus the operational base */
  physicalBytes(): number {
    let total = this.operationalBytes;
    for (const partition of this.partitions.values()) if (!partition.dropped) total += partition.bytes;
    return total;
  }
  hotBytesFor(dataset: string, partition: string): number { const part = this.get(dataset, partition); return part === undefined || part.dropped ? 0 : part.bytes; }
  async exists(dataset: string, partition: string): Promise<boolean> { const part = this.get(dataset, partition); return part !== undefined && !part.dropped; }
  async exportPartition(dataset: string, partition: string): Promise<{ bytes: Uint8Array; rowCount: number; contentHash: string; sourceWindow: { from: string; to: string }; schemaVersion: string }> {
    this.calls.export += 1;
    if (this.failures.export?.() === true) throw new Error('EXPORT_FAILED');
    const part = this.get(dataset, partition);
    if (part === undefined || part.dropped) throw new Error('PARTITION_MISSING');
    const encoded = encodeNdjsonGzip(part.rows);
    return { bytes: encoded.bytes, rowCount: encoded.rowCount, contentHash: encoded.contentHash, sourceWindow: { from: `${partition}T00:00:00Z`, to: `${partition}T23:59:59Z` }, schemaVersion: 'v1' };
  }
  async countRows(dataset: string, partition: string): Promise<number> {
    if (this.failures.count?.() === true) throw new Error('COUNT_FAILED');
    const part = this.get(dataset, partition);
    return part === undefined || part.dropped ? 0 : part.rows.length;
  }
  async detach(dataset: string, partition: string): Promise<void> {
    this.calls.detach += 1;
    if (this.failures.detach?.() === true) throw new Error('DETACH_FAILED');
    const part = this.get(dataset, partition);
    if (part !== undefined) part.attached = false;
  }
  async drop(dataset: string, partition: string): Promise<void> {
    this.calls.drop += 1;
    if (this.failures.drop?.() === true) throw new Error('DROP_FAILED');
    const part = this.get(dataset, partition);
    if (part !== undefined && !part.dropped) { if (part.attached) throw new Error('DROP_REQUIRES_DETACH'); part.dropped = true; }
  }
}

export const gzipNdjsonCodec: ArchiveCodec = ndjsonGzipCodec;

export const alwaysReplayable: ReplayVerifier = { async verify() { return 'NOT_APPLICABLE'; } };

export interface Harness {
  readonly db: ModelDatabase;
  readonly backend: ArchiveBackend;
  readonly store: InMemoryPartitionStore;
  readonly plane: DataControlPlane;
  clock: { value: number };
  yieldFlag: { value: boolean };
}

export function makeHarness(options: { operationalBytes?: number; planBytes?: number; backend?: ArchiveBackend; registry?: readonly DatasetPolicy[]; replay?: ReplayVerifier; maintenance?: () => Promise<void>; retirementEligible?: ControlPlaneDeps['retirementEligible'] } = {}): Harness {
  const db = new ModelDatabase(options.operationalBytes ?? 400 * 1024 ** 2);
  const backend = options.backend ?? new InMemoryArchiveBackend();
  const store = new InMemoryPartitionStore();
  const clock = { value: Date.parse('2026-10-05T21:00:00Z') };
  const yieldFlag = { value: false };
  const deps: ControlPlaneDeps = {
    botId: 'theta', sourceSha: 'a'.repeat(40), policyVersion: 'policy-1', backend, store, opsFor: () => db, codecFor: () => gzipNdjsonCodec, replayFor: () => options.replay ?? alwaysReplayable,
    now: () => new Date(clock.value).toISOString(), measure: async () => ({ dbBytes: db.physicalBytes(), planBytes: options.planBytes ?? 8 * 1024 ** 3 }),
    partitionBytes: (record) => db.hotBytesFor(record.dataset, record.partition), yieldToOperations: () => yieldFlag.value, maintenance: options.maintenance,
    registry: options.registry ?? datasetRegistry, allowUnverifiedRetirement: true, retirementEligible: options.retirementEligible,
  };
  return { db, backend, store, plane: new DataControlPlane(deps), clock, yieldFlag };
}

/** deterministic PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function sessionDates(count: number, start = '2026-10-05'): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
