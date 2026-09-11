DO $$
BEGIN
  IF to_regclass('trade.broker_position_snapshot') IS NULL THEN
    RAISE EXCEPTION 'broker_position_snapshot missing';
  END IF;
  IF to_regclass('trade.broker_activity_fact') IS NULL THEN
    RAISE EXCEPTION 'broker_activity_fact missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='trade.broker_position_snapshot'::regclass
      AND tgname='reject_immutable_mutation' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'broker position immutability trigger missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='trade.broker_activity_fact'::regclass
      AND tgname='protect_broker_activity_fact' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'broker activity protection trigger missing'; END IF;
END $$;
