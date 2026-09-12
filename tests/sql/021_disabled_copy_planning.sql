\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  BEGIN
    INSERT INTO copy.master_copy_event(master_copy_event_id,master_bot_instance_id,action,symbol,
      master_quantity,master_filled_quantity,occurred_at,payload_hash)
    VALUES('unconfirmed-master-event','00000000-0000-0000-0000-000000000204','OPEN_CSP','SYN',
      1,1,'2026-09-10T14:00:00Z',repeat('b',64));
    RAISE EXCEPTION 'unconfirmed master copy event was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='copy'
    AND table_name='follower_copy_event' AND column_name='risk_execution_evidence_json') THEN
    RAISE EXCEPTION 'follower evidence column missing';
  END IF;
END;
$$;

ROLLBACK;
