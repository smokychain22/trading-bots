# THETA Phase 3 Baseline (2026-10-02)

Status: documentation only. No implementation changed, no migration applied, no Production mutation.

Baseline release: main = Production deployment = Windows worker = `97665fbfd49adac33e0efd6b4a7a92f363f8be69`.
Production schema head: `067_postgres_cycle_evidence_compaction` (migration 068 exists in the repo and is NOT applied).
Gates: execution LOCKED, followers LOCKED, live money NOT AUTHORIZED. No Paper order has ever been submitted by this release.

Scope note: Phase 3 is taken here as the broker and execution state machine (order intent through fill, cancel, replace,
partial fill, reconciliation and restart recovery). The repository holds no single Phase 3 charter, so the capability list below
is reconstructed from the Phase 2 receipt, the execution sources in `src/execution/`, and the deferred items recorded in the
Phase 2 register. Correct the list if the intended Phase 3 denominator differs.

Evidence level used throughout: every ALREADY SHIPPED row is proven by deterministic or disposable-database tests only. None has
been exercised against the Alpaca Paper broker, because no order has been submitted. "Shipped" therefore means present in the
deployed release and test-covered, not observed in Paper.

## 1. ALREADY SHIPPED (in release 97665fb)

| # | Capability | Source files | Tests | Runtime dependency | DB dependency | Remaining risk |
|---|---|---|---|---|---|---|
| 1 | Management repricing driver (persisted attempt state, bounded concessions, replace via coordinator) | `src/execution/management-order-repricing.ts`, `adaptive-limit-policy.ts` | `tests/phase2-repricing-driver.test.ts`, `tests/db/management-reprice-store.test.ts` | worker scan loop in `src/theta/autonomous-runtime.ts`; Alpaca replace/cancel; fresh quote | reads `trade.order_intent`, `master_paper_action_plan`, execution-price events | never run against a real working order; MANAGEMENT orders only (new-risk entry orders are not under this driver); wait interval and concession schedule come from the sealed plan |
| 2 | Floor liveness (cancel at the economic boundary, plan closed, next scan makes a NEW decision) | same | same | same | same | a one-cent move below the SELL floor cancels and the block can repeat each scan (fail-safe, may churn); no cooldown (OSCILLATION-HYSTERESIS is OWNER_POLICY) |
| 3 | Quote freshness contract (decision-time windows, plan windows, submit cap, pre-submit check) | `src/theta/paper-bootstrap-runtime-policy.ts`, `src/execution/master-paper-action-handoff.ts`, `execution-option-quote.ts` | `tests/phase2-repricing-driver.test.ts`, `tests/master-paper-action-handoff.test.ts`, `tests/phase2-fixpass-management-execution.test.ts` | Alpaca option and stock quotes | none | thresholds are bootstrap policy values, unvalidated empirically; pre-submit age is looser than decision age by design |
| 4 | Broker vs ledger share reconciliation (two share truths, typed mismatch, no coercion of UNKNOWN) | `src/theta/stock-share-reconciliation.ts`, `src/execution/alpaca-stock-inventory-source.ts` | `tests/phase2-share-reconciliation.test.ts`, `tests/phase2-stock-inventory-source.test.ts` | Alpaca positions snapshot, fresh pre-submit inventory read | reads `trade.broker_position_snapshot` | mismatch classes `LEDGER_AHEAD_OF_BROKER` and `BROKER_AHEAD_OF_LEDGER` require reconciliation (no automatic repair); candidate causes are hints only |
| 5 | Free sellable shares (shares not committed to short calls or working sell orders) | same, plus `src/execution/management-chain-inflight.ts` | same, plus `tests/phase2-short-call-commitments.test.ts` | Alpaca positions and orders | `trade.order_intent`, plan table | account-wide commitment is conservative against per-chain shares; a fill between snapshot and scan can undercount (snapshot taken in the same scan) |
| 6 | Multi-lot disposal (full position allocated exactly across all open lots, call-away through the same allocator, atomic store) | `src/execution/stock-lot-allocation.ts`, `src/theta/postgres-lifecycle-application-store.ts`, `broker-fill-lifecycle-router.ts` | `tests/phase2-chain-stock-disposal.test.ts`, `tests/db/stock-disposal-lots.test.ts`, `tests/db/lifecycle-application.test.ts` | fill ingestion | `trade.stock_lot`, lifecycle application tables | partial positions are UNKNOWN until lot selection is decided (OWNER_POLICY); a lot cannot be split by the current ledger |
| 7 | Plan integrity (sealed payload hash verified at claim and before submit) | `src/execution/action-plan-integrity.ts`, `postgres-master-paper-action-plan-store.ts` | `tests/phase2-plan-integrity.test.ts` | worker claim path | `master_paper_action_plan`; DB-level immutability trigger and uniqueness exist only in migration 068 | database-level enforcement is NOT in Production until 068 is applied; the application layer alone guards the plan today |
| 8 | Plan-order-fill lineage | `src/execution/management-order-repricing.ts`, `postgres-master-paper-action-plan-store.ts`, `postgres-execution-evidence-store.ts` | `tests/phase2-repricing-driver.test.ts`, `tests/db/management-reprice-store.test.ts` | worker | plan, order_intent, fill tables | lineage proven on fixtures only |
| 9 | Recovery race coverage (restart, duplicate trigger, replace race, late fill during cancel) | `src/execution/management-order-repricing.ts` | `tests/phase2-repricing-driver.test.ts` | worker restart behaviour | order_intent, evidence rows | no real restart soak; races simulated, not provoked at the broker |
| 10 | Short-call commitment guard (account-net cover at plan assembly, handoff, order construction, coordinator) | `src/theta/account-exposure.ts`, `src/execution/management-chain-inflight.ts`, `management-paper-plan-assembly.ts`, `master-paper-action-handoff.ts`, `order-construction.ts`, `paper-order-coordinator.ts` | `tests/phase2-hdac-naked-call-guard.test.ts`, `tests/phase2-short-call-commitments.test.ts`, `tests/db/management-chain-inflight.test.ts` | reconciliation snapshot GOOD | broker position snapshot, plan table, order_intent | `buildAlpacaLimitOrder` itself does not require the count for stock sales; the guard lives in the handoff, and no production path bypasses it |
| 11 | SELL_STOCK limit policy (floor equals the bid, never above it; limit inside the BBO; sub-tick cancels) | `src/execution/adaptive-limit-policy.ts`, `master-paper-command-assembly.ts`, `src/theta/paper-bootstrap-management-policy.ts` | `tests/adaptive-limit-policy.test.ts`, `tests/phase2-fixpass-management-execution.test.ts` | fresh Alpaca stock quote | none | floor is exact, so a small decline cancels the sale (fail-safe); `economicsRemainPositive` means "selected risk-reducing action", not positive expected value |
| 12 | Order state machine, deterministic idempotent client order id, single mutation authority | `src/theta/order-intent-state.ts`, `src/execution/paper-order-coordinator.ts`, `broker.ts`, `order-construction.ts` | `tests/order-intent-state.test.ts`, `tests/order-intent-transition-invariants.test.ts`, `tests/paper-order-coordinator.test.ts`, `tests/architecture-authority-guards.test.ts`, `tests/db/order-intent-client-order-id-unique.test.ts` | Alpaca order API (gate LOCKED) | `trade.order_intent` unique constraint | never exercised live |
| 13 | Unknown-submit reconciliation and broker reconciliation worker | `src/execution/broker-reconciliation-worker.ts`, `broker-fact-impact.ts`, `lifecycle-reconciliation.ts` | `tests/broker-reconciliation-worker.test.ts`, `tests/broker-lifecycle-evidence.test.ts` | Alpaca account, positions, orders GET | reconciliation snapshot tables | live reconciliation is GOOD with 0 positions and 0 orders, which proves the read path only |
| 14 | Fill to ledger lifecycle routing and TCA | `src/execution/broker-fill-lifecycle-router.ts`, `postgres-broker-fill-lifecycle-orchestrator.ts`, `confirmed-fill-tca.ts` | `tests/broker-fill-lifecycle-router.test.ts`, `tests/confirmed-fill-tca.test.ts`, `tests/phase2-chain-*` | fills from the broker | ledger tables | roll recording needs both legs fully filled (partial rolls stay PARTIAL by design) |

