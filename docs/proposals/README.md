# Proposal SQL — NOT migrations

Files here are **draft proposals**. They are not part of the production migration sequence, are never applied by the migration runner, and never register a
`core.schema_migration` version. The production sequence is `migrations/NNN_*.sql` only (head: `069_multi_leg_order_durability`).

| File | What it is |
|---|---|
| `DP1_data_platform_DRAFT.sql` | data-platform schema `dp.*` (bounded hot storage). Formerly named `069_data_platform_DRAFT.sql`; renamed so it can not be mistaken for migration 069. |
| `DP2_pit_compat_swap_DRAFT.sql` | point-in-time evidence compatibility swap (requires DP1). Formerly `070_…`. |
| `DP3_bounded_historical_truth_DRAFT.sql` | bounded historical truth / session integrity (requires DP1). Formerly `071_…`. |

Turning a draft into a real migration means giving it the next free `migrations/NNN_` number through a governed release, with the upgrade-path proof the
real migrations have (`tests/db/migration-069-upgrade.test.ts` is the pattern). The `MIGRATION_069_REQUIRED` guard text inside DP2/DP3 refers to DP1, not to
`migrations/069_multi_leg_order_durability.sql`.
