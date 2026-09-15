DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'theta_outcome_subject','theta_outcome_observation','theta_outcome_resolution_receipt',
    'theta_resolved_outcome_label','theta_policy_challenger_evaluation'
  ] LOOP
    IF to_regclass('research.'||target) IS NULL THEN RAISE EXCEPTION 'missing P2C table %',target; END IF;
    IF NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
      AND event_object_table=target AND trigger_name='reject_immutable_mutation') THEN
      RAISE EXCEPTION 'P2C table % is mutable',target;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_resolved_outcome_label'::regclass
    AND pg_get_constraintdef(oid) LIKE '%label_available_at > decision_timestamp%') THEN
    RAISE EXCEPTION 'resolved label causality constraint missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_resolved_outcome_label'::regclass
    AND pg_get_constraintdef(oid) LIKE '%execution_authorized = false%') THEN
    RAISE EXCEPTION 'resolved labels can authorize execution';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_policy_challenger_evaluation'::regclass
    AND pg_get_constraintdef(oid) LIKE '%promoted = false%') THEN
    RAISE EXCEPTION 'challenger evaluation can self-promote';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='research.theta_outcome_subject'::regclass
    AND conname='theta_outcome_subject_decision_identity'
    AND pg_get_constraintdef(oid) LIKE '%decision_timestamp%') THEN
    RAISE EXCEPTION 'outcome subject identity does not distinguish repeated decisions';
  END IF;
END $$;
