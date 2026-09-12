# THETA host-independent worker runtime

Status: `EXTERNAL_WORKER_HOST_DEFERRED_UNTIL_PAPER_READINESS`

The repository contains a resident THETA worker that can run on a generic Docker host.
No permanent worker is deployed yet. Vercel remains the web control plane and its
authenticated bounded runtime endpoint remains available for explicit invocations.

## Safety boundary

The worker starts only when all of these are true:

- `THETA_AUTONOMOUS_WORKER_ENABLED=true`
- a database connection is configured
- the encrypted Paper credential key is configured
- `PAPER_PAUSE_NEW_ORDERS=true`
- `MASTER_PAPER_EXECUTION_ENABLED=false`
- `FOLLOWER_PAPER_EXECUTION_ENABLED=false`
- a Python runtime is available

This makes the current container read-only at the broker boundary. Startup fails if
an execution flag is enabled. The runtime uses the exact Alpaca Paper host in the
application adapter and never accepts a host from the worker deployment file.

## Container targets

The single `Dockerfile` has two final targets:

- `control-plane`, the existing web/API server on port 3000
- `worker`, the Node scheduler and Python quant runtime on port 3001

Both run as the unprivileged `node` user. The image contains no environment file or
secret. `.dockerignore` excludes local environments, Vercel state, tests, reports,
and Git history. `docker-compose.worker.example.yml` shows a generic deployment with
a read-only filesystem, dropped Linux capabilities, a small `/tmp` tmpfs, and
restart-on-failure behavior. Its `.env.worker` file is deliberately absent and ignored.

## Runtime behavior

The worker validates its locked execution boundary, database, and Python runtime. It
serves sanitized `/healthz` and `/readyz`, runs one cycle immediately, and schedules
later cycles without overlap. PostgreSQL leases and deterministic job IDs suppress
duplicates. Broker reconciliation and ambiguous-submit recovery precede later work.
On `SIGINT` or `SIGTERM`, the worker waits for the active cycle, closes its HTTP server,
then closes the database pool.

`/readyz` can be ready while the last cycle is degraded. Degraded means the process,
Python runtime, and database work but trading evidence is incomplete. Detailed cycle
status remains in PostgreSQL. Health responses contain no credentials, broker identity,
holdings, or authorization headers.

## Commands

After compiling:

```text
npm run build
npm run worker:start
```

Future generic Docker host:

```text
docker compose -f docker-compose.worker.example.yml up -d --build
```

This command is documentation only during the current phase. Docker Desktop was not
running during initial verification, so an image build remains an explicit gap.

## Research evidence export

After genuine point-in-time candidate evidence exists, create the deterministic,
Git-ignored research handoff with:

```text
npm run theta:research-export -- --latest
```

For a bounded window, use `--from <ISO time> --to <ISO time>`. The command writes
`dataset.json`, `manifest.json`, and `data-quality.json` under both
`research_exports/<dataset hash>/` and `research_exports/latest/`. It returns a
truthful `NO_POINT_IN_TIME_EVIDENCE_TO_EXPORT` receipt when no real evidence exists.
It never creates synthetic evidence and never exports secrets.
