# PostgreSQL fault-injection matrix

This matrix binds the database incident cases to executable tests. Passing tests prove the software response. They do not prove current Aiven stability.

| Case | Executed evidence | Expected invariant |
| --- | --- | --- |
| checked-out client error during read | `runtime-postgres-client.test.ts`, checked-out client and fresh-client retry cases | broken client destroyed, replay-safe read uses another client |
| transaction client dies before COMMIT | `runtime-postgres-client.test.ts`, pre-commit rollback case | write is not retried |
| ambiguous COMMIT | `runtime-postgres-client.test.ts`, ambiguous COMMIT cases | immutable identity verification or `POSTGRES_COMMIT_OUTCOME_UNKNOWN` |
| `pool.connect()` acquisition timeout | `runtime-postgres-client.test.ts`, acquisition-timeout case | `POSTGRES_CONNECTION_ACQUISITION_TIMEOUT`, infrastructure deferred |
| SQLSTATE 57P03 | classifier and accelerated soak tests | transient server unavailable |
| SQLSTATE 57P01 | classifier and circuit tests | transient server unavailable |
| database absent across cycles | `database-health-circuit.test.ts` | circuit opens and no strategy evidence is recorded |
| database returns | circuit recovery and Windows supervisor source tests | four fresh probes, then new reconciliation cycle |
| one client dies while another is healthy | fresh-client read-retry test | failed client destroyed, healthy client succeeds |
| connection budget exhausted | runtime pool budget test plus bounded retry/circuit tests | max remains bounded, acquisition timeout classified |
| restart during outage | Windows supervisor recovery-mode source test | infrastructure deferred, locks preserved |
| restart after unknown COMMIT | ambiguous-COMMIT reconciliation tests | no duplicate write or assumed outcome |
| SQLite spool accumulates and replays | local evidence outbox and Windows backfill tests | immutable hash and idempotent replay, no authority |
| stale candidate across outage | circuit receipt and database-resilient observation tests | `carryForwardCandidateAllowed=false`, fresh cycle required |

Every case runs with order submission and broker mutation authority absent. The live Aiven stability gate and disposable PostgreSQL concurrency soak are separate acceptance evidence.
