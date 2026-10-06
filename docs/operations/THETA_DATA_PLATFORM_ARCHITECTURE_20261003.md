# THETA data platform: bounded PostgreSQL by design (2026-10-03)

> **CORRECTION 2026-10-03 (cutover preparation, measured).** Sections of this document that say PostgreSQL "stays bounded" describe the DESIGN INTENT and the earlier model-based simulation (0.376 MiB per session of permanent
> drift). The real writer measured on the 100 most recent real decisions shows that decision truth and the legacy research and diagnostic tables stay permanent at about 102 KiB per decision (about 15 MiB per session), so as
> wired the post-archive size is linear and reaches the 8 GiB plan in about 226 sessions. Authoritative numbers and the owner decision they need:
> `THETA_DATA_PLATFORM_PERMANENT_GROWTH_DECISION_20261003.md`, `THETA_DATA_PLATFORM_WRITER_MEASUREMENT_20261003.json`, `THETA_DATA_PLATFORM_CUTOVER_SIMULATION_20261003.json`. Staged rollout: `THETA_DATA_PLATFORM_CUTOVER_RUNBOOK_20261003.md`.

Status: **built and proven offline; not deployed, not wired, nothing deleted.** Every module below exists in the repository with tests; the Production runtime is unchanged
(`main` = deployed = worker = `a5ff0a6`). Cutover is staged and needs the owner's go (see "Cutover" and "Owner decisions").

## 1. The problem, measured

Production PostgreSQL is 4.66 GiB and grew about 250 MiB per active session (2026-10-03). The question is not "how do we clean it at 5 GB" but "how does it stay bounded for
years inside an 8 GiB allocation with no recurring human cleanup". Measured root causes (read-only forensics, `docs/operations/THETA_DATA_PLATFORM_MEASUREMENTS_20261003.json`):

| Root cause | Evidence |
|---|---|
| **FULL_ARCHIVE_HOT** | the complete compressed cycle evidence is stored in a `bytea` column of the append-only `trade.fusion_snapshot`: P50 604 KiB, P95 3.8 MiB per decision, 81% of current growth; 616 of 616 blobs are distinct, so content addressing cannot shrink it, only retention can |
| **NO_RETENTION / NO_PARTITIONING** | every history table is append-only and un-partitioned; there is no mechanism, in code or schema, that ever moves anything out |
| **REPEATED_CONTEXT** | in the legacy per-candidate evidence, `volatility_json.surface` and `.providerMetrics` are byte-identical for every candidate of a decision (461 decisions, 82.9x repetition) and make up 1.9 GiB of the table's 2.1 GiB of volatility JSON; event, flow, technical, account, portfolio and provenance repeat 70 to 3,379x |
| **RESEARCH_IN_POSTGRES** | 2.9 GiB of the 4.66 GiB is legacy research evidence from 2026-09-16 to 2026-09-25 whose only copy was the database row |
| **RAW_PROVIDER_DUPLICATION** | modest: Optionomics payloads repeat about 2x (`response_hash`), about 0.1 GiB |
| **Not a cause** | bloat: dead tuples are negligible (largest 17% on a 15k-row table), autovacuum is healthy, the large tables have 0 updates and 0 deletes. All growth is logical, not physical |

## 2. Four memories, four owners

| Memory | Home | Owns |
|---|---|---|
| WORKING | PostgreSQL | open broker state, orders, fills, attempts, plans, leases, reconciliation, inventory, assignment, open chains, management and risk state, current account, compact decision audit, recent hot evidence, small durable hashes and references |
| LONG-TERM | immutable compressed columnar archive (Parquet ZSTD, date partitioned) behind a pluggable `ArchiveBackend` | complete candidate history, chains, observations, marks, counterfactuals, Optionomics history, replay data, training sets |
| REPRODUCIBILITY | GitHub | code, schema, migrations, policy, manifests, receipts, small fixtures, historical-incident regressions (never a market-data warehouse) |
| DISASTER RECOVERY | verified backups | restore of the whole system |

PostgreSQL is not the research warehouse. After cutover: PostgreSQL = operational truth, archive = historical analytical truth, GitHub = code/policy truth, backup = DR truth.

## 3. Hot, warm, cold

`src/storage/data-platform/dataset-registry.ts` is the single registry. The derived table is `THETA_DATA_PLATFORM_RETENTION_MATRIX_20261003.json` and is pinned by a test.
Windows are counted in trading sessions, so an idle weekend never ages data. HOT is PostgreSQL; WARM is a local verified-archive cache (not PostgreSQL); COLD is the archive.
Every dataset states why it is hot, how long, why warm, when it is archived, when it leaves PostgreSQL, what compact form stays behind, and how it is restored.
Examples: cycle evidence blob 5 sessions hot (replay and label resolution need it within days; `VALUE_BYTES_RATIO` 14.8, the lowest, which is why its window is the shortest);
decision context and candidate detail 10; frontier summary 60 (12 weekly partitions); raw Optionomics 3; runtime diagnostics 30; broker history and decision audit PERMANENT.
Operational truth can never be configured to leave PostgreSQL (a validator and a test enforce it).

## 4. The control plane (one authority)

`StorageGovernor`, `ArchiveManager`, `RetentionManager`, `PartitionManager`, `CompactionManager`, `ArchiveVerifier`, `ReplayVerifier`, `GrowthForecaster` and `StoragePressureGate`
are exported from one module (`control-plane.ts`); nothing else decides storage policy.

