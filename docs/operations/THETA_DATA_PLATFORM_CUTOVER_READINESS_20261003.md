# THETA_DATA_PLATFORM_CUTOVER_READINESS (2026-10-03)

**Answer: CUTOVER_READY=NO.** The platform is built, wired behind flags, and proven on real PostgreSQL, but measured on real Production decisions it does **not** keep the database bounded as wired. Nothing was
deployed, applied, enabled, purged or pushed. Production is unchanged (`main` = deployed = worker = `a5ff0a6`), PRODUCTION_DELETE_EXECUTED=NO.

## What changed in this command (all local commits, inert by default)

- Real normalized point-in-time writer in the cycle store with the staged modes OFF / SHADOW / DUAL_WRITE_VALIDATE (bounded by a ledger deadline) / AUTHORITATIVE; the exact SQL reconstruction view; tiers
  (SELECTED/FINALIST full, NEAR_BOUNDARY/ANOMALY sufficient, ORDINARY_REJECTED identity + reason + hash + histogram); content-addressed payloads; the compatibility swap (070) that re-points dependent views.
- Storage pressure semantics: absent, stale or malformed state is `STORAGE_PRESSURE_UNKNOWN` (research throttled, new risk restricted, locked after 72 h, management never affected). The gate is wired into the cycle blob,
  point-in-time rows, canonical candidate research, shadow opportunities, raw payloads, Command-5A marks, the local research archiver and the new-risk entry path. Operational truth is structurally exempt.
- Vendor-neutral archive backend contract + remote object-store adapter + conformance suite; the purge rule (verified primary AND second authority AND off-machine copy) enforced in code.
- Real pre-session (READY or NEW_RISK_STORAGE_LOCK), post-session, weekly integrity and SLO tasks; default-partition repair; provider-calendar partition pre-creation; governed rebuild/swap for physical reclaim.
- Measurements with the real writer; simulation re-run with those bytes; cold archive cost; legacy archives re-verified; exact purge population.

## IDENTITY

BASE_MAIN=a5ff0a606f83e723cf5646ca8e695a9649e36afc | LOCAL_START=9b2f5fd694f83996fdceaf63ca631aeab9e6bbf0 (continuation start; normalized-PIT checkpoint f0dc8ab) | REMOTE_MAIN=a5ff0a606f83e723cf5646ca8e695a9649e36afc | not pushed.

## NORMALIZED_WRITER

PIT_WIRED=YES | DECISION_CONTEXT_WIRED=YES | CANDIDATE_TIERS_WIRED=YES | PAYLOAD_DEDUP_WIRED=YES (research mode, THETA_PAYLOAD_DEDUP) | LEGACY_COMPAT_VIEW=YES (dp view + swap 070; a real defect found by the read-only Production plan,
`research.option_contract_risk_history` would have gone stale after the rename, is fixed and tested in both directions) | REAL_PG_PARITY=PASS | REAL_ARCHIVED_PARITY=PASS.

Evidence: 80 random decisions (single candidate, many, empty objects, missing children, nulls, arrays) and a 2,619-candidate decision rebuild to the exact legacy rows by the database's own jsonb equality; the
real store under all four modes with the ledger; 155 real archived decisions / 14,437 rows exact in TypeScript and 5,210 rows exact through the real SQL view (91% fewer stored bytes); 100 real recent decisions
exact through the real writer.

## AMPLIFICATION (REAL writer, 100 most recent real Production decisions, stored bytes incl. indexes)

OLD_P50=1,371.6 KiB | OLD_P95=4,951.7 KiB | NEW_P50=1,223.8 KiB | NEW_P95=4,136.6 KiB | MAX=4,349.8 KiB | TARGET=P95 < 250 KiB | **STATUS=NOT_MET** (kept as the code constant until the owner agrees to change it).

