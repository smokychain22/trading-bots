# Legacy Neon data manifest

Status date: 2026-09-16

This manifest contains no database credentials or connection strings.

## Authority and preservation

- Provider: `NEON`
- Project identity: Vercel-connected Production PostgreSQL project, exact provider identifier intentionally omitted from the repository
- Branch identity: provider default/main branch
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
- Last known PostgreSQL size: approximately 0.27 GB from the provider control-plane receipt, to be reverified when readable
- Current access blocker: SQLSTATE `53000`, provider transfer/resource quota
- Quota reset metadata: not available through the current database protocol response
- Bootstrap lineage: repository migrations `001` through `049`
- Aiven cutover SHA: `NOT_YET_CUT_OVER`

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

The 2026-09-16 non-destructive search found repository research exports with dataset manifests and hashes.
These are candidate historical research artifacts, not a complete PostgreSQL backup. No validated
`pg_dump` or custom-format PostgreSQL backup was identified. SQL files found in the workspace are schema
migrations/specifications and are not database exports.

## Deferred trigger

When Neon becomes readable: create a consistent export, compute a checksum, inventory and restore to
isolated staging, compare with Aiven, classify data families, deduplicate, validate point-in-time and
synthetic/real provenance, backfill approved evidence, and expose only approved history to research.
