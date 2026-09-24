# THETA storage decoupling and Aiven audit

Status: measured, target authority implemented, archive mechanism verified, live high-volume write cutover pending, destructive retention not authorized

## Authority boundary

THETA now declares the following target storage split in code. The final column
keeps the runtime claim honest. High-volume families still have legacy
PostgreSQL writers until relation-level archive parity and a controlled write
cutover are complete.

| Data family | Target canonical home | Outage or hot buffer | Long-term archive | Trading authority | Runtime state |
| --- | --- | --- | --- | --- | --- |
| Broker, account, order, position, fill, lifecycle and whole-chain state | PostgreSQL | SQLite WAL | Verified Parquet/DuckDB copy | Yes | ACTIVE |
| Decision, mutation and reconciliation audit receipts | PostgreSQL | SQLite WAL | Verified Parquet/DuckDB copy | Yes | ACTIVE |
| High-volume market, risk and candidate observations | Parquet/DuckDB | SQLite WAL | Parquet/DuckDB | No | POSTGRES WRITE CUTOVER PENDING |
| Research datasets, counterfactuals and model evidence | Parquet/DuckDB | SQLite WAL | Parquet/DuckDB | No | POSTGRES WRITE CUTOVER PENDING |
| Rebuildable provider and feature caches | Memory | SQLite WAL when needed | None unless promoted to evidence | No | ACTIVE |

PostgreSQL remains the transactional authority. SQLite is an outage spool, not a second trading authority. Parquet/DuckDB is the portable analytical authority for append-heavy history. No archive grants broker authority.

The machine-readable registry is `src/storage/storage-authority-registry.ts`. Retention cannot authorize PostgreSQL cleanup until a verified archive manifest, row-count parity, deterministic digest parity, Parquet readability and schema parity all pass. This is enforced by `src/storage/retention-policy.ts`.

## Exact read-only Aiven measurement

The final post-session read-only audit was observed at `2026-09-24T20:01:26.599Z`. Its immutable local outputs are:

- `.theta-local-worker/storage-audits/2026-09-24T200126599Z.json`
- `.theta-local-worker/storage-audits/2026-09-24T200126599Z.top30.csv`

These files are operational evidence and are intentionally Git-ignored. The audit used one PostgreSQL connection, an explicit read-only transaction and no data mutation.

| Metric | Measured value |
| --- | ---: |
| Database total | 3,812,898,495 bytes, 3.551 GiB |
| Relations inventoried | 153 |
| Canonical state plus audit | 464.46 MiB |
| Short-retention observations | 771.88 MiB |
| Research history | 2,384.90 MiB |
| Indexes | 221.45 MiB |
| TOAST | 2,440.46 MiB |
| Unknown storage classifications | 0 |
| PostgreSQL version | 18.6 |
| Provider default read-only | off |
| Audit transaction read-only | on |

The 153 relations classify as 26 canonical trading-state relations, 54
canonical-audit relations, 16 short-retention observation relations and 57
research-history relations. No current relation was labelled redundant or
derivable without evidence, and none remains unclassified.

WAL statistics, where available, are cluster-cumulative and cannot be attributed honestly to this database. The audit labels that limitation instead of treating cluster WAL bytes as THETA database bytes. PostgreSQL tuple counters returned zero for the large relations. They therefore do not establish an append rate. A direct timestamp-window count was added for the high-volume decision families, with a rolling-hour window and the latest observed New York session window. The session window is explicitly labelled as a calendar/session observation and is not presented as exchange-calendar validation.

At the final audit, `pg_stat_wal` reported 237,994,936 bytes, 32,918
records and 32,705 full-page images since its `2026-09-24T20:00:41.704Z`
cluster reset. These values are service-cluster activity, not a THETA database
size component. Aiven did not expose database-specific WAL/service overhead or
provider free-space bytes through PostgreSQL, so both remain explicitly
provider-limited. The database activity view reported 87 commits, zero
rollbacks, zero temporary files/bytes and zero deadlocks in its current stats
window.

The relation statistics reported 26 estimated dead tuples across all measured
relations: 12 in `ops.scheduler_checkpoint`, seven in
`ops.runtime_worker_status`, five in `ops.runtime_worker_lease`, and one each
in `ops.runtime_worker_cycle` and `copy.alpaca_oauth_token`. The large append
relations reported zero dead tuples in this stats window. Exact table/index
ratios and per-relation vacuum/analyze timestamps are retained in the audit
JSON. The short/reset-sensitive statistics window and planner estimates are
not sufficient to claim physical bloat or authorize VACUUM/REINDEX work.

The database changed during bounded audits despite zero trades:

| Observation | Database bytes |
| --- | ---: |
| 2026-09-24 19:25:57Z | 3,634,353,855 |
| 2026-09-24 19:30:50Z | 3,668,489,919 |
| 2026-09-24 19:32:27Z | 3,668,555,455 |
| 2026-09-24 19:34:06Z | 3,683,071,679 |
| 2026-09-24 20:01:26Z | 3,812,898,495 |

