# Legacy reconstruction provenance graph

Generated: 2026-09-17T10:58:49.906Z
Analyzed code: `04b6d3ebd3ba7eff77f8874d14c9ee1c652aab87`
Manifest hash: `6a6d5d4b371be947327c75133690a3b08361fbf4608407cec58e557461bdd1f3`

## Authority graph

```text
Alpaca Paper broker facts -> reconciliation -> Aiven current broker state
Optionomics supported observations -> immutable raw observation -> normalized features -> Aiven current provider evidence
THETA FusionSnapshot -> candidates/frontiers/decisions -> immutable PIT export -> isolated recovered research history
Git migrations/config -> deterministic schema and version lineage
Neon legacy -> preserved source, direct reads quota-blocked -> future exact dump comparison
```

Current operational authority is Aiven. Alpaca Paper remains broker truth. Optionomics remains intelligence truth only for supported, qualified observations. Neon has historical authority only after exact source evidence is readable.

## Source registry

The manifest registers 148 checksummed sources. This includes 109 immutable research exports, 24 parsed research-output runs, safe worker and operator receipts, current read-only Alpaca reconciliation, current Optionomics capability metadata, Git schema lineage, bounded local search, Git history search, GitHub Actions artifact search, and the authenticated Aiven inventory.

| Source class | Count | Strongest confidence | PIT use |
| --- | ---: | --- | --- |
| LOCAL_EXPORT | 109 | A | ELIGIBLE |
| RESEARCH_OUTPUT | 24 | D | INELIGIBLE |
| WORKER_STATE | 5 | C | UNKNOWN |
| OPERATOR_RECEIPT | 2 | B | UNKNOWN |
| GITHUB_DETERMINISTIC | 1 | A | INELIGIBLE |
| VERCEL_RUNTIME | 1 | A | UNKNOWN |
| OTHER | 4 | D | INELIGIBLE |
| ALPACA_DERIVED | 1 | B | UNKNOWN |
| OPTIONOMICS_DERIVED | 1 | E | UNKNOWN |

## Writer and origin coverage

Every canonical base table through migration 051 appears in the recovery matrix. Current and historical writer paths are captured when literal SQL callsites exist. Empty writer lists identify schema-only, trigger-driven, view-driven, or unresolved historical writers. They are not treated as proof that rows never existed.

