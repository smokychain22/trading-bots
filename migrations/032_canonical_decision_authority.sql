BEGIN;

ALTER TABLE trade.canonical_strategy_frontier
  ADD COLUMN decision_authority_version text NOT NULL DEFAULT 'theta-canonical-decision-authority-v1',
  ADD COLUMN primary_action text NOT NULL DEFAULT 'SYSTEM_HOLD',
  ADD COLUMN selected_quantity integer NOT NULL DEFAULT 0 CHECK(selected_quantity >= 0),
  ADD COLUMN empirical_utility_state text NOT NULL DEFAULT 'UNKNOWN_NOT_YET_CALIBRATED'
    CHECK(empirical_utility_state = 'UNKNOWN_NOT_YET_CALIBRATED');

ALTER TABLE trade.decision
  ADD COLUMN decision_authority_version text;

INSERT INTO core.schema_migration(version,checksum)
VALUES('032_canonical_decision_authority',repeat('0',64));

COMMIT;
