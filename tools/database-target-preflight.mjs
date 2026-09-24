import pg from "pg";

const environmentFileArgument = process.argv.find((argument) => argument.startsWith('--environment-file='));
let connectionString = process.env.AIVEN_DATABASE_URL;
if (environmentFileArgument) {
  const { loadEnvironmentFile } = await import('../src/config/environment.ts');
  const environment = loadEnvironmentFile(environmentFileArgument.slice('--environment-file='.length));
  connectionString = environment.AIVEN_DATABASE_URL;
}
if (!connectionString) throw new Error("AIVEN_DATABASE_URL_NOT_CONFIGURED");

let client;
try {
  client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 8_000,
    application_name: "theta-database-target-preflight",
  });
  await client.connect();
  const result = await client.query(`SELECT
    current_setting('server_version') AS version,
    current_setting('default_transaction_read_only') AS default_transaction_read_only,
    current_setting('transaction_read_only') AS transaction_read_only,
    current_setting('max_connections')::integer AS max_connections,
    COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
    (SELECT count(*)::integer FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema')) AS schema_count,
    (SELECT count(*)::integer FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')) AS table_count,
    (SELECT count(*)::integer FROM pg_stat_activity) AS total_connections,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database()) AS current_database_connections,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE backend_type='client backend') AS client_backends,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE backend_type<>'client backend') AS background_processes,
    (SELECT count(*)::integer FROM pg_stat_activity
      WHERE backend_type='client backend' AND state='active') AS active_clients,
    (SELECT count(*)::integer FROM pg_stat_activity
      WHERE backend_type='client backend' AND state='idle') AS idle_clients,
    (SELECT count(*)::integer FROM pg_stat_activity
      WHERE backend_type='client backend' AND state='active' AND wait_event IS NOT NULL) AS waiting_clients`);
  await client.query("BEGIN");
  await client.query("CREATE TEMPORARY TABLE theta_aiven_write_probe(id integer PRIMARY KEY)");
  await client.query("INSERT INTO theta_aiven_write_probe(id) VALUES (1)");
  await client.query("ROLLBACK");

  const row = result.rows[0];
  process.stdout.write(`${JSON.stringify({
    connectivity: "PASS",
    ssl: row.ssl === true ? "PASS" : "FAIL",
    postgresVersion: row.version,
    defaultTransactionReadOnly: row.default_transaction_read_only,
    transactionReadOnly: row.transaction_read_only,
    maxConnections: row.max_connections,
    totalConnectionsAtProbe: row.total_connections,
    currentDatabaseConnectionsAtProbe: row.current_database_connections,
    clientBackendsAtProbe: row.client_backends,
    backgroundProcessesAtProbe: row.background_processes,
    activeClientsAtProbe: row.active_clients,
    idleClientsAtProbe: row.idle_clients,
    waitingClientsAtProbe: row.waiting_clients,
    existingSchemaCount: row.schema_count,
    existingTableCount: row.table_count,
    transactionWriteRollback: "PASS",
  })}\n`);
} catch (error) {
  // Node/pg connection errors may include the database hostname or URL.
  // The preflight receipt needs only a bounded failure category.
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code)
    ? error.code : 'UNCLASSIFIED_DATABASE_ERROR';
  process.stderr.write(`${JSON.stringify({ connectivity: 'FAIL', errorCode: code })}\n`);
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => undefined);
}
