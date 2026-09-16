import pg from "pg";

const connectionString = process.env.AIVEN_DATABASE_URL;
if (!connectionString) throw new Error("AIVEN_DATABASE_URL_NOT_CONFIGURED");

const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 8_000,
  application_name: "theta-database-target-preflight",
});

await client.connect();
try {
  const result = await client.query(`SELECT
    current_setting('server_version') AS version,
    current_setting('max_connections')::integer AS max_connections,
    COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
    (SELECT count(*)::integer FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema')) AS schema_count,
    (SELECT count(*)::integer FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')) AS table_count,
    (SELECT count(*)::integer FROM pg_stat_activity) AS active_connections`);
  await client.query("BEGIN");
  await client.query("CREATE TEMPORARY TABLE theta_aiven_write_probe(id integer PRIMARY KEY)");
  await client.query("INSERT INTO theta_aiven_write_probe(id) VALUES (1)");
  await client.query("ROLLBACK");

  const row = result.rows[0];
  process.stdout.write(`${JSON.stringify({
    connectivity: "PASS",
    ssl: row.ssl === true ? "PASS" : "FAIL",
    postgresVersion: row.version,
    maxConnections: row.max_connections,
    activeConnectionsAtProbe: row.active_connections,
    existingSchemaCount: row.schema_count,
    existingTableCount: row.table_count,
    transactionWriteRollback: "PASS",
  })}\n`);
} finally {
  await client.end();
}
