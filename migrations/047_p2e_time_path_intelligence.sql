BEGIN;

CREATE TABLE research.theta_position_path_checkpoint (
  position_path_checkpoint_id uuid PRIMARY KEY,
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  management_input_snapshot_id uuid NOT NULL REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  observed_at timestamptz NOT NULL,
  path_classification text NOT NULL CHECK(path_classification IN (
    'NEW_POSITION','EARLY_WINNER','EARLY_LOSER','NORMAL_ADVERSE_MOVE','MATURE_WINNER','WINNER_GIVEBACK',
    'WINNER_TO_LOSER','THESIS_DETERIORATION','ACCELERATING_LOSS','LATE_EXPIRY_LOSS','EVENT_DRIVEN_LOSS',
    'LIQUIDITY_MARK_LOSS','RECOVERY_IMPROVING','RECOVERY_DETERIORATING','STABLE_UNDERWATER','UNKNOWN')),
  checkpoint_json jsonb NOT NULL CHECK(jsonb_typeof(checkpoint_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(management_input_snapshot_id)
);
CREATE INDEX ix_theta_position_path_chain_time ON research.theta_position_path_checkpoint(chain_id,observed_at);

CREATE TABLE research.theta_action_inaction_frontier (
  action_inaction_frontier_id uuid PRIMARY KEY,
  management_input_snapshot_id uuid NOT NULL REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  observed_at timestamptz NOT NULL,
  hold_evidence_state text NOT NULL CHECK(hold_evidence_state IN (
    'HOLD_SUPPORTED','HOLD_WEAK','HOLD_OPPORTUNITY_COST_HIGH','HOLD_DERISK_RECOMMENDED_RESEARCH','HOLD_UNKNOWN')),
  frontier_json jsonb NOT NULL CHECK(jsonb_typeof(frontier_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(management_input_snapshot_id)
);
CREATE INDEX ix_theta_action_inaction_chain_time ON research.theta_action_inaction_frontier(chain_id,observed_at);

CREATE TABLE research.theta_strategy_timing_snapshot (
  strategy_timing_snapshot_id uuid PRIMARY KEY,
  management_input_snapshot_id uuid NOT NULL REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  observed_at timestamptz NOT NULL,
  session_state text NOT NULL,
  option_time_json jsonb NOT NULL CHECK(jsonb_typeof(option_time_json)='object'),
  timing_router_json jsonb NOT NULL CHECK(jsonb_typeof(timing_router_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(management_input_snapshot_id)
);
CREATE INDEX ix_theta_strategy_timing_chain_time ON research.theta_strategy_timing_snapshot(chain_id,observed_at);

CREATE TABLE ops.theta_operator_control_event (
  operator_control_event_id uuid PRIMARY KEY,
  actor_ref_hash char(64) NOT NULL CHECK(actor_ref_hash ~ '^[0-9a-f]{64}$'),
  command text NOT NULL CHECK(command IN ('PAUSE_NEW_ENTRIES','RESUME_NEW_ENTRIES','EMERGENCY_EXECUTION_LOCK')),
  idempotency_key text NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL,
  confirmed boolean NOT NULL,
  previous_state_json jsonb NOT NULL CHECK(jsonb_typeof(previous_state_json)='object'),
  resulting_state_json jsonb NOT NULL CHECK(jsonb_typeof(resulting_state_json)='object'),
  audit_json jsonb NOT NULL CHECK(jsonb_typeof(audit_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE research.theta_policy_learning_record
  ADD COLUMN return_cohort_definition_version text NOT NULL DEFAULT 'theta-return-cohort-v1',
  ADD COLUMN win_rate_aggregation_version text;

COMMENT ON COLUMN research.theta_policy_learning_record.win_rate_cohort IS
  'Aggregate cohort field only. It must remain NULL on individual episode records.';

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['theta_position_path_checkpoint','theta_action_inaction_frontier','theta_strategy_timing_snapshot'] LOOP
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',target);
  END LOOP;
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON ops.theta_operator_control_event
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('047_p2e_time_path_intelligence',repeat('0',64));

COMMIT;
