BEGIN;

-- Normalize restored control state against immutable owner authorization.
-- Preserve an active master lane only when a valid PAPER-only authorization
-- event exists. Every other state fails closed. Followers always remain off.
WITH latest_valid_authorization AS (
  SELECT authorization_event_id
  FROM ops.paper_execution_authorization_event
  WHERE account_role='MASTER_THETA_PAPER'
    AND environment='PAPER'
    AND master_submission_authorized
    AND NOT follower_submission_authorized
    AND NOT live_money_authorized
  ORDER BY authorized_at DESC,created_at DESC
  LIMIT 1
), normalized AS (
  SELECT pec.singleton,
    CASE
      WHEN pec.master_execution_enabled AND current_event.authorization_event_id IS NOT NULL
        THEN current_event.authorization_event_id
      WHEN pec.master_execution_enabled
        THEN latest.authorization_event_id
      ELSE pec.authorization_event_id
    END AS authorization_event_id,
    pec.master_execution_enabled AND COALESCE(
      current_event.authorization_event_id,
      latest.authorization_event_id
    ) IS NOT NULL AS master_execution_enabled,
    pec.pause_new_orders OR NOT (
      pec.master_execution_enabled AND COALESCE(
        current_event.authorization_event_id,
        latest.authorization_event_id
      ) IS NOT NULL
    ) AS pause_new_orders
  FROM ops.paper_execution_control pec
  LEFT JOIN ops.paper_execution_authorization_event current_event
    ON current_event.authorization_event_id=pec.authorization_event_id
   AND current_event.account_role='MASTER_THETA_PAPER'
   AND current_event.environment='PAPER'
   AND current_event.master_submission_authorized
   AND NOT current_event.follower_submission_authorized
   AND NOT current_event.live_money_authorized
  LEFT JOIN latest_valid_authorization latest ON true
  WHERE pec.singleton=true
)
UPDATE ops.paper_execution_control pec
SET pause_new_orders=normalized.pause_new_orders,
    master_execution_enabled=normalized.master_execution_enabled,
    follower_execution_enabled=false,
    authorization_event_id=normalized.authorization_event_id,
    changed_by='MIGRATION_061_CONTROL_NORMALIZATION',
    changed_at=now()
FROM normalized
WHERE pec.singleton=normalized.singleton
  AND (pec.pause_new_orders,pec.master_execution_enabled,pec.follower_execution_enabled,pec.authorization_event_id)
    IS DISTINCT FROM
    (normalized.pause_new_orders,normalized.master_execution_enabled,false,normalized.authorization_event_id);

INSERT INTO core.schema_migration(version,checksum)
VALUES('061_paper_execution_control_normalization',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
