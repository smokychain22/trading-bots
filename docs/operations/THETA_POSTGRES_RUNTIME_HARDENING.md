# THETA PostgreSQL runtime hardening

Status: source hardening in progress. This document is a connection ownership map, not a claim that Aiven is stable.

## Authority and failure semantics

PostgreSQL remains authoritative for reconciliation, lifecycle, decision, intent, and lease state. The SQLite WAL outbox may retain immutable observations during an outage, but it cannot authorize risk. A database interruption is `INFRASTRUCTURE_DEFERRED`. It is excluded from strategy WAIT and rejection statistics.

Recovery requires four successful physical connection probes separated by 30 seconds. The recovered worker starts a new cycle from broker reconciliation. A pre-failure snapshot, candidate, AEGIS assessment, sizing result, finalist, or plan cannot cross the recovery boundary.

## Production connection budget

The provider limit observed on 2026-09-25 was 20 sessions. THETA's per-process budget is capped below that limit. Separate Vercel instances can still multiply process-local pools, so market-critical diagnostic and research tools must remain deferred.

| Component | Pool max | Timeout | Idle timeout | Lifetime | application_name | Lifetime/overlap | Operations and protection |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| Vercel autonomous runtime | 2 | 8s | 10s | 60s | `theta-runtime` | module shared, resident request path | mixed reads/writes, connection errors classified, checked-out clients discarded by runtime wrappers where used |
| Customer/master credential store in runtime | 0 additional | shared | shared | shared | shared runtime pool | runtime context resolution | credential reads reuse canonical runtime authority |
| Customer HTTP API | 2 | 8s | 10s | 60s | `theta-customer-control` | module shared, separate API workload | mixed reads/writes, bounded shared pool |
| Master-role administration | 1 | 5s | 10s | 60s | `theta-master-role` | module shared, owner administration only | mixed reads/writes, must not run during market-critical cycle |
| Native resident worker | 2 | 8s | 10s | 60s | `theta-resident-worker` | persistent, alternative deployment to Windows HTTP supervisor | runtime and lease state, classified pool/client errors |
| Operator control inside runtime cycle | 0 additional | shared | shared | shared | shared runtime pool | per cycle | replay-safe read retry, transactional writes with ambiguous-COMMIT verification |
| Windows HTTP supervisor | 0 | HTTP bounded | n/a | n/a | n/a | one local mutex owner | drives one server cycle at a time and opens a DB circuit on typed transient failures |

Normal Windows/Vercel decision-runtime demand in one warm process is at most two PostgreSQL clients. Owner administration can add one. A separate native resident worker uses two instead of the Windows/Vercel path and must not run concurrently as a second primary. At least 17 of 20 provider slots remain outside one normal runtime process. Customer HTTP traffic and horizontal serverless instances can still multiply pools, so exports, backfills, history certification, storage audits, readiness sweeps, and manual diagnostics are prohibited from market-critical overlap.

## Non-runtime tools

CLI and recovery tools own bounded pools, generally max 1. Database migration, legacy import/promotion, forensic import, research export, history certification, IV backfill, storage audit, and readiness commands are operator jobs. They do not share the trading pool and must not overlap the market-critical worker. Migration and restore utilities remain deliberately isolated because their transaction and lifecycle requirements differ from trading runtime queries.

Every source-owned `new Pool(...)` constructor under `src/` and `tools/` has a distinct `application_name`. `tests/postgres-application-identity.test.ts` scans those source trees and fails if an unnamed pool is introduced. This makes future `pg_stat_activity` ownership evidence attributable without changing connection limits or query behavior.

## Soak timeout authority

The strict Phase-1 soak has two separate timeout meanings. A pooled client may wait at most 5,000 ms when the pool is already occupied. A new physical connection may take at most 8,000 ms, matching the existing recovery-gate and database-preflight connection window. The pool-wait limit is enforced outside `pg-pool`, and a client that arrives after that limit is released immediately.

The 8,000 ms value is THETA's current bootstrap reliability policy. It is not an Aiven requirement or an external service guarantee. Commit `b566253` introduced it after a 40-attempt characterization produced 40 successes, P50 1,107.864 ms, P95 2,815.925 ms, and maximum 7,177.684 ms. Its runtime SLO is precise: physical PostgreSQL establishment must finish before 8,000 ms. The strict checkpoint stops on a breach and retains the phase evidence. It does not raise the limit or retry to obtain a green result. A future change requires a larger qualified sample and a versioned policy decision.

