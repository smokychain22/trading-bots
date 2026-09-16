# Legacy Neon recovery matrix

Status date: 2026-09-16.

The canonical, table-level matrix is generated from Aiven by the protected read-only
`database-legacy-inventory` operation. It inventories every base table in `iam`, `copy`, `core`, `market`,
`strategy`, `execution`, `risk`, `analytics`, `trade`, `ops`, and `research` and records:

- current Aiven row count
- staged legacy row count by source family
- local-export availability
- Git schema reconstructability
- Alpaca current-state reconstructability
- provider current-state reconstructability
- whether the missing history remains Neon-only
- explicit recovery status

Allowed statuses are `FULLY_RECOVERED`, `PARTIALLY_RECOVERED`, `RECONSTRUCTED_CURRENT_STATE`,
`RECONSTRUCTED_SCHEMA_ONLY`, `TEMPORARILY_NEON_BLOCKED`, `EMPTY_BY_DESIGN`, and `UNKNOWN`.
An empty table is never labeled recovered merely because its schema exists. `FULLY_RECOVERED` requires a
readable source inventory and matching validated source and destination identities, so the current classifier
cannot issue that status.

The current staged source families contain 25,125 records from the immutable R6 export. They include
candidate sets, point-in-time candidates, shadow candidates, strategy frontiers, option-chain decisions,
execution evidence, outcome subjects, and resolution receipts. They do not prove recovery of customer,
credential, complete provider observation, operator, lifecycle, or accounting history.

Current broker state is reconstructed only from Alpaca Paper. Current provider state is reconstructed only
from authenticated provider qualification. Neither source replaces missing historical Neon evidence.
