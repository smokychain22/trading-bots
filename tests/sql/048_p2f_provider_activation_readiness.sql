DO $$ BEGIN
  IF to_regclass('research.optionomics_provider_qualification_receipt') IS NULL OR
     to_regclass('research.quote_provider_qualification_receipt') IS NULL OR
     to_regclass('ops.theta_alert_event') IS NULL THEN RAISE EXCEPTION 'P2F tables missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='ops' AND table_name='theta_operator_control_event' AND column_name='state_version')
     THEN RAISE EXCEPTION 'operator state version missing'; END IF;
END $$;
