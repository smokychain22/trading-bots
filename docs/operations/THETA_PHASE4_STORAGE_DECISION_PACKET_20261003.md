# THETA_PHASE4_STORAGE_DECISION_PACKET (2026-10-03)

> **UPDATE 2026-10-03 (cutover preparation):** the exact purge population, its re-verification after a process restart (row parity, 40-row restore samples, schema identity, Parquet readability, replay sample), the per-table method (a governed
> rebuild/swap for the two rebuildable tables, which also re-points `research.option_contract_risk_history`) and the two blockers (no second off-machine durability authority; owner approval) are in `THETA_LEGACY_PURGE_POPULATION_20261003.md`.
> The statement that PostgreSQL then "stays bounded" is superseded by `THETA_DATA_PLATFORM_PERMANENT_GROWTH_DECISION_20261003.md` (measured permanent growth).


Measured, read-only. **No Production row was deleted, no table was altered, the database plan was not changed, and no research write was resumed or paused.** The destructive step waits for the exact-population
approval below.

## 1. Release identity

MAIN = DEPLOYED = WORKER = `a5ff0a606f83e723cf5646ca8e695a9649e36afc`; schema `068_action_plan_integrity`; reconciliation GOOD (worker `MASTER_PAPER_RECONCILING`, lease ACTIVE); Paper gate LOCKED; no broker mutation.
Production holds 0 rows in `order_intent`, `broker_order`, `fill`, `execution_attempt` and `master_paper_action_plan`.

## 2. What consumes the 4.666 GiB (measured)

| Relation | GiB | Rows | Oldest .. newest | Growth per active session | Class |
|---|---|---|---|---|---|
| `trade.candidate_point_in_time_evidence` | 1.373 | 39,962 | 2026-09-16 .. 2026-10-02 | 25 to 67 MiB since 09-29 (legacy rows: 10,700 per day) | Tier C |
| `trade.fusion_snapshot` | 1.198 | 1,087 | 09-16 .. 10-02 | 112 / 254 / 307 / 153 MiB (current-contract cycle blobs) | Tier B (blob) + Tier C (legacy payload) |
| `trade.canonical_strategy_candidate_evidence` | 0.755 | 304,719 | 09-16 .. 09-24 | 0 since 09-24 | Tier C |
| `trade.canonical_strategy_frontier` / `trade.decision` | 0.215 / 0.213 | 1,087 each | 09-16 .. 10-02 | 3 to 7 MiB each | Tier A lineage (legacy payloads are 0.14 GiB each, not yet a population) |
| `market.optionomics_feature_snapshot` | 0.151 | 466 | 09-16 .. 09-25 | 0 | Tier C |
| `market.optionomics_raw_observation` | 0.133 | 5,522 | 09-16 .. 10-02 | 0.2 to 0.5 MiB | Tier C |
| `trade.candidate` / `candidate_reason` | 0.120 / 0.040 | 39,962 / 160,153 | | 0 | Tier C (next export set) |
| `research.theta_option_chain_decision_evidence` | 0.117 | 471 | 09-16 .. 09-25 | 0 | Tier C |
| `research.theta_execution_observation_job` | 0.064 | 158,115 | 09-16 .. 10-02 | 1 to 2 MiB | Tier B |

Full table with index and TOAST bytes, per-day counts and largest columns: `THETA_DATA_PLATFORM_MEASUREMENTS_20261003.json`. TOAST is 3.5 GiB of the 4.66.
**Physical bloat is not the problem:** the largest dead-tuple ratio is 17% on a 15k-row table, autovacuum last ran on the busy tables within hours, and the big tables have zero updates and deletes. All growth is logical.
Amplification found: shared decision context repeated per candidate (`surface` and `providerMetrics` identical for all candidates of a decision, 82.9x, 1.9 GiB of the 2.1 GiB of volatility JSON), the full cycle blob hot (81% of current growth),
no retention. No orphan rows (0 candidates without set, 0 evidence without frontier, 0 decisions without snapshot). Unused indexes over 1 MiB exist only on unique/primary keys of the archived tables (47 MiB of `content_hash` uniqueness on candidate evidence).

## 3. Four tiers