- **Lifecycle:** `ACTIVE_HOT -> CLOSED_HOT -> ARCHIVE_PENDING -> ARCHIVED_VERIFIED -> DETACH_ELIGIBLE -> DETACHED -> DROPPED`; the only backward edge is verification failure to `ARCHIVE_PENDING`.
- **Exactly-once archival:** export, upload (content-addressed key), verify (file hash, content hash, row parity with the live source), replay verify, immutable manifest, state change; each step is checkpointed
  before the next. A crash injected at **every persisted step** of archive and retirement recovers with one valid manifest, no data loss and no ambiguous state.
- **Retirement is DETACH + DROP of a whole partition, never row DELETE.** It re-verifies the archive against the live source immediately before acting and passes a durability gate: a second archive copy, or a
  verified DR backup that started after the archive was created. On real PostgreSQL, DROP PARTITION returned 100% of the space at once; row DELETE plus VACUUM returned none.
- **Priority:** storage work yields to operations before every partition step; the gates can restrict or lock NEW RISK and degrade research writes but have no path to closing, management, reconciliation or order truth (`managementAllowed` is the literal `true`).
- **Archive backends:** `ArchiveBackend` (immutable, content addressed, no delete, no overwrite); local filesystem now, replicated wrapper, fault-injecting wrapper for tests. No vendor is chosen.

## 5. Capacity, prediction, backpressure

Bands over the 8 GiB allocation: NORMAL below 40%, ARCHIVE_PRESSURE from 40%, RESEARCH_THROTTLED 55%, NEW_RISK_RESTRICTED 70%, STORAGE_CRITICAL 82.5% (configurable, validated).
The governor forecasts the next session, 5 and 20 sessions from rolling growth, archive throughput and the retirable backlog; if the predicted peak crosses a band it archives before the session and, if still unsafe, restricts or locks new risk.
Write priorities: P0 operational (always written), P1 selected/finalist evidence, P2 full research, P3 raw provider payloads. Pressure degrades P3, then P2, then P1 only at critical, and every skip is an explicit
`EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE` record with its exact scope. Archive queue bytes, partitions and lag are bounded; exceeding them engages backpressure.
The SLO is statistical: a post-archive size that rises with session count (Theil-Sen slope, Mann-Kendall tau, after the longest hot window has filled) raises `UNBOUNDED_POSTGRES_GROWTH`.

## 6. Normalization (measured before built)

- **decision_context:** shared per-decision context stored once; candidates reference it. One nested level is descended, so a large nested value shared by every candidate is stored once even when a small sibling differs. Lossless (property tests, exact reconstruction).
- **Candidate tiers:** SELECTED, FINALIST, NEAR_BOUNDARY, ANOMALY keep full detail hot; ordinary rejected contracts are a per-decision histogram plus the hash of the complete list; the complete rows live in the archive and verify against that hash. Storage home changes, never sampling.
- **Content-addressed payloads:** payload identity (sha256) is separate from observation identity (who, when, what), so identical bytes observed twice are one blob and two observations with their own times.
- **Option chain once:** the chain exists once per cycle in the evidence blob; candidates, frontier, decision, shadow and research reference it. The legacy `theta_option_chain_decision_evidence` copy of the chain is an archive population.

## 7. Parquet long-term model

Date-partitioned (`dp_session_date=`), ZSTD level 9, stable typed scalar columns (BIGINT, DOUBLE, BOOLEAN, TIMESTAMPTZ, DATE, UUID), nested variable structure as JSON text columns, bounded row groups.
Every row is read back and compared with its source line by exact decimal comparison; a scalar that cannot round-trip exactly as DOUBLE is stored as text, never rounded. Small files are counted and compacted into month files with
lineage (every source file, sha256, row count), exact parity in both directions (`EXCEPT` both ways = 0) and atomic publish. `evidence_views.py` presents one logical dataset over PostgreSQL (hot) and Parquet (cold), hot winning on overlap.
`EvidenceReader` does the same for replay: hot first, otherwise the verified archive object; a cold cycle blob was returned **byte-identical** to the original on real PostgreSQL.

## 8. Automation

Pre-session (08:30 ET): capacity assessment, new-risk storage gate, upcoming partitions pre-created. Post-session (16:30 ET): close, archive, verify, retire, ANALYZE, measure, receipt, incidents.
Weekly: integrity sweep (re-read, hash, row count) that sends a failed archive back to `ARCHIVE_PENDING` while the hot copy still exists. `tools/theta-data-platform.ts` is the entry point;
`tools/windows/register-theta-data-platform-tasks.ps1` defines the three scheduled tasks (dry-run tested, not installed). The tool is inert (`DATA_PLATFORM_SCHEMA_ABSENT`) until the schema exists.

## 9. Cutover (staged, no permanent dual write)

1. Release the inert code (flag off). 2. Apply migration 069 (`docs/proposals/DP1_data_platform_DRAFT.sql`: new empty tables, default partitions, lifecycle tables) through the governed verified-backup path. 3. Enable readers first
(`COALESCE(s.evidence_archive_gzip, b.blob)` is safe with no `dp` rows), then the writer flag `THETA_DATA_PLATFORM_BLOB_STORE=1`: **new** cycles write the blob to `dp.cycle_evidence_blob` only; no dual write ever exists.
4. Parity gate: blob hash equals the stored `evidence_archive_hash` for every new cycle for three sessions. 5. Backfill the 616 current blobs (852 MB) into `dp` partitions, verify, then null the legacy column. 6. Install the scheduled tasks.
7. Legacy populations: archive (done), owner approves the exact population, governed purge (see `THETA_PHASE4_GOVERNED_PURGE_PROPOSAL_20261003.md`). Exit condition for step 5: zero parity mismatches for three sessions.
