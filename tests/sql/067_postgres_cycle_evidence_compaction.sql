DO $$
DECLARE
  fusion_columns integer;
  frontier_columns integer;
  decision_columns integer;
BEGIN
  SELECT count(*) INTO fusion_columns
  FROM information_schema.columns
  WHERE table_schema='trade' AND table_name='fusion_snapshot'
    AND column_name IN (
      'storage_contract_version','snapshot_projection_hash','evidence_archive_gzip','evidence_archive_hash',
      'evidence_archive_uncompressed_bytes','evidence_archive_compressed_bytes',
      'full_contract_count','projected_contract_count'
    );
  IF fusion_columns <> 8 THEN RAISE EXCEPTION 'fusion snapshot compaction columns missing'; END IF;

  SELECT count(*) INTO frontier_columns
  FROM information_schema.columns
  WHERE table_schema='trade' AND table_name='canonical_strategy_frontier'
    AND column_name IN ('storage_contract_version','frontier_projection_hash');
  IF frontier_columns <> 2 THEN RAISE EXCEPTION 'frontier compaction columns missing'; END IF;

  SELECT count(*) INTO decision_columns
  FROM information_schema.columns
  WHERE table_schema='trade' AND table_name='decision'
    AND column_name IN ('receipt_storage_contract_version','receipt_projection_hash');
  IF decision_columns <> 2 THEN RAISE EXCEPTION 'decision compaction columns missing'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.fusion_snapshot'::regclass AND conname='ck_fusion_snapshot_projection_hash')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.fusion_snapshot'::regclass AND conname='ck_fusion_snapshot_archive_hash')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.fusion_snapshot'::regclass AND conname='ck_fusion_snapshot_storage_counts')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.fusion_snapshot'::regclass AND conname='ck_fusion_snapshot_archive_bytes') THEN
    RAISE EXCEPTION 'fusion snapshot compaction constraints missing';
  END IF;
END $$;