- **TIER_A_OPERATIONAL_IMMUTABLE:** orders, fills, reconciliation, execution attempts, action plans, lifecycle, positions, accounting, policy lineage. Never purged automatically; a code allowlist plus a test make them ineligible even with a perfect archive. Untouched here.
- **TIER_B_CURRENT_RUNTIME_EVIDENCE:** the 616 current-contract cycle blobs (0.79 GiB), recent diagnostics, pending observation jobs. Retained for their hot window (the only raw replay source of the running release). Candidate for rolling retirement after cutover.
- **TIER_C_RESEARCH_ARCHIVABLE (archived and verified, awaiting approval):** the six populations in section 6, 346,682 rows.
- **TIER_D_REGENERABLE_OR_REDUNDANT:** none found that is provably regenerable; nothing is classified destructively without evidence.

## 4. Storage decision table (measured)

| Object | CURRENT_GIB | GROWTH_MIB_PER_SESSION | RETAIN_IN_DB | ARCHIVE | PURGE | EXPECTED_RECLAIM_GIB | RISK | RATIONALE |
|---|---|---|---|---|---|---|---|---|
| legacy candidate PIT evidence (38,226 rows) | 1.373 | 0 (legacy) | the 1,736 current rows | DONE, verified | rebuild retained rows, drop old | 1.313 physical | LOW | no foreign keys; 97% of its bytes were repeated shared context; Parquet is 7.9x smaller than the JSON archive |
| candidate evidence (304,719 rows) | 0.755 | 0 | nothing | DONE, verified | drop whole table | 0.755 physical | LOW | no foreign keys; per-candidate copies the bounded contract no longer writes |
| legacy fusion payloads (471 rows) | 0.342 | 0 | row, ids, hash | DONE, verified | replace payload with archive pointer | 0.342 reuse only | MEDIUM | 16 dependent tables; the table cannot be dropped; space is reused, not returned |
| Optionomics features / chain evidence / raw (3,266 rows) | 0.257 | 0 | rows, ids, hashes | DONE, verified | replace payload with pointer | 0.257 reuse only | MEDIUM | referenced by link/temporal tables |
| current-contract cycle blobs | 0.794 | 112 to 307 (mean 207) | 5 sessions | after cutover, rolling | after cutover, partition drop | steady state | MEDIUM | needs migration 069, the blob sink flag and the scheduled tasks |

OPTION_A (archive/purge only clearly redundant data now): 2.667 GiB logical, **2.068 GiB immediate physical** (4.666 to 2.597 GiB); growth continues at about 262 MiB per session, so the 4 GiB internal guard returns in about 5 sessions and
the 8 GiB allocation in about 20.
OPTION_B (the retention and partition platform going forward): bounded post-archive size 2.07 to 2.16 GiB over 250 simulated sessions, projected 2.85 / 3.03 / 3.22 GiB (1 / 3 / 5 years, peaks included). Not deployed.
OPTION_C (raise the plan, delete nothing): no change in the growth rate, no replayable research benefit, and it hides the 97% repeated-context finding. Rejected as the primary path.
**OPTION_D (hybrid, recommended): A now on the approved exact population, B through the staged cutover. No plan increase.**
Evaluation: operational safety A/B/D keep Tier A untouched and require verified archives; replayability preserved by the evidence reader (cold cycle blob byte-identical); research value preserved (complete rows in Parquet, exact parity);
complexity A low, B high but proven on real PostgreSQL; future growth only B bounds it; restore time: a cold blob read is one object read plus hash verification.

## 5. Pressure response: what actually exists (verified in code)

The statement that non-essential research writes are paused is **not true at the PostgreSQL level.** `researchWriteDisposition=PAUSE_NONESSENTIAL` is a label printed by `theta:storage:audit`; **no writer consumes it** (`grep` over `src`, `tools`, `api`).
The only enforced storage pressure control is `PAUSE_STORAGE_PRESSURE` for NEW Command-5A subject scheduling against the LOCAL spool. Research persistence into PostgreSQL continues at full rate (database grew 1.0 GiB from 09-29 to 10-02).
There is therefore no storage-related loss risk to orders, fills, reconciliation, inventory, risk, management or audit lineage today, and equally no throttle. The new `StoragePressureGate` policy (operational writes always allowed, research degraded P3 then P2 then P1 only at critical,
every skip recorded) exists and is tested, but **no writer is wired to it**; wiring is part of the owner-approved cutover. Resuming or pausing writes was not changed in this work.

## 6. Archive-first evidence (exact population)

