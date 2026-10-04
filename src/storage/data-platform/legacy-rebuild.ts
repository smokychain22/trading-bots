// Governed rebuild/swap that physically returns the space of an archived legacy population. DELETE (or payload replacement) never shrinks PostgreSQL files; only dropping a table does.
// For a population that is a SLICE of a table (older rows archived, newer rows retained) the safe method is: build a new table with only the retained rows inside one short transaction,
// swap the names, keep the old table until a second, separately approved step drops it. Nothing here runs against Production by itself: `planRebuild` only reads catalogs and returns the
// exact SQL; `executeRebuild` is for disposable databases and for the approved Production window, and `dropRetiredTable` refuses without the approval token.
import type { Pool, PoolClient } from 'pg';

const identifier = /^[a-z_][a-z0-9_]*$/;
const qualified = (schema: string, table: string): string => { if (!identifier.test(schema) || !identifier.test(table)) throw new Error('INVALID_IDENTIFIER'); return `${schema}.${table}`; };

/** an index definition without its name and table, so the same index on the old and the new table compares equal */
const indexShape = (definition: string): string => definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, 'CREATE $1INDEX ON ');

async function indexNames(db: Pool | PoolClient, schema: string, table: string): Promise<Array<{ readonly name: string; readonly shape: string }>> {
  const rows = (await db.query('SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname', [schema, table])).rows as Array<{ indexname: string; indexdef: string }>;
  return rows.map((row) => ({ name: row.indexname, shape: indexShape(row.indexdef) }));
}

export interface RebuildSpec {
  readonly schema: string;
  readonly table: string;
  /** SQL predicate over the table (no alias) selecting the rows that STAY, for example `decision_time >= '2026-09-26T04:00:00Z'` */
  readonly retainPredicate: string;
  /** the retained row count the archive proof implies; the rebuild aborts (and rolls back) if the live count differs */
  readonly expectedRetainedRows: number;
}

export interface RebuildPlan {
  readonly table: string;
  readonly refused: readonly string[];
  readonly steps: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly triggers: readonly string[];
  /** plain views over the table: they follow the renamed table by OID, so they are re-created against the new table inside the same transaction */
  readonly dependentViews: readonly { readonly schema: string; readonly name: string; readonly definition: string }[];
  readonly retainedRows: number;
  readonly totalRows: number;
  readonly currentBytes: number;
}

/** Reads catalogs only. A table with inbound foreign keys, dependent views or rules is REFUSED: the rename would leave them pointing at the old table. */
export async function planRebuild(db: Pool | PoolClient, spec: RebuildSpec): Promise<RebuildPlan> {
  const name = qualified(spec.schema, spec.table);
  const refused: string[] = [];
  const kind = (await db.query('SELECT relkind FROM pg_class WHERE oid = to_regclass($1)', [name])).rows[0]?.relkind as string | undefined;
  if (kind !== 'r') refused.push(kind === undefined ? 'TABLE_MISSING' : `NOT_A_PLAIN_TABLE:${kind}`);
  const inbound = Number((await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND confrelid = to_regclass($1)`, [name])).rows[0]?.n ?? 0);
  if (inbound > 0) refused.push(`INBOUND_FOREIGN_KEYS:${inbound}`);
  const dependents = (await db.query(`SELECT DISTINCT n.nspname AS schema_name, c.relname AS view_name, c.relkind, pg_get_viewdef(c.oid, true) AS definition FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE d.refobjid = to_regclass($1) AND d.classid = 'pg_rewrite'::regclass AND c.oid <> d.refobjid ORDER BY 1, 2`, [name])).rows as Array<{ schema_name: string; view_name: string; relkind: string; definition: string }>;
  const unsupported = dependents.filter((row) => row.relkind !== 'v');
  if (unsupported.length > 0) refused.push(`DEPENDENT_NON_PLAIN_VIEWS:${unsupported.map((row) => `${row.schema_name}.${row.view_name}`).join(',')}`);
  const dependentViews = dependents.filter((row) => row.relkind === 'v').map((row) => ({ schema: row.schema_name, name: row.view_name, definition: row.definition }));
  const partitioned = Number((await db.query(`SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent = to_regclass($1) OR inhrelid = to_regclass($1)`, [name])).rows[0]?.n ?? 0);
  if (partitioned > 0) refused.push('PARTITIONED_OR_INHERITED_TABLE');
  const foreignKeys = (await db.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'f' AND conrelid = to_regclass($1) ORDER BY conname`, [name])).rows.map((row) => `ALTER TABLE ${name} ADD CONSTRAINT ${String(row.conname)} ${String(row.def)}`);
  const triggers = (await db.query(`SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = to_regclass($1) AND NOT tgisinternal ORDER BY tgname`, [name])).rows.map((row) => String(row.def));
  const counts = kind === 'r' ? (await db.query(`SELECT count(*)::bigint AS total, count(*) FILTER (WHERE ${spec.retainPredicate})::bigint AS retained FROM ${name}`)).rows[0] as { total: string; retained: string } : { total: '0', retained: '0' };
  const bytes = kind === 'r' ? Number((await db.query('SELECT pg_total_relation_size($1::regclass)::bigint AS n', [name])).rows[0].n) : 0;
  const fresh = `${spec.table}_rebuild_new`; const old = `${spec.table}_retired_old`;
  const steps = [
    'BEGIN',
    `SET LOCAL lock_timeout = '10s'`,
    `LOCK TABLE ${name} IN ACCESS EXCLUSIVE MODE`,
    `CREATE TABLE ${spec.schema}.${fresh} (LIKE ${name} INCLUDING ALL)`,
    `INSERT INTO ${spec.schema}.${fresh} SELECT * FROM ${name} WHERE ${spec.retainPredicate}`,
    `-- abort and roll back unless count(${spec.schema}.${fresh}) = ${spec.expectedRetainedRows} AND equals the live retained count`,
    `ALTER TABLE ${name} RENAME TO ${old}`,
    `ALTER TABLE ${spec.schema}.${fresh} RENAME TO ${spec.table}`,
    ...foreignKeys, ...dependentViews.map((view) => `CREATE OR REPLACE VIEW ${view.schema}.${view.name} AS ${view.definition.replace(/\s+/g, ' ').trim()}`), ...triggers.map((def) => def.replace(new RegExp(`ON ${name.replace('.', '\\.')}\\b`, 'i'), `ON ${name}`)),
    'COMMIT',
    `-- LATER, separately approved: DROP TABLE ${spec.schema}.${old}   (returns ${bytes} bytes before the retained rows are subtracted)`,
  ];
  return { table: name, refused, steps, foreignKeys, triggers, dependentViews, retainedRows: Number(counts.retained), totalRows: Number(counts.total), currentBytes: bytes };
}