Those are exact interval deltas. They are not extrapolated into a daily rate because the observation span is under one hour. A daily-growth value is emitted only after at least one hour between comparable local audits.

The post-session audit completed direct timestamp-window counts with
`track_counts=on`:

| Relation | Rows in last rolling hour | Rows in latest observed New York session |
| --- | ---: | ---: |
| `trade.canonical_strategy_candidate_evidence` | 30,456 | 79,628 |
| `trade.candidate_point_in_time_evidence` | 2,577 | 6,579 |
| `trade.shadow_opportunity` | 160 | 445 |
| `trade.canonical_strategy_frontier` | 32 | 89 |
| `trade.decision` | 32 | 89 |

The latest observed window was September 24, 2026 from 09:30 through 16:00
America/New_York. It is derived from persisted timestamps and labelled as the
latest observed New York session window. It is not a holiday-aware exchange
calendar assertion. These counts prove large candidate/evidence write
amplification while broker order submissions remained zero. The three research
families above wrote 86,652 rows for 89 completed decisions, or 973.62 research
rows per decision. Session-bound bytes per decision remain unavailable because
PostgreSQL does not provide relation-size history at the session boundary.

## Top 30 relations

Row counts are PostgreSQL planner estimates. Size columns are exact at the audit timestamp. Dead-tuple and index ratios are indicators, not exact bloat measurements.

| # | Relation | Table MiB | Index MiB | TOAST MiB | Total MiB | Est. rows | Class |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `trade.candidate_point_in_time_evidence` | 74.10 | 3.28 | 1,091.16 | 1,168.59 | 26,579 | RESEARCH_HISTORY |
| 2 | `trade.canonical_strategy_candidate_evidence` | 647.34 | 125.80 | 0.01 | 773.34 | 216,702 | RESEARCH_HISTORY |
| 3 | `trade.fusion_snapshot` | 0.70 | 0.19 | 462.96 | 463.87 | 107 | SHORT_RETENTION_OBSERVATION |
| 4 | `trade.canonical_strategy_frontier` | 0.23 | 0.20 | 206.18 | 206.63 | 107 | CANONICAL_AUDIT |
| 5 | `trade.decision` | 0.21 | 0.09 | 205.34 | 205.67 | 107 | CANONICAL_AUDIT |
| 6 | `market.optionomics_feature_snapshot` | 0.12 | 0.23 | 149.90 | 150.27 | 107 | SHORT_RETENTION_OBSERVATION |
| 7 | `market.optionomics_raw_observation` | 2.55 | 0.77 | 124.93 | 128.27 | 1,673 | SHORT_RETENTION_OBSERVATION |
| 8 | `trade.candidate` | 72.54 | 3.54 | 39.27 | 115.40 | 29,898 | RESEARCH_HISTORY |
| 9 | `research.theta_option_chain_decision_evidence` | 1.05 | 0.21 | 113.41 | 114.70 | 107 | RESEARCH_HISTORY |
| 10 | `legacy_neon.artifact_record` | 18.60 | 8.18 | 31.62 | 58.44 | 24,408 | RESEARCH_HISTORY |
| 11 | `research.theta_execution_observation_job` | 25.74 | 31.41 | 0.01 | 57.19 | 118,479 | RESEARCH_HISTORY |
| 12 | `trade.candidate_reason` | 33.34 | 5.20 | 0.01 | 38.59 | 118,556 | RESEARCH_HISTORY |
| 13 | `legacy_neon.promotion_record` | 14.02 | 8.77 | 0.01 | 22.83 | 25,126 | RESEARCH_HISTORY |
| 14 | `trade.shadow_opportunity` | 16.72 | 2.91 | 0.01 | 19.67 | 28,925 | RESEARCH_HISTORY |
| 15 | `ops.scheduler_checkpoint` | 10.86 | 6.62 | 0.01 | 17.52 | 22,771 | CANONICAL_AUDIT |
| 16 | `market.execution_quote_observation` | 9.02 | 7.62 | 0.01 | 16.69 | 26,729 | SHORT_RETENTION_OBSERVATION |
| 17 | `trade.broker_reconciliation_snapshot` | 2.94 | 1.39 | 10.87 | 15.23 | 6,544 | CANONICAL_AUDIT |
| 18 | `ops.runtime_worker_cycle` | 12.62 | 1.29 | 0.01 | 13.95 | 6,971 | CANONICAL_AUDIT |
| 19 | `market.option_quote_snapshot` | 4.76 | 3.30 | 0.01 | 8.10 | 19,469 | SHORT_RETENTION_OBSERVATION |
| 20 | `research.optionomics_temporal_feature_observation` | 1.92 | 2.57 | 0.01 | 4.52 | 3,419 | RESEARCH_HISTORY |
| 21 | `market.option_contract` | 1.70 | 1.80 | 0.01 | 3.55 | 3,648 | SHORT_RETENTION_OBSERVATION |
| 22 | `legacy_neon.research_export_variant` | 0.66 | 0.17 | 0.99 | 1.84 | 460 | RESEARCH_HISTORY |
| 23 | `research.theta_outcome_subject` | 0.52 | 0.39 | 0.87 | 1.80 | 617 | RESEARCH_HISTORY |
| 24 | `legacy_neon.missing_record_forensic_search` | 0.32 | 0.13 | 1.22 | 1.70 | 553 | RESEARCH_HISTORY |
| 25 | `trade.canonical_strategy_branch_evidence` | 0.79 | 0.81 | 0.01 | 1.63 | 1,745 | RESEARCH_HISTORY |
| 26 | `research.theta_runtime_behavior_diagnostic` | 0.12 | 0.09 | 0.52 | 0.74 | 0 | RESEARCH_HISTORY |
| 27 | `research.theta_outcome_resolution_receipt` | 0.51 | 0.14 | 0.01 | 0.68 | 321 | RESEARCH_HISTORY |
| 28 | `trade.strategy_route` | 0.53 | 0.08 | 0.01 | 0.64 | 108 | CANONICAL_AUDIT |
| 29 | `market.optionomics_feature_observation_link` | 0.21 | 0.34 | 0.01 | 0.59 | 1,664 | SHORT_RETENTION_OBSERVATION |
| 30 | `trade.broker_activity_fact` | 0.49 | 0.05 | 0.01 | 0.58 | 9 | CANONICAL_AUDIT |

