# Legacy reconstruction matrix

Generated: 2026-09-17T09:05:54.997Z
Manifest hash: `b21b47e8246693bc1155c2394e997b014ac8c7879a3deffe370b79f882556ee8`

## Recovery result

- Canonical data families: 134
- Exact original PIT rows already promoted: 25125
- Additional stable identities found only in older exports: 0
- Conflicting stable identities: 230, all retained as source-version metadata and never overwritten
- Unique unresolved parent keys: 1548
- Parent references across child families: 2037
- Local database dumps found: 0
- Relevant GitHub Actions data artifacts found: 0
- Status counts: NEON_ONLY_UNRECOVERABLE_CURRENTLY=101, RECONSTRUCTED_CURRENT_STATE=11, EMPTY_BY_DESIGN=13, RECONSTRUCTED_SCHEMA_ONLY=1, PARTIALLY_RECOVERED=8

The 101 `NEON_ONLY_UNRECOVERABLE_CURRENTLY` classifications refer to missing legacy history, not missing current Aiven functionality. Current runtime rows in those tables remain authoritative in Aiven. No placeholder parent, inferred THETA decision, synthetic fill, reconstructed reason, or unproven label was inserted.

## Complete table-level matrix

| Relation | Origins | PK | Natural key | FK parents | Recovery | Exact | Authoritative | Deterministic | Partial refs | Aiven at sweep | Research | Runtime |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| copy.alpaca_oauth_state | NEON_LEGACY, GIT_SCHEMA | state_hash | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.alpaca_oauth_token | NEON_LEGACY, GIT_SCHEMA | token_secret_id | UNKNOWN | 1 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 1 | NO | YES |
| copy.customer_participation | NEON_LEGACY, GIT_SCHEMA | customer_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| copy.follower_account | NEON_LEGACY, GIT_SCHEMA | follower_account_id | UNKNOWN | 1 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 1 | NO | YES |
| copy.follower_chain_participation | NEON_LEGACY, GIT_SCHEMA | UNKNOWN | UNKNOWN | 3 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_chain_participation_event | NEON_LEGACY, GIT_SCHEMA | participation_event_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_copy_event | NEON_LEGACY, GIT_SCHEMA | follower_copy_event_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_fill | NEON_LEGACY, GIT_SCHEMA | follower_fill_id | UNKNOWN | 1 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_lifecycle_divergence_event | NEON_LEGACY, GIT_SCHEMA | follower_divergence_event_id | event_key | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_order_intent | NEON_LEGACY, GIT_SCHEMA | follower_order_intent_id | client_order_id | 1 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_paper_action_plan | NEON_LEGACY, GIT_SCHEMA | follower_action_plan_id | follower_order_intent_id<br>client_order_id | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_paper_action_plan_event | NEON_LEGACY, GIT_SCHEMA | follower_action_plan_event_id | event_key | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_policy | NEON_LEGACY, GIT_SCHEMA | follower_policy_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_reconciliation_event | NEON_LEGACY, GIT_SCHEMA | follower_reconciliation_event_id | UNKNOWN | 4 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.follower_runtime_checkpoint | NEON_LEGACY, GIT_SCHEMA | follower_account_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.master_copy_event | NEON_LEGACY, GIT_SCHEMA | master_copy_event_id | UNKNOWN | 5 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | NO | YES |
| copy.operator_audit_event | NEON_LEGACY, GIT_SCHEMA | operator_audit_event_id | UNKNOWN | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| core.bot_instance | NEON_LEGACY, GIT_SCHEMA | bot_instance_id | UNKNOWN | 7 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| core.cost_model_version | NEON_LEGACY, GIT_SCHEMA | cost_model_version_id | semantic_version<br>config_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| core.execution_version | NEON_LEGACY, GIT_SCHEMA | execution_version_id | semantic_version<br>config_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| core.feature_version | NEON_LEGACY, GIT_SCHEMA | feature_version_id | semantic_version<br>config_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| core.provider_capability | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | UNKNOWN | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 48 | NO | YES |
| core.provider_connection | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | provider_connection_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 2 | NO | YES |
| core.provider_operation_registry | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | UNKNOWN | UNKNOWN | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 38 | NO | YES |
| core.provider_request | NEON_LEGACY, GIT_SCHEMA | request_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| core.risk_limit_version | NEON_LEGACY, GIT_SCHEMA | risk_limit_version_id | semantic_version<br>config_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| core.schema_migration | NEON_LEGACY, GIT_SCHEMA | version | UNKNOWN | 0 | RECONSTRUCTED_SCHEMA_ONLY | 0 | 0 | 0 | 0 | 51 | NO | YES |
| core.strategy_version | NEON_LEGACY, GIT_SCHEMA | strategy_version_id | semantic_version<br>config_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| core.trading_account | NEON_LEGACY, GIT_SCHEMA | account_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| core.universe_version | NEON_LEGACY, GIT_SCHEMA | universe_version_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| iam.customer_identity | NEON_LEGACY, GIT_SCHEMA | customer_id | email_normalized | 0 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 1 | NO | YES |
| iam.customer_session | NEON_LEGACY, GIT_SCHEMA | session_hash | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| iam.workspace | NEON_LEGACY, GIT_SCHEMA | workspace_id | UNKNOWN | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| market.execution_quote_observation | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | quote_observation_id | content_hash | 2 | PARTIALLY_RECOVERED | 8731 | 8731 | 0 | 126 | 212 | YES | YES |
| market.option_contract | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | option_contract_id | contract_symbol | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 59 | YES | YES |
| market.option_quote_snapshot | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | snapshot_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| market.optionomics_feature_observation_link | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | UNKNOWN | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 31 | YES | YES |
| market.optionomics_feature_snapshot | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | feature_snapshot_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 9 | YES | YES |
| market.optionomics_raw_observation | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | observation_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 31 | YES | YES |
| market.regime_snapshot | NEON_LEGACY, GIT_SCHEMA | regime_snapshot_id | UNKNOWN | 3 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| market.underlying | NEON_LEGACY, GIT_SCHEMA | underlying_id | UNKNOWN | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 2 | YES | YES |
| ops.decision_trigger_evidence | NEON_LEGACY, GIT_SCHEMA | decision_trigger_id | UNKNOWN | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| ops.paper_account_role_event | NEON_LEGACY, GIT_SCHEMA | event_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | NO | YES |
| ops.paper_execution_control | NEON_LEGACY, GIT_SCHEMA | singleton | UNKNOWN | 0 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 1 | NO | YES |
| ops.provider_verification | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | provider_verification_id | UNKNOWN | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| ops.runtime_worker_cycle | NEON_LEGACY, GIT_SCHEMA | worker_cycle_id | correlation_id | 0 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 42 | NO | YES |
| ops.runtime_worker_event | NEON_LEGACY, GIT_SCHEMA | worker_event_id | UNKNOWN | 1 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 25 | NO | YES |
| ops.runtime_worker_lease | NEON_LEGACY, GIT_SCHEMA | lease_key | UNKNOWN | 1 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 1 | NO | YES |
| ops.runtime_worker_status | NEON_LEGACY, GIT_SCHEMA | worker_id | UNKNOWN | 0 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 8 | NO | YES |
| ops.scheduler_checkpoint | NEON_LEGACY, GIT_SCHEMA | job_id | UNKNOWN | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 415 | NO | YES |
| ops.theta_alert_event | NEON_LEGACY, GIT_SCHEMA | alert_event_id | content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| ops.theta_operator_control_event | NEON_LEGACY, GIT_SCHEMA | operator_control_event_id | idempotency_key<br>content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | NO | YES |
| research.model_version | NEON_LEGACY, GIT_SCHEMA | model_version_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.optionomics_family_health_observation | NEON_LEGACY, GIT_SCHEMA | family_health_id | content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.optionomics_provider_qualification_receipt | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | qualification_run_id | evidence_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.optionomics_quote_qualification_run | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | qualification_run_id | content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | YES | NO |
| research.optionomics_temporal_feature_observation | NEON_LEGACY, GIT_SCHEMA | temporal_feature_id | content_hash | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 65 | YES | NO |
| research.quote_provider_qualification_receipt | NEON_LEGACY, GIT_SCHEMA, OPTIONOMICS_OR_PROVIDER_CURRENT | qualification_run_id | evidence_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_action_inaction_frontier | NEON_LEGACY, GIT_SCHEMA | action_inaction_frontier_id | content_hash<br>management_input_snapshot_id | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_counterfactual_outcome | NEON_LEGACY, GIT_SCHEMA | counterfactual_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_dataset_export | NEON_LEGACY, GIT_SCHEMA | dataset_export_id | dataset_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_execution_observation_job | NEON_LEGACY, GIT_SCHEMA | observation_job_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 502 | YES | NO |
| research.theta_near_miss_reevaluation_event | NEON_LEGACY, GIT_SCHEMA | near_miss_event_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_option_chain_decision_evidence | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | chain_decision_evidence_id | fusion_snapshot_id<br>content_hash | 1 | PARTIALLY_RECOVERED | 2 | 2 | 0 | 219 | 9 | YES | NO |
| research.theta_outcome_label | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | outcome_label_id | content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_outcome_observation | NEON_LEGACY, GIT_SCHEMA | outcome_observation_id | content_hash | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_outcome_resolution_receipt | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | outcome_resolution_receipt_id | content_hash | 1 | PARTIALLY_RECOVERED | 112 | 112 | 0 | 0 | 148 | YES | NO |
| research.theta_outcome_subject | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | outcome_subject_id | content_hash<br>CONSTRAINT | 3 | PARTIALLY_RECOVERED | 274 | 274 | 0 | 0 | 617 | YES | NO |
| research.theta_paper_active_baseline_receipt | NEON_LEGACY, GIT_SCHEMA | baseline_receipt_id | scan_id<br>content_hash | 3 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 4 | YES | NO |
| research.theta_paper_order_preview_receipt | NEON_LEGACY, GIT_SCHEMA | preview_receipt_id | receipt_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_policy_challenger_evaluation | NEON_LEGACY, GIT_SCHEMA | policy_challenger_evaluation_id | content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_policy_learning_record | NEON_LEGACY, GIT_SCHEMA | policy_learning_record_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_position_path_checkpoint | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | position_path_checkpoint_id | content_hash<br>management_input_snapshot_id | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_replay_observation | NEON_LEGACY, GIT_SCHEMA | replay_observation_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_replay_outcome_label | NEON_LEGACY, GIT_SCHEMA | replay_outcome_label_id | replay_observation_id | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_resolved_outcome_label | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | resolved_outcome_label_id | outcome_resolution_receipt_id<br>content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_runtime_behavior_diagnostic | NEON_LEGACY, GIT_SCHEMA | diagnostic_id | scan_id<br>content_hash | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 4 | YES | NO |
| research.theta_shadow_account_snapshot | NEON_LEGACY, GIT_SCHEMA | shadow_account_snapshot_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_shadow_chain | NEON_LEGACY, GIT_SCHEMA | shadow_chain_id | opening_intent_id | 3 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_shadow_fill | NEON_LEGACY, GIT_SCHEMA | shadow_fill_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_shadow_lifecycle_event | NEON_LEGACY, GIT_SCHEMA | shadow_lifecycle_event_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_shadow_management_policy_evidence | NEON_LEGACY, GIT_SCHEMA | shadow_policy_evidence_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_shadow_order_event | NEON_LEGACY, GIT_SCHEMA | shadow_order_event_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_shadow_order_intent | NEON_LEGACY, GIT_SCHEMA | shadow_intent_id | content_hash | 7 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_shadow_scan_member | NEON_LEGACY, GIT_SCHEMA | UNKNOWN | UNKNOWN | 3 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 8 | YES | NO |
| research.theta_shadow_scan_run | NEON_LEGACY, GIT_SCHEMA | scan_id | content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 4 | YES | NO |
| research.theta_shadow_virtual_account | NEON_LEGACY, GIT_SCHEMA | shadow_account_id | bot_instance_id | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_strategy_timing_snapshot | NEON_LEGACY, GIT_SCHEMA | strategy_timing_snapshot_id | content_hash<br>management_input_snapshot_id | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| research.theta_synthetic_lifecycle_receipt | NEON_LEGACY, GIT_SCHEMA | simulation_receipt_id | content_hash | 0 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | NO |
| trade.account_snapshot | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | account_snapshot_id | UNKNOWN | 2 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 13 | YES | YES |
| trade.assignment_event | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | assignment_event_id | UNKNOWN | 2 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.assignment_reconciliation | NEON_LEGACY, GIT_SCHEMA | assignment_reconciliation_id | reconciliation_key | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.broker_activity_fact | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | broker_activity_fact_id | UNKNOWN | 1 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 9 | YES | YES |
| trade.broker_order | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | broker_order_id | UNKNOWN | 1 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.broker_order_event | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | broker_order_event_id | UNKNOWN | 1 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.broker_position_snapshot | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | UNKNOWN | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.broker_reconciliation_snapshot | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | reconciliation_snapshot_id | correlation_id | 1 | RECONSTRUCTED_CURRENT_STATE | 0 | 0 | 0 | 0 | 42 | YES | YES |
| trade.candidate | NEON_LEGACY, GIT_SCHEMA | candidate_id | UNKNOWN | 5 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 139 | YES | YES |
| trade.candidate_point_in_time_evidence | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | candidate_id | UNKNOWN | 3 | PARTIALLY_RECOVERED | 7550 | 7550 | 0 | 250 | 139 | YES | YES |
| trade.candidate_reason | NEON_LEGACY, GIT_SCHEMA | candidate_reason_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 656 | YES | YES |
| trade.candidate_set | NEON_LEGACY, GIT_SCHEMA | candidate_set_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 9 | YES | YES |
| trade.candidate_set_evidence | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | candidate_set_id | UNKNOWN | 2 | PARTIALLY_RECOVERED | 302 | 302 | 0 | 0 | 9 | YES | YES |
| trade.canonical_strategy_branch_evidence | NEON_LEGACY, GIT_SCHEMA | branch_evidence_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 45 | YES | YES |
| trade.canonical_strategy_candidate_evidence | NEON_LEGACY, GIT_SCHEMA | candidate_evidence_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 139 | YES | YES |
| trade.canonical_strategy_frontier | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | frontier_id | fusion_snapshot_id<br>content_hash | 1 | PARTIALLY_RECOVERED | 302 | 302 | 0 | 1295 | 9 | YES | YES |
| trade.decision | NEON_LEGACY, GIT_SCHEMA | decision_id | UNKNOWN | 3 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 9 | YES | YES |
| trade.decision_invalidation_snapshot | NEON_LEGACY, GIT_SCHEMA | decision_invalidation_snapshot_id | content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.decision_reason | NEON_LEGACY, GIT_SCHEMA | decision_reason_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 14 | YES | YES |
| trade.dividend_event | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | dividend_event_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.economic_chain | NEON_LEGACY, GIT_SCHEMA | chain_id | UNKNOWN | 2 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.execution_account | NEON_LEGACY, GIT_SCHEMA | execution_account_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 1 | YES | YES |
| trade.execution_attempt | NEON_LEGACY, GIT_SCHEMA | execution_attempt_id | UNKNOWN | 1 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.execution_price_event | NEON_LEGACY, GIT_SCHEMA | execution_price_event_id | content_hash | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.expiration_event | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | expiration_event_id | UNKNOWN | 1 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.fee_event | NEON_LEGACY, GIT_SCHEMA | fee_event_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.fill | NEON_LEGACY, GIT_SCHEMA, ALPACA_CURRENT | fill_id | UNKNOWN | 1 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.fusion_snapshot | NEON_LEGACY, GIT_SCHEMA | fusion_snapshot_id | UNKNOWN | 8 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 9 | YES | YES |
| trade.global_wait_evidence | NEON_LEGACY, GIT_SCHEMA | decision_id | UNKNOWN | 3 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 5 | YES | YES |
| trade.lifecycle_application | NEON_LEGACY, GIT_SCHEMA | lifecycle_application_id | evidence_key | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.lifecycle_transition | NEON_LEGACY, GIT_SCHEMA | lifecycle_transition_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.management_action_frontier | NEON_LEGACY, GIT_SCHEMA | management_action_frontier_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.management_decision | NEON_LEGACY, GIT_SCHEMA | management_decision_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.management_input_snapshot | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | management_input_snapshot_id | UNKNOWN | 4 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.management_opportunity | NEON_LEGACY, GIT_SCHEMA | entry_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.master_paper_action_plan | NEON_LEGACY, GIT_SCHEMA | action_plan_id | decision_id<br>content_hash | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.master_paper_action_plan_event | NEON_LEGACY, GIT_SCHEMA | action_plan_event_id | UNKNOWN | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.option_leg | NEON_LEGACY, GIT_SCHEMA | option_leg_id | UNKNOWN | 4 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.order_intent | NEON_LEGACY, GIT_SCHEMA | order_intent_id | client_order_id | 4 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.reconciliation_event | NEON_LEGACY, GIT_SCHEMA | reconciliation_event_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.shadow_opportunity | NEON_LEGACY, GIT_SCHEMA, LOCAL_RESEARCH_EXPORT | opportunity_id | UNKNOWN | 1 | PARTIALLY_RECOVERED | 7852 | 7852 | 0 | 147 | 139 | YES | YES |
| trade.stock_lot | NEON_LEGACY, GIT_SCHEMA | stock_lot_id | UNKNOWN | 3 | EMPTY_BY_DESIGN | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.strategy_route | NEON_LEGACY, GIT_SCHEMA | strategy_route_id | fusion_snapshot_id | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 5 | YES | YES |
| trade.transaction_cost_analysis | NEON_LEGACY, GIT_SCHEMA | transaction_cost_analysis_id | order_intent_id<br>content_hash | 1 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 0 | YES | YES |
| trade.unmatched_broker_fact | NEON_LEGACY, GIT_SCHEMA | unmatched_broker_fact_id | UNKNOWN | 2 | NEON_ONLY_UNRECOVERABLE_CURRENTLY | 0 | 0 | 0 | 0 | 11 | YES | YES |
