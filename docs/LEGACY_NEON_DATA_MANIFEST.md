# Legacy Neon data manifest

Status date: 2026-09-16

This manifest contains no database credentials or connection strings.

## Authority and preservation

- Provider: `NEON`
- Project identity: Vercel-connected Production PostgreSQL project. Exact provider identifiers are stored only in the ignored recovery receipt and Aiven legacy staging.
- Branch identity: provider default/main branch plus two preserved Vercel preview branches
- Branch role: legacy Production source
- Runtime authority after cutover: `NO`
- Historical value: `YES`
- Deletion: `FORBIDDEN`
- Mutation during recovery: `NO`
- Backfill required: `YES`
- Export required for current progress: `NO`
- Export required for eventual historical completeness: `YES`
- Recovery phase: `NEON_LEGACY_DATA_RECOVERY`
- Recovery status: `PRESERVED_TEMPORARILY_INACCESSIBLE`
- Last known migration head: `049_p2g_simulation_and_preview`
- Last known PostgreSQL version: 18
- Last known PostgreSQL size: 270.1 MB logical storage plus 0.18 GB retained history, to be reverified when readable
- Current access blocker: SQLSTATE `53000`, provider transfer/resource quota
- Quota metadata: 5.72 GB used against a 5 GB monthly network-transfer allowance. Reset metadata was not exposed.
- Bootstrap lineage: repository migrations `001` through `050`
- Aiven cutover SHA: `530ff2ceee632f7cce1c585669efe3dd22703a0b`

## Preserved branches

The control plane confirms the default `main` branch and the Vercel preview branches for
`codex/master-paper-role` and `claude/theta-r1-real-state` remain present. The ignored manifest preserves
their exact provider IDs. Each SQL editor and data-plane surface was tested once. The project-wide quota
prevented row access on all three branches, so no preview branch is claimed as exported.

## Known data families

The source is known to contain customer identity and encrypted Paper credentials, broker-role state,
provider observations and qualification receipts, candidate and decision evidence, path and time
checkpoints, management evidence, simulations, research exports, lifecycle/accounting structures,
worker state, operational events, and execution-gate records. Exact row counts require restored read
access.

## Recovery and merge policy

Recovery is non-blocking for current engineering. When source read access returns, freeze and hash a
consistent export, restore it into an isolated staging database or `legacy_neon` schema, inventory and
classify every table, then backfill only approved historical evidence. Preserve source keys, original
timestamps, source checksums, and import-batch lineage. Stable IDs and hashes must prevent duplicates.

Current authority order is Alpaca Paper for broker state, current qualified Optionomics observations for
provider state, Aiven for current THETA runtime state after cutover, then Neon for historical evidence.
Legacy rows must never overwrite newer account, position, order, provider-health, strategy, execution-gate,
or worker-health state.

## Existing-copy search

The 2026-09-16 non-destructive search found 9,591 candidate archive/data files across the named workspace,
Downloads, Desktop, and temporary roots. A second search covered GitHub workspaces, Claude history, and
Codex temporary state. Repository research exports with dataset manifests and hashes are useful historical
artifacts, but they are not a complete PostgreSQL backup. The only `.backup` file was unrelated CSS. No
validated `pg_dump` or custom-format PostgreSQL backup was identified. GitHub contained 305 non-expired
artifacts, all named `browser-evidence`, with no database dump.

## Deferred trigger

When Neon becomes readable: create a consistent export, compute a checksum, inventory and restore to
isolated staging, compare with Aiven, classify data families, deduplicate, validate point-in-time and
synthetic/real provenance, backfill approved evidence, and expose only approved history to research.