## Verified archive proof

A real 115,813,769-byte sanitized research export was converted into a ZSTD-compressed Parquet archive outside the repository:

`C:\ProjectBackups\trading-bots\research-archives\2026-09-25_330cd39_cb9a967a`

The archive contains 25,125 rows and a 3,811,257-byte Parquet file. The manifest records the source byte hash, canonical-content digest, Parquet hash, row-family counts and producer SHA. DuckDB read-back verifies row counts and per-row payload hashes. The source did not contain a source release SHA, so the manifest records `UNAVAILABLE_IN_SOURCE` rather than inventing lineage.

This archive proves the export and read-back mechanism. It does not authorize deletion of any Aiven row. Table-by-table archive coverage and parity are still required before a relation can leave PostgreSQL hot retention.

The current worker still persists several high-volume candidate and research
families to PostgreSQL. This phase measures that coupling, defines the target
authority, proves portable archive/read-back, and defers non-critical market-hour
work. It does not claim that every live writer has already moved to Parquet.

## PostgreSQL dependency census

A static scan of 466 source and operations files found 525 unique
file/relation/operation references to the 153 measured relations. Qualified
literal SQL references classify as:

| Dependency class | Count |
| --- | ---: |
| SAFETY_REQUIRED | 144 |
| CANONICAL_STATE_REQUIRED | 152 |
| PERSISTENCE_ONLY | 27 |
| RESEARCH_ONLY | 202 |
| ACCIDENTAL_COUPLING | 0 |

The local dependency receipt includes per-relation writer and reader files:
`.theta-local-worker/storage-audits/2026-09-24T200126599Z.dependencies.json`.
This is an exact scan of literal qualified SQL identifiers in the included
source tree. It does not claim to detect dynamically constructed or
unqualified SQL. The runtime safety reads of recent IV history are explicitly
classified as safety-required bounded hot-history reads. Diagnostic, replay
and outcome consumers are research-only and must progressively use the unified
verified-archive loader.

## Resource priority and storage budgets

During an open U.S. options session, the Windows worker now defers large research export generation, empirical training/calibration runs and durable dataset mirroring. A pending marker allows the closed-session worker to resume the deferred export. Trading, broker reconciliation, current BBO acquisition and safety evidence keep priority.

The worker also defers the storage audit while the market is open. After a
successful closed-session cycle it captures at most one audit per UTC day into
the persistent worker control directory. An audit failure is non-critical and
cannot stop reconciliation or change execution authority.

The initial infrastructure guard is versioned as `theta-aiven-developer1-storage-budget-v1`. It warns at 3.2 GiB PostgreSQL total and breaches at 4 GiB, with separate limits for daily growth, canonical state, observations, research, indexes and TOAST. These numbers are conservative bootstrap operating limits for the current 8 GiB provider plan. They are not profitability policy or an empirical trading threshold.

At the measured state, research and TOAST budgets are breached. Total database and observation budgets are warning. Cleanup remains forbidden until verified archive parity is produced for the exact source relations.

## Remaining safe work

1. Accumulate comparable relation-size audits across full sessions to establish measured byte-growth trends. The direct row-count session window is complete, but the audit did not capture relation sizes at both session boundaries.
2. Export each archive-eligible relation with immutable IDs, schema, timestamp semantics and deterministic digests.
3. Restore/query every archive through DuckDB and compare row counts and digests to the same PostgreSQL snapshot.
4. Define bounded hot-retention windows per relation and obtain explicit authorization before any production deletion.
5. Keep prior verified PostgreSQL disaster-recovery generations. Parquet research archives supplement them and do not replace canonical restore coverage.
6. Add off-device encrypted replication when a destination and key-management policy are approved.

No production data was deleted, truncated, reorganized, vacuumed or optimized during this audit. No database migration, order submission, broker mutation, follower activation or live-money change occurred.
