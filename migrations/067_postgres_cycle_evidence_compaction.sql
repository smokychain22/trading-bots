BEGIN;

ALTER TABLE trade.fusion_snapshot
  ADD COLUMN IF NOT EXISTS storage_contract_version text,
  ADD COLUMN IF NOT EXISTS snapshot_projection_hash char(64),
  ADD COLUMN IF NOT EXISTS evidence_archive_gzip bytea,
  ADD COLUMN IF NOT EXISTS evidence_archive_hash char(64),
  ADD COLUMN IF NOT EXISTS evidence_archive_uncompressed_bytes bigint,
  ADD COLUMN IF NOT EXISTS evidence_archive_compressed_bytes bigint,
  ADD COLUMN IF NOT EXISTS full_contract_count integer,
  ADD COLUMN IF NOT EXISTS projected_contract_count integer;

ALTER TABLE trade.fusion_snapshot
  DROP CONSTRAINT IF EXISTS ck_fusion_snapshot_projection_hash,
  ADD CONSTRAINT ck_fusion_snapshot_projection_hash CHECK (
    snapshot_projection_hash IS NULL OR snapshot_projection_hash ~ '^[0-9a-f]{64}$'),
  DROP CONSTRAINT IF EXISTS ck_fusion_snapshot_archive_hash,
  ADD CONSTRAINT ck_fusion_snapshot_archive_hash CHECK (
    evidence_archive_hash IS NULL OR evidence_archive_hash ~ '^[0-9a-f]{64}$'),
  DROP CONSTRAINT IF EXISTS ck_fusion_snapshot_storage_counts,
  ADD CONSTRAINT ck_fusion_snapshot_storage_counts CHECK (
    (full_contract_count IS NULL AND projected_contract_count IS NULL)
    OR (full_contract_count >= 0 AND projected_contract_count >= 0
      AND projected_contract_count <= full_contract_count)),
  DROP CONSTRAINT IF EXISTS ck_fusion_snapshot_archive_bytes,
  ADD CONSTRAINT ck_fusion_snapshot_archive_bytes CHECK (
    (evidence_archive_uncompressed_bytes IS NULL AND evidence_archive_compressed_bytes IS NULL)
    OR (evidence_archive_uncompressed_bytes > 0 AND evidence_archive_compressed_bytes > 0
      AND evidence_archive_compressed_bytes <= evidence_archive_uncompressed_bytes));

ALTER TABLE trade.canonical_strategy_frontier
  ADD COLUMN IF NOT EXISTS storage_contract_version text,
  ADD COLUMN IF NOT EXISTS frontier_projection_hash char(64);

ALTER TABLE trade.decision
  ADD COLUMN IF NOT EXISTS receipt_storage_contract_version text,
  ADD COLUMN IF NOT EXISTS receipt_projection_hash char(64);

INSERT INTO core.schema_migration(version, checksum)
VALUES('067_postgres_cycle_evidence_compaction', repeat('0',64))
ON CONFLICT DO NOTHING;

COMMIT;