The earlier 5,000 ms physical-connection value was introduced directly in the soak implementation and had no separate policy authority. A 40-sample sequential Aiven characterization on 2026-09-28 produced 40 valid connections, P50 1,107.864 ms, P95 2,815.925 ms, and a valid maximum of 7,177.684 ms. That maximum included 3,493.316 ms DNS and 1,744.217 ms TCP, then completed TLS, PostgreSQL startup, its first query, and explicit close. This evidence makes 5,000 ms unsuitable as the physical-connect limit while retaining it as a bounded pool-wait limit. The 8,000 ms physical limit is a reliability gate, not a retry or permission to hide a failed connection.

The first full soak after separating those limits ran for 901.238 seconds, completed 137 bounded batches and 959 reads, acquired and released all 1,054 clients, completed 46 fresh connections, and observed no acquisition failure, leak, retry, postmaster restart, classified pool error, or unknown PostgreSQL error. Its receipt still failed because `maxPoolWaiting` reached one. The recorded observations prove the nonzero count occurred with two idle clients and resolved in zero to one millisecond. `pg-pool` appends an idle-client checkout to its pending queue and schedules `_pulseQueue()` on `process.nextTick`, so a second same-turn bounded task can observe one pending handoff before the idle client is delivered. Every one of the 137 post-batch progress receipts reported zero waiters.

Soak acceptance therefore records every pending handoff as an explicit wait event with batch, timing, pool, concurrency, operation, result, classification, and post-batch drain evidence. Queue depth alone has no pass/fail authority. A soak fails on an acquisition timeout, a wait reaching the governed 5,000 ms boundary, an acquisition failure, incomplete or over-concurrent batch, a client leak, a waiter remaining after a batch or at final completion, a classified or unknown PostgreSQL error, a recovered strict-soak retry, an idle transaction leak, or a postmaster restart. Fresh probes use the same one-connection, one-query, explicit-close behavior while now recording DNS, TCP, TLS, PostgreSQL startup, total connection, first-query, and close timings. An unavailable phase remains `null`.

The later failed soak exposed two receipt defects. `pg-pool` uses the same pending queue and generic timeout text for a saturated checkout and for a new physical connection. Classification now uses pre-acquisition capacity after subtracting already-promised idle clients. Generic error text cannot override that state. A state with `total=1`, `idle=1`, `waiting=1`, and `max=2` has no unpromised idle client and still has a free physical slot, so it is `NEW_CONNECTION`, not pool starvation. The bounded runner also drains every already-started sibling task before returning the primary failure. This prevents pool shutdown from creating a misleading secondary error. Every started batch is persisted as `PASS` or `FAILED`, including partial task counts, final queue state, and the typed primary failure.

The strict Phase-1 soak is a zero-irregularity certification. It does not use the runtime read retry and fails if any recovered retry appears. Normal runtime `SAFE_IDEMPOTENT_READ` operations may use their bounded fresh-client retry. The two policies serve different purposes and must not be conflated.

## Query replay classes

- `SAFE_IDEMPOTENT_READ`: use `withRuntimePostgresReadRetry` when on a critical runtime boundary. Each retry checks out a fresh client.
- `IDEMPOTENT_WRITE`: no generic retry. Reconcile using immutable identity before deciding whether to retry at the owning workflow level.
- `NON_IDEMPOTENT_WRITE`: never replay automatically.
- `TRANSACTIONAL_WRITE`: use `withRuntimePostgresTransaction`.
- `COMMIT_OUTCOME_SENSITIVE`: a lost COMMIT becomes `POSTGRES_COMMIT_OUTCOME_UNKNOWN` until a fresh identity read proves the outcome.

The operator-control current-state read and active lease-owner read now use the fresh-client read retry. Operator-control writes already use the transaction wrapper and immutable idempotency key verification. Remaining direct writes deliberately rely on their owning transaction or idempotent identity rather than a blind query retry.

## Typed database incident codes

Observed and governed codes include `POSTGRES_57P03`, `POSTGRES_57P01`, `POSTGRES_CONNECTION_TERMINATED`, `POSTGRES_CHECKED_OUT_CLIENT_LOST`, `POSTGRES_CONNECTION_ACQUISITION_TIMEOUT`, `POSTGRES_ECONNRESET`, `POSTGRES_ETIMEDOUT`, `POSTGRES_EPIPE`, SQLSTATE class `08`, and `POSTGRES_COMMIT_OUTCOME_UNKNOWN`. Receipts contain only safe codes, never provider messages or connection strings.

## Circuit states

`DB_HEALTHY` permits a fresh decision cycle. `DB_TRANSIENT_FAILURE` records the first typed incident. Repetition moves to `DB_CIRCUIT_OPEN`. The supervisor then performs only `DB_RECOVERY_PROBING`. Four successful fresh probes over 90 seconds produce `DB_RECOVERED`, while decision authority remains deferred. The next full cycle moves to `DB_HEALTHY` and begins from reconciliation. Any probe failure reopens the circuit.