## 2. PARTIALLY SHIPPED

| Capability | What exists | What is missing |
|---|---|---|
| Partial-fill handling | Option partial closes are recorded at terminal state (`TERMINAL_PARTIAL_CLOSE_RECORDED`). A part-filled order is never replaced (`PARTIAL_FILL_ORDER_LEFT_WORKING`). | A terminal part-filled stock exit has no ledger application, so the ledger stays ahead of the broker and share reconciliation reports `LEDGER_AHEAD_OF_BROKER` (needs reconciliation). Depends on the OWNER_POLICY decisions below. |
| Database-level plan hardening | Migration 068 written and rehearsed on a disposable 067-state database. | Not applied to Production. Production currently relies on the application-layer hash checks. |
| Fill ingestion path | Reconciliation-driven fills feed the lifecycle router. `trade-updates.ts` exists. | The legacy `postgres-trade-update-store.ts` is quarantined (no production importer). Whether a streaming trade-updates source feeds Production was not verified in this pass. |
| Restart recovery | Attempt state and last action time are persisted; duplicate triggers are no-ops in fixtures. | No real restart soak with a working Paper order. |
| Market-closed and session behaviour | `MARKET_CLOSED` is a typed transient reason; DAY orders only. | Behaviour across a session boundary with a working order is untested against the broker. |