| Relation | Insert callsites | Update/delete callsites | Historical references | Source API/event |
| --- | --- | --- | --- | --- |
| copy.alpaca_oauth_state | src/customer/customer-store.ts | src/customer/customer-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.alpaca_oauth_token | src/customer/customer-store.ts | src/customer/customer-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.customer_participation | src/customer/customer-store.ts | src/customer/customer-store.ts<br>src/customer/paper-account-role.ts<br>src/database/master-paper-bootstrap.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_account | src/customer/customer-store.ts | src/customer/customer-store.ts<br>src/customer/paper-account-role.ts<br>src/database/master-paper-bootstrap.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_chain_participation | src/customer/postgres-disabled-copy-planner.ts | src/customer/postgres-disabled-copy-planner.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_chain_participation_event | src/customer/postgres-disabled-copy-planner.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_copy_event | src/customer/postgres-disabled-copy-planner.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_fill | NONE_FOUND | NONE_FOUND | src/customer/postgres-disabled-copy-planner.ts<br>src/database/legacy-recovery-inventory.ts | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| copy.follower_lifecycle_divergence_event | src/customer/postgres-follower-paper-runtime.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_order_intent | src/customer/postgres-disabled-copy-planner.ts | src/customer/postgres-follower-paper-runtime.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| copy.follower_paper_action_plan | src/customer/postgres-follower-paper-runtime.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_paper_action_plan_event | src/customer/postgres-follower-paper-runtime.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_policy | src/customer/customer-store.ts | src/customer/customer-store.ts<br>src/customer/paper-account-role.ts<br>src/database/master-paper-bootstrap.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_reconciliation_event | src/customer/postgres-follower-paper-runtime.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.follower_runtime_checkpoint | src/customer/postgres-follower-paper-runtime.ts | src/customer/postgres-follower-paper-runtime.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.master_copy_event | src/customer/postgres-disabled-copy-planner.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| copy.operator_audit_event | src/customer/customer-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.bot_instance | src/research/master-shadow-context.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.cost_model_version | NONE_FOUND | NONE_FOUND | src/research/postgres-shadow-virtual-trader.ts<br>src/research/production-shadow-runtime.ts | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.execution_version | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.feature_version | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.provider_capability | src/providers/capability-registry.ts | src/providers/capability-registry.ts | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / VERSIONED_PLATFORM_STATE |
| core.provider_connection | src/providers/capability-registry.ts<br>src/research/master-shadow-context.ts | src/providers/capability-registry.ts | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / VERSIONED_PLATFORM_STATE |
| core.provider_operation_registry | src/providers/capability-registry.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / VERSIONED_PLATFORM_STATE |
| core.provider_request | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.risk_limit_version | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.schema_migration | NONE_FOUND | NONE_FOUND | src/customer/database-readiness.ts<br>src/database/legacy-recovery-inventory.ts<br>src/database/target-migration.ts<br>src/database/target-preflight.ts<br>src/database/target-validation.ts<br>tools/database-migrate.mjs<br>tools/database-verify.mjs<br>tools/neon-legacy-method-sweep.mjs | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.strategy_version | src/theta/strategy-version-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.trading_account | src/research/master-shadow-context.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| core.universe_version | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| iam.customer_identity | src/customer/customer-store.ts<br>src/database/master-paper-bootstrap.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| iam.customer_session | src/customer/customer-store.ts | src/customer/customer-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| iam.workspace | src/customer/customer-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| market.execution_quote_observation | src/research/point-in-time-evidence.ts<br>src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| market.option_contract | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / VERSIONED_PLATFORM_STATE |
| market.option_quote_snapshot | NONE_FOUND | NONE_FOUND | src/database/legacy-recovery-inventory.ts<br>src/theta/management-input-state.ts<br>tools/legacy-reconstruction-sweep.ts | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| market.optionomics_feature_observation_link | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| market.optionomics_feature_snapshot | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| market.optionomics_raw_observation | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| market.regime_snapshot | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| market.underlying | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| ops.decision_trigger_evidence | src/theta/decision-trigger-evidence.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| ops.paper_account_role_event | src/customer/paper-account-role.ts<br>src/database/master-paper-bootstrap.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.paper_execution_control | NONE_FOUND | NONE_FOUND | src/database/legacy-recovery-inventory.ts<br>src/database/target-validation.ts<br>tools/database-verify.mjs | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.provider_verification | NONE_FOUND | NONE_FOUND | src/database/legacy-recovery-inventory.ts<br>tools/legacy-reconstruction-sweep.ts | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.runtime_worker_cycle | src/theta/autonomous-runtime.ts | src/theta/autonomous-runtime.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.runtime_worker_event | src/worker/postgres-worker-runtime-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.runtime_worker_lease | src/worker/postgres-worker-runtime-store.ts | src/worker/postgres-worker-runtime-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.runtime_worker_status | src/worker/postgres-worker-runtime-store.ts | src/worker/postgres-worker-runtime-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.scheduler_checkpoint | src/theta/postgres-scheduler-checkpoint-repository.ts | src/theta/postgres-scheduler-checkpoint-repository.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.theta_alert_event | src/ops/theta-alerts.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| ops.theta_operator_control_event | src/customer/operator-control.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / OPERATOR_SCHEDULER_OR_WORKER_EVENT |
| research.model_version | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.optionomics_family_health_observation | src/research/p2g-receipt-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.optionomics_provider_qualification_receipt | src/providers/optionomics-qualification.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / VERSIONED_PLATFORM_STATE |
| research.optionomics_quote_qualification_run | src/theta/optionomics-quote-qualification-runtime.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / VERSIONED_PLATFORM_STATE |
| research.optionomics_temporal_feature_observation | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.quote_provider_qualification_receipt | src/execution/quote-provider-qualification.ts | NONE_FOUND | NONE_FOUND | OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY / VERSIONED_PLATFORM_STATE |
| research.theta_action_inaction_frontier | src/theta/p2e-evidence-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.theta_counterfactual_outcome | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_dataset_export | src/research/postgres-dataset-export.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_execution_observation_job | src/research/shadow-evidence-runtime.ts | src/research/shadow-evidence-runtime.ts<br>src/worker/postgres-worker-runtime-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.theta_near_miss_reevaluation_event | src/research/postgres-shadow-virtual-trader.ts<br>src/theta/autonomous-runtime.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_option_chain_decision_evidence | src/theta/options-chain-decision-intelligence.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.theta_outcome_label | src/research/outcome-resolver.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_outcome_observation | src/research/outcome-resolver.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.theta_outcome_resolution_receipt | src/research/outcome-resolver.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_outcome_subject | src/research/outcome-resolver.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_paper_active_baseline_receipt | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_paper_order_preview_receipt | src/research/p2g-receipt-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| research.theta_policy_challenger_evaluation | NONE_FOUND | NONE_FOUND | src/customer/operator-readiness.ts | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_policy_learning_record | src/research/outcome-resolver.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_position_path_checkpoint | src/theta/p2e-evidence-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| research.theta_replay_observation | src/research/theta-replay.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.theta_replay_outcome_label | src/research/theta-replay.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_resolved_outcome_label | src/research/outcome-resolver.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_runtime_behavior_diagnostic | src/theta/runtime-behavior-diagnostic.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_shadow_account_snapshot | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.theta_shadow_chain | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_shadow_fill | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| research.theta_shadow_lifecycle_event | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_shadow_management_policy_evidence | src/theta/shadow-management-policy.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_shadow_order_event | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| research.theta_shadow_order_intent | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| research.theta_shadow_scan_member | src/research/shadow-evidence-runtime.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_shadow_scan_run | src/research/shadow-evidence-runtime.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_shadow_virtual_account | src/research/postgres-shadow-virtual-trader.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| research.theta_strategy_timing_snapshot | src/theta/p2e-evidence-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| research.theta_synthetic_lifecycle_receipt | src/research/p2g-receipt-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.account_snapshot | src/research/production-shadow-runtime.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.assignment_event | src/theta/postgres-lifecycle-application-store.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / BROKER_RECONCILIATION_EVENT |
| trade.assignment_reconciliation | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| trade.broker_activity_fact | src/execution/broker-reconciliation-worker.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / BROKER_RECONCILIATION_EVENT |
| trade.broker_order | src/execution/broker-reconciliation-worker.ts<br>src/execution/postgres-paper-order-store.ts | src/execution/postgres-trade-update-store.ts | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / BROKER_RECONCILIATION_EVENT |
| trade.broker_order_event | src/execution/broker-reconciliation-worker.ts<br>src/execution/postgres-trade-update-store.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / BROKER_RECONCILIATION_EVENT |
| trade.broker_position_snapshot | src/execution/broker-reconciliation-worker.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / BROKER_RECONCILIATION_EVENT |
| trade.broker_reconciliation_snapshot | src/execution/broker-reconciliation-worker.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.candidate | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.candidate_point_in_time_evidence | src/research/point-in-time-evidence.ts<br>src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.candidate_reason | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.candidate_set | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.candidate_set_evidence | src/research/point-in-time-evidence.ts<br>src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.canonical_strategy_branch_evidence | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.canonical_strategy_candidate_evidence | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.canonical_strategy_frontier | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.decision | src/execution/postgres-master-paper-action-plan-store.ts<br>src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.decision_invalidation_snapshot | src/theta/decision-invalidation.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.decision_reason | src/execution/postgres-master-paper-action-plan-store.ts<br>src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.dividend_event | NONE_FOUND | NONE_FOUND | src/database/legacy-recovery-inventory.ts<br>src/research/outcome-resolver.ts<br>src/theta/management-input-state.ts<br>tools/legacy-reconstruction-sweep.ts | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / VERSIONED_PLATFORM_STATE |
| trade.economic_chain | src/execution/postgres-master-paper-action-plan-store.ts | src/theta/postgres-lifecycle-application-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.execution_account | src/research/master-shadow-context.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.execution_attempt | src/execution/postgres-paper-order-store.ts | src/execution/postgres-paper-order-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.execution_price_event | src/execution/postgres-execution-evidence-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.expiration_event | src/theta/postgres-lifecycle-application-store.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / BROKER_RECONCILIATION_EVENT |
| trade.fee_event | NONE_FOUND | NONE_FOUND | src/customer/operator-readiness.ts<br>src/research/outcome-resolver.ts<br>src/theta/management-input-state.ts | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.fill | src/execution/broker-reconciliation-worker.ts<br>src/execution/postgres-trade-update-store.ts | NONE_FOUND | NONE_FOUND | ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS / BROKER_RECONCILIATION_EVENT |
| trade.fusion_snapshot | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.global_wait_evidence | src/research/point-in-time-evidence.ts<br>src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.lifecycle_application | src/theta/postgres-lifecycle-application-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.lifecycle_transition | src/theta/postgres-lifecycle-application-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.management_action_frontier | src/theta/management-input-state.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.management_decision | NONE_FOUND | NONE_FOUND | src/theta/persistence-repositories.ts | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.management_input_snapshot | src/theta/management-input-state.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT |
| trade.management_opportunity | NONE_FOUND | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.master_paper_action_plan | src/execution/postgres-master-paper-action-plan-store.ts | src/execution/postgres-master-paper-action-plan-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.master_paper_action_plan_event | src/execution/postgres-master-paper-action-plan-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.option_leg | src/theta/postgres-lifecycle-application-store.ts | src/theta/postgres-lifecycle-application-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.order_intent | src/execution/postgres-paper-order-store.ts | src/execution/broker-reconciliation-worker.ts<br>src/execution/postgres-paper-order-store.ts<br>src/execution/postgres-trade-update-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / BROKER_RECONCILIATION_EVENT |
| trade.reconciliation_event | src/execution/broker-reconciliation-worker.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.shadow_opportunity | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.stock_lot | src/theta/postgres-lifecycle-application-store.ts | src/theta/postgres-lifecycle-application-store.ts | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.strategy_route | src/theta/postgres-theta-cycle-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.transaction_cost_analysis | src/execution/postgres-execution-evidence-store.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
| trade.unmatched_broker_fact | src/execution/broker-reconciliation-worker.ts | NONE_FOUND | NONE_FOUND | NONE_DETERMINISTIC_OR_INTERNAL / VERSIONED_PLATFORM_STATE |
