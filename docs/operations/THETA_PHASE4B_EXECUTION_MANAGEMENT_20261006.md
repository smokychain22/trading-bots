# THETA Phase 4B — execution + management gaps (H and D): recovery and completion receipt

Date: 2026-10-06 · Branch: `main` (local, **not pushed, not deployed**) · Start: `0f3b7a5bba0ef852a283ce5c1086e9e05a1b315d`

This document is the honest receipt of what was recovered from Codex's interrupted Phase 4B work, what was found wrong and fixed, what is now built and proven,
and what is **still not built**. Nothing here authorizes H or D Paper trading, live money or follower execution. `H_PAPER_AUTHORIZED = NO`, `D_PAPER_AUTHORIZED = NO`.

## 1. Disposition of the interrupted local diff

| File | Disposition | Notes |
|---|---|---|
| `migrations/069_multi_leg_order_durability.sql` | KEEP_AND_FINISH | normalized parent + legs + broker leg state kept; amended (NULL-`leg_index` dedupe, unknown-fee accounting, `contracts`, chain isolation, defined-risk position, governed authority). 069 was never applied anywhere, so amending is legitimate. |
| `src/execution/postgres-paper-order-store.ts` | NEEDS_CORRECTION | reloaded leg expiration came back as a JS `Date` string (`Fri Oct 16`), corrupting leg identity after restart. Found by the real-PostgreSQL round trip. |
| `src/execution/defined-risk-lifecycle.ts` | NEEDS_CORRECTION | accounting coerced unknown fees/prices to 0; rebuilt with UNKNOWN preserved and before-fee vs after-fee P&L. |
| `src/execution/postgres-defined-risk-lifecycle-store.ts` | NEEDS_CORRECTION | `UNIQUE(.., leg_index)` does not dedupe NULLs: a replayed parent-level broker event would have doubled stock consequences. |
| `src/execution/paper-order-coordinator.ts`, `defined-risk-paper-order.ts` | KEEP_AND_FINISH | broker leg truth persisted before state advances; asymmetric legs → `RECONCILING`, never resubmitted; `prepare` now validates durable leg evidence for mleg. |
| `src/theta/order-intent-state.ts` | KEEP | three `→ RECONCILING` edges; the Phase 3 reviewed state-machine spec was updated deliberately and says why. |
| `src/theta/management-action-frontier.ts`, `hold-strike-lifecycle.ts` | KEEP_AND_FINISH | H lifecycle bound into the sovereign frontier; **removed** `reconcileHoldStrikeAssignment` (an unused second assignment authority — the single authority is `reconcileManagedOptionLifecycle`). |
| `src/theta/hold-strike-production-decision.ts`, `theta-shadow-cycle.ts` | KEEP_AND_FINISH | producer was wired to a config field nothing populated; it now reads the governed authority store. |
| tests (`phase4b-*`, `paper-order-coordinator`, `phase4-paper-strategy-lifecycle`) | TEST_ONLY / corrected | asymmetric fills correctly resolve to `RECONCILING` (the test expectation `PARTIAL` was wrong); lint errors fixed. |

## 2. Defects found by running the real thing (not by reading)

1. Leg expiration identity corrupted on reload (Date → string). 2. NULL `leg_index` event dedupe. 3. Close-attempt numbering advanced past a never-submitted READY close intent, so a restart
would have minted a **second** close order. 4. Broker-activity attribution could re-consume an activity already attributed to another identical spread. 5. Unknown multiplier accepted by the
in-memory prepare path. 6. Accounting turned unknown fees into zero. 7. A Wheel loader would have picked up a spread chain and managed only the short leg (isolation added, with a guard test).

## 3. What exists now

**Single-leg path (Q/A/C) is unchanged** apart from `chain_kind='WHEEL'` loader filters and the three `RECONCILING` edges.

**H (hold-strike):** production decision producer reads a governed, append-only, release-SHA-bound authority receipt (`ops.theta_strategy_paper_authority`, written only by
`tools/theta-strategy-authority.ts`, dry-run by default) and nominates only after Q declined; the canonical frontier stays sovereign. H management safety rules (event / AEGIS / liquidity / near-expiry) are
in the one management frontier; **no roll**; the review deadline is persisted in the stored frontier reason codes and a mandatory-but-unexecutable close is typed. Assignment goes through the one
broker-confirmed authority and keeps the originating chain id, then RECOVERY_WAIT → A. H shares the single order path with Q (guard test).

**D (defined-risk):** `trade.defined_risk_position` is a typed lifecycle (PENDING_OPEN / ASYMMETRIC_OPEN / OPEN / CLOSE_PENDING / CLOSED / EXPIRED_WORTHLESS / STOCK_FROM_ASSIGNMENT / DIVERGED_EMERGENCY) derived
only from persisted per-leg broker truth; naked short or short-stock is always an emergency; terminal states are never left. Management decision (`defined-risk-management.ts`) requires **both** exact
leg quotes, treats unknown broker legs as UNKNOWN, and never invents a profit/loss rule. Close = one native mleg package built from the durable open legs. Assignment/exercise/expiration are recorded
only from broker activity identities, per exact leg, once. Shares handed over start ONE Wheel chain with `origin_chain_id`. Whole-chain accounting uses actual per-leg fills; fees stay unknown until a fee
exists. A D emergency pauses **new** entries of every strategy.

