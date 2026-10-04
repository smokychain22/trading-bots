// PostgreSQL implementation of the partition operations and the lifecycle state store. Retirement is DETACH + DROP of a whole time partition: no row-level DELETE,
// no WAL storm, no table bloat, and the space returns to the filesystem immediately. All identifiers are validated (never interpolated from data).
import type { Pool, PoolClient } from 'pg';
import { sha256Hex } from './archive-manifest.js';
import type { ExportedPartition, PartitionOps } from './archival-pipeline.js';
import { contentHashOfLines, NdjsonGzipWriter } from './ndjson-codec.js';
import type { PartitionRecord } from './partition-lifecycle.js';
import type { PartitionStateStore } from './partition-store.js';

const identifier = /^[a-z_][a-z0-9_]*$/;
function qualified(name: string): string {
  const parts = name.split('.');
  if (parts.length !== 2 || !parts.every((part) => identifier.test(part))) throw new Error(`INVALID_QUALIFIED_IDENTIFIER:${name}`);
  return `${parts[0]}.${parts[1]}`;
}

export interface PartitionedDataset {
  readonly dataset: string;
  /** schema-qualified partitioned parent table */
  readonly parent: string;
  /** partition key column (date) */
  readonly keyColumn: string;
  /** a stable total order for exports, usually the primary key columns */
  readonly orderBy: string;
  /** inclusive start and exclusive end date of a partition key, for example a session date, ISO week or month */
  readonly range: (partitionKey: string) => { readonly from: string; readonly to: string };
}

/** child table name for a partition key: 2026-10-05 -> <parent>_p20261005, 2026-W41 -> <parent>_p2026w41, 2026-10 -> <parent>_p202610 */
export function childTableName(parent: string, partitionKey: string): string {
  const [schema, table] = qualified(parent).split('.') as [string, string];
  const suffix = partitionKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (suffix.length === 0) throw new Error('INVALID_PARTITION_KEY');
  return `${schema}.${table}_p${suffix}`;
}

export class PostgresPartitionOps implements PartitionOps {
  constructor(private readonly pool: Pool, private readonly datasets: readonly PartitionedDataset[], private readonly pageRows = 2000) {}

  private spec(dataset: string): PartitionedDataset {
    const found = this.datasets.find((entry) => entry.dataset === dataset);
    if (found === undefined) throw new Error(`UNKNOWN_DATASET:${dataset}`);
    return found;
  }

