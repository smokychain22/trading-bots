// Read-only Production storage forensics (Phase 4 storage decision). Measures, never infers: per-relation bytes, row age range, per-column stored size,
// per-day growth, bloat indicators and index usage. Every query runs in one BEGIN READ ONLY transaction; nothing is written to the database.
// Output: JSON to --output=<file> (default: .theta-local-worker/storage-forensics/<timestamp>.json); stdout carries only a summary.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { explicitEnvironmentFile } from '../src/config/tool-environment.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const environment = loadEnvironmentFile(arg('environment-file') ?? explicitEnvironmentFile());
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const topRelations = Number(arg('top') ?? '14');
const observedAt = new Date().toISOString();
const outputPath = resolve(arg('output') ?? resolve('.theta-local-worker', 'storage-forensics', `${observedAt.replace(/[-:.]/g, '')}.json`));

const TIME_COLUMNS = ['observed_at', 'decided_at', 'decision_time', 'created_at', 'recorded_at', 'received_at', 'captured_at', 'started_at', 'updated_at', 'as_of', 'event_time'];
const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-storage-forensics',
  options: '-c statement_timeout=120000' });

const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  const database = (await client.query(`SELECT pg_database_size(current_database())::text AS bytes, current_setting('transaction_read_only') AS ro`)).rows[0];
  if (database.ro !== 'on') throw new Error('FORENSICS_NOT_READ_ONLY');
  const relations = (await client.query(`SELECT n.nspname AS schema_name, c.relname AS table_name, c.oid::int AS oid,
      pg_relation_size(c.oid)::text AS table_bytes, pg_indexes_size(c.oid)::text AS index_bytes,
      CASE WHEN c.reltoastrelid=0 THEN '0' ELSE pg_total_relation_size(c.reltoastrelid)::text END AS toast_bytes,
      pg_total_relation_size(c.oid)::text AS total_bytes, GREATEST(c.reltuples,0)::bigint::text AS estimated_rows,
      COALESCE(s.n_live_tup,0)::text AS live_tuples, COALESCE(s.n_dead_tup,0)::text AS dead_tuples,
      s.last_autovacuum, s.last_vacuum, s.last_autoanalyze
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
    WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    ORDER BY pg_total_relation_size(c.oid) DESC`)).rows as Array<Record<string, string | number | Date | null>>;

  const detailed: unknown[] = [];
  for (const relation of relations.slice(0, topRelations)) {
    const name = `${q(String(relation.schema_name))}.${q(String(relation.table_name))}`;
    const columns = (await client.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attstorage AS storage
      FROM pg_attribute a WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [relation.oid])).rows as Array<{ name: string; type: string; storage: string }>;
    const timeColumn = TIME_COLUMNS.find((candidate) => columns.some((column) => column.name === candidate && /timestamp|date/.test(column.type)));
    const range = timeColumn === undefined ? null
      : (await client.query(`SELECT min(${q(timeColumn)})::text AS oldest, max(${q(timeColumn)})::text AS newest, count(*)::text AS live_rows FROM ${name}`)).rows[0];
    const perDay = timeColumn === undefined ? [] : (await client.query(`SELECT (${q(timeColumn)} AT TIME ZONE 'America/New_York')::date::text AS day, count(*)::text AS rows
      FROM ${name} WHERE ${q(timeColumn)} >= now() - interval '14 days' GROUP BY 1 ORDER BY 1`)).rows;
    // pg_column_size reports the STORED (possibly compressed/out-of-line) size without detoasting the value.
    const sizeExpression = columns.map((column) => `COALESCE(sum(pg_column_size(${q(column.name)})),0)::text AS ${q(column.name)}`).join(',');
    const columnSizes = (await client.query(`SELECT count(*)::text AS rows, ${sizeExpression} FROM ${name}`)).rows[0] as Record<string, string>;
    const largestColumns = columns.map((column) => ({ column: column.name, type: column.type, storedBytes: Number(columnSizes[column.name]) }))
      .sort((left, right) => right.storedBytes - left.storedBytes).slice(0, 6);
    const indexes = (await client.query(`SELECT s.indexrelname AS index_name, pg_relation_size(s.indexrelid)::text AS bytes, s.idx_scan::text AS scans, i.indisunique AS is_unique
      FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid=s.indexrelid WHERE s.relid=$1 ORDER BY pg_relation_size(s.indexrelid) DESC`, [relation.oid])).rows;
    detailed.push({ schema: relation.schema_name, table: relation.table_name, timeColumn: timeColumn ?? null, range, perDayLast14: perDay, rowsCounted: columnSizes.rows, largestColumns, indexes });
  }
  await client.query('COMMIT');
  const output = { observedAt, databaseBytes: Number(database.bytes), relationCount: relations.length, relations, detailed };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2));
  process.stdout.write(`${JSON.stringify({ state: 'PASS', observedAt, databaseBytes: output.databaseBytes, outputPath })}\n`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ state: 'FAILED', code: (error as { code?: string }).code ?? (error as Error).message })}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
