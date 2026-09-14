DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ops.runtime_worker_status
    WHERE runtime_mode = 'MASTER_THETA_PAPER'
      AND execution_gate = 'EXTERNAL_QUOTE_BLOCKER'
  ) AND EXISTS (SELECT 1 FROM ops.runtime_worker_status) THEN
    RAISE EXCEPTION 'existing runtime worker was not migrated to master Paper mode';
  END IF;

  BEGIN
    INSERT INTO ops.runtime_worker_status(
      worker_id, lease_key, host_id, host_type, runtime_mode, build_sha,
      runtime_version, policy_version, started_at, last_heartbeat,
      execution_gate, state, database_health
    ) VALUES (
      'invalid-live-runtime-test', 'invalid-live-runtime-test', 'test', 'LOCAL_LAPTOP',
      'LIVE', '0000000', 'test', 'test', now(), now(), 'LOCKED', 'OFFLINE', 'GOOD'
    );
    RAISE EXCEPTION 'live runtime mode was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;
