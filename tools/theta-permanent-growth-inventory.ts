// READ-ONLY inventory of every relation that still produces bytes per session: rows per active session, bytes per session (stored bytes per row of the relation x rows per session), foreign keys,
// dependents (views, materialized views, functions), immutability triggers, and the time column used. Nothing is written to Production.
//   node --import tsx tools/theta-permanent-growth-inventory.ts [--environment-file=.env.local] [--days=14] [--out=<file>]
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { classifyPostgresRelation } from '../src/storage/storage-authority-registry.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const days = Number(arg('days') ?? '14');
const environment = loadEnvironmentFile(arg('environment-file') ?? '.env.local');
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-growth-inventory', options: '-c statement_timeout=120000' });
pool.on('error', () => undefined);
async function read<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect(); let broken = false;
    try { await client.query('BEGIN READ ONLY'); const rows = (await client.query(sql, values)).rows as T[]; await client.query('COMMIT'); return rows; }
    catch (error) { broken = true; await client.query('ROLLBACK').catch(() => undefined); const transient = /terminated|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(`${(error as { code?: string }).code ?? ''} ${(error as Error).message}`); if (attempt >= 5 || !transient) throw error; await sleep(5_000 * attempt); }
    finally { client.release(broken ? true : undefined); }
  }
}
const TIME_PRIORITY = ['decision_time', 'observed_at', 'created_at', 'recorded_at', 'occurred_at', 'event_time', 'started_at', 'requested_at', 'retrieved_at', 'as_of', 'target_at', 'finished_at', 'updated_at', 'ingested_at', 'first_observed_at'];
const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

const relations = await read<{ schema_name: string; table_name: string; total_bytes: string; table_bytes: string; index_bytes: string; toast_bytes: string; live_rows: string; dead_rows: string }>(`
  SELECT n.nspname AS schema_name, c.relname AS table_name, pg_total_relation_size(c.oid)::bigint AS total_bytes, pg_table_size(c.oid)::bigint - COALESCE(pg_total_relation_size(NULLIF(c.reltoastrelid, 0)), 0) AS table_bytes,
    pg_indexes_size(c.oid)::bigint AS index_bytes, COALESCE(pg_total_relation_size(NULLIF(c.reltoastrelid, 0)), 0)::bigint AS toast_bytes, GREATEST(c.reltuples, 0)::bigint AS live_rows,
    COALESCE(s.n_dead_tup, 0)::bigint AS dead_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND pg_total_relation_size(c.oid) > 65536
  ORDER BY pg_total_relation_size(c.oid) DESC`);
