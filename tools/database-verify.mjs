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
    "009_private_paper_api_key_beta", "010_paper_account_roles",
    "011_optional_follower_limits", "012_explicit_option_position_intent",
    "013_position_intent_null_guard",
    "014_theta_runtime_persistence",
    "015_autonomous_runtime_evidence",
    "016_broker_lifecycle_evidence",
    "017_management_decision_vertical_slice",
  ];
  const actual = migrationRows.rows.map((row) => row.version);
  for (const version of expected) {
    if (!actual.includes(version)) throw new Error(`MIGRATION_MISSING:${version}`);
  }
  const required = [
    ["iam", "customer_identity"], ["iam", "customer_session"],
    ["copy", "alpaca_oauth_token"], ["copy", "follower_account"],
    ["copy", "customer_participation"], ["trade", "order_intent"],
    ["ops", "paper_account_role_event"],
    ["trade", "management_decision"], ["trade", "strategy_route"],
    ["trade", "shadow_opportunity"], ["trade", "management_opportunity"],
    ["trade", "lifecycle_transition"], ["ops", "scheduler_checkpoint"],
    ["ops", "runtime_worker_cycle"], ["trade", "broker_reconciliation_snapshot"],
    ["trade", "unmatched_broker_fact"], ["research", "theta_replay_observation"],
    ["research", "theta_replay_outcome_label"],
    ["trade", "broker_position_snapshot"], ["trade", "broker_activity_fact"],
    ["trade", "management_input_snapshot"], ["trade", "management_action_frontier"],
    ["trade", "lifecycle_application"],
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
  for (const column of ["customer_id", "token_secret_id", "connection_method", "connection_status", "equity", "open_position_count", "open_order_count", "market_is_open", "account_role"]) {
    if (!columnSet.has(column)) throw new Error(`COLUMN_MISSING:copy.follower_account.${column}`);
  }
  const policyColumns = await client.query(
    "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='copy' AND table_name='follower_policy'",
  );
  const policyColumnMap = new Map(policyColumns.rows.map((row) => [row.column_name, row.is_nullable]));
  if (!policyColumnMap.has("limit_mode")) throw new Error("COLUMN_MISSING:copy.follower_policy.limit_mode");
  for (const column of ["max_bot_capital_pct", "max_ticker_exposure_pct", "max_contracts", "max_daily_loss_usd", "max_open_positions", "max_slippage_per_contract_usd", "min_dte", "max_dte", "min_open_interest"]) {
    if (policyColumnMap.get(column) !== "YES") throw new Error(`OPTIONAL_LIMIT_NOT_NULLABLE:${column}`);
  }
  const protections = await client.query(`SELECT
    to_regclass('copy.ux_paper_broker_identity') IS NOT NULL AS global_identity,
    to_regclass('copy.ux_single_theta_master') IS NOT NULL AS single_master,
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='copy' AND trigger_name='reject_master_copy') AS self_copy_trigger,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='copy' AND table_name='follower_policy' AND constraint_name='recommended_has_no_extra_caps') AS recommended_null_constraint`);
  const protection = protections.rows[0];
  if (!protection?.global_identity || !protection?.single_master || !protection?.self_copy_trigger || !protection?.recommended_null_constraint)
    throw new Error("PAPER_ACCOUNT_PROTECTION_MISSING");
  const executionControl = await client.query("SELECT pause_new_orders, master_execution_enabled, follower_execution_enabled FROM ops.paper_execution_control WHERE singleton=true");
  const intentProtection = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='trade' AND table_name='order_intent' AND column_name='position_intent') AS has_column,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='trade' AND table_name='order_intent' AND constraint_name='ck_order_intent_position_intent') AS has_constraint`);
  if (!intentProtection.rows[0]?.has_column || !intentProtection.rows[0]?.has_constraint)
    throw new Error("EXPLICIT_POSITION_INTENT_PROTECTION_MISSING");
  const intentNullGuard = await client.query(`SELECT
    pg_get_constraintdef(oid) AS definition, convalidated
    FROM pg_constraint WHERE conrelid='trade.order_intent'::regclass
    AND conname='ck_order_intent_position_intent'`);
  const intentConstraint = intentNullGuard.rows[0];
  if (!intentConstraint?.convalidated || !intentConstraint.definition.includes('position_intent IS NOT NULL'))
    throw new Error("EXPLICIT_POSITION_INTENT_NULL_GUARD_MISSING");
  const runtimeEvidence = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ops' AND table_name='scheduler_checkpoint' AND column_name='lease_acquired_at') AS lease_evidence,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ops' AND table_name='scheduler_checkpoint' AND column_name='runtime_version') AS runtime_version,
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research' AND trigger_name='reject_early_replay_label') AS anti_leakage,
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade' AND trigger_name='reject_immutable_mutation' AND event_object_table='broker_reconciliation_snapshot') AS immutable_reconciliation`);
  const runtimeProtection = runtimeEvidence.rows[0];
  if (!runtimeProtection?.lease_evidence || !runtimeProtection?.runtime_version || !runtimeProtection?.anti_leakage || !runtimeProtection?.immutable_reconciliation)
    throw new Error("AUTONOMOUS_RUNTIME_PROTECTION_MISSING");
  const lifecycleEvidence = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade' AND trigger_name='reject_immutable_mutation' AND event_object_table='broker_position_snapshot') AS immutable_positions,
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade' AND trigger_name='protect_broker_activity_fact' AND event_object_table='broker_activity_fact') AS protected_activities`);
  if (!lifecycleEvidence.rows[0]?.immutable_positions || !lifecycleEvidence.rows[0]?.protected_activities)
    throw new Error("BROKER_LIFECYCLE_EVIDENCE_PROTECTION_MISSING");
  const gate = executionControl.rows[0];
  if (!gate?.pause_new_orders || gate.master_execution_enabled || gate.follower_execution_enabled)
    throw new Error("PAPER_EXECUTION_NOT_LOCKED");
  const activeFollowers = await client.query("SELECT count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL");
  const activeCredentials = await client.query("SELECT count(*)::int AS count FROM copy.alpaca_oauth_token WHERE revoked_at IS NULL");
  const roles = await client.query("SELECT account_role, count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL GROUP BY account_role");
  const orderCount = await client.query("SELECT count(*)::int AS count FROM trade.broker_order");
  process.stdout.write(JSON.stringify({
    state: "CONNECTED",
    migrations: expected.length,
    requiredTables: required.length,
    privateBetaColumns: 9,
    accountRoles: Object.fromEntries(roles.rows.map((row) => [row.account_role, row.count])),
    selfCopyProtection: "ENFORCED",
    optionalFollowerLimits: "ENFORCED",
    paperExecutionGate: "LOCKED",
    explicitOptionPositionIntent: "ENFORCED",
    autonomousRuntimeEvidence: "ENFORCED",
    replayFeatureLabelSeparation: "ENFORCED",
    brokerLifecycleEvidence: "ENFORCED",
    managementDecisionVerticalSlice: "ENFORCED",
    activeFollowers: activeFollowers.rows[0]?.count ?? 0,
    activeEncryptedCredentials: activeCredentials.rows[0]?.count ?? 0,
    brokerOrders: orderCount.rows[0]?.count ?? 0,
  }) + "\n");
} finally {
  await client.end();
}
