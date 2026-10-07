# THETA broker-confirmed orphan position recovery

Status: SOURCE ONLY, wired in the default read-only `OBSERVE` mode. Not deployed.

## Problem (2026-10-07)

A THETA `SELL_TO_OPEN` filled at the broker, but its `SHORT_PUT_OPEN` lifecycle application was rejected by the schema-069 CHECK (23514).

- The chain stayed `WAIT` with zero option legs.
- The management loader excluded it, so a real short put had no management owner.

The same shape follows from any registration failure: a schema bug, a DB commit failure, or a worker crash between the fill and its registration.

Classification: `BROKER_CONFIRMED_POSITION_LIFECYCLE_REGISTRATION_BLOCKED`.

## One authority, no second executor

The orphan path feeds the existing sovereign management authority. It does not use a parallel executor, and it never calls Alpaca directly.

| Step | Code |
| --- | --- |
| Classify broker truth against THETA lineage | `classifyBrokerConfirmedOrphan` (pure) |
| Decide HOLD or CLOSE_RISK | `decideOrphanRiskAction`: no owner policy means `HOLD` |
| Governed authority rows | `buildOrphanManagementAuthority` + `PostgresOrphanManagementAuthorityStore` |
| Plan | `buildOrphanRiskClosePlan`: one whole-position `CLOSE_CSP` |
| Decision + publication | `buildOrphanManagementDecisionDraft` → `PostgresMasterPaperActionPlanStore.publishManagementPlans` (unchanged) |
| Execution | The normal dispatch / PaperOrderCoordinator path: quote refresh, 150 s mutation fence, 30 s plan window, claim, `verifyBeforeSubmit` |
| Bookkeeping | `applyConfirmedFillLifecycle`: `SHORT_PUT_OPEN`, then `OPTION_CLOSE`, in one cycle |

**Authority rows**

- The input snapshot records `lifecycle_state=WAIT` and `input_json.inputKind=BROKER_CONFIRMED_ORPHAN`.
- The frontier selects exactly `HOLD` or `CLOSE_FULL`.
- IDs are content-derived, and the inserts are `ON CONFLICT DO NOTHING` with a read-back. A replay maps to the same rows.
- The writer refuses with `ORPHAN_CHAIN_NO_LONGER_WAIT` once the lifecycle owns the chain.

**Publication**

- The plan uses the same authority reference as normal management (`management:<frontier>:CLOSE_FULL`), so every existing `publishManagementPlans` check applies unchanged: frontier selection, policy lineage, input snapshot, account and group shape.
- At claim time, `managementDecisionIsCurrent` (chain still `WAIT`) supersedes an orphan plan as soon as the lifecycle takes over.

**Protecting the normal loader**

- The normal loader never treats an orphan snapshot as its predecessor (it filters on `inputKind`). Shadow-management code that reads `previous.context` is therefore never handed an orphan-shaped row.

## Generic identity

Exact recovery needs the full identity, including the broker position itself:

- strategy branch;
- candidate;
- action plan;
- order intent;
- client order ID;
- broker order ID;
- contract and quantity.

**Outcomes**

- **Any member missing:** `RECONCILING` (`ORPHAN_LINEAGE_INCOMPLETE_RECONCILING`). Nothing is adopted or written.
- **Contradictory evidence** (side, symbol, quantity, price or chain): `REFUSED` with a typed `ORPHAN_*` code.
- **D native spreads:** `ORPHAN_STRATEGY_NOT_SUPPORTED`, because they have their own typed lifecycle.

## Modes (`THETA_ORPHAN_RECOVERY_MODE`)

**`OBSERVE` (default)**

- It runs one read-only SQL query for unowned short option positions in the GOOD reconciliation snapshot, plus one lineage query per such position.
- It makes no market read. It writes no rows and places no orders.
- The `POSITION_MANAGEMENT_SCAN` result becomes degraded with the typed code instead of `skipped`.
- With zero orphans, the behaviour is identical to the prior release, apart from that one extra read.

**`CLOSE_RISK_CERTIFIED`**

- It makes one Alpaca market read per orphan: an exact-strike option snapshot plus the IEX underlying quote.
- It persists the governed rows.
- It publishes a close only when an owner trigger in `THETA_ORPHAN_RISK_CLOSE_POLICY_JSON` fires and the quote is fresh. There is no default threshold.
- Any in-flight plan or order on the chain blocks a second close, so there is a single owner across restarts.

**`OFF`** disables the read entirely.

## Close-before-registration bookkeeping

Fill rows are replayed in intent-creation order, so the open is applied first. That open creates the deterministic leg `option-leg:<open intent>`.

A pass that newly applies an open and still has unresolved facts runs exactly one more pass. `OPTION_CLOSE` then resolves against that leg within the same cycle.

**Idempotency**

- Applications are keyed by evidence key, the leg ID is deterministic, and copy events are keyed by ID.
- `tests/orphan-open-close-convergence.test.ts` drives the real orchestrator, lifecycle store and copy planner over an in-memory emulation. It proves:
  - exactly one `SHORT_PUT_OPEN` and one `OPTION_CLOSE`;
  - one leg (the premium is recorded once);
  - realized P&L = credit − debit;
  - two copy events;
  - pure duplicates on three later replays.

**Capital release** follows broker truth (account exposure reads broker positions) and terminal plans or intents. Nothing extra is booked.

## Remaining before `CLOSE_RISK_CERTIFIED` may be enabled

1. **Owner trigger values** for `THETA_ORPHAN_RISK_CLOSE_POLICY_JSON`.
2. **A DB-level end-to-end test** against `TEST_DATABASE_URL`: orphan → authority rows → publish → claim → `verifyBeforeSubmit`. The SQL-validity test is written and skips without a database.
3. **Exact-SHA CI and an observed `OBSERVE` cycle in Production**, before any certification.
