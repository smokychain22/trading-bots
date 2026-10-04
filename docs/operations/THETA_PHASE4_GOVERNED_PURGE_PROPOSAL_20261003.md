# THETA Phase 4: governed purge mechanism (PROPOSAL, not applied)

> **UPDATE 2026-10-03 (cutover preparation):** the exact purge population, its re-verification after a process restart (row parity, 40-row restore samples, schema identity, Parquet readability, replay sample), the per-table method (a governed
> rebuild/swap for the two rebuildable tables, which also re-points `research.option_contract_risk_history`) and the two blockers (no second off-machine durability authority; owner approval) are in `THETA_LEGACY_PURGE_POPULATION_20261003.md`.
> The statement that PostgreSQL then "stays bounded" is superseded by `THETA_DATA_PLATFORM_PERMANENT_GROWTH_DECISION_20261003.md` (measured permanent growth).


Status: **design only**. Nothing in this document has been run against Production, and no file here is under `migrations/` (adding a numbered migration would change the
runtime schema contract, `expectedMaximum 068_action_plan_integrity`, and needs a governed release). It exists because the storage investigation found that the
largest candidate tables are append-only by design.

## Why a mechanism is needed

`trade.fusion_snapshot`, `trade.candidate_point_in_time_evidence`, `trade.decision`, `trade.canonical_strategy_frontier` and the other decision-truth tables carry the
trigger `core.reject_immutable_mutation()` (migrations 003, 018, 031), which raises `55000 append-only` on every UPDATE and DELETE. That is correct for audit
lineage. It also means a purge cannot be done with an ordinary `DELETE`, and nobody should disable the trigger by hand. The mechanism below keeps the trigger on and
adds one narrow, ledgered, receipt-gated exception.

## Design

1. **Receipt table** `storage_governance.archive_receipt` (append-only): `receipt_id`, `population_id`, `source_table`, `cutoff`, `archived_rows`, `population_digest`
   (sha256 over the chunk digests), `archive_location` (outside the database), `source_release_sha`, `verified_at`, `verification_json` (row-count proof, per-day aggregate
   equality, sampled byte-exact restore), `approved_by` and `approval_ref` (the owner's typed approval of the exact population). All NOT NULL.
2. **Purge function** `storage_governance.purge_population(receipt_id uuid, batch_rows int)`: `SECURITY DEFINER`, allowlist of (table, action) pairs only (the six populations),
   refuses unless the receipt exists, is approved, and its table/cutoff match; deletes (or replaces the payload with an archive pointer holding the receipt id and the row
   sha256) in bounded batches of rows older than the cutoff; never touches a row newer than the cutoff or any table outside the allowlist; writes one `purge_ledger` row per
   batch (rows affected, receipt, time). Row counts deleted can never exceed `archived_rows`.
3. **Trigger exception**: `core.reject_immutable_mutation()` is replaced by a version that allows the operation only while the transaction-local setting
   `theta.purge_receipt` names a valid approved receipt for that table (set by the function itself with `SET LOCAL`), and still raises otherwise. Operational tables are not
   in the allowlist and the function has no code path for them.
4. **Verification before and after**: the purge refuses to run unless `tools/theta-storage-archive.ts --mode=verify` produced a receipt for the same digest in the last 24 hours;
   after each batch the tool re-counts the remaining population and confirms the archive still verifies.
5. **Rollback**: a purge is not reversible inside the database; the restore path is the archive plus the verified backup. The function therefore ships with a dry-run mode that
   returns exactly the rows it would touch.

## What this does not do

- It does not shrink `pg_database_size`. PostgreSQL reuses freed pages for new rows; the files shrink only after a physical rewrite (pg_repack or dump and restore), which is
  a separate, disruptive operation that this proposal does not include.
- It does not purge the current-contract cycle archive blobs (all inside the hot window, and the only raw replay source for the running release).

## Approval gate

Execution requires, in order: the owner's approval of the exact candidate population from the dry-run receipt, the migration shipped through the normal governed release,
a fresh verified backup, and a verify receipt. None of these has happened.
