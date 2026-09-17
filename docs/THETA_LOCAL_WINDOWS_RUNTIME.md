# THETA local Windows shadow runtime

## Purpose

The owner's Windows laptop is the temporary continuous host for THETA Paper operations and evidence collection. The installed task triggers the authenticated Production runtime. Broker credentials, the credential-encryption key, and the Aiven connection stay inside the secure Production environment. The Task Scheduler command line contains no secret.

The local supervisor is pinned to the exact tested `origin/main` SHA recorded at installation. It never pulls code automatically. A changed checkout or dirty tracked file makes startup fail closed.

## Runtime flow

1. Windows Task Scheduler starts `tools/windows/theta-local-worker.ps1` at user logon.
2. A local named mutex prevents duplicate supervisor processes.
3. The supervisor authenticates to `/api/theta-runtime` using an ignored local token.
4. Production acquires the singleton worker lease.
5. Each cycle reconciles the Alpaca Paper account before management or discovery.
6. Closed sessions reconcile and wait. Supported open sessions scan and persist point-in-time evidence.
7. Network failures use bounded exponential backoff.
8. A graceful stop writes a stop request, releases the lease, and records the worker offline.
9. A heartbeat gap records missed observation horizons as `HOST_OFFLINE`. No later quote is substituted for the missed timestamp.
10. A complete dataset is researched once per dataset-hash and worker-build pair. An existing immutable result is reused only after its dataset, code, experiment, feature, evidence-source, and strategy identities all match.
11. After each bounded cycle, the supervisor writes a sanitized append-only local receipt under `.theta-local-worker/receipts/<market-session-date>/`. Each receipt is hash-chained to the previous receipt and `latest.json` points to the newest item.

The current gate remains controlled by Production. The supervisor never bypasses it and contains no direct Alpaca mutation code.

## Local durability boundary

Aiven is the only live transactional runtime authority. Local receipts are a recovery and audit layer, not a second database and not a trading input. A local disk failure is reported in worker health but does not create split-brain state.

The local writer uses a fixed allowlist. It stores build and mode identity, gate state, scope outcomes, safe reconciliation counts, market-session state, research-export state, and zero-or-positive order counts. It rejects or discards credentials, account identifiers, symbols, positions, raw provider payloads, and unknown fields. The ignored `.theta-local-worker` directory must never be committed.

Research exports remain separately available under the ignored `research_exports` and `research_outputs` directories. Their dataset identity and hash determine whether they can be reused. They do not override Aiven, Alpaca broker truth, or current provider observations.

## Installation and updates

Codex provisions the ignored token, redeploys Production so the rotated token is active, applies the canonical migration set, and then runs the installer. The installer requires a clean `main` that exactly matches `origin/main`.

An update is deliberate:

1. stop the worker
2. validate and push a new canonical SHA
3. deploy and apply migrations
4. rerun the installer to pin the new SHA

Startup never follows arbitrary new commits.

## Operator evidence

`ops.runtime_worker_status` holds current sanitized health. `ops.runtime_worker_lease` enforces one primary collector. `ops.runtime_worker_event` is append-only startup, lease, gap, shutdown, and error evidence. The private operations UI reads the same status, including build SHA, heartbeat, market session, provider health, last reconciliation, and last candidate scan.

Local status is also available through `npm run worker:windows:status`. It contains no credentials.