  /** Creates the partition if missing (idempotent). Writers must call this ahead of time so an INSERT never fails for lack of a partition. */
  async ensurePartition(dataset: string, partitionKey: string): Promise<void> {
    const spec = this.spec(dataset);
    const { from, to } = spec.range(partitionKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('INVALID_PARTITION_RANGE');
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${childTableName(spec.parent, partitionKey)} PARTITION OF ${qualified(spec.parent)} FOR VALUES FROM ('${from}') TO ('${to}')`);
  }

  private async state(client: Pool | PoolClient, dataset: string, partitionKey: string): Promise<{ exists: boolean; attached: boolean }> {
    const spec = this.spec(dataset);
    const child = childTableName(spec.parent, partitionKey);
    const row = (await client.query(`SELECT to_regclass($1) IS NOT NULL AS exists, EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = to_regclass($1) AND i.inhparent = $2::regclass) AS attached`, [child, qualified(spec.parent)])).rows[0] as { exists: boolean; attached: boolean };
    return row;
  }

  async exists(dataset: string, partition: string): Promise<boolean> { return (await this.state(this.pool, dataset, partition)).exists; }

  async countRows(dataset: string, partition: string): Promise<number> {
    const spec = this.spec(dataset);
    const state = await this.state(this.pool, dataset, partition);
    if (!state.exists) return 0;
    return Number((await this.pool.query(`SELECT count(*)::bigint AS n FROM ${childTableName(spec.parent, partition)}`)).rows[0].n);
  }

  async exportPartition(dataset: string, partition: string): Promise<ExportedPartition> {
    const spec = this.spec(dataset);
    const child = childTableName(spec.parent, partition);
    const writer = new NdjsonGzipWriter();
    // a server-side cursor in one repeatable-read transaction: constant memory on the server and a consistent view; the partition is CLOSED so it cannot change anyway
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
      await client.query(`DECLARE theta_export NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS j FROM ${child} t ORDER BY ${spec.orderBy}`);
      for (;;) {
        const page = (await client.query(`FETCH ${this.pageRows} FROM theta_export`)).rows as Array<{ j: string }>;
        if (page.length === 0) break;
        for (const row of page) writer.write(row.j);
      }
      await client.query('CLOSE theta_export');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
    const { from, to } = spec.range(partition);
    const encoded = await writer.finish();
    return { bytes: encoded.bytes, rowCount: encoded.rowCount, contentHash: encoded.contentHash, sourceWindow: { from, to }, schemaVersion: `pg:${sha256Hex(`${spec.parent}|${spec.orderBy}`).slice(0, 12)}` };
  }

  async detach(dataset: string, partition: string): Promise<void> {
    const spec = this.spec(dataset);
    const state = await this.state(this.pool, dataset, partition);
    if (!state.exists || !state.attached) return;
    await this.pool.query(`ALTER TABLE ${qualified(spec.parent)} DETACH PARTITION ${childTableName(spec.parent, partition)}`);
  }

  async drop(dataset: string, partition: string): Promise<void> {
    const spec = this.spec(dataset);
    const state = await this.state(this.pool, dataset, partition);
    if (!state.exists) return;
    if (state.attached) throw new Error('DROP_REQUIRES_DETACH');
    await this.pool.query(`DROP TABLE ${childTableName(spec.parent, partition)}`);
  }
}

export { contentHashOfLines };

/** dp.partition_state: one row per (dataset, partition) holding the whole lifecycle record, upserted atomically. */
export class PostgresPartitionStateStore implements PartitionStateStore {
  constructor(private readonly pool: Pool, private readonly table = 'dp.partition_state') { qualified(table); }
  async get(dataset: string, partition: string): Promise<PartitionRecord | null> {
    const row = (await this.pool.query(`SELECT record_json FROM ${this.table} WHERE dataset = $1 AND partition_key = $2`, [dataset, partition])).rows[0] as { record_json: PartitionRecord } | undefined;
    return row === undefined ? null : row.record_json;
  }
  async put(record: PartitionRecord): Promise<void> {
    await this.pool.query(`INSERT INTO ${this.table}(dataset, partition_key, state, step, record_json, updated_at) VALUES($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
      ON CONFLICT (dataset, partition_key) DO UPDATE SET state = EXCLUDED.state, step = EXCLUDED.step, record_json = EXCLUDED.record_json, updated_at = EXCLUDED.updated_at`,
      [record.dataset, record.partition, record.state, record.step, JSON.stringify(record), record.updatedAt]);
    // the immutable manifest is ALSO a permanent relation: it is what survives the partition (archive id, hashes, schema, source SHA, location), so a retired decision stays traceable
    const manifest = record.manifest;
    if (manifest !== null && this.table === 'dp.partition_state') {
      await this.pool.query(`INSERT INTO dp.archive_manifest(archive_id, bot_id, dataset, partition_key, source_from, source_to, row_count, schema_version, source_sha, policy_version, content_hash, file_hash, compressed_bytes, created_at, verified_at,
          archive_location, replay_verified, purge_state, manifest_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $15::timestamptz, $16, $17, $18, $19)
        ON CONFLICT (archive_id) DO UPDATE SET verified_at = EXCLUDED.verified_at, replay_verified = EXCLUDED.replay_verified, purge_state = EXCLUDED.purge_state, manifest_hash = EXCLUDED.manifest_hash, archive_location = EXCLUDED.archive_location`,
      [manifest.archiveId, manifest.botId, manifest.dataset, manifest.partition, manifest.sourceWindow.from, manifest.sourceWindow.to, manifest.rowCount, manifest.schemaVersion, manifest.sourceSha, manifest.policyVersion, manifest.contentHash, manifest.fileHash,
        manifest.compressedBytes, manifest.createdAt, manifest.verifiedAt, manifest.archiveLocation, String(manifest.replayVerified), manifest.purgeState, manifest.manifestHash]);
    }
  }
  async list(dataset?: string): Promise<readonly PartitionRecord[]> {
    const rows = (dataset === undefined ? await this.pool.query(`SELECT record_json FROM ${this.table} ORDER BY dataset, partition_key`)
      : await this.pool.query(`SELECT record_json FROM ${this.table} WHERE dataset = $1 ORDER BY partition_key`, [dataset])).rows as Array<{ record_json: PartitionRecord }>;
    return rows.map((row) => row.record_json);
  }
}

export async function databaseBytes(pool: Pool): Promise<number> {
  return Number((await pool.query('SELECT pg_database_size(current_database())::bigint AS n')).rows[0].n);
}

/** Rows sitting in a DEFAULT partition mean a writer found no real partition (or a late writer hit a retired session): an incident, never silently tolerated. */
export async function defaultPartitionRowCounts(pool: Pool, parents: readonly string[]): Promise<Readonly<Record<string, number>>> {
  const result: Record<string, number> = {};
  for (const parent of parents) {
    const name = `${qualified(parent)}_default`;
    const exists = (await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [name])).rows[0].ok as boolean;
    result[parent] = exists ? Number((await pool.query(`SELECT count(*)::bigint AS n FROM ${name}`)).rows[0].n) : 0;
  }
  return result;
}

/** Pre-creates the partitions of the next sessions so writers always find their partition (idempotent). */
export async function ensureFuturePartitions(ops: PostgresPartitionOps, dataset: string, partitionKeys: readonly string[]): Promise<void> {
  for (const key of partitionKeys) await ops.ensurePartition(dataset, key);
}

export interface DefaultPartitionRepair {
  readonly dataset: string;
  readonly moved: number;
  /** partition keys that were created and filled from the default partition */
  readonly repairedKeys: readonly string[];
  /** keys whose partition was already archived and dropped: the late rows are NOT merged back (that would fork the archived partition) and stay in the default partition under an incident */
  readonly lateIntoRetired: readonly { readonly key: string; readonly rows: number }[];
}

/**
 * Moves rows out of a DEFAULT partition into real partitions (created on demand), inside one transaction per key. A late writer, a missing scheduled partition and a session
 * boundary all land here; the rows are never lost and the default partition is left empty. Rows whose partition was already retired are reported, not moved.
 * `retiredKeys` are the partition keys the lifecycle store records as DETACHED or DROPPED.
 */
export async function repairDefaultPartition(pool: Pool, spec: PartitionedDataset, keyOfDate: (date: string) => string, retiredKeys: ReadonlySet<string>): Promise<DefaultPartitionRepair> {
  const parent = qualified(spec.parent);
  const defaultTable = `${parent}_default`;
  if (!identifier.test(spec.keyColumn)) throw new Error('INVALID_KEY_COLUMN');
  const exists = (await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [defaultTable])).rows[0].ok as boolean;
  if (!exists) return { dataset: spec.dataset, moved: 0, repairedKeys: [], lateIntoRetired: [] };
  const dates = (await pool.query(`SELECT ${spec.keyColumn}::text AS d, count(*)::int AS n FROM ${defaultTable} GROUP BY 1 ORDER BY 1`)).rows as Array<{ d: string; n: number }>;
  const byKey = new Map<string, { dates: string[]; rows: number }>();
  for (const row of dates) { const key = keyOfDate(row.d.slice(0, 10)); const entry = byKey.get(key) ?? { dates: [], rows: 0 }; entry.dates.push(row.d); entry.rows += row.n; byKey.set(key, entry); }
  let moved = 0; const repairedKeys: string[] = []; const lateIntoRetired: Array<{ key: string; rows: number }> = [];
  for (const [key, entry] of byKey) {
    if (retiredKeys.has(key)) { lateIntoRetired.push({ key, rows: entry.rows }); continue; }
    const { from, to } = spec.range(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('INVALID_PARTITION_RANGE');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL dp.maintenance = 'on'");
      await client.query(`CREATE TEMP TABLE dp_default_move ON COMMIT DROP AS SELECT * FROM ${defaultTable} WHERE ${spec.keyColumn} >= $1::date AND ${spec.keyColumn} < $2::date`, [from, to]);
      const count = Number((await client.query('SELECT count(*)::bigint AS n FROM dp_default_move')).rows[0].n);
      await client.query(`DELETE FROM ${defaultTable} WHERE ${spec.keyColumn} >= $1::date AND ${spec.keyColumn} < $2::date`, [from, to]);
      await client.query(`CREATE TABLE IF NOT EXISTS ${childTableName(spec.parent, key)} PARTITION OF ${parent} FOR VALUES FROM ('${from}') TO ('${to}')`);
      await client.query(`INSERT INTO ${parent} SELECT * FROM dp_default_move`);
      await client.query('COMMIT');
      moved += count; repairedKeys.push(key);
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
  }
  return { dataset: spec.dataset, moved, repairedKeys, lateIntoRetired };
}