## 3. NOT STARTED

| Capability | Note |
|---|---|
| Repricing for new-risk entry orders (OPEN_CSP) | The driver covers MANAGEMENT orders only. Entry orders go through the handoff once and rest as DAY orders. |
| Broker fault-injection matrix against Alpaca Paper (429 / 5xx / timeout on submit, cancel, replace) | HTTP 408 and unknown-submit classification exist; no Paper-level injection campaign has been run. |
| Order-endpoint rate-limit and backoff policy | Not verified to exist for mutation endpoints; to be checked when Phase 3 starts. |
| Cross-session working-order sweep (orders left working at the close, next-open reconciliation) | Not built as a dedicated step. |
| Lot-split accounting (needed before any partial stock sale is recordable) | Blocked on the lot-selection decision. |

## 4. OWNER POLICY (see the decision packet)

- MULTI_LOT_PARTIAL_POSITION_DISPOSAL (lot selection for a partial stock sale)
- PARTIAL_FILL_STOCK_EXIT (behaviour after a SELL_STOCK partial fill)
- OSCILLATION-HYSTERESIS (dwell or cooldown between management cycles)
- LOSS-ENTRY-CREDIT-ANCHOR, COVERED-CALL-BELOW-BASIS, LIFECYCLE-EXTRA-STATES
- Q-MIN-PREMIUM-EDGE, Q-EARNINGS-UNIT, ACCOUNT-CONCENTRATION-POLICY
- RELATIVE-STRENGTH-DEFINITION, INSTRUMENT-APPROVAL-EXPANSION

## 5. PROVIDER LIMITED

- Per-fill fees: Alpaca does not supply them; realized chain P&L stays UNKNOWN for fees until an owner-attested fee schedule exists.
- Alpaca positions are aggregated per symbol with no broker-side tax-lot selection: lot choice is internal attribution only.

## 6. EMPIRICAL / PAPER REQUIRED

- Any claim about fill rate, concession schedule quality, slippage, or time-to-fill (no Paper fills exist).
- Behaviour of the repricing driver and the floor against a real working order and real quote motion.
- Partial-fill frequency for stock exits and options.
- First Paper fill, assignment and call-away observation (FUTURE_PAPER in the Phase 2 register).

## 7. Boundary rules for starting Phase 3

1. Migration 068 is applied to Production, or an explicit decision is recorded that Phase 3 proceeds on the application-layer guard alone.
2. The two new owner policies (lot selection, partial-fill stock exit) are decided, or Phase 3 treats both as "fail closed and reconcile" with no new accounting.
3. No Paper order is submitted until separately authorized; Phase 3 testing stays on disposable databases, fixtures and read-only broker calls until then.