| Population | Rows | Archive (gzip NDJSON) | Parquet ZSTD | Row proof | Per-day aggregate | Sample restore |
|---|---|---|---|---|---|---|
| legacy candidate PIT evidence | 38,226 | 719 MiB | 95.6 MB | 38,226 / 38,226 | equal | 150 / 150 byte-exact |
| candidate evidence | 304,719 | 79 MiB | 36.5 MB | 304,719 / 304,719 | equal | 150 / 150 |
| legacy fusion payloads | 471 | 205 MiB | 117.3 MB | 471 / 471 | equal | 150 / 150 |
| Optionomics feature snapshots | 466 | 60 MiB | 50.8 MB | 466 / 466 | equal | 150 / 150 |
| option chain decision evidence | 471 | 50 MiB | 38.4 MB | 471 / 471 | equal | 150 / 150 |
| Optionomics raw observations | 2,329 | 46 MiB | 42.4 MB | 2,329 / 2,329 | equal | 150 / 150 |

Archive location: `C:\ProjectBackups\trading-bots\storage-archives\theta-20261003\` (outside the database), manifest per population (chunk digests, population digest, source database identity hash, source release), Parquet manifest per dataset
(every row read back and compared exactly). Replay: 20 of 20 sampled current-contract cycle blobs decoded, hash-verified and replayed with no error; 6 reproduce the originating frontier hash, 14 differ because the code has changed since
(a labelled cross-source counterfactual, not a defect).

## 7. THETA_STORAGE_PURGE_DRY_RUN

```
CURRENT_DB_GIB=4.666
PROJECTED_8GIB_DATE=13.7 active sessions from now (about 2026-10-21)
TOP_10_STORAGE_OBJECTS=candidate_point_in_time_evidence 1.373; fusion_snapshot 1.198; canonical_strategy_candidate_evidence 0.755; canonical_strategy_frontier 0.215; decision 0.213;
  optionomics_feature_snapshot 0.151; optionomics_raw_observation 0.133; candidate 0.120; theta_option_chain_decision_evidence 0.117; theta_execution_observation_job 0.064
ARCHIVE_CANDIDATE_ROWS=346,682   ARCHIVE_CANDIDATE_GIB (logical reclaim)=2.667   ARCHIVE_FILE_GIB=1.132
ARCHIVE_DESTINATION=C:\ProjectBackups\trading-bots\storage-archives\theta-20261003
ARCHIVE_HASH=per-population digest in each manifest (see the dry-run JSON)
ARCHIVE_VERIFY=PASS all six   REPLAY_VERIFY=PASS (aggregate equality, byte-exact restore sample, cycle blob replay sample)
WOULD_DELETE_ROWS=342,945 (two foreign-key-free tables)   WOULD_REPLACE_PAYLOAD_ROWS=3,737 (four foreign-key-referenced tables)
WOULD_RECLAIM_LOGICAL_GIB=2.667   ESTIMATED_PHYSICAL_RECLAIM=2.068 GiB immediate (drop / rebuild), 0.599 GiB reuse only
OPERATIONAL_TABLES_TOUCHED=NO  ORDERS_TOUCHED=0 FILLS_TOUCHED=0 ACTION_PLANS_TOUCHED=0 BROKER_EVENTS_TOUCHED=0 WHOLE_CHAIN_TOUCHED=0
POST_PURGE_PROJECTED_DB_GIB=2.597 immediate (1.998 after a full rewrite)   PROJECTED_SESSIONS_TO_NEXT_LIMIT=about 20 (8 GiB) at today's write rate; bounded only after the cutover
PRODUCTION_DELETE_EXECUTED=NO
```

## 8. Owner decisions

1. **Approve (or amend) the exact population in section 7** for the governed purge (`THETA_PHASE4_GOVERNED_PURGE_PROPOSAL_20261003.md`: receipt table, allowlisted function, trigger exception, ledger; the two foreign-key-free tables are a rebuild/drop, the four others a payload replacement).
2. **Archive durability:** the archive currently has one copy on this machine plus the DR backup. Retirement of the platform's partitions is gated on a second archive copy or a verified DR backup newer than the archive. The cold archive of current-contract cycle blobs grows
   about 52 GB per year (mean 1.38 MiB per decision, already compressed), more than this disk (26 GiB free) can hold. Choose an archive target (external volume, network share, or object store) or a cold retention window. No vendor was chosen.
3. **Cutover go** (migration 069, writer flag, scheduled tasks) when you want the platform live; until then storage keeps growing about 262 MiB per active session.
