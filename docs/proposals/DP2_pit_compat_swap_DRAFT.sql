-- DRAFT (not applied, not under migrations/): the point-in-time evidence COMPATIBILITY SWAP. Applied only at the AUTHORITATIVE cutover of the PIT writer (never earlier, never with the
-- dual-write window still open), after the bounded dual-write protocol recorded CUTOVER_AT with zero mismatches (see src/storage/data-platform/pit-writer.ts).
--
-- Every existing consumer (dataset export, outcome resolution, replay export, risk-policy study, IV stress, readiness) reads `trade.candidate_point_in_time_evidence`. After the swap that
-- name is a VIEW over the old rows (renamed table, immutable, untouched) plus the new normalized rows rebuilt exactly (dp.candidate_point_in_time_evidence_v). No consumer changes its
-- SQL, no consumer needs the legacy table by name, and the legacy writer (kept only for rollback) targets the renamed table.
--
-- IMPORTANT: after this swap `DROP SCHEMA dp CASCADE` is NO LONGER a safe downgrade (it would take the compat view and the views built on it with it). Roll back with
-- rollbackAuthoritativeAndSwap (src/storage/data-platform/pit-writer.ts), which copies the new rows back, re-points the dependent views and restores the names.
--
-- Rollback (manual form): DROP VIEW, rename the table back. New rows written while AUTHORITATIVE exist only in dp.* and are rebuilt by the view; to roll back WITHOUT losing them, first run
-- INSERT INTO trade.candidate_point_in_time_evidence_legacy SELECT <33 columns> FROM dp.candidate_point_in_time_evidence_v WHERE candidate_id NOT IN (SELECT candidate_id FROM ..._legacy).

BEGIN;
DO $$
BEGIN
  IF to_regclass('dp.candidate_point_in_time_evidence_v') IS NULL THEN RAISE EXCEPTION 'MIGRATION_069_REQUIRED'; END IF;
  IF to_regclass('trade.candidate_point_in_time_evidence_legacy') IS NOT NULL THEN RAISE EXCEPTION 'PIT_COMPAT_SWAP_ALREADY_APPLIED'; END IF;
  IF (SELECT relkind FROM pg_class WHERE oid = 'trade.candidate_point_in_time_evidence'::regclass) <> 'r' THEN RAISE EXCEPTION 'PIT_TABLE_NOT_A_PLAIN_TABLE'; END IF;
END $$;

-- Views that read the table (production has research.option_contract_risk_history, migration 062) follow the RENAMED table by OID, so they would silently serve only the legacy rows.
-- Capture their definitions now; they are re-created against the unchanged name (the new view) below. Only plain views are handled: anything else fails the migration (nothing is applied).
CREATE TEMP TABLE pit_swap_dependents ON COMMIT DROP AS
SELECT DISTINCT n.nspname AS schema_name, c.relname AS view_name, pg_get_viewdef(c.oid, true) AS definition, c.relkind
FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE d.refobjid = 'trade.candidate_point_in_time_evidence'::regclass AND d.classid = 'pg_rewrite'::regclass AND c.oid <> d.refobjid;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pit_swap_dependents WHERE relkind <> 'v') THEN RAISE EXCEPTION 'PIT_COMPAT_SWAP_UNSUPPORTED_DEPENDENT_OBJECT'; END IF;
END $$;

ALTER TABLE trade.candidate_point_in_time_evidence RENAME TO candidate_point_in_time_evidence_legacy;
ALTER INDEX IF EXISTS trade.ix_candidate_pit_decision RENAME TO ix_candidate_pit_decision_legacy;

CREATE VIEW trade.candidate_point_in_time_evidence AS
SELECT candidate_id, decision_id, fusion_snapshot_id, decision_time, branch, rank_at_decision, selected, hard_status, soft_status, rejection_reason, contract_json, market_json, volatility_json,
  technical_json, event_json, flow_json, ownership_json, account_json, portfolio_json, aegis_json, execution_json, known_economics_json, unknown_economics_json, hard_blockers_json, soft_evidence_json,
  provider_provenance_json, strategy_version, risk_version, feature_version, cost_model_version, regime_version, execution_model_version, content_hash, created_at
FROM trade.candidate_point_in_time_evidence_legacy
UNION ALL
SELECT candidate_id, decision_id, fusion_snapshot_id, decision_time, branch, rank_at_decision, selected, hard_status, soft_status, rejection_reason, contract_json, market_json, volatility_json,
  technical_json, event_json, flow_json, ownership_json, account_json, portfolio_json, aegis_json, execution_json, known_economics_json, unknown_economics_json, hard_blockers_json, soft_evidence_json,
  provider_provenance_json, strategy_version, risk_version, feature_version, cost_model_version, regime_version, execution_model_version, content_hash, created_at
FROM dp.candidate_point_in_time_evidence_v v
WHERE NOT EXISTS (SELECT 1 FROM trade.candidate_point_in_time_evidence_legacy l WHERE l.candidate_id = v.candidate_id);

-- re-point every dependent view at the unchanged name (CREATE OR REPLACE keeps owner, grants and options; the column list is identical by construction)
DO $$
DECLARE dependent record;
BEGIN
  FOR dependent IN SELECT * FROM pit_swap_dependents LOOP
    EXECUTE format('CREATE OR REPLACE VIEW %I.%I AS %s', dependent.schema_name, dependent.view_name, dependent.definition);
  END LOOP;
END $$;
COMMIT;
