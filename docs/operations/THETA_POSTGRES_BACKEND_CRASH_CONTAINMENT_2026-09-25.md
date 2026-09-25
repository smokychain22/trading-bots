# THETA PostgreSQL backend crash containment receipt

Observed incident: `2026-09-25T14:54:45Z`

Canonical source before correction: `960836fe41504592a969d1ef3de8e8912214b981`

Running worker: `af3d43d14d703c47ff52e833588130af60d61e48`

## Evidence-derived diagnosis

The open-session no-submit cycle reached broker and account reads and entered
the evidence scan. It then lost its checked-out PostgreSQL client. Aiven's
PostgreSQL log identifies the server-side event precisely:

1. The backend executing the `trade.fusion_snapshot` insert was terminated by
   signal 9.
2. PostgreSQL terminated the other server processes and reinitialized.
3. WAL recovery completed and the database returned to service.
4. Immediate admission attempts received `53000` during recovery.

This evidence rules out a strategy decision as the cause. The source audit and
the prior storage audit also rule against a simple application pool leak as the
primary trigger. Before the incident, a max-one diagnostic and a two-minute
bounded soak passed with two observed database sessions, zero idle-in-
transaction sessions, and zero soak errors.

The exact backend SIGKILL and triggering SQL are proven. A provider or node
resource limit is a strong explanation because the service has 1 GB RAM and
the insert was a multi-megabyte JSONB document, but Aiven did not expose the
kernel cause. This receipt does not relabel that inference as fact.

## Measured amplification

The prior read-only storage audit measured:

| Relation | Estimated rows | Total bytes | TOAST bytes |
| --- | ---: | ---: | ---: |
| `trade.fusion_snapshot` | 107 | 486,400,000 | 485,449,728 |
| `research.theta_option_chain_decision_evidence` | 107 | 120,274,944 | 118,923,264 |

The old writer duplicated the full normalized option chain inside the fusion
snapshot, the research chain document, the full canonical frontier, the
decision receipt, per-candidate evidence, and shadow opportunity rows. Zero
orders could therefore produce large PostgreSQL growth and a large single
transaction.

## Implemented correction

Migration `067_postgres_cycle_evidence_compaction` adds storage metadata and a
compressed immutable evidence archive. New cycle persistence performs these
steps:

1. Verify the original full FusionSnapshot and its content hash.
2. Serialize one canonical full-cycle archive containing the complete snapshot,
   full frontier, Q evidence, decision receipt, and shadow opportunities.
3. Gzip that archive, record its hash and exact compressed and uncompressed
   byte counts, and reject it before SQL if it exceeds the governed bound.
4. Store a bounded queryable fusion projection containing only selected,
   near-miss, best-rejected, diagnostic, and open-position contract evidence.
5. Store a bounded canonical-frontier and decision projection while preserving
   the original full content hashes as lineage.
6. In production storage mode, persist only bounded operational candidates and
   shadow states. Full candidate research remains in the immutable archive.
7. Keep event revisions in PostgreSQL, while replacing duplicate non-event raw
   Optionomics payloads with an explicit archive manifest.
8. Let the existing closed-session Windows exporter decode the full archive,
   verify the original frontier hash, write SQLite WAL, and compact to verified
   Parquet/DuckDB.

This changes storage representation only. Candidate generation, thresholds,
AEGIS, sizing, execution gates, strategy authority, broker authority, and live
money authorization are unchanged.

## Stage truth for the interrupted no-submit run

| Stage | State |
| --- | --- |
| Provider and account reads | Reached |
| Database admission and initial reads | Reached |
| SPY database-independent observation | Reached |
| Canonical candidate enumeration | Not completed |
| Q economics | Not proven |
| AEGIS | Not reached |
| Sizing | Not reached |
| Finalist exact contract and quote | Not reached |
| Canonical strategy action | Not proven |

The fallback `SYSTEM_HOLD` reason was
`RUNTIME_STAGE_DEFERRED:PROVIDER_STATE`. It is an infrastructure result and
must never enter WAIT-selectivity or strategy-performance statistics.

## Verification

- Focused storage, cycle-store, and local-archive tests: pass.
- Full Node suite: 2,307 pass, 14 skip, 0 fail.
- TypeScript check: pass.
- ESLint: pass.
- Production build: pass.
- Secret scan: 1,362 paths, 0 findings.
- Fresh max-one Aiven diagnostic after recovery: pass, read-only off, two
  sessions, zero idle-in-transaction sessions.
- Local disposable PostgreSQL migration test: unavailable because Docker and a
  local PostgreSQL service were not running.
- Aiven migration: not yet attempted.
- Current-release runtime proof: not yet attempted.

## Safety receipt

`ORDER_SUBMISSIONS = 0`

`BROKER_MUTATIONS = 0`

`FOLLOWERS = LOCKED`

`LIVE_MONEY = NOT_AUTHORIZED`

`RUNNING_WORKER_CHANGED = NO`