const fks = await read<{ child: string; parent: string; on_delete: string }>(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, confdeltype::text AS on_delete FROM pg_constraint WHERE contype = 'f'`);
const views = await read<{ dependent: string; depends_on: string; kind: string }>(`SELECT DISTINCT cv.oid::regclass::text AS dependent, d.refobjid::regclass::text AS depends_on, cv.relkind::text AS kind FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class cv ON cv.oid = r.ev_class WHERE d.classid = 'pg_rewrite'::regclass AND cv.oid <> d.refobjid AND d.refobjid IN (SELECT oid FROM pg_class WHERE relkind IN ('r','p'))`);
const triggers = await read<{ rel: string; trigger_name: string }>(`SELECT tgrelid::regclass::text AS rel, tgname AS trigger_name FROM pg_trigger WHERE NOT tgisinternal`);
const columns = await read<{ schema_name: string; table_name: string; column_name: string; data_type: string }>(`SELECT table_schema AS schema_name, table_name, column_name, data_type FROM information_schema.columns WHERE data_type IN ('timestamp with time zone', 'timestamp without time zone', 'date') AND table_schema NOT IN ('pg_catalog', 'information_schema', 'dp')`);

const results: Array<Record<string, unknown>> = [];
for (const relation of relations) {
  const name = `${relation.schema_name}.${relation.table_name}`;
  const timeColumns = columns.filter((column) => column.schema_name === relation.schema_name && column.table_name === relation.table_name).map((column) => column.column_name);
  const timeColumn = TIME_PRIORITY.find((candidate) => timeColumns.includes(candidate)) ?? timeColumns[0] ?? null;
  const totalBytes = Number(relation.total_bytes);
  const storageClass = classifyPostgresRelation(relation.schema_name, relation.table_name);
  let rowsExact: number | null = null; let recent: { rows: number; activeDays: number; oldest: string | null; newest: string | null } | null = null;
  try {
    rowsExact = Number((await read<{ n: string }>(`SELECT count(*)::bigint AS n FROM ${q(relation.schema_name)}.${q(relation.table_name)}`))[0]?.n ?? 0);
    if (timeColumn !== null) {
      const r = (await read<{ n: string; d: string; lo: string | null; hi: string | null }>(`SELECT count(*)::bigint AS n, count(DISTINCT ${q(timeColumn)}::date)::bigint AS d, min(${q(timeColumn)})::text AS lo, max(${q(timeColumn)})::text AS hi FROM ${q(relation.schema_name)}.${q(relation.table_name)} WHERE ${q(timeColumn)} >= now() - make_interval(days => $1)`, [days]))[0];
      recent = r === undefined ? null : { rows: Number(r.n), activeDays: Number(r.d), oldest: r.lo, newest: r.hi };
    }
  } catch (error) { rowsExact = null; recent = null; process.stderr.write(`${name}: ${(error as Error).message.slice(0, 80)}\n`); }
  const bytesPerRow = rowsExact !== null && rowsExact > 0 ? totalBytes / rowsExact : null;
  // a weekend or holiday has no decisions but diagnostics run on every calendar day: rows per ACTIVE DAY is the per-session figure; 7/5 diagnostics factor is applied to session sums later
  const rowsPerActiveDay = recent !== null && recent.activeDays > 0 ? recent.rows / recent.activeDays : null;
  results.push({ relation: name, classification: storageClass.classification, classificationRationale: storageClass.rationale, totalMiB: +(totalBytes / 1048576).toFixed(2), tableMiB: +(Number(relation.table_bytes) / 1048576).toFixed(2), indexMiB: +(Number(relation.index_bytes) / 1048576).toFixed(2), toastMiB: +(Number(relation.toast_bytes) / 1048576).toFixed(2),
    rows: rowsExact, timeColumn, rowsLastDays: recent?.rows ?? null, activeDays: recent?.activeDays ?? null, rowsPerActiveDay: rowsPerActiveDay === null ? null : +rowsPerActiveDay.toFixed(1), bytesPerRow: bytesPerRow === null ? null : Math.round(bytesPerRow),
    bytesPerActiveDayKiB: rowsPerActiveDay !== null && bytesPerRow !== null ? +((rowsPerActiveDay * bytesPerRow) / 1024).toFixed(1) : null,
    deadTupleEstimate: Number(relation.dead_rows), deadTupleRatio: Number(relation.live_rows) + Number(relation.dead_rows) === 0 ? 0 : Number(relation.dead_rows) / (Number(relation.live_rows) + Number(relation.dead_rows)),
    outboundForeignKeys: fks.filter((fk) => fk.child === name || fk.child === relation.table_name).map((fk) => fk.parent), inboundForeignKeys: fks.filter((fk) => fk.parent === name || (relation.schema_name === 'public' && fk.parent === relation.table_name)).map((fk) => fk.child),
    dependentViews: views.filter((view) => view.depends_on === name).map((view) => `${view.dependent}(${view.kind})`), immutabilityTrigger: triggers.some((trigger) => trigger.rel === name && /immutable|append/i.test(trigger.trigger_name)) });
  process.stderr.write(`${name} done\n`);
}
await pool.end();
const growing = results.filter((row) => typeof row.bytesPerActiveDayKiB === 'number' && (row.bytesPerActiveDayKiB as number) > 0).sort((a, b) => (b.bytesPerActiveDayKiB as number) - (a.bytesPerActiveDayKiB as number));
const classificationGrowthKiBPerActiveDay = Object.fromEntries([...new Set(results.map((row) => String(row.classification)))].sort().map((classification) => [classification, +growing.filter((row) => row.classification === classification).reduce((sum, row) => sum + (row.bytesPerActiveDayKiB as number), 0).toFixed(1)]));
const text = `${JSON.stringify({ measuredAt: new Date().toISOString(), windowDays: days, relations: results.length, totalGrowthKiBPerActiveDay: +growing.reduce((sum, row) => sum + (row.bytesPerActiveDayKiB as number), 0).toFixed(1), classificationGrowthKiBPerActiveDay, top30Growth: growing.slice(0, 30), results }, null, 1)}\n`;
const out = arg('out'); if (out !== undefined) writeFileSync(out, text); else process.stdout.write(text);
