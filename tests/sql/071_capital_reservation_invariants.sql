BEGIN;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['capital_envelope','capital_reservation','capital_reservation_event'] LOOP
    IF to_regclass('trade.'||target) IS NULL THEN RAISE EXCEPTION 'CAPITAL_TABLE_MISSING:%',target; END IF;
  END LOOP;
  IF to_regclass('trade.ux_capital_reservation_decision') IS NULL
    OR to_regclass('trade.ix_capital_reservation_active') IS NULL
  THEN RAISE EXCEPTION 'CAPITAL_IDEMPOTENCY_OR_ACTIVE_INDEX_MISSING'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
      AND tgrelid IN ('trade.capital_envelope'::regclass,'trade.capital_reservation_event'::regclass)
      AND tgname='reject_immutable_mutation' AND tgenabled='O') <> 2
  THEN RAISE EXCEPTION 'CAPITAL_EVIDENCE_IMMUTABILITY_MISSING'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
      AND tgrelid='trade.capital_reservation'::regclass AND tgname='guard_capital_reservation_identity' AND tgenabled='O')
  THEN RAISE EXCEPTION 'CAPITAL_RESERVATION_IDENTITY_GUARD_MISSING'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid='trade.capital_reservation'::regclass AND contype='f')<>3
  THEN RAISE EXCEPTION 'CAPITAL_ACCOUNT_ENVELOPE_INTENT_LINEAGE_MISSING'; END IF;
END $$;
ROLLBACK;
