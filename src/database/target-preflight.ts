import { Pool } from 'pg';

export interface DatabaseTargetPreflight {
  readonly connectivity: 'PASS';
  readonly ssl: 'PASS' | 'FAIL';
  readonly postgresVersion: string;
  readonly maxConnections: number;
  readonly activeConnectionsAtProbe: number;
  readonly existingSchemaCount: number;
  readonly existingTableCount: number;
  readonly canonicalTableCount: number;
  readonly migrationHead: string | null;
  readonly transactionWriteRollback: 'PASS';
}

export async function preflightDatabaseTarget(connectionString: string): Promise<DatabaseTargetPreflight> {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 1_000,
    application_name: 'theta-database-target-preflight',
  });
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT
      current_setting('server_version') AS version,
      current_setting('max_connections')::integer AS max_connections,
      COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
      (SELECT count(*)::integer FROM pg_stat_activity) AS active_connections,
      (SELECT count(*)::integer FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema')) AS schema_count,
      (SELECT count(*)::integer FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')) AS table_count,
      (SELECT count(*)::integer FROM information_schema.tables
        WHERE table_schema IN ('iam','copy','core','market','strategy','execution','risk','analytics',
          'trade','ops','research')) AS canonical_table_count,
      CASE WHEN to_regclass('core.schema_migration') IS NULL THEN NULL
        ELSE (SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1) END AS migration_head`);

    await client.query('BEGIN');
    await client.query('CREATE TEMPORARY TABLE theta_database_target_write_probe(id integer PRIMARY KEY)');
    await client.query('INSERT INTO theta_database_target_write_probe(id) VALUES (1)');
    await client.query('ROLLBACK');

    const row = result.rows[0];
    return {
      connectivity: 'PASS',
      ssl: row.ssl === true ? 'PASS' : 'FAIL',
      postgresVersion: String(row.version),
      maxConnections: Number(row.max_connections),
      activeConnectionsAtProbe: Number(row.active_connections),
      existingSchemaCount: Number(row.schema_count),
      existingTableCount: Number(row.table_count),
      canonicalTableCount: Number(row.canonical_table_count),
      migrationHead: typeof row.migration_head === 'string' ? row.migration_head : null,
      transactionWriteRollback: 'PASS',
    };
  } finally {
    client.release();
    await pool.end();
  }
}
