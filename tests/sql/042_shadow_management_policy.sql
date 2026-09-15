DO $$
BEGIN
  IF to_regclass('research.theta_shadow_management_policy_evidence') IS NULL THEN
    RAISE EXCEPTION 'shadow management evidence table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='research'
      AND event_object_table='theta_shadow_management_policy_evidence'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'shadow management evidence is not immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='research.theta_shadow_management_policy_evidence'::regclass
      AND pg_get_constraintdef(oid) LIKE '%execution_authorized = false%'
  ) THEN
    RAISE EXCEPTION 'shadow management evidence can gain execution authority';
  END IF;
END $$;