## 4. Gate table

| Gate | Status | Evidence |
|---|---|---|
| Q_ENTRY / Q_MANAGEMENT / Q_ASSIGNMENT | PASS (regression-protected, unchanged paths) | existing suites + full run |
| H_PRODUCTION_DECISION_PRODUCER | PASS (wired to governed source; fail-closed) | `tests/db/strategy-paper-authority-store.test.ts`, `tests/phase4-paper-strategy-lifecycle.test.ts` |
| H_ENTRY | PASS (source/test) | same |
| H_MANAGEMENT | PASS (source/test) | `tests/phase4b-execution-management.test.ts` |
| H_EXPIRY_ASSIGNMENT | PASS (shares the single broker-confirmed authority) | `tests/broker-lifecycle-evidence.test.ts`, `tests/phase4b-execution-management.test.ts` |
| H_RESTART_RECOVERY | PASS for what is H-specific (identity in thesis, deadline persisted); the rest is the shared Q path | see limitations |
| D_PARENT_PERSISTENCE / D_LEG_PERSISTENCE | PASS (real PostgreSQL) | `tests/db/multi-leg-order-durability.test.ts` |
| D_PARTIAL_FILL_DURABILITY | PASS (real PostgreSQL) | `tests/db/defined-risk-position-lifecycle.test.ts` |
| D_RECONCILIATION | PASS | coordinator + failure-injection suites |
| D_MANAGEMENT | PASS for decision, close command, runner, restart; **escalation-only** for emergencies | `tests/defined-risk-management.test.ts`, `tests/db/defined-risk-management-runner.test.ts` |
| D_EXPIRY_PIN_ASSIGNMENT | PASS (broker-activity facts, stock chain, replay-safe) | `tests/db/defined-risk-broker-facts.test.ts` |
| D_RESTART_RECOVERY | PASS (fresh pool/store reaches the same state; crash between persist and submit resumes the READY intent) | DB suites |
| D_WHOLE_CHAIN_ACCOUNTING | PASS with fees UNKNOWN until a fee source exists (honest) | `tests/defined-risk-position.test.ts` |
| A_RECOVERY / C | PASS (unchanged) | existing suites |
| SOLE_BROKER_MUTATION_AUTHORITY | PASS | `RAW_BROKER_MUTATION_CALLERS_OUTSIDE_COORDINATOR = 0`; adapter exposes exactly POST/PATCH/DELETE order endpoints |
| FAILURE_INJECTION (D) | PASS | `tests/phase4b-failure-injection.test.ts` |
| D_PAPER_AUTHORIZED / H_PAPER_AUTHORIZED | **NO** | no receipt recorded for any SHA |

## 5. Not built / known limitations (do not read the PASS rows as more than they say)

* **D has no production ENTRY path.** `buildDefinedRiskPaperCommand` still has no production caller; the master action-plan store is single-contract. D can not open a Paper position in production, so every D
  lifecycle capability above is proven on fixtures and real PostgreSQL, not on a live spread.
* **D management is not an action inside the shared single-leg management input.** It is a separate typed decision (persisted as a `trade.decision` of kind MANAGEMENT whose evidence snapshot is the entry's
  fusion snapshot, stated in the receipt). Folding spreads into `ManagementInputState` is a versioned-contract change deferred on purpose.
* **D emergency flatten is escalation-only.** An unhedged short is persisted, escalated and blocks new entries, but no autonomous single-leg order is sent.
* **D event / AEGIS-deterioration feeds are UNKNOWN** for open spreads (never CLEAR/ALLOW by default); expiry/pin/assignment, broker-leg mismatch and quote executability are live.
* **Fees:** after-fee P&L stays UNKNOWN until a fee exists; before-fee P&L is reported.
* **Account-specific mleg submit entitlement is unverified** (documented capability + Options Level 3 only). No dummy order was or may be sent.
* H DB-level restart integration beyond identity/deadline persistence rides on the shared Q machinery.
* Draft data-platform SQL under `docs/proposals/069..071_*` collides in number with the real migration 069 and must be renumbered at cutover.

## 6. Deployment prerequisites (nothing deployed)

* Migration **069 must be applied first** (verified-backup governed path). The runtime schema contract now locks a pre-069 schema (`MIGRATION_REQUIRED`) instead of failing mid-cycle; the previous runtime still works on a 069 schema (additive, defaulted).
* Host check at the time of writing: Windows reported **battery discharging** → a worker cutover is not allowed until AC power is confirmed.
* Exact-SHA CI, governed evidence regeneration, the Vercel Production deployment status and the Windows immutable cutover are all still ahead (`memory/release_flow.md`).
