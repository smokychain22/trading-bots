DO $$
BEGIN
  IF to_regclass('research.theta_policy_learning_record') IS NULL THEN
    RAISE EXCEPTION 'P2D policy learning table missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
    AND event_object_table='theta_policy_learning_record' AND trigger_name='reject_immutable_mutation') THEN
    RAISE EXCEPTION 'P2D policy learning records are mutable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_outcome_subject'::regclass
    AND conname='theta_outcome_subject_exactly_one_source') THEN
    RAISE EXCEPTION 'P2D subject source identity constraint missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='research'
    AND indexname='ux_theta_outcome_resolution_receipt_state_model') THEN
    RAISE EXCEPTION 'P2D restart-idempotent resolution receipt index missing';
  END IF;
END $$;

BEGIN;
INSERT INTO iam.workspace(workspace_id,name) VALUES('46000000-0000-4000-8000-000000000001','p2d-test');
INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status)
VALUES('46000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000001','ALPACA','PAPER','test','ACTIVE');
INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status)
VALUES('46000000-0000-4000-8000-000000000003','46000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000002','p2d-paper','PAPER','ACTIVE');
INSERT INTO market.underlying(underlying_id,symbol,asset_type,exchange)
VALUES('46000000-0000-4000-8000-000000000004','P2D','EQUITY','TEST');
INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id)
VALUES('46000000-0000-4000-8000-000000000005','46000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000003');
INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at)
VALUES('46000000-0000-4000-8000-000000000006','46000000-0000-4000-8000-000000000005',
  '46000000-0000-4000-8000-000000000004','WAIT','2026-09-14T13:00:00Z');

INSERT INTO research.theta_outcome_subject(outcome_subject_id,source_chain_id,subject_id,label_type,
  decision_timestamp,feature_snapshot_hash,candidate_universe_hash,strategy_version,horizon_id,horizon_closes_at,
  resolver_contract_version,execution_authorized,content_hash)
VALUES
('46000000-0000-4000-8000-000000000010','46000000-0000-4000-8000-000000000006','SAME_OCC','SELECTED_CONTRACT_OUTCOME',
 '2026-09-14T14:00:00Z',repeat('a',64),repeat('b',64),'test','ONE_DAY','2026-09-15T14:00:00Z',
 'theta-outcome-resolution-v1',false,repeat('c',64)),
('46000000-0000-4000-8000-000000000011','46000000-0000-4000-8000-000000000006','SAME_OCC','SELECTED_CONTRACT_OUTCOME',
 '2026-09-15T14:00:00Z',repeat('d',64),repeat('e',64),'test','ONE_DAY','2026-09-16T14:00:00Z',
 'theta-outcome-resolution-v1',false,repeat('f',64));

DO $$ BEGIN
  IF (SELECT count(*) FROM research.theta_outcome_subject WHERE subject_id='SAME_OCC')<>2 THEN
    RAISE EXCEPTION 'Monday and Tuesday decisions collided';
  END IF;
END $$;
ROLLBACK;
