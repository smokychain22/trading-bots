import pg from "pg";
import { resolveDatabaseConnection } from "./database-connection.mjs";

const { connectionString } = resolveDatabaseConnection(process.env, "migration");

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
    "024_paper_execution_lineage",
    "025_execution_pricing_and_tca",
    "026_provider_neutral_execution_lineage",
    "027_paper_active_baseline_and_near_miss",
    "028_optionomics_layered_evidence",
    "029_optionomics_request_provenance",
    "030_optionomics_context_lineage",
    "031_canonical_strategy_frontier",
    "032_canonical_decision_authority",
    "033_master_paper_runtime",
    "034_master_paper_action_handoff",
    "035_paper_evidence_authorization",
    "036_runtime_behavior_diagnostics",
    "037_management_action_plan_dispatch",
    "038_optionomics_temporal_feature_evidence",
    "039_cross_branch_candidate_evidence",
    "040_follower_paper_runtime",
    "041_management_policy_evidence",
    "042_shadow_management_policy",
    "043_options_chain_decision_intelligence",
    "044_resolved_outcome_engine",
    "045_outcome_subject_decision_identity",
    "046_real_label_materialization",
    "047_p2e_time_path_intelligence",
    "048_p2f_provider_activation_readiness",
    "049_p2g_simulation_and_preview",
    "050_legacy_neon_staging",
    "051_legacy_neon_promotion",
    "052_legacy_reconstruction_registry",
    "053_local_forensic_recovery",
    "054_master_paper_authorization",
    "055_paper_indicative_quote_reference",
    "056_paper_runtime_gate_semantics",
    "057_broker_cash_activity_evidence",
    "058_terminal_partial_close_accounting",
    "059_paper_restart_recovery_invariant",
    "060_execution_account_paper_only_invariant",
    "061_paper_execution_control_normalization",
    "062_policy_neutral_risk_evidence",
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
    ["trade", "option_partial_close_realization"],
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
    ["trade", "execution_price_event"],
    ["trade", "transaction_cost_analysis"],
    ["research", "theta_paper_active_baseline_receipt"],
    ["research", "theta_near_miss_reevaluation_event"],
    ["market", "optionomics_raw_observation"],
    ["market", "optionomics_feature_snapshot"],
    ["market", "optionomics_feature_observation_link"],
    ["research", "optionomics_quote_qualification_run"],
    ["trade", "canonical_strategy_frontier"],
    ["trade", "master_paper_action_plan"], ["trade", "master_paper_action_plan_event"],
    ["research", "theta_runtime_behavior_diagnostic"],
    ["research", "optionomics_temporal_feature_observation"],
    ["trade", "canonical_strategy_branch_evidence"],
    ["trade", "canonical_strategy_candidate_evidence"],
    ["copy", "follower_paper_action_plan"],
    ["copy", "follower_paper_action_plan_event"],
    ["copy", "follower_lifecycle_divergence_event"],
    ["copy", "follower_runtime_checkpoint"],
    ["research", "theta_shadow_management_policy_evidence"],
    ["research", "theta_option_chain_decision_evidence"],
    ["research", "theta_outcome_subject"],
    ["research", "theta_outcome_observation"],
    ["research", "theta_outcome_resolution_receipt"],
    ["research", "theta_resolved_outcome_label"],
    ["research", "theta_policy_challenger_evaluation"],
    ["research", "theta_policy_learning_record"],
    ["research", "theta_position_path_checkpoint"],
    ["research", "theta_action_inaction_frontier"],
    ["research", "theta_strategy_timing_snapshot"],
    ["ops", "theta_operator_control_event"],
    ["research", "optionomics_provider_qualification_receipt"],
    ["research", "quote_provider_qualification_receipt"],
    ["ops", "theta_alert_event"],
    ["legacy_neon", "local_forensic_sweep"],
    ["legacy_neon", "local_forensic_source"],
    ["legacy_neon", "research_export_variant"],
    ["legacy_neon", "missing_record_forensic_search"],
  ];
  const tables = await client.query(
    "SELECT table_schema, table_name FROM information_schema.tables WHERE (table_schema, table_name) IN (SELECT * FROM unnest($1::text[], $2::text[]))",
    [required.map(([schema]) => schema), required.map(([, table]) => table)],
  );
  const found = new Set(tables.rows.map((row) => `${row.table_schema}.${row.table_name}`));
  for (const [schema, table] of required) {
    if (!found.has(`${schema}.${table}`)) throw new Error(`TABLE_MISSING:${schema}.${table}`);
  }
  const riskHistory = await client.query("SELECT to_regclass('research.option_contract_risk_history')::text AS name");
  if (!riskHistory.rows[0]?.name) throw new Error("RELATION_MISSING:research.option_contract_risk_history");
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
  const executionControl = await client.query("SELECT pause_new_orders, master_execution_enabled, follower_execution_enabled, authorization_event_id FROM ops.paper_execution_control WHERE singleton=true");
  const intentProtection = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='trade' AND table_name='order_intent' AND column_name='position_intent') AS has_column,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='trade' AND table_name='order_intent' AND constraint_name='ck_order_intent_position_intent') AS has_constraint`);
  if (!intentProtection.rows[0]?.has_column || !intentProtection.rows[0]?.has_constraint)
    throw new Error("EXPLICIT_POSITION_INTENT_PROTECTION_MISSING");
  const executionLineage=await client.query(`SELECT
    count(*) FILTER(WHERE column_name IN ('quote_source','quote_feed','quote_semantics','quote_content_hash'))::int AS column_count,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='trade'
      AND table_name='order_intent' AND constraint_name='ck_order_intent_quote_lineage') AS has_constraint
    FROM information_schema.columns WHERE table_schema='trade' AND table_name='order_intent'`);
  if(executionLineage.rows[0]?.column_count!==4||!executionLineage.rows[0]?.has_constraint)
    throw new Error('PAPER_EXECUTION_LINEAGE_PROTECTION_MISSING');
  const executionEconomics=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
      AND event_object_table='execution_price_event' AND trigger_name='reject_immutable_mutation') AS immutable_prices,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
      AND event_object_table='transaction_cost_analysis' AND trigger_name='reject_immutable_mutation') AS immutable_tca`);
  if(!executionEconomics.rows[0]?.immutable_prices||!executionEconomics.rows[0]?.immutable_tca)
    throw new Error('EXECUTION_PRICING_TCA_PROTECTION_MISSING');
  const baselineEvidence=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='theta_paper_active_baseline_receipt' AND trigger_name='reject_immutable_mutation') AS immutable_receipts,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='theta_near_miss_reevaluation_event' AND trigger_name='reject_immutable_mutation') AS immutable_near_miss`);
  if(!baselineEvidence.rows[0]?.immutable_receipts||!baselineEvidence.rows[0]?.immutable_near_miss)
    throw new Error('PAPER_ACTIVE_BASELINE_EVIDENCE_PROTECTION_MISSING');
  const optionomicsEvidence=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='market'
      AND event_object_table='optionomics_raw_observation' AND trigger_name='reject_immutable_mutation') AS immutable_raw,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='market'
      AND event_object_table='optionomics_feature_snapshot' AND trigger_name='reject_immutable_mutation') AS immutable_features,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='optionomics_quote_qualification_run' AND trigger_name='reject_immutable_mutation') AS immutable_qualification,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='market'
      AND event_object_table='optionomics_feature_observation_link' AND trigger_name='reject_immutable_mutation') AS immutable_context_lineage`);
  if(!optionomicsEvidence.rows[0]?.immutable_raw||!optionomicsEvidence.rows[0]?.immutable_features||
    !optionomicsEvidence.rows[0]?.immutable_qualification||!optionomicsEvidence.rows[0]?.immutable_context_lineage)
    throw new Error('OPTIONOMICS_LAYERED_EVIDENCE_PROTECTION_MISSING');
  const optionomicsTemporalEvidence=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='optionomics_temporal_feature_observation' AND trigger_name='reject_immutable_mutation') AS immutable_temporal,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.optionomics_temporal_feature_observation'::regclass
      AND conname='optionomics_temporal_known_shape') AS known_shape,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.optionomics_temporal_feature_observation'::regclass
      AND conname='optionomics_temporal_time_order') AS time_order`);
  if(!optionomicsTemporalEvidence.rows[0]?.immutable_temporal||!optionomicsTemporalEvidence.rows[0]?.known_shape||
    !optionomicsTemporalEvidence.rows[0]?.time_order)
    throw new Error('OPTIONOMICS_TEMPORAL_EVIDENCE_PROTECTION_MISSING');
  const crossBranchEvidence=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
      AND event_object_table='canonical_strategy_branch_evidence' AND trigger_name='reject_immutable_mutation') AS immutable_branches,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
      AND event_object_table='canonical_strategy_candidate_evidence' AND trigger_name='reject_immutable_mutation') AS immutable_candidates,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='trade.canonical_strategy_candidate_evidence'::regclass
      AND conname='canonical_candidate_execution_locked') AS execution_locked`);
  if(!crossBranchEvidence.rows[0]?.immutable_branches||!crossBranchEvidence.rows[0]?.immutable_candidates||
    !crossBranchEvidence.rows[0]?.execution_locked)
    throw new Error('CROSS_BRANCH_CANDIDATE_EVIDENCE_PROTECTION_MISSING');
  const followerPaperRuntime=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='copy'
      AND event_object_table='follower_paper_action_plan' AND trigger_name='reject_immutable_mutation') AS immutable_plans,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='copy'
      AND event_object_table='follower_paper_action_plan_event' AND trigger_name='reject_immutable_mutation') AS immutable_events,
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='copy'
      AND event_object_table='follower_lifecycle_divergence_event' AND trigger_name='reject_immutable_mutation') AS immutable_divergence,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='copy.follower_paper_action_plan'::regclass
      AND conname='follower_paper_action_plan_execution_authorized_check') AS authorization_locked,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='copy.follower_paper_action_plan'::regclass
      AND conname='follower_paper_action_plan_execution_gate_check') AS gate_locked,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='copy.follower_paper_action_plan'::regclass
      AND conname='follower_paper_action_plan_order_shape') AS order_shape,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='copy'
      AND table_name='follower_reconciliation_event' AND column_name='event_key') AS reconciliation_idempotency`);
  if(!followerPaperRuntime.rows[0]?.immutable_plans||!followerPaperRuntime.rows[0]?.immutable_events||
    !followerPaperRuntime.rows[0]?.immutable_divergence||!followerPaperRuntime.rows[0]?.authorization_locked||
    !followerPaperRuntime.rows[0]?.gate_locked||!followerPaperRuntime.rows[0]?.order_shape||
    !followerPaperRuntime.rows[0]?.reconciliation_idempotency)
    throw new Error('FOLLOWER_PAPER_RUNTIME_PROTECTION_MISSING');
  const optionomicsProvenance=await client.query(`SELECT count(*)::int AS column_count
    FROM information_schema.columns WHERE table_schema='market' AND table_name='optionomics_raw_observation'
      AND column_name IN ('requested_at','request_path','request_parameters_json','http_status','rate_limit_json',
        'documentation_reference','credential_identity_ref_hash','session_date')`);
  if(optionomicsProvenance.rows[0]?.column_count!==8)
    throw new Error('OPTIONOMICS_REQUEST_PROVENANCE_MISSING');
  const strategyFrontierProtection=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
      AND event_object_table='canonical_strategy_frontier' AND trigger_name='reject_immutable_mutation') AS immutable_frontier`);
  if(!strategyFrontierProtection.rows[0]?.immutable_frontier)
    throw new Error('CANONICAL_STRATEGY_FRONTIER_PROTECTION_MISSING');
  const actionHandoffProtection=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
      AND event_object_table='master_paper_action_plan_event' AND trigger_name='reject_immutable_mutation') AS immutable_events,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='trade'
      AND table_name='master_paper_action_plan' AND constraint_type='CHECK') AS plan_checks`);
  if(!actionHandoffProtection.rows[0]?.immutable_events||!actionHandoffProtection.rows[0]?.plan_checks)
    throw new Error('MASTER_PAPER_ACTION_HANDOFF_PROTECTION_MISSING');
  const managementDispatchProtection=await client.query(`SELECT
    count(*) FILTER(WHERE column_name IN ('authority_kind','management_input_snapshot_id','management_action_frontier_id',
      'action_group_id','leg_sequence','depends_on_action_plan_id','execution_order_intent_id'))::int AS column_count,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='trade.master_paper_action_plan'::regclass
      AND conname='master_paper_action_plan_authority_shape_check') AS authority_shape,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='trade.master_paper_action_plan'::regclass
      AND conname='master_paper_action_plan_dependency_shape_check') AS dependency_shape,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='trade.master_paper_action_plan'::regclass
      AND conname='master_paper_action_plan_execution_intent_key') AS intent_link
    FROM information_schema.columns WHERE table_schema='trade' AND table_name='master_paper_action_plan'`);
  if(managementDispatchProtection.rows[0]?.column_count!==7||!managementDispatchProtection.rows[0]?.authority_shape||
    !managementDispatchProtection.rows[0]?.dependency_shape||!managementDispatchProtection.rows[0]?.intent_link)
    throw new Error('MANAGEMENT_ACTION_PLAN_DISPATCH_PROTECTION_MISSING');
  const managementPolicyEvidence=await client.query(`SELECT
    count(*) FILTER(WHERE column_name IN ('policy_version','policy_evidence_hash'))::int AS column_count,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='trade.management_action_frontier'::regclass
      AND conname='management_policy_evidence_shape') AS evidence_shape
    FROM information_schema.columns WHERE table_schema='trade' AND table_name='management_action_frontier'`);
  if(managementPolicyEvidence.rows[0]?.column_count!==2||!managementPolicyEvidence.rows[0]?.evidence_shape)
    throw new Error('MANAGEMENT_POLICY_EVIDENCE_PROTECTION_MISSING');
  const shadowManagementPolicy=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='theta_shadow_management_policy_evidence' AND trigger_name='reject_immutable_mutation') AS immutable_evidence,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_shadow_management_policy_evidence'::regclass
      AND pg_get_constraintdef(oid) LIKE '%execution_authorized = false%') AS execution_locked,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_shadow_management_policy_evidence'::regclass
      AND pg_get_constraintdef(oid) LIKE '%comparison_complete = false%') AS comparison_locked`);
  if(!shadowManagementPolicy.rows[0]?.immutable_evidence||!shadowManagementPolicy.rows[0]?.execution_locked||
    !shadowManagementPolicy.rows[0]?.comparison_locked)
    throw new Error('SHADOW_MANAGEMENT_POLICY_PROTECTION_MISSING');
  const paperEvidenceAuthorization=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='trade' AND table_name='order_intent'
      AND column_name='execution_tier') AS tier,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='trade' AND table_name='order_intent'
      AND constraint_name='order_intent_paper_evidence_quantity_reduces_only') AS reduces_only,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='trade' AND table_name='order_intent'
      AND constraint_name='order_intent_submitted_quantity_matches_evidence') AS quantity_matches`);
  if(!paperEvidenceAuthorization.rows[0]?.tier||!paperEvidenceAuthorization.rows[0]?.reduces_only||
    !paperEvidenceAuthorization.rows[0]?.quantity_matches)throw new Error('PAPER_EVIDENCE_AUTHORIZATION_PROTECTION_MISSING');
  const runtimeBehaviorProtection=await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table='theta_runtime_behavior_diagnostic'
      AND trigger_name='reject_immutable_mutation') AS immutable_diagnostic`);
  if(!runtimeBehaviorProtection.rows[0]?.immutable_diagnostic)
    throw new Error('RUNTIME_BEHAVIOR_DIAGNOSTIC_PROTECTION_MISSING');
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
  const chainDecisionProtection = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND trigger_name='reject_immutable_mutation' AND event_object_table='theta_option_chain_decision_evidence') AS immutable_chain,
    EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='research'
      AND table_name='theta_option_chain_decision_evidence' AND constraint_type='CHECK'
      AND constraint_name IS NOT NULL) AS chain_checks`);
  if (!chainDecisionProtection.rows[0]?.immutable_chain || !chainDecisionProtection.rows[0]?.chain_checks)
    throw new Error("OPTION_CHAIN_DECISION_PROTECTION_MISSING");
  const resolvedOutcomeProtection=await client.query(`SELECT
    (SELECT count(DISTINCT event_object_table)::int FROM information_schema.triggers WHERE trigger_schema='research'
      AND trigger_name='reject_immutable_mutation' AND event_object_table IN
      ('theta_outcome_subject','theta_outcome_observation','theta_outcome_resolution_receipt','theta_resolved_outcome_label','theta_policy_challenger_evaluation','theta_policy_learning_record')) AS immutable_tables,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='research'
      AND table_name='theta_resolved_outcome_label' AND constraint_type='CHECK') AS label_checks`);
  if(Number(resolvedOutcomeProtection.rows[0]?.immutable_tables)!==6||!resolvedOutcomeProtection.rows[0]?.label_checks)
    throw new Error('RESOLVED_OUTCOME_PROTECTION_MISSING');
  const p2eProtection=await client.query(`SELECT
    (SELECT count(DISTINCT event_object_table)::int FROM information_schema.triggers WHERE trigger_name='reject_immutable_mutation'
      AND ((trigger_schema='research' AND event_object_table IN ('theta_position_path_checkpoint','theta_action_inaction_frontier','theta_strategy_timing_snapshot'))
        OR (trigger_schema='ops' AND event_object_table='theta_operator_control_event'))) AS immutable_tables,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema IN ('research','ops')
      AND table_name IN ('theta_position_path_checkpoint','theta_action_inaction_frontier','theta_strategy_timing_snapshot','theta_operator_control_event')
      AND column_name='execution_authorized' AND column_default='false') AS locked_execution_columns,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='research' AND table_name='theta_policy_learning_record'
      AND column_name='return_cohort_definition_version') AS cohort_versioned`);
  if(Number(p2eProtection.rows[0]?.immutable_tables)!==4||Number(p2eProtection.rows[0]?.locked_execution_columns)!==4||
    !p2eProtection.rows[0]?.cohort_versioned)throw new Error('P2E_TIME_PATH_PROTECTION_MISSING');
  const p2fProtection=await client.query(`SELECT
    (SELECT count(DISTINCT event_object_table)::int FROM information_schema.triggers
      WHERE trigger_name='reject_immutable_mutation' AND
        ((trigger_schema='research' AND event_object_table IN
          ('optionomics_provider_qualification_receipt','quote_provider_qualification_receipt'))
        OR (trigger_schema='ops' AND event_object_table='theta_alert_event'))) AS immutable_tables,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='ops'
      AND table_name='theta_operator_control_event' AND column_name='state_version' AND is_nullable='NO') AS state_versioned,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='ops' AND tablename='theta_operator_control_event'
      AND indexname='ux_theta_operator_control_state_version') AS state_version_unique,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='research'
      AND table_name='theta_position_path_checkpoint' AND column_name='checkpoint_reason' AND is_nullable='NO') AS semantic_checkpoints`);
  if(Number(p2fProtection.rows[0]?.immutable_tables)!==3||!p2fProtection.rows[0]?.state_versioned||
    !p2fProtection.rows[0]?.state_version_unique||!p2fProtection.rows[0]?.semantic_checkpoints)
    throw new Error('P2F_PROVIDER_ACTIVATION_PROTECTION_MISSING');
  const p2gProtection=await client.query(`SELECT
    (SELECT count(DISTINCT event_object_table)::int FROM information_schema.triggers WHERE trigger_schema='research'
      AND trigger_name='reject_immutable_mutation' AND event_object_table IN
      ('theta_synthetic_lifecycle_receipt','theta_paper_order_preview_receipt','optionomics_family_health_observation')) AS immutable_tables,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_synthetic_lifecycle_receipt'::regclass
      AND pg_get_constraintdef(oid) LIKE '%real_paper_evidence = false%') AS simulated_not_real,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_paper_order_preview_receipt'::regclass
      AND pg_get_constraintdef(oid) LIKE '%submit_to_broker = false%') AS preview_never_submits`);
  if(Number(p2gProtection.rows[0]?.immutable_tables)!==3||!p2gProtection.rows[0]?.simulated_not_real||
    !p2gProtection.rows[0]?.preview_never_submits)throw new Error('P2G_SIMULATION_PREVIEW_PROTECTION_MISSING');
  const fillFees = await client.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='trade' AND table_name='fill' AND column_name='fees'");
  if (fillFees.rows[0]?.is_nullable !== "YES" || fillFees.rows[0]?.column_default !== null)
    throw new Error("UNKNOWN_FILL_FEES_COERCED_TO_ZERO");
  const brokerCashColumns=await client.query(`SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='broker_activity_fact'
      AND column_name IN ('net_amount','per_share_amount') AND is_nullable='YES' AND column_default IS NULL`);
  if(Number(brokerCashColumns.rows[0]?.count)!==2)throw new Error('BROKER_CASH_ACTIVITY_EVIDENCE_MISSING');
  const terminalPartialClose = await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
      AND event_object_table='option_partial_close_realization' AND trigger_name='reject_immutable_mutation') AS immutable,
    EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='trade'
      AND table_name='option_partial_close_realization' AND constraint_type='UNIQUE') AS replay_guard`);
  if(!terminalPartialClose.rows[0]?.immutable||!terminalPartialClose.rows[0]?.replay_guard)
    throw new Error('TERMINAL_PARTIAL_CLOSE_PROTECTION_MISSING');
  const latestPaperProtections = await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='trade' AND tablename='order_intent'
      AND indexname='ix_order_intent_restart_recovery') AS restart_recovery_index,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='trade.execution_account'::regclass
      AND conname='execution_account_paper_only_check' AND convalidated) AS paper_only_execution_account,
    EXISTS(SELECT 1 FROM core.schema_migration
      WHERE version='061_paper_execution_control_normalization') AS control_normalization_applied`);
  if(!latestPaperProtections.rows[0]?.restart_recovery_index)
    throw new Error('PAPER_RESTART_RECOVERY_INDEX_MISSING');
  if(!latestPaperProtections.rows[0]?.paper_only_execution_account)
    throw new Error('EXECUTION_ACCOUNT_PAPER_ONLY_PROTECTION_MISSING');
  if(!latestPaperProtections.rows[0]?.control_normalization_applied)
    throw new Error('PAPER_EXECUTION_CONTROL_NORMALIZATION_MISSING');
  const gate = executionControl.rows[0];
  const locked=gate?.pause_new_orders===true&&gate?.master_execution_enabled===false&&gate?.follower_execution_enabled===false;
  const ownerAuthorized=gate?.master_execution_enabled===true&&gate?.follower_execution_enabled===false
    &&typeof gate?.authorization_event_id==='string';
  if (!locked&&!ownerAuthorized) throw new Error("PAPER_EXECUTION_AUTHORIZATION_INVALID");
  const activeFollowers = await client.query("SELECT count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL AND account_role='FOLLOWER_THETA_PAPER'");
  const activeMasters = await client.query("SELECT count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL AND account_role='MASTER_THETA_PAPER'");
  const activeCredentials = await client.query("SELECT count(*)::int AS count FROM copy.alpaca_oauth_token WHERE revoked_at IS NULL");
  const roles = await client.query("SELECT account_role, count(*)::int AS count FROM copy.follower_account WHERE disconnected_at IS NULL GROUP BY account_role");
  const orderCount = await client.query("SELECT count(*)::int AS count FROM trade.broker_order");
  const optionomicsTemporalCount = await client.query("SELECT count(*)::int AS count FROM research.optionomics_temporal_feature_observation");
  const shadowCounts=await client.query(`SELECT
    (SELECT count(*)::int FROM research.theta_shadow_order_intent) AS intents,
    (SELECT count(*)::int FROM research.theta_shadow_fill) AS fills,
    (SELECT count(*)::int FROM research.theta_shadow_chain) AS chains,
    (SELECT count(*)::int FROM research.theta_paper_active_baseline_receipt) AS baseline_receipts,
    (SELECT count(*)::int FROM research.theta_near_miss_reevaluation_event) AS near_miss_events`);
  const p2dCounts=await client.query(`SELECT
    (SELECT count(*)::int FROM research.theta_outcome_subject) AS outcome_subjects,
    (SELECT count(*)::int FROM research.theta_resolved_outcome_label) AS resolved_labels,
    (SELECT count(*)::int FROM research.theta_policy_learning_record) AS policy_learning_records`);
  process.stdout.write(JSON.stringify({
    state: "CONNECTED",
    migrations: expected.length,
    requiredTables: required.length,
    privateBetaColumns: 9,
    accountRoles: Object.fromEntries(roles.rows.map((row) => [row.account_role, row.count])),
    selfCopyProtection: "ENFORCED",
    optionalFollowerLimits: "ENFORCED",
    paperExecutionGate: ownerAuthorized?(gate.pause_new_orders?"MANAGEMENT_ONLY":"MASTER_PAPER_ACTIVE"):"LOCKED",
    explicitOptionPositionIntent: "ENFORCED",
    paperExecutionLineage:"ENFORCED",
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
    paperActiveBaselineEvidence:"ENFORCED",
    optionomicsLayeredEvidence:"ENFORCED",
    optionomicsContextLineage:"ENFORCED",
    optionomicsTemporalEvidence:"ENFORCED",
    optionsChainDecisionEvidence:"ENFORCED",
    masterPaperActionHandoff:"ENFORCED",
    managementActionPlanDispatch:"ENFORCED",
    paperEvidenceAuthorization:"ENFORCED",
    runtimeBehaviorDiagnostic:"ENFORCED",
    realLabelMaterialization:"ENFORCED",
    p2eTimePathIntelligence:"ENFORCED",
    p2fProviderActivationReadiness:"ENFORCED",
    p2gSimulationPreviewIsolation:"ENFORCED",
    terminalPartialCloseAccounting:"ENFORCED",
    paperRestartRecovery:"ENFORCED",
    executionAccountPaperOnly:"ENFORCED",
    paperExecutionControlNormalization:"ENFORCED",
    activeFollowers: activeFollowers.rows[0]?.count ?? 0,
    activeMasters: activeMasters.rows[0]?.count ?? 0,
    activeEncryptedCredentials: activeCredentials.rows[0]?.count ?? 0,
    brokerOrders: orderCount.rows[0]?.count ?? 0,
    optionomicsTemporalFeatureRows:optionomicsTemporalCount.rows[0]?.count??0,
    shadowIntents:shadowCounts.rows[0]?.intents??0,
    shadowFills:shadowCounts.rows[0]?.fills??0,
    shadowChains:shadowCounts.rows[0]?.chains??0,
    baselineReceipts:shadowCounts.rows[0]?.baseline_receipts??0,
    nearMissEvents:shadowCounts.rows[0]?.near_miss_events??0,
    outcomeSubjects:p2dCounts.rows[0]?.outcome_subjects??0,
    resolvedOutcomeLabels:p2dCounts.rows[0]?.resolved_labels??0,
    policyLearningRecords:p2dCounts.rows[0]?.policy_learning_records??0,
  }) + "\n");
} finally {
  await client.end();
}
