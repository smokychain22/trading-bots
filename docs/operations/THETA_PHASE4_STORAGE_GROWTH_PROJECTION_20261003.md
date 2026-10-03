# THETA Phase 4: storage growth projection (2026-10-03)

Source: read-only `theta:storage:audit` at 2026-10-03T09:27Z (`READ_ONLY`, `transaction_read_only=on`, exact byte sizes, planner row estimates) and the verified-backup size trend
(`database-size-trend.jsonl`, exact `pg_database_size` at each backup). Nothing here is a trading threshold.

## Current state (exact)

| Quantity | Value |
|---|---|
| PostgreSQL total | 5,008,201,407 bytes (4.664 GiB) |
| Budget policy `theta-aiven-developer1-storage-budget-v1` | warn 3.2 GiB, breach 4 GiB, plan allocation 8 GiB |
| Budget assessment | **BREACHED** (max utilisation ratio 5.18 on the research budget); watermark CRITICAL; `researchWriteDisposition=PAUSE_NONESSENTIAL`; operational-truth writes still allowed |
| Canonical state / audit | 1.8 MiB / 556 MiB |
| Short-retention observation | 1,552 MiB |
| Research history | 2,650 MiB |
| TOAST (wide JSON) | 3,498 MiB; indexes 239 MiB |
| Local Parquet archive | 0.042 GiB (measured files); verified backup archives 2.56 GB under `C:\ProjectBackups\trading-bots` |

Top relations (MiB): `candidate_point_in_time_evidence` 1,406; `fusion_snapshot` 1,227; `canonical_strategy_candidate_evidence` 773; `canonical_strategy_frontier` 220; `decision` 219;
`optionomics_feature_snapshot` 155; `optionomics_raw_observation` 136; `candidate` 123; `theta_option_chain_decision_evidence` 119; `theta_execution_observation_job` 66.

## Measured growth

| Interval | Size | Note |
|---|---|---|
| 2026-09-28 23:36Z | 3,763 MiB | last measurement before the full-chain sessions |
| 2026-10-02 23:30Z | 4,766 MiB | **+1,003 MiB** over the weekday sessions 09-29, 09-30, 10-01, 10-02 (four sessions) |
| 2026-10-03 04:42Z | 4,768 MiB | +2 MiB overnight (closed market): the idle database is effectively flat |

Derived, labelled as an estimate from two exact points and an assumed four active sessions: **about 250 MiB per active session** (about 2.1 MiB per completed decision; the latest session
completed 119 decisions and wrote 365 candidate point-in-time rows, 119 frontier rows and 139 shadow-opportunity rows). The audit tool itself still reports `growthState=UNKNOWN` because it
needs two comparable local audits at least one hour apart; this document is the manual substitute and is not a promise.

## Projection (active sessions only; idle days add about 0)

| Horizon | Added | Total (from 4.66 GiB) | Against the 8 GiB plan |
|---|---|---|---|
| 1 session | about 250 MiB | 4.9 GiB | 61% |
| 1 week (5 sessions) | about 1.2 GiB | 5.9 GiB | 74% |
| 1 month (21 sessions) | about 5.1 GiB | 9.8 GiB | **exceeds 8 GiB in about 13 sessions (around 2026-10-21)** |

## What is bounded, retained, compacted, archived

| Class | Policy in code | Effect on growth |
|---|---|---|
| Canonical trading state | tiny and permanent | negligible |
| Canonical audit (frontier, decision) | permanent; the per-candidate lists inside the queryable projection are bounded (Phase 3 `phase3-frontier-projection-bound`) with the full list in the compressed cycle archive | bounded per decision |
| Short-retention observations (`fusion_snapshot`, Optionomics raw) | classified short-retention; **no deletion job is activated** | unbounded until the retention action is approved |
| Research history | exportable to Parquet (`theta:storage:compact-research`, certified export), **database purge not activated** | unbounded until an archive-then-purge is approved |
| Idle/closed market | no writes | flat |

## Conclusion and classification

The growth rate is bounded per decision and the code path is safe, but **the database is already over its own 4 GiB budget and would exceed the 8 GiB plan in roughly two weeks of
normal sessions** unless one of these owner-controlled actions is taken: approve archive-then-purge of short-retention and research history (the export tooling exists and is tested), raise the plan,
or accept pausing non-essential research writes (already the automatic disposition). Deleting Production rows is an irreversible Production mutation and was NOT performed in Phase 4.
Register classification: `OWNER_POLICY` (retention/purge approval) with the engineering already in place; the dated risk above is carried to Phase 5.
