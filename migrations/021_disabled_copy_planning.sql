BEGIN;

ALTER TABLE copy.master_copy_event
  ADD COLUMN IF NOT EXISTS source_broker_activity_fact_id uuid REFERENCES trade.broker_activity_fact(broker_activity_fact_id),
  ADD COLUMN IF NOT EXISTS contract_id text,
  ADD COLUMN IF NOT EXISTS parent_master_copy_event_id text REFERENCES copy.master_copy_event(master_copy_event_id),
  ADD COLUMN IF NOT EXISTS broker_confirmation_kind text
    CHECK (broker_confirmation_kind IN ('FILL','LIFECYCLE_ACTIVITY'));

DO $$ BEGIN
  ALTER TABLE copy.master_copy_event ADD CONSTRAINT master_copy_event_requires_broker_confirmation CHECK (
    broker_confirmation_kind IS NOT NULL AND (
    (broker_confirmation_kind = 'FILL' AND master_fill_id IS NOT NULL AND source_broker_activity_fact_id IS NULL)
    OR
    (broker_confirmation_kind = 'LIFECYCLE_ACTIVITY' AND source_broker_activity_fact_id IS NOT NULL)
  ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE copy.master_copy_event ADD CONSTRAINT master_copy_event_explicit_roll_legs CHECK (
    action NOT IN ('ROLL_CSP','ROLL_CC')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE copy.master_copy_event ADD CONSTRAINT master_copy_event_confirmation_matches_action CHECK (
    (action IN ('OPEN_CSP','REDUCE_CSP','CLOSE_CSP','SELL_STOCK','OPEN_CC','REDUCE_CC','CLOSE_CC')
      AND broker_confirmation_kind='FILL')
    OR
    (action IN ('EXPIRE_CSP','ASSIGN_STOCK','HOLD_STOCK','EXPIRE_CC','CALL_AWAY')
      AND broker_confirmation_kind='LIFECYCLE_ACTIVITY')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE copy.follower_copy_event
  ADD COLUMN IF NOT EXISTS evaluated_at timestamptz,
  ADD COLUMN IF NOT EXISTS risk_execution_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(risk_execution_evidence_json) = 'object');

COMMENT ON COLUMN copy.follower_copy_event.risk_execution_evidence_json IS
  'Follower-specific point-in-time capacity, limits, BBO and copy degradation evidence. Never credentials.';

INSERT INTO core.schema_migration(version,checksum)
VALUES('021_disabled_copy_planning',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
