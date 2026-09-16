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

export interface DatabaseTargetFailure {
  readonly failureCode: string;
  readonly failureClass: 'AUTHENTICATION' | 'DATABASE_NOT_FOUND' | 'CONNECTION_LIMIT' | 'DNS' |
    'NETWORK' | 'RESOURCE_QUOTA' | 'TLS_CERTIFICATE' | 'TLS_REQUIRED' | 'TIMEOUT' | 'UNKNOWN';
}

export interface SafeDatabaseEndpointDescription {
  readonly protocol: string | null;
  readonly hostname: string | null;
  readonly port: string | null;
  readonly databaseNamePresent: boolean;
  readonly sslRequired: boolean;
}

export interface DatabaseSourcePreflight {
  readonly connectivity: 'PASS';
  readonly ssl: 'PASS' | 'FAIL';
  readonly postgresVersion: string;
  readonly databaseBytes: string;
  readonly existingSchemaCount: number;
  readonly existingTableCount: number;
  readonly canonicalTableCount: number;
  readonly migrationHead: string | null;
  readonly accessMode: 'READ_ONLY_PROBE';
}

export function describeDatabaseEndpoint(connectionString: string): SafeDatabaseEndpointDescription {
  try {
    const url = new URL(connectionString);
    return {
      protocol: url.protocol,
      hostname: url.hostname || null,
      port: url.port || null,
      databaseNamePresent: url.pathname.length > 1,
      sslRequired: url.searchParams.get('sslmode') === 'require' || url.searchParams.get('sslmode') === 'verify-full',
    };
  } catch {
    return { protocol: null, hostname: null, port: null, databaseNamePresent: false, sslRequired: false };
  }
}

export function classifyDatabaseTargetError(error: unknown): DatabaseTargetFailure {
  const candidate = typeof error === 'object' && error !== null
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : {};
  const rawCode = typeof candidate.code === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(candidate.code)
    ? candidate.code.toUpperCase()
    : 'UNKNOWN';
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  if (rawCode === '28P01') return { failureCode: rawCode, failureClass: 'AUTHENTICATION' };
  if (rawCode === '3D000') return { failureCode: rawCode, failureClass: 'DATABASE_NOT_FOUND' };
  if (rawCode === '53300') return { failureCode: rawCode, failureClass: 'CONNECTION_LIMIT' };
  if (rawCode === '53000') return { failureCode: rawCode, failureClass: 'RESOURCE_QUOTA' };
  if (rawCode === 'ENOTFOUND' || rawCode === 'EAI_AGAIN') return { failureCode: rawCode, failureClass: 'DNS' };
  if (rawCode === 'ECONNREFUSED' || rawCode === 'ECONNRESET') return { failureCode: rawCode, failureClass: 'NETWORK' };
  if (rawCode === 'ETIMEDOUT' || message.includes('timeout')) return { failureCode: rawCode, failureClass: 'TIMEOUT' };
  if (rawCode.includes('CERT') || message.includes('certificate') || message.includes('self-signed'))
    return { failureCode: rawCode, failureClass: 'TLS_CERTIFICATE' };
  if (message.includes('ssl') && message.includes('required'))
    return { failureCode: rawCode, failureClass: 'TLS_REQUIRED' };
  return { failureCode: rawCode, failureClass: 'UNKNOWN' };
}

export async function preflightDatabaseSource(connectionString: string): Promise<DatabaseSourcePreflight> {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 1_000,
    application_name: 'theta-database-source-preflight',
  });
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT
      current_setting('server_version') AS version,
      COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
      pg_database_size(current_database())::text AS database_bytes,
      (SELECT count(*)::integer FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema')) AS schema_count,
      (SELECT count(*)::integer FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')) AS table_count,
      (SELECT count(*)::integer FROM information_schema.tables
        WHERE table_schema IN ('iam','copy','core','market','strategy','execution','risk','analytics',
          'trade','ops','research')) AS canonical_table_count,
      to_regclass('core.schema_migration')::text AS migration_relation`);
    const migrationHead = result.rows[0]?.migration_relation === null
      ? null
      : String((await client.query(
        'SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1',
      )).rows[0]?.version ?? '') || null;
    const row = result.rows[0];
    return {
      connectivity: 'PASS',
      ssl: row.ssl === true ? 'PASS' : 'FAIL',
      postgresVersion: String(row.version),
      databaseBytes: String(row.database_bytes),
      existingSchemaCount: Number(row.schema_count),
      existingTableCount: Number(row.table_count),
      canonicalTableCount: Number(row.canonical_table_count),
      migrationHead,
      accessMode: 'READ_ONLY_PROBE',
    };
  } finally {
    client.release();
    await pool.end();
  }
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
      to_regclass('core.schema_migration')::text AS migration_relation`);
    const migrationHead = result.rows[0]?.migration_relation === null
      ? null
      : String((await client.query(
        'SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1',
      )).rows[0]?.version ?? '') || null;

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
      migrationHead,
      transactionWriteRollback: 'PASS',
    };
  } finally {
    client.release();
    await pool.end();
  }
}
