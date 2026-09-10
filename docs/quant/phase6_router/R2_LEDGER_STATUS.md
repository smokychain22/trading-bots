# R2 Ledger — Current Status

Durability artifact for `migrations/004_economic_lifecycle_ledger.sql`,
`tests/sql/004_economic_lifecycle_ledger.sql`, and `src/theta/ledger-contract.ts`.

## What this covers

Extends `migrations/003_immutable_decision_truth.sql` (decision → candidate → fusion
snapshot, already append-only-enforced) with everything downstream: `economic_chain`
(the Wheel lineage grouping), `option_leg` (open/close/roll/expire/assign, realized P&L
immutable once set), `stock_lot` (post-assignment inventory, unrealized MTM visible via
`current_price_per_share`, realized P&L only set on actual disposal — assignment is
never an automatic win), `order_intent` (mirrors `src/theta/order-intent-state.ts`'s
exact state enum), `broker_order`, `fill` (append-only), `assignment_event`/
`expiration_event`/`dividend_event` (append-only), `fee_event`, and
`reconciliation_event` (mirrors the reconciliation states this task's message names:
`MATCHED`/`PENDING`/`PARTIAL_FILL`/`UNKNOWN_SUBMISSION`/`BROKER_ONLY_ORDER`/
`LOCAL_ONLY_INTENT`/`POSITION_MISMATCH`/`FILL_MISMATCH`/`ASSIGNMENT_DETECTED`/
`EXPIRY_DETECTED`/`CORPORATE_ACTION_REVIEW`/`RECONCILIATION_REQUIRED`/`QUARANTINED`).

A roll is enforced as CLOSE OLD + OPEN NEW at the schema level: `option_leg` rows are
linked via `rolled_from_option_leg_id`/`rolled_to_option_leg_id`, never merged into one
row, and a trigger (`trade.reject_realized_pnl_mutation`) makes `realized_pnl` immutable
once set on both `option_leg` and `stock_lot` — a later UPDATE or DELETE targeting a row
with a set `realized_pnl` raises an exception, exactly like the existing
`core.reject_immutable_mutation` trigger 003 already applies to `decision`/
`fusion_snapshot`.

## Important honesty note: NOT executed against a live Postgres this session

Docker Desktop's engine is not running in this environment (`docker info` fails to
reach the daemon; `docker compose up` errors on the named pipe). **This migration and
its accompanying SQL test file were written carefully to match the exact conventions
of `migrations/001-003` and `tests/sql/003_immutable_decision_truth.sql` (same
`\set ON_ERROR_STOP on` / transaction / fixture / `DO $$ ... EXCEPTION WHEN ... END $$`
pattern, same placeholder-checksum convention, same schema/table naming), but neither
file has been run against a real database this session.** This is flagged explicitly
rather than silently presented as verified — the same discipline applied to the
missing Alpaca credentials. Whoever has a working Docker environment (or Codex's CI,
which already runs exactly this apply-migrations-then-run-sql-tests loop per
`.github/workflows/ci.yml`) should run these two files before trusting them as
correct; a syntax or constraint-logic error is possible and has not been ruled out by
actual execution.

## What IS genuinely tested this session (no DB required)

`src/theta/ledger-contract.ts` — the TypeScript-side ledger contract mirroring the SQL
schema, plus `computeWholeChainPnl()`, the pure-function implementation of
`WholeChainPnl = RealizedStockPnl + UnrealizedStockPnl + RealizedOptionPnl +
UnrealizedOptionPnl + Dividends - Fees` (slippage folded into fees for now — this
ledger schema has no separate slippage line item yet, flagged rather than silently
assumed zero). 11 tests, all passing, covering: a closed leg requires both
`closeReason` and `realizedPnl`; an open leg must not carry one; a disposed stock lot
requires `realizedPnl` (assignment/disposal is never a silent non-event); an open lot
must not carry one; dividends are correctly scaled by the paying lot's share count (a
real bug caught and fixed while writing this test, before it ever shipped); a
dividend referencing an unknown lot is excluded, not guessed; an old roll's realized
loss is preserved unchanged even after a new leg opens; an unknown current price is
excluded from unrealized MTM, never assumed to be zero; and a fully resolved chain
correctly reports no unresolved open positions.

## Status

SPECIFIED + IMPLEMENTED (schema + TS contract), **UNVERIFIED against a live database**.
Genuinely tested: the TS-side contract and P&L calculator only.
