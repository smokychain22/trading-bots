BEGIN;
ALTER TABLE copy.follower_policy
  ADD COLUMN IF NOT EXISTS limit_mode text NOT NULL DEFAULT 'CUSTOM'
    CHECK (limit_mode IN ('RECOMMENDED','CUSTOM')),
  ALTER COLUMN max_bot_capital_pct DROP NOT NULL,
  ALTER COLUMN max_ticker_exposure_pct DROP NOT NULL,
  ALTER COLUMN max_contracts DROP NOT NULL,
  ALTER COLUMN max_daily_loss_usd DROP NOT NULL,
  ALTER COLUMN max_open_positions DROP NOT NULL,
  ALTER COLUMN max_slippage_per_contract_usd DROP NOT NULL,
  ALTER COLUMN min_dte DROP NOT NULL,
  ALTER COLUMN max_dte DROP NOT NULL,
  ALTER COLUMN min_open_interest DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE copy.follower_policy ADD CONSTRAINT recommended_has_no_extra_caps CHECK (
    limit_mode <> 'RECOMMENDED' OR (
      max_bot_capital_pct IS NULL AND max_ticker_exposure_pct IS NULL AND max_contracts IS NULL
      AND max_daily_loss_usd IS NULL AND max_open_positions IS NULL
      AND max_slippage_per_contract_usd IS NULL AND min_dte IS NULL AND max_dte IS NULL
      AND min_open_interest IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
INSERT INTO core.schema_migration(version,checksum) VALUES ('011_optional_follower_limits',repeat('0',64))
ON CONFLICT (version) DO NOTHING;
COMMIT;
