# Migration 068 (`068_action_plan_integrity`) production readiness assessment (2026-10-02)

Not applied to Production. All Production checks below were read-only (`BEGIN READ ONLY`, counts only, no connection details recorded).

## What it does
1. `CREATE OR REPLACE FUNCTION trade.reject_master_paper_action_plan_economic_mutation()` (plpgsql). Rejects any UPDATE that changes the
   economic payload columns, re-points an already-set `execution_order_intent_id`, or moves a TERMINAL / QUARANTINED plan to another status.
2. `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER reject_master_paper_action_plan_economic_mutation BEFORE UPDATE ... FOR EACH ROW`
   on `trade.master_paper_action_plan`.
3. A dedupe `UPDATE`: among MANAGEMENT plans in READY / CLAIMED / WAITING_GATE sharing `(plan_json->>'chainId', leg_sequence)`, the newest is kept
   and older ones become QUARANTINED with `last_blockers_json = ["MIGRATION_068_DUPLICATE_PRESUBMIT_PLAN"]` and claim fields cleared.
4. `CREATE UNIQUE INDEX IF NOT EXISTS ux_master_paper_action_plan_management_chain_leg_presubmit` on
   `((plan_json->>'chainId'), leg_sequence)` `WHERE authority_kind='MANAGEMENT' AND status IN ('READY','CLAIMED','WAITING_GATE')`.
5. `INSERT INTO core.schema_migration(version, checksum) ... ON CONFLICT DO NOTHING` (checksum `repeat('0',64)`, the same convention as 067).
Only `trade.master_paper_action_plan` is touched. No column, table or data deletion.

## Locks (measured on the disposable rehearsal)
Table `trade.master_paper_action_plan`: RowExclusiveLock (dedupe UPDATE), ShareRowExclusiveLock (CREATE TRIGGER), ShareLock (non-concurrent
CREATE UNIQUE INDEX, blocks writes for the build). On a re-run where the trigger already exists, `DROP TRIGGER` additionally takes
ACCESS EXCLUSIVE on the table briefly. No lock on any other table. Reads are never blocked except during that brief ACCESS EXCLUSIVE.

## Production state (read-only preflight, runtime authority = Aiven)
Schema head 067; 068 not present. `master_paper_action_plan`: 0 rows, 64 kB total; 0 pre-submit management plans; 0 duplicate groups; no existing
triggers; all 20 columns the trigger function reads exist; 0 locks on the table; 0 transactions older than 30 s. `master_paper_action_plan_event`: 0
rows; `order_intent`: 0 rows. Database size 4.6 GB. (The legacy Neon archive reports an older head, 049, and is not the runtime database.)
Conflict-proof query to re-run immediately before applying:
```sql
SELECT plan_json->>'chainId' AS chain, leg_sequence, count(*)
FROM trade.master_paper_action_plan
WHERE authority_kind='MANAGEMENT' AND status IN ('READY','CLAIMED','WAITING_GATE')
GROUP BY 1,2 HAVING count(*)>1;   -- expect 0 rows
```

## Behaviour properties
- Transactional: yes. The file is `BEGIN; ... COMMIT;` and the runner sends it as one multi-statement query; any failure rolls everything back.
- Retryable: yes. Idempotent (`CREATE OR REPLACE`, `DROP ... IF EXISTS`, `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`); re-applying changed nothing in the rehearsal.
- Expected runtime on Production: milliseconds (empty table; 11 ms on the 10-row rehearsal).
- Failure mode: a duplicate that appears between the dedupe step and the index build (a concurrent insert) would abort and roll back the whole migration; retry succeeds.
- A claimed plan that is older than a newer READY plan for the same chain and leg would be quarantined by the dedupe even if a worker holds its claim. Moot with 0 rows today; apply with the worker idle.

## Reversibility and rollback
Reversible for schema objects; the dedupe data change is not reversed.
```sql
BEGIN;
DROP INDEX IF EXISTS trade.ux_master_paper_action_plan_management_chain_leg_presubmit;
DROP TRIGGER IF EXISTS reject_master_paper_action_plan_economic_mutation ON trade.master_paper_action_plan;
DROP FUNCTION IF EXISTS trade.reject_master_paper_action_plan_economic_mutation();
DELETE FROM core.schema_migration WHERE version='068_action_plan_integrity';
COMMIT;
```
Rollback removes only the trigger, function, index and ledger row and loses no data. Rows that the dedupe quarantined stay QUARANTINED (none in Production today). Rehearsal: rollback returned head 067, 0 triggers, 0 index, 10 of 10 rows intact; re-apply restored 068.

## Worker compatibility
`src/theta/runtime-schema-compatibility.ts` accepts head 067 through 068. The deployed worker (97665fb) runs on 067 today and on 068 in tests. No worker restart is required and neither deploy-then-migrate nor migrate-then-deploy is order-sensitive. Apply while no management plan is being published (outside the scan window) so the brief ShareLock cannot delay a claim.

## Governed path
`npm run db:migrate:production:checkpoint` (`tools/windows/dr/Invoke-ThetaProductionMigration.ps1`): a verified backup with restore parity first (up to 6 h timeout), then the migration against the Aiven authority, then verification. It was not run.

## Rehearsal result (disposable Postgres, schema 067 plus seeded duplicates)
Seeded 10 plans (duplicate READY / CLAIMED / WAITING_GATE for two chains, a SUBMITTED, a TERMINAL, two NEW_RISK). After 068: 3 older duplicates quarantined, the newest kept per chain, NEW_RISK and SUBMITTED / TERMINAL untouched; payload UPDATE rejected; TERMINAL and QUARANTINED resurrection rejected; operational UPDATE allowed; a second pre-submit plan for the same chain and leg rejected; re-apply idempotent; rollback then re-apply clean. DB tests on a database migrated through 068 passed: plan-integrity, management-reprice-store, stock-disposal-lots, management-chain-inflight, lifecycle-application.