export class RebuildRefused extends Error { constructor(readonly reasons: readonly string[]) { super(`REBUILD_REFUSED:${reasons.join(',')}`); this.name = 'RebuildRefused'; } }

/** One transaction: build, verify, swap. The old table stays (renamed) so the whole step is reversible until dropRetiredTable runs. */
export async function executeRebuild(pool: Pool, spec: RebuildSpec): Promise<{ readonly retained: number; readonly oldTable: string }> {
  const plan = await planRebuild(pool, spec);
  if (plan.refused.length > 0) throw new RebuildRefused(plan.refused);
  const name = qualified(spec.schema, spec.table);
  const fresh = qualified(spec.schema, `${spec.table}_rebuild_new`); const old = qualified(spec.schema, `${spec.table}_retired_old`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '10s'`);
    await client.query(`LOCK TABLE ${name} IN ACCESS EXCLUSIVE MODE`);
    await client.query(`CREATE TABLE ${fresh} (LIKE ${name} INCLUDING ALL)`);
    // the immutability trigger forbids DELETE, never INSERT: copying retained rows is an ordinary insert
    await client.query(`INSERT INTO ${fresh} SELECT * FROM ${name} WHERE ${spec.retainPredicate}`);
    const retained = Number((await client.query(`SELECT count(*)::bigint AS n FROM ${fresh}`)).rows[0].n);
    const live = Number((await client.query(`SELECT count(*)::bigint AS n FROM ${name} WHERE ${spec.retainPredicate}`)).rows[0].n);
    if (retained !== spec.expectedRetainedRows || retained !== live) throw new Error(`REBUILD_ROW_COUNT_MISMATCH:${retained}/${live}/${spec.expectedRetainedRows}`);
    const originalIndexes = await indexNames(client, spec.schema, spec.table);
    await client.query(`ALTER TABLE ${name} RENAME TO ${old.split('.')[1]}`);
    for (const index of originalIndexes) await client.query(`ALTER INDEX ${spec.schema}.${index.name} RENAME TO ${index.name.slice(0, 50)}_retired`);
    await client.query(`ALTER TABLE ${fresh} RENAME TO ${spec.table}`);
    // the rebuilt table keeps the CANONICAL index names (consumers, migrations and the compatibility swap refer to them by name)
    const rebuiltIndexes = await indexNames(client, spec.schema, spec.table);
    for (const original of originalIndexes) {
      const match = rebuiltIndexes.find((candidate) => candidate.shape === original.shape && candidate.name !== original.name);
      if (match === undefined) throw new Error(`REBUILD_INDEX_NOT_REPRODUCED:${original.name}`);
      await client.query(`ALTER INDEX ${spec.schema}.${match.name} RENAME TO ${original.name}`);
    }
    for (const statement of plan.foreignKeys) await client.query(statement);
    for (const view of plan.dependentViews) await client.query(`CREATE OR REPLACE VIEW ${qualified(view.schema, view.name)} AS ${view.definition}`);
    for (const definition of plan.triggers) await client.query(definition);
    await client.query('COMMIT');
    return { retained, oldTable: old };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

/** The irreversible second step. Requires the approval token (the owner's final purge approval) and the proof that the archive was verified. */
export async function dropRetiredTable(pool: Pool, spec: Pick<RebuildSpec, 'schema' | 'table'>, approval: { readonly token: string; readonly expectedToken: string; readonly archiveVerifiedAt: string | null }): Promise<{ readonly reclaimedBytes: number }> {
  if (approval.token.length < 16 || approval.token !== approval.expectedToken) throw new Error('PURGE_APPROVAL_TOKEN_REQUIRED');
  if (approval.archiveVerifiedAt === null) throw new Error('ARCHIVE_VERIFICATION_PROOF_REQUIRED');
  const old = qualified(spec.schema, `${spec.table}_retired_old`);
  const bytes = Number((await pool.query('SELECT COALESCE(pg_total_relation_size(to_regclass($1)), 0)::bigint AS n', [old])).rows[0].n);
  await pool.query(`DROP TABLE IF EXISTS ${old}`);
  return { reclaimedBytes: bytes };
}