IRREDUCIBLE_BREAKDOWN (mean 1,517 KiB per decision): cycle blob 1,334.5 KiB (88%, P50 1,047.5, P95 3,766.8, leaves PostgreSQL after 5 sessions); currently inherited decision truth and legacy relations 102.2 KiB (6.7%), now governed by the bounded-history draft rather than accepted as permanent; shared decision context
69.4 KiB (4.6%, P50 60.6, P95 189.8; irreducible Optionomics surface, leaves after 10 sessions); candidate-specific rows 11.3 KiB; indexes 1.8 KiB. Excluding the blob: P50 181.7, P95 349.0 KiB. Per candidate P50 73.6 to 25.1 KiB.
Proposed replacement metric: permanent bytes per decision after retirement, P95 144.6 KiB (met), plus the post-archive slope and sessions-to-pressure horizon. Synthetic chain-size scaling (40 to 10,000 contracts) is in the
measurement file; the legacy relational writer FAILS on chains of 1,000+ contracts (PostgreSQL's 256 MiB jsonb limit), the normalized writer does not.

## PRESSURE

UNKNOWN_SEMANTICS=IMPLEMENTED_AND_TESTED | P0_ALWAYS_ALLOWED=YES (structural import test + the operational DB suites pass with a STORAGE_CRITICAL row, 19 pass / 0 fail) | RESEARCH_THROTTLING_WIRED=YES |
NEW_RISK_GATE_WIRED=YES (LOCKED admits no new plan, RESTRICTED one per scan; inert unless THETA_STORAGE_GOVERNOR=1) | MANAGEMENT_PROTECTED=YES | BACKPRESSURE_WIRED=YES (queue bytes, lag, backend health, projected sessions are in the pressure state the writers read).

## MIGRATION_069

REVIEW=DONE: 20 findings recorded, 11 fixed in the draft (indexes for the legacy access paths, non-negative checks, request-hash check, TRUNCATE guard, latest-manifest reference view, histogram `created_at` for Parquet, dead
`decision_audit` and `candidate_detail` tables removed, incident kinds, view guarded by column presence, ledger, pressure state), the rest documented (soft references by design, owner-level guard not a security boundary).
DISPOSABLE_APPLY=PASS | UPGRADE_FROM_068=PASS (production schema, no existing row changes, idempotent, no foreign key in or out of dp) | REAL_WRITER=PASS | DEFAULT_PARTITION_HANDLING=PASS (missing partition, late writer, session boundary; late
rows for a retired partition stay under a CRITICAL incident) | PARTITION_RETIREMENT=PASS | ARCHIVE_RESTORE=PASS (real cycles: archive, REAL replay verification, retire, cold read, replay SAME_SOURCE_REPRODUCED, compact archive reference kept) |
EVIDENCE_READER=PASS (consumer inventory test) | DUAL_WRITE_EXIT=PASS (bounded 14-day window, parity ledger, exit sweep, cutover, rollback without row loss).

## AUTOMATION

PRE_SESSION=REAL | POST_SESSION=REAL (archive, verify, replay, Parquet, two-authority retirement, ONE receipt) | WEEKLY_VERIFY=REAL (hashes, manifests, DuckDB open, row counts, sampled replay; corruption is an incident and no deletion) |
RESTART_SAFE=PASS | OPERATION_YIELD=PASS | Windows tasks (pre-session daily, post-session and SLO weekdays, weekly Saturday) dry-run tested, not installed.

## ARCHIVE

BACKEND_CONTRACT=DONE | LOCAL_BACKEND=CONFORMANT_DEVELOPMENT_ONLY | REMOTE_BACKEND_CODE_READY=YES (object-store client interface + adapter, retry, timeout, corruption detection; no provider chosen) | SECOND_DURABILITY_RULE=ENFORCED (the laptop is never the sole holder) | LEGACY_ARCHIVES_REVERIFIED=6/6.

## SIMULATION (REAL control plane, measured inputs, start 2.598 GiB, 154 decisions per session)

| | AS_WIRED | + tombstone (proposal) | + tombstone + diagnostics retention (proposal) |
|---|---|---|---|
| 250-session start / end (post-archive) | 2.81 / 8.36 GiB | 2.80 / 6.48 | 2.79 / 4.99 |
| post-archive slope | 15.08 MiB/session | 11.80 | 5.17 |
| linear growth | **YES** | YES | within tolerance (still rising; horizon warning) |
| new risk first non-open / critical | session 67 / 122 | 123 / 248 | never / never |
| extreme session (10,000 contracts, 8x blobs, 1.7x decisions) peak; washes out to the pre-spike trend | 9.01 GiB, LOCKED; yes | 7.81 GiB, LOCKED; yes | 7.15 GiB, RESTRICTED; yes |
| 5-session archive outage peak (post-archive) | 6.83 GiB | 5.89 | 5.20 |
| 80-session archive outage: max peak, first throttle / critical | 8.39 GiB, 26 / 49 | 7.50 GiB, 42 / 51 | 7.06 GiB, 43 / 53 |

Never dropped without a verified archive: true in every scenario.

## PROJECTION

POSTGRES (post-archive, plan 8 GiB): AS_WIRED 1y 8.4 | 3y 15.8 | 5y 23.2 GiB (plan reached at about session 226). Proposals: tombstone 6.7 / 12.5 / 18.3; tombstone + diagnostics 5.3 / 7.8 / 10.3 (reached at about 847 sessions).
COLD ARCHIVE (compressed, measured; 38,808 decisions per year): full cycle archive 53.45 GiB (1,444 KiB per decision: 1.0823x the stored blob), candidate and context NDJSON 2.08 GiB, Parquet research copy 1.36 GiB (compacted month files are 1.139x larger than the
per-date files: compaction reduces file count, not bytes) = **about 56.9 GiB/year, 170.7 GiB at 3 years, 284.5 GiB at 5 years**. Raw research payloads are inside the blob (the default writer stores stubs). Command-5A marks are not archived yet
(0.42 KiB per row hot; not measured as cold). No provider is chosen.

## LEGACY

ROWS=346,682 | LOGICAL_GIB=7.35 | IMMEDIATE_PHYSICAL_GIB=2.068 (1.313 + 0.755; rebuild/swap) | PROJECTED_POST_CLEANUP_GIB=2.598 | OPERATIONAL_ROWS_INCLUDED=0 | PRODUCTION_DELETE_EXECUTED=NO. Exact table-by-table packet:
`THETA_LEGACY_PURGE_POPULATION_20261003.md`. Re-verified after restart: row parity 6/6 EQUAL, 40/40 restore samples MATCH each, schema identical, Parquet readable, 20/20 replay executed.

## VALIDATION (at the final source)

NODE=PASS (4,193 tests, 0 fail, new skips are the DB-backed tests that run in their dedicated database steps) | PYTHON=PASS (1,346) | TYPECHECK=PASS | LINT=PASS | BUILD=PASS | BROWSER=PASS (23) | WINDOWS=PASS (9 files) | SECURITY=PASS (0 findings, storage policy PASS) |
DATABASE=PASS (dp-only: postgres, cli, automation, rebuild, pit-view; production schema: pit, lifecycle; operational suites under STORAGE_CRITICAL) | SIMULATION=PASS (documented as above) | governed executed evidence regenerated (phases 2-6).

## FINAL

CUTOVER_READY=NO | CODE_SOLVABLE_REMAINING=none without an owner decision (the wave-2 mechanisms that would bound the permanent growth change immutable decision truth and are deliberately not built) |
REMOTE_ARCHIVE_PROVIDER_DECISION=REQUIRED | PURGE_APPROVAL_REQUIRED=YES (exact population above, plus the second off-machine authority) | MIGRATION_069_READY=YES (technically reviewed and tested; apply only through the governed path) |
NEXT_ACTION: owner decides the permanent-growth option (`THETA_DATA_PLATFORM_PERMANENT_GROWTH_DECISION_20261003.md`), the remote archive provider and the purge population; then the staged runbook (`THETA_DATA_PLATFORM_CUTOVER_RUNBOOK_20261003.md`). DO NOT START PHASE 5.
