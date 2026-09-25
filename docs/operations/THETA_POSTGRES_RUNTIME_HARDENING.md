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
