import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

export const aivenBootstrapConfirmation = 'AIVEN_BOOTSTRAP_050' as const;

export interface DatabaseTargetMigrationReceipt {
  readonly state: 'MIGRATED';
  readonly migrationCount: number;
  readonly appliedNow: readonly string[];
  readonly migrationHead: string;
  readonly migrationPlanHash: string;
  readonly canonicalTableCount: number;
  readonly legacyStagingTableCount: number;
  readonly maxConnections: number;
  readonly clientConnectionsAtCompletion: number;
}

export function matchesAivenBootstrapConfirmation(value: string | string[] | undefined): boolean {
  return typeof value === 'string' && value === aivenBootstrapConfirmation;
}

export async function migrateDatabaseTarget(
  connectionString: string,
  migrationDirectory = resolve(process.cwd(), 'migrations'),
): Promise<DatabaseTargetMigrationReceipt> {
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (files.length === 0) throw new Error('NO_BUNDLED_MIGRATIONS');
  const plans = await Promise.all(files.map(async (file) => ({
    file,
    version: file.replace(/\.sql$/, ''),
    sql: await readFile(resolve(migrationDirectory, file), 'utf8'),
  })));
  const migrationPlanHash = createHash('sha256')
    .update(plans.map(({ file, sql }) => `${file}\0${sql}\0`).join(''))
    .digest('hex');

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 1_000,
    application_name: 'theta-aiven-canonical-migration',
  });
  const client = await pool.connect();
  const appliedNow: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [863_801_009]);
    const registry = await client.query("SELECT to_regclass('core.schema_migration')::text AS name");
    const applied = new Set<string>(registry.rows[0]?.name
      ? (await client.query('SELECT version FROM core.schema_migration')).rows.map((row) => String(row.version))
      : []);
    for (const plan of plans) {
      if (applied.has(plan.version)) continue;
      await client.query(plan.sql);
      appliedNow.push(plan.version);
    }
    const summary = await client.query(`SELECT
      (SELECT count(*)::integer FROM core.schema_migration) AS migration_count,
      (SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1) AS migration_head,
      (SELECT count(*)::integer FROM information_schema.tables
        WHERE table_schema IN ('iam','copy','core','market','strategy','execution','risk','analytics',
          'trade','ops','research')) AS canonical_table_count,
      (SELECT count(*)::integer FROM information_schema.tables
        WHERE table_schema='legacy_neon') AS legacy_staging_table_count,
      current_setting('max_connections')::integer AS max_connections,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE backend_type='client backend') AS client_connections`);
    const row = summary.rows[0];
    const migrationHead = String(row.migration_head);
    if (migrationHead !== plans.at(-1)?.version) throw new Error('MIGRATION_HEAD_MISMATCH');
    return {
      state: 'MIGRATED',
      migrationCount: Number(row.migration_count),
      appliedNow,
      migrationHead,
      migrationPlanHash,
      canonicalTableCount: Number(row.canonical_table_count),
      legacyStagingTableCount: Number(row.legacy_staging_table_count),
      maxConnections: Number(row.max_connections),
      clientConnectionsAtCompletion: Number(row.client_connections),
    };
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [863_801_009]); } catch { /* connection cleanup */ }
    client.release();
    await pool.end();
  }
}
