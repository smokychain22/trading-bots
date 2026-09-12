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
    "018_point_in_time_evidence_pipeline",
    "019_real_shadow_evidence_activation",
    "020_local_worker_runtime",
    "021_disabled_copy_planning",
    "022_disabled_copy_engine_closure",
    "023_shadow_virtual_trader",
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
    ["trade", "candidate_set_evidence"], ["trade", "candidate_point_in_time_evidence"],
    ["trade", "global_wait_evidence"], ["market", "execution_quote_observation"],
    ["research", "theta_outcome_label"], ["research", "theta_counterfactual_outcome"],
    ["research", "theta_dataset_export"], ["ops", "decision_trigger_evidence"],
    ["trade", "decision_invalidation_snapshot"],
    ["research", "theta_shadow_scan_run"], ["research", "theta_shadow_scan_member"],
    ["research", "theta_execution_observation_job"],
    ["ops", "runtime_worker_status"], ["ops", "runtime_worker_lease"],
    ["ops", "runtime_worker_event"],
    ["copy", "follower_chain_participation"],
    ["copy", "follower_chain_participation_event"],
    ["research", "theta_shadow_virtual_account"],
    ["research", "theta_shadow_order_intent"],
    ["research", "theta_shadow_order_event"],
    ["research", "theta_shadow_fill"],
    ["research", "theta_shadow_chain"],
    ["research", "theta_shadow_lifecycle_event"],
    ["research", "theta_shadow_account_snapshot"],
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
  const localWorkerProtection = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='ops'
      AND trigger_name='reject_immutable_mutation' AND event_object_table='runtime_worker_event') AS immutable_events,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='ops'
      AND table_name='runtime_worker_status' AND constraint_type='CHECK') AS state_checks`);
  if (!localWorkerProtection.rows[0]?.immutable_events || !localWorkerProtection.rows[0]?.state_checks)
    throw new Error("LOCAL_WORKER_RUNTIME_PROTECTION_MISSING");
  const disabledCopyProtection = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='copy'
      AND table_name='follower_copy_event' AND column_name='risk_execution_evidence_json') AS follower_evidence,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='copy'
      AND table_name='master_copy_event' AND constraint_name='master_copy_event_requires_broker_confirmation') AS fill_first,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='copy'
      AND table_name='master_copy_event' AND constraint_name='master_copy_event_explicit_roll_legs') AS explicit_rolls`);
  if (!disabledCopyProtection.rows[0]?.follower_evidence || !disabledCopyProtection.rows[0]?.fill_first ||
    !disabledCopyProtection.rows[0]?.explicit_rolls) throw new Error("DISABLED_COPY_PLANNING_PROTECTION_MISSING");
  const copyClosure=await client.query(`SELECT
    to_regclass('copy.follower_chain_participation') IS NOT NULL AS participation,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='copy'
      AND event_object_table='follower_copy_event' AND trigger_name='guard_disabled_follower_plan') AS boundary_guard,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='copy'
      AND table_name='follower_copy_event' AND constraint_name='follower_copy_event_copy_locked') AS execution_lock,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='copy'
      AND table_name='follower_chain_participation_event'
      AND constraint_name='follower_chain_participation_event_workspace_fk') AS participation_tenant_fk`);
  if(!copyClosure.rows[0]?.participation||!copyClosure.rows[0]?.boundary_guard||!copyClosure.rows[0]?.execution_lock||
    !copyClosure.rows[0]?.participation_tenant_fk)
    throw new Error('DISABLED_COPY_ENGINE_CLOSURE_MISSING');
  const shadowVirtualProtection=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='research'
      AND table_name='theta_shadow_order_intent' AND constraint_type='CHECK') AS intent_checks,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='theta_shadow_fill' AND trigger_name='reject_immutable_mutation') AS immutable_fills,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='theta_shadow_lifecycle_event' AND trigger_name='reject_immutable_mutation') AS immutable_lifecycle,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='theta_shadow_account_snapshot' AND trigger_name='reject_immutable_mutation') AS immutable_account_snapshots`);
  if(!shadowVirtualProtection.rows[0]?.intent_checks||!shadowVirtualProtection.rows[0]?.immutable_fills||
    !shadowVirtualProtection.rows[0]?.immutable_lifecycle||!shadowVirtualProtection.rows[0]?.immutable_account_snapshots)
    throw new Error('SHADOW_VIRTUAL_TRADER_PROTECTION_MISSING');
  const lifecycleEvidence = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade' AND trigger_name='reject_immutable_mutation' AND event_object_table='broker_position_snapshot') AS immutable_positions,
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade' AND trigger_name='protect_broker_activity_fact' AND event_object_table='broker_activity_fact') AS protected_activities`);
  if (!lifecycleEvidence.rows[0]?.immutable_positions || !lifecycleEvidence.rows[0]?.protected_activities)
    throw new Error("BROKER_LIFECYCLE_EVIDENCE_PROTECTION_MISSING");
  const evidencePipeline = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade' AND trigger_name='reject_immutable_mutation' AND event_object_table='candidate_point_in_time_evidence') AS immutable_features,
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research' AND trigger_name='reject_immutable_mutation' AND event_object_table='theta_outcome_label') AS immutable_labels,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='market' AND table_name='execution_quote_observation' AND constraint_type='CHECK') AS quote_checks`);
  if (!evidencePipeline.rows[0]?.immutable_features || !evidencePipeline.rows[0]?.immutable_labels || !evidencePipeline.rows[0]?.quote_checks)
    throw new Error("POINT_IN_TIME_EVIDENCE_PROTECTION_MISSING");
  const fillFees = await client.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='trade' AND table_name='fill' AND column_name='fees'");
  if (fillFees.rows[0]?.is_nullable !== "YES" || fillFees.rows[0]?.column_default !== null)
    throw new Error("UNKNOWN_FILL_FEES_COERCED_TO_ZERO");
  const gate = executionControl.rows[0];
  if (!gate?.pause_new_orders || gate.master_execution_enabled || gate.follower_execution_enabled)
    throw new Error("PAPER_EXECUTION_NOT_LOCKED");
  const activeFollowers = await client.query("SELECT count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL");
  const activeCredentials = await client.query("SELECT count(*)::int AS count FROM copy.alpaca_oauth_token WHERE revoked_at IS NULL");
  const roles = await client.query("SELECT account_role, count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL GROUP BY account_role");
  const orderCount = await client.query("SELECT count(*)::int AS count FROM trade.broker_order");
  const shadowCounts=await client.query(`SELECT
    (SELECT count(*)::int FROM research.theta_shadow_order_intent) AS intents,
    (SELECT count(*)::int FROM research.theta_shadow_fill) AS fills,
    (SELECT count(*)::int FROM research.theta_shadow_chain) AS chains`);
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
    pointInTimeEvidencePipeline: "ENFORCED",
    realShadowEvidenceActivation: "ENFORCED",
    localWorkerRuntime: "ENFORCED",
    disabledCopyPlanning: "ENFORCED",
    disabledCopyEngineClosure:"ENFORCED",
    shadowVirtualTrader:"ENFORCED",
    activeFollowers: activeFollowers.rows[0]?.count ?? 0,
    activeEncryptedCredentials: activeCredentials.rows[0]?.count ?? 0,
    brokerOrders: orderCount.rows[0]?.count ?? 0,
    shadowIntents:shadowCounts.rows[0]?.intents??0,
    shadowFills:shadowCounts.rows[0]?.fills??0,
    shadowChains:shadowCounts.rows[0]?.chains??0,
  }) + "\n");
} finally {
  await client.end();
}
