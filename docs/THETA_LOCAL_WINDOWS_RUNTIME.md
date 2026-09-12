# THETA local Windows shadow runtime

## Purpose

The owner's Windows laptop is the temporary continuous host for THETA shadow evidence collection. The installed task only triggers the authenticated Production read-only runtime. Alpaca credentials, the credential-encryption key, and the Neon connection stay inside Vercel Production. The Task Scheduler command line contains no secret.

The local supervisor is pinned to the exact tested `origin/main` SHA recorded at installation. It never pulls code automatically. A changed checkout or dirty tracked file makes startup fail closed.

## Runtime flow

1. Windows Task Scheduler starts `tools/windows/theta-local-worker.ps1` at user logon.
2. A local named mutex prevents duplicate supervisor processes.
3. The supervisor authenticates to `/api/theta-runtime` using an ignored local token.
4. Production acquires the singleton `THETA_MASTER_SHADOW_COLLECTION` database lease.
5. Each cycle reconciles the Alpaca Paper account before management or discovery.
6. Closed sessions reconcile and wait. Supported open sessions scan and persist point-in-time evidence.
7. Network failures use bounded exponential backoff.
8. A graceful stop writes a stop request, releases the lease, and records the worker offline.
9. A heartbeat gap records missed observation horizons as `HOST_OFFLINE`. No later quote is substituted for the missed timestamp.

The endpoint and worker both retain `executionGate=LOCKED`. The read-only runtime has no submit, replace, cancel, exercise, or DNE broker methods.

## Installation and updates

Codex provisions the ignored token, redeploys Production so the rotated token is active, applies migration `020_local_worker_runtime`, and then runs the installer. The installer requires a clean `main` that exactly matches `origin/main`.

An update is deliberate:

1. stop the worker
2. validate and push a new canonical SHA
3. deploy and apply migrations
4. rerun the installer to pin the new SHA

Startup never follows arbitrary new commits.

## Operator evidence

`ops.runtime_worker_status` holds current sanitized health. `ops.runtime_worker_lease` enforces one primary collector. `ops.runtime_worker_event` is append-only startup, lease, gap, shutdown, and error evidence. The private operations UI reads the same status, including build SHA, heartbeat, market session, provider health, last reconciliation, and last candidate scan.

Local status is also available through `npm run worker:windows:status`. It contains no credentials.
