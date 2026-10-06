# THETA data platform: cutover runbook (staged, bounded, reversible until the purge)

Status: **prepared, not executed.** Production runtime, schema and data are unchanged. Nothing in this runbook deploys migration 069, enables a flag, purges, or pushes. Every stage below
needs the owner's explicit go for that stage (governed release flow: evidence regeneration, two CI runs, fast-forward main, Worker cutover).

## The rule that makes this safe

Every new behavior is OFF by default and is switched on by one environment flag that the previous stage proves is safe. A stage is never skipped and never overlaps the next one for longer than its
bounded window. Operational truth (orders, fills, broker reconciliation, execution state, positions, inventory, risk, management, safety events, action-plan lineage) is **never** an input to any storage
gate: this is enforced structurally (`tests/phase4-storage-gate-wiring.test.ts` fails if an operational module imports the pressure modules).

| Flag | Meaning | Default |
|---|---|---|
| `THETA_STORAGE_GOVERNOR=1` | bulk research writers and the new-risk entry gate consult `dp.storage_pressure_state` (absent/stale/malformed is `STORAGE_PRESSURE_UNKNOWN`: research throttled, new risk restricted, locked after 72 h unknown, management never affected) | off |
| `THETA_PIT_STORAGE_MODE=OFF/SHADOW/DUAL_WRITE_VALIDATE/AUTHORITATIVE` | point-in-time evidence writer mode; capped by the bounded ledger (`dp.dual_write_ledger`) | OFF |
| `THETA_PIT_COMPACT_REJECTED=1` | AUTHORITATIVE only: ordinary rejected rows keep identity, reason, hash | off |
| `THETA_DATA_PLATFORM_BLOB_STORE=1` | complete cycle evidence goes to the partitioned `dp.cycle_evidence_blob` (writers and readers agree) | off |
| `THETA_PAYLOAD_DEDUP=1` | raw provider payloads (research mode) stored content-addressed | off |

## Stage 0: INERT_DEPLOY

Release the code with every flag unset. Acceptance: all CI gates green; `tools/theta-data-platform.ts --mode=status` reports `DATA_PLATFORM_SCHEMA_ABSENT`; one real decision cycle is byte-identical to the
previous release (same frontier hash, same receipt). Rollback: previous release.

## Stage 1: SHADOW (>= 5 sessions)

1. Apply migration 069 through the governed migration path (a fresh verified DR backup first). Tests already prove: applies from 068, idempotent, no existing row changes, no foreign key into or out of `dp`,
   downgrade (`DROP SCHEMA dp CASCADE`) leaves the legacy path fully working (`tests/db/data-platform-lifecycle.test.ts`).
2. Register the four scheduled tasks (`tools/windows/register-theta-data-platform-tasks.ps1`: pre-session daily, post-session and SLO weekdays, weekly Saturday). Run pre-session once by hand: it writes the first
   pressure row. Only then set `THETA_STORAGE_GOVERNOR=1`.
3. `THETA_PIT_STORAGE_MODE=SHADOW`: the legacy writer stays authoritative; the normalized form is built, validated (exact round trip) and measured in memory. No `dp` writes.

Acceptance: pre-session returns READY every day; pressure row never older than 36 h; every SHADOW decision `roundTripExact`; no CRITICAL incident; measured reduction recorded. Rollback: unset the flags.

## Stage 2: DUAL_WRITE_VALIDATE (bounded, at most 14 days)

`tools/theta-data-platform.ts --mode=dual-write-start --days=14` records `DUAL_WRITE_STARTED_AT` and a hard deadline. Mode DUAL_WRITE_VALIDATE writes BOTH homes in the SAME transaction and the database compares
the rebuilt rows with the legacy rows (jsonb equality) for every decision, counting `PARITY_DECISIONS`, `PARITY_ROWS`, `MISMATCH_COUNT`. A dp-side failure never fails the decision transaction (savepoint). When the
deadline passes the writer degrades to the legacy path by itself and pre-session raises `DUAL_WRITE_WINDOW_EXPIRED`: dual writing can never become permanent.

Exit criteria (`--mode=dual-write-status` evaluates them; `--mode=dual-write-cutover` refuses unless all hold): ledger mode DUAL_WRITE_VALIDATE; `MISMATCH_COUNT = 0`; `PARITY_DECISIONS >= 200`;
`PARITY_ROWS >= 1000`; a fresh sweep over recent decisions finds the same candidate ids, the same row counts, identical scalar columns, all sixteen JSON columns equal, no missing and no duplicate rows.

## Stage 3: AUTHORITATIVE (cutover)

`--mode=dual-write-cutover` records `CUTOVER_AT` and `LEGACY_WRITER_DISABLED=true` (the table CHECK refuses an AUTHORITATIVE row with mismatches). Same window: apply
`docs/proposals/DP2_pit_compat_swap_DRAFT.sql` (renames the legacy table, puts a view with the unchanged name over old + rebuilt rows) and set `THETA_PIT_STORAGE_MODE=AUTHORITATIVE`. Existing consumers keep their SQL
(`tests/db/data-platform-lifecycle.test.ts` runs the research export over the view). Enable `THETA_DATA_PLATFORM_BLOB_STORE=1` in the same release as the readers that use `cycleBlobSelectExpression`.

Acceptance: a week of sessions with parity sweeps clean, post-session receipts every day, consumers unchanged, rollback rehearsed on a disposable copy
(`rollbackAuthoritativeAndSwap`: copies the rows written while authoritative back, re-points the dependent views such as `research.option_contract_risk_history`, restores the names; after the swap `DROP SCHEMA dp CASCADE` is no longer a safe downgrade).

## Stage 4: OLD_PATH_DISABLED (after 14 clean sessions)

A release removes the legacy large PIT writer branch (the renamed table stays readable). Acceptance: CI green, no `trade.candidate_point_in_time_evidence_legacy` writer in the source.

## Stage 5: HISTORICAL_ARCHIVE_MIGRATION (separate owner approval; not part of this command)

Preconditions: a remote archive target is configured (the laptop must never be the sole holder of cold data; the purge rule is enforced in code: primary verified AND a second authority AND an off-machine copy), the six
legacy populations are re-verified the same day (`tools/theta-legacy-archive-reverify.ts`), and the owner approves the exact purge population. The method per table is in the purge packet: whole-table drop where there is
no dependent, rebuild/swap (`src/storage/data-platform/legacy-rebuild.ts`, plan printed by `tools/theta-legacy-rebuild-plan.ts`) where only an old slice leaves, reuse-only where foreign keys forbid a rewrite.
The irreversible drop needs the approval token AND the verification proof.

## Restart safety and yielding

Pre-session, post-session and weekly tasks are idempotent: every archive step is checkpointed in `dp.partition_state`, a repeated post-session replaces its session receipt, a crashed run resumes at the recorded step,
and storage work stops between partitions whenever the worker publishes the operations-busy marker (`THETA_OPERATIONS_BUSY_FILE`).
