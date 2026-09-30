# THETA database and storage authority

Status: canonical runtime policy as of 2026-09-18.

## Authority boundaries

| Store | Authority | Allowed content | Failure effect |
| --- | --- | --- | --- |
| Alpaca Paper | Current broker truth | Account, positions, orders, fills, activities, assignment, expiry | Broker mutations fail closed |
| Aiven PostgreSQL | Transactional THETA truth | Decisions, intents, lifecycle, accounting, idempotency, leases, risk and promotion state | Runtime mutation fails closed |
| Neon archive | Read-only historical source | Preserved legacy evidence pending controlled import | Non-blocking for current runtime |
| Local runtime receipts | Sanitized operations recovery | Allowlisted health, gate and count fields | Noncritical |
| Local durable evidence | Content-addressed research and recovery bundles | Deterministic PIT exports, provenance, lifecycle and outcome evidence | Noncritical |
| Local ephemeral storage | Cache and disposable computation | Regenerable intermediate data | Noncritical |

## Repository visibility and data placement

The `smokychain22/trading-bots` repository was observed as public on 2026-09-30. Visibility is an owner decision and this policy does not change it. Treat every commit, including Git history, as public. Use these explicit tiers:

| Tier | Allowed content | Prohibited content |
| --- | --- | --- |
| `PUBLIC_REPO_SAFE` | Source, schema, policy, documentation, synthetic fixtures, and sanitized compact manifests | Credentials, broker/account records, raw provider responses, private datasets, database dumps, and production environment files |
| `LOCAL_PRIVATE` | Git-ignored runtime configuration, bounded outage spool, private diagnostic receipts, and encrypted or access-controlled local archives | A second transactional trading authority |
| `DATABASE_PRIVATE` | Aiven transactional state, compact audit identity, idempotency, leases, and controlled operational evidence | Unbounded raw research history or a substitute for external archive storage |
| `EXTERNAL_PRIVATE_STORAGE` | Verified large immutable archives, Parquet history, and recovery artifacts with hashes and access controls | Broker mutation authority or unhashed evidence promoted to empirical truth |

Do not infer privacy from `package.json`'s `private` flag. That flag prevents npm publication and says nothing about GitHub visibility. GitHub Releases and Git LFS under this repository are public too. Before committing, run `scan:security` and `storage:git-policy`; neither scan proves that historical commits never exposed a secret. Historical exposure needs a separate bounded review and an owner-led response without printing values or rotating credentials automatically.

Local evidence never becomes broker, lifecycle, idempotency, or transactional authority. It cannot authorize an order.

## Environment contract

- `DATABASE_RUNTIME_AUTHORITY=AIVEN` requires `AIVEN_DATABASE_URL`.
- Runtime and migration code selects `AIVEN_DATABASE_URL` directly when Aiven is authoritative. A stale `DATABASE_URL` cannot override it.
- `NEON_ARCHIVE_DATABASE_URL` is the explicit read-only archive source.
- `LEGACY_NEON_DATABASE_URL` is a typed derived value. For compatibility, it may fall back to `DATABASE_URL` only when that URL has a `*.neon.tech` host.
- No tool may use a generic URL as a Neon archive merely because its variable is named `DATABASE_URL`.

The server, worker, customer tools, provider tools, research export, outcome resolver, readiness tools, migration tool and verification tool all pass through either the typed environment loader or the explicit CLI database resolver.

## Durable evidence contract

`tools/write-local-durable-evidence.mjs` takes the existing deterministic export in `research_exports/latest` and writes an immutable bundle under `.theta-local-worker/evidence/<bundle-hash>`.

Each bundle contains:

- `dataset.json`
- `manifest.json`
- `data-quality.json`
- `handoff.json`
- `bundle-receipt.json`

The receipt records file hashes, sizes, dataset identity, schema and feature versions, source window, and the explicit `RECOVERY_AND_RESEARCH_SUPPORT_ONLY` authority. The writer rejects credential-shaped keys, authorization material, and database connection strings. Rewriting an existing bundle with different bytes fails.

Retention is append-only by default. No automatic deletion occurs. `latest.json` is only a pointer. Content-addressed directories are portable recovery exports and can be copied to approved backup storage without changing identity. Any future pruning policy must preserve the latest accepted Paper lifecycle, all unresolved chains, promoted-policy evidence, and the hashes needed to verify retained bundles.

## Operational behavior

The Windows supervisor writes the durable bundle after a deterministic research export exists. A local evidence failure is recorded as `FAILED_NONCRITICAL` and does not stop reconciliation, management, or Aiven persistence. Aiven or broker consistency failures remain blocking.
