BEGIN;

ALTER TABLE trade.broker_position_snapshot
  ADD COLUMN IF NOT EXISTS average_entry_price numeric(24,8),
  ADD COLUMN IF NOT EXISTS current_price numeric(24,8),
  ADD COLUMN IF NOT EXISTS market_value numeric(24,8),
  ADD COLUMN IF NOT EXISTS cost_basis numeric(24,8),
  ADD COLUMN IF NOT EXISTS unrealized_pnl numeric(24,8);

CREATE TABLE IF NOT EXISTS trade.management_input_snapshot (
  management_input_snapshot_id uuid PRIMARY KEY,
  previous_management_input_snapshot_id uuid REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  reconciliation_snapshot_id uuid NOT NULL REFERENCES trade.broker_reconciliation_snapshot(reconciliation_snapshot_id),
  fusion_snapshot_id uuid REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  observed_at timestamptz NOT NULL,
  lifecycle_state trade.lifecycle_state NOT NULL,
  input_json jsonb NOT NULL CHECK (jsonb_typeof(input_json) = 'object'),
  unknown_fields_json jsonb NOT NULL CHECK (jsonb_typeof(unknown_fields_json) = 'array'),
  change_json jsonb NOT NULL CHECK (jsonb_typeof(change_json) = 'array'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chain_id, content_hash)
);
CREATE INDEX IF NOT EXISTS ix_management_input_chain
  ON trade.management_input_snapshot(chain_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS trade.management_action_frontier (
  management_action_frontier_id uuid PRIMARY KEY,
  management_input_snapshot_id uuid NOT NULL REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  observed_at timestamptz NOT NULL,
  lifecycle_state trade.lifecycle_state NOT NULL,
  economic_model_state text NOT NULL CHECK (economic_model_state = 'EV_MODEL_NOT_EMPIRICALLY_READY'),
  actions_json jsonb NOT NULL CHECK (jsonb_typeof(actions_json) = 'array'),
  selected_action text,
  second_best_action text,
  decision_state text NOT NULL CHECK (decision_state IN ('ACTION_SELECTED','SYSTEM_HOLD_MISSING_EVIDENCE')),
  reason_codes_json jsonb NOT NULL CHECK (jsonb_typeof(reason_codes_json) = 'array'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(management_input_snapshot_id, content_hash)
);
CREATE INDEX IF NOT EXISTS ix_management_action_frontier_chain
  ON trade.management_action_frontier(chain_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS trade.lifecycle_application (
  lifecycle_application_id uuid PRIMARY KEY,
  evidence_key char(64) NOT NULL UNIQUE CHECK (evidence_key ~ '^[0-9a-f]{64}$'),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  event_kind text NOT NULL CHECK (event_kind IN (
    'SHORT_PUT_ASSIGNMENT','COVERED_CALL_ASSIGNMENT','OPTION_EXPIRATION',
    'OPTION_CLOSE','OPTION_ROLL','COVERED_CALL_OPEN','STOCK_DISPOSAL'
  )),
  provider_activity_ref_hash char(64) CHECK (
    provider_activity_ref_hash IS NULL OR provider_activity_ref_hash ~ '^[0-9a-f]{64}$'
  ),
  transition_path_json jsonb NOT NULL CHECK (jsonb_typeof(transition_path_json) = 'array'),
  applied_at timestamptz NOT NULL,
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lifecycle_application_chain
  ON trade.lifecycle_application(chain_id, applied_at);

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['management_input_snapshot','management_action_frontier','lifecycle_application'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', target);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      target
    );
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version, checksum)
VALUES ('017_management_decision_vertical_slice', repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
