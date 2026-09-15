DO $$
BEGIN
  IF to_regclass('research.theta_option_chain_decision_evidence') IS NULL THEN
    RAISE EXCEPTION 'options-chain decision evidence table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='research'
      AND event_object_table='theta_option_chain_decision_evidence'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'options-chain decision evidence is not immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='research.theta_option_chain_decision_evidence'::regclass
      AND pg_get_constraintdef(oid) LIKE '%execution_authorized = false%'
  ) THEN
    RAISE EXCEPTION 'options-chain decision evidence can gain execution authority';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='research.theta_option_chain_decision_evidence'::regclass
      AND pg_get_constraintdef(oid) LIKE '%empirical_economics_ready = false%'
  ) THEN
    RAISE EXCEPTION 'options-chain decision evidence can claim empirical readiness';
  END IF;
END $$;
