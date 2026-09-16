# Pre-Aiven legacy recovery inventory

Inventory date: 2026-09-16. No secret values or database connection strings are recorded here.

## Deterministic reconstruction

- `GITHUB_SCHEMA_RECONSTRUCTABLE = YES`
- `GITHUB_DETERMINISTIC_STATE_RECONSTRUCTABLE = YES`
- Canonical migration inventory at the time of search: 49 files, `001_phase0_foundation.sql` through
  `049_p2g_simulation_and_preview.sql`, 193,321 bytes total. Migration 050 adds only the isolated
  legacy-staging layer and does not claim to reconstruct historical Production rows.
- GitHub reconstructs schemas, tables, views, functions, triggers, indexes, constraints, registries,
  lifecycle/accounting structures, path/time and management structures, research contracts, and safety
  structures. Fixtures remain test evidence and are never classified as Production history.

## Local artifact search

- `FULL_DB_BACKUP_FOUND = NO`
- `FULL_DB_BACKUP_PATH = NONE`
- `FULL_DB_BACKUP_TIMESTAMP = UNKNOWN`
- Explicit dump extensions searched: `.dump`, `.backup`, `.bak`, `.pgdump`, `.sql.gz`.
- One unrelated CSS backup was found outside THETA. It is not a database artifact.
- 518 `.sql` files were found across the searched roots. The largest THETA files are bootstrap schemas;
  the remainder inspected by location are migration/specification files. None is a validated data dump.
- Search roots covered the THETA repository, parent Codex workspaces, Documents, Downloads, Desktop, and
  the named local evidence directories. Candidate files were not modified.

## Research exports

- `RESEARCH_EXPORT_COUNT = 109`
- `RESEARCH_EXPORT_LATEST_HASH = cb9a967ad03ea7216ce82983cabc0eddfa906fa386fc6d37b6daaed1b79c4294`
- `RESEARCH_EXPORT_TOTAL_ROWS = 244566` across all immutable export versions. Exports are cumulative, so
  this is an artifact-volume count and must not be treated as independent sample size.
- Latest source window: `2026-09-14 13:30:34.54+00` through `2026-09-15 15:46:13.375+00`.
- Latest schema: `theta-r6-dataset-v6`, source class `REAL_POINT_IN_TIME_SHADOW`.
- Latest export has 25,125 family rows, including 7,550 candidates, 7,852 shadow candidates, 8,731
  execution observations, 302 candidate sets, 302 strategy frontiers, 274 outcome subjects, and 112
  resolution receipts. It has zero resolved labels, lifecycle outcomes, whole-chain outcomes, management
  snapshots, policy-learning records, or position-path checkpoints.
- Latest `dataset.json`: 115,813,769 bytes, SHA-256
  `fdedc89f75940fcc978a0f0f805037983e31f14f54e9449383c19a75f125f527`.
- Latest data quality reports 125 effective decision cycles, two market sessions, 100% missing provider
  fields for the affected candidate feature family, and 93.35% missed execution observations. It is real
  shadow evidence, but it is not sufficient for model training or policy promotion.

## Other evidence

- `RESEARCH_OUTPUT_ARTIFACTS_FOUND = YES`, 114 JSON artifacts. They are descriptive/replay research
  outputs tied to dataset hashes and source commits, not broker-confirmed economic outcomes.
- `PAPER_PREFLIGHT_ARTIFACTS_FOUND = NO` as a dedicated local directory.
- `LOCAL_WORKER_EVIDENCE_FOUND = YES`. Runtime/status receipts and dataset/qualification references exist.
  Secret configuration and worker-token files are excluded from inventory content.
- `GITHUB_ACTIONS_ARTIFACTS_FOUND = YES`, 305 non-expired artifacts, all named `browser-evidence`. No CI
  database dump, research export, migration backup, or operator evidence bundle was found.

## Recovery classification

- `REAL_HISTORICAL_DATA_RECOVERABLE_NOW = point-in-time candidate sets, candidate and shadow-candidate
  evidence, strategy frontiers, execution observations, outcome-subject scaffolding, resolution receipts,
  provider qualification references, and descriptive research receipts`.
- `SYNTHETIC_DATA_FOUND = deterministic simulations and replay/descriptive research outputs where their
  manifests declare synthetic or replay provenance`.
- `TEMPORARILY_NEON_BLOCKED_DATA = customer/credential rows, complete provider-observation history,
  runtime/operator events not exported locally, and any other Production rows absent from the exports`.
- `NEON_MAIN_PRESERVED = YES`
- `NEON_PREVIEW_CODEX_PRESERVED = YES`
- `NEON_PREVIEW_CLAUDE_PRESERVED = YES`
- `NEON_DATA_PLANE = QUOTA_BLOCKED`
- `NEON_CONTROL_PLANE = AVAILABLE`
- `AIVEN_LEGACY_STAGING_REQUIRED = YES`
- `HISTORICAL_RECOVERY_VERDICT = PARTIAL`

## Bounded source-surface verdict

- Main pooled PostgreSQL: `BLOCKED`, SQLSTATE `53000`, resource quota.
- Main direct PostgreSQL: `BLOCKED`, SQLSTATE `53000`, resource quota.
- Codex preview SQL surface: `BLOCKED`, project-wide quota.
- Claude preview SQL surface: `BLOCKED`, project-wide quota.
- Data API: no working provisioned data surface could be qualified.
- Time Travel and snapshot surfaces: control-plane shells are present, but data cannot load under the quota.
- No repeated retry loop was run.

`npm run db:neon:recover` provides the resumable path. It makes one bounded probe per configured pooled and
direct source, records a sanitized ignored receipt, and stops when blocked. Once readable, it enumerates
non-template databases, creates PostgreSQL 18 custom-format dumps without owners or ACLs, stores them only
under the ignored recovery directory, and computes SHA-256 for every dump. Credentials are supplied to the
container through process environment and never printed or placed in command arguments.

Recovered records must enter `legacy_neon` staging first. They require provenance, timestamp, point-in-time,
synthetic/real, schema-compatibility, duplication, and content-hash validation before controlled backfill.
No staged history is a current account, broker, provider-health, execution-gate, or worker-state authority.
