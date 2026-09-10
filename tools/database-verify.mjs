import pg from "pg";

const connectionString = process.env.DATABASE_MIGRATION_URL
  ?? process.env.DATABASE_URL_UNPOOLED
  ?? process.env.POSTGRES_URL_NON_POOLING
  ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_CONNECTION_NOT_CONFIGURED");

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const migrationRows = await client.query("SELECT version FROM core.schema_migration ORDER BY version");
  const expected = [
    "001_phase0_foundation", "002_provider_capability_registry",
    "003_immutable_decision_truth", "004_economic_lifecycle_ledger",
    "005_follower_copy_engine", "006_customer_identity_and_alpaca_oauth",
    "007_connection_readiness", "008_paper_execution_readiness",
    "009_private_paper_api_key_beta",
  ];
  const actual = migrationRows.rows.map((row) => row.version);
  for (const version of expected) {
    if (!actual.includes(version)) throw new Error(`MIGRATION_MISSING:${version}`);
  }
  const required = [
    ["iam", "customer_identity"], ["iam", "customer_session"],
    ["copy", "alpaca_oauth_token"], ["copy", "follower_account"],
    ["copy", "customer_participation"], ["trade", "order_intent"],
  ];
  const tables = await client.query(
    "SELECT table_schema, table_name FROM information_schema.tables WHERE (table_schema, table_name) IN (SELECT * FROM unnest($1::text[], $2::text[]))",
    [required.map(([schema]) => schema), required.map(([, table]) => table)],
  );
  const found = new Set(tables.rows.map((row) => `${row.table_schema}.${row.table_name}`));
  for (const [schema, table] of required) {
    if (!found.has(`${schema}.${table}`)) throw new Error(`TABLE_MISSING:${schema}.${table}`);
  }
  const columns = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='copy' AND table_name='follower_account'",
  );
  const columnSet = new Set(columns.rows.map((row) => row.column_name));
  for (const column of ["customer_id", "token_secret_id", "connection_method", "connection_status", "equity", "open_position_count", "open_order_count", "market_is_open"]) {
    if (!columnSet.has(column)) throw new Error(`COLUMN_MISSING:copy.follower_account.${column}`);
  }
  const activeFollowers = await client.query("SELECT count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL");
  const activeCredentials = await client.query("SELECT count(*)::int AS count FROM copy.alpaca_oauth_token WHERE revoked_at IS NULL");
  const orderCount = await client.query("SELECT count(*)::int AS count FROM trade.broker_order");
  process.stdout.write(JSON.stringify({
    state: "CONNECTED",
    migrations: expected.length,
    requiredTables: required.length,
    privateBetaColumns: 8,
    activeFollowers: activeFollowers.rows[0]?.count ?? 0,
    activeEncryptedCredentials: activeCredentials.rows[0]?.count ?? 0,
    brokerOrders: orderCount.rows[0]?.count ?? 0,
  }) + "\n");
} finally {
  await client.end();
}
