# THETA Engineering Implementation Map

Owner: production engineering. This is the Codex-owned counterpart to
`docs/QUANT_IMPLEMENTATION_MAP.md` — it maps TRD/Backend-Schema requirements to
concrete `bots/theta/app/` modules, their migrations, and their tests. Read
`docs/IMPLEMENTATION_AUDIT.md` first; several rows below depend on decisions flagged
there (marked ⚠ below).

## 1. Provider adapters — `app/src/providers/`

| Requirement | Module | Durable output | Test |
|---|---|---|---|
| Alpaca account/config/clock/calendar (TRD §8.1, Appendix B) | `providers/alpaca/account.ts`, `clock.ts` | `trade.account_snapshot`, `market.market_session` | Contract test against `/v2/account`, `/v2/clock`, `/v2/calendar` |
| Alpaca contracts/quotes/chain snapshot | `providers/alpaca/contracts.ts`, `quotes.ts` | `market.option_contract`, `stock_quote_snapshot`, `option_quote_snapshot`, `option_greeks_snapshot` (with `unit_basis`/`normalization_version` populated — non-negotiable, TYPE-001-adjacent) | Fixture: reject adjusted/ambiguous-deliverable contracts (ALP-005) |
| Alpaca order/trade_updates/orders REST | `providers/alpaca/orders.ts`, `stream.ts` | `trade.order_intent` → `broker_order` → `broker_order_event` → `fill` | Idempotency + timeout-then-reconcile chaos test (ALP-001/002) |
| Alpaca activities (assignment/expiry/exercise) | `providers/alpaca/activities.ts` | `trade.broker_activity` (unique `provider_activity_id`), normalizes `OPXRC`/`OPEXC` variants to one internal `EXERCISE` event | Fixture covering both documented activity-code variants (TRD S8/S18) |
| Alpaca corporate actions (REST + SSE wake) | `providers/alpaca/corporate_actions.ts` | `market.corporate_action` | SSE dedupe + REST-reconcile fixture (CA-001/002) |
| Optionomics operation-alias registry ⚠ (blocked on live contract verification, audit §4) | `providers/optionomics/registry.ts` | `core.provider_operation_registry`, `market.optionomics_feature_family_contract` | Contract-version/null/freshness tests; **no adapter code binds a real path until the live API Reference is checked** (OPT-001) |
| Optionomics feature ingestion | `providers/optionomics/features.ts`, `events.ts` | `market.optionomics_feature_snapshot` (FK-bound to an ACTIVE family contract), `optionomics_event` | Missing feature → `UNKNOWN`, never `0` (MKT-001) |

## 2. FusionSnapshot and candidate/decision persistence — `app/src/market/`, `app/src/theta/`

| Requirement | Module | Durable output | Test |
|---|---|---|---|
| FusionSnapshot construction (TRD §10, Schema §16) | `market/fusion_snapshot.ts` | `trade.fusion_snapshot` (content-hash unique per bot_instance) | Deterministic replay: same inputs → same `content_hash` |
| Candidate generation pipeline (TRD §16) | `theta/candidates/*.ts` | `trade.candidate_set`, `candidate`, `candidate_reason`, `candidate_rejection` | Completeness: full feasible strike/expiry lattice persisted, not just the winner (CAND-001) |
| Decision record | `theta/decisions/*.ts` | `trade.decision`, `decision_reason` | WAIT is a first-class row, not an absence of a row (§40 OUT rules apply at the reporting layer, not here) |
| Sizing decision ⚠ | `risk/sizing.ts` (AEGIS-adjacent, but the *decision* record itself is engineering's to persist) | `risk.sizing_decision` — every cap (collateral/stress/concentration/broker) and multiplier explained; `final_qty` may be `0` | Invariant test: no `max(1, qty)` hack anywhere in this path — grep-level static check plus a unit test that asserts `final_qty = 0` is reachable and never coerced |

## 3. AEGIS runtime integration — `app/src/risk/`

AEGIS's *policy* (hard-veto vs soft-evidence, stress math) is specified in the TRD;
engineering owns wiring it into the runtime path so nothing can bypass it.

| Requirement | Module | Durable output | Test |
|---|---|---|---|
| AEGIS output contract (`ALLOW_FULL/ALLOW_REDUCED/DEFINED_RISK_ONLY/HOLD_ONLY/HARD_VETO`) | `risk/aegis.ts` | `risk.risk_snapshot` | Every order-producing decision has exactly one `risk_snapshot` row before an `order_intent` can be created |
| Correlation / exposure clustering | `risk/correlation.ts`, `risk/clustering.ts` | `risk.correlation_snapshot` (canonicalized pair ordering — service-level responsibility per bootstrap comment), `risk.exposure_cluster_snapshot`/`_member` | Reject same-underlying pairs; correlation ∈ [-1,1]; pair canonicalization unit test |
| Kill switch | `risk/kill_switch.ts` | `risk.kill_switch_event` | Independently callable from strategy engine (SEC-002); chaos test that a kill mid-evaluation still blocks order submission |
| Stress scenarios/runs | `risk/stress.ts` | `risk.stress_scenario`, `stress_run`, `stress_result` | Historical presets are diagnostics only, never the sole gate |

## 4. Execution engine and order state machine ⚠ — `app/src/execution/`

**Blocked on audit §3.1 (`broker_order` cardinality decision) before this module's
core design is finalized.** Recommended resolution (stated in the audit, not yet
implemented): each adaptive-limit reprice mints a new `order_intent` with a
deterministic `client_order_id`; `execution_attempt` tracks pre-submit retries within
one intent; `broker_order.replaced_by_id` chains sibling intents' broker orders.

| Requirement | Module | Durable output | Test |
|---|---|---|---|
| Order state machine (TRD §27, Schema §19) | `execution/order_state_machine.ts` | `trade.order_intent` → `execution_attempt` → `broker_order` → `broker_order_event` → `fill` | Full `OrderState` transition table fixture; no transition skips reconciliation |
| Idempotency / `client_order_id` | `execution/idempotency.ts` | Unique `(account_id, client_order_id)`, `(account_id, idempotency_key)` | Timeout-then-retry chaos test proves zero duplicate positions (EXEC-001, ALP-001/002) |
| Partial fills | `execution/partials.ts` | `trade.fill` rows accumulate against `broker_order.filled_qty`; remaining-order state explicit | Strategy layer never assumes full intended quantity (EXEC-003) |
| Adaptive limit ladder + fill model consumption | `execution/limit_ladder.ts` | `trade.fill_model_prediction`, `execution_markout` | Cancel-rather-than-cross test when EV turns non-positive (FILL-003) |
| TCA | `execution/tca.ts` | `execution_markout` (1m/5m/30m/EOD, unique per `fill_id`+horizon) | Markout computation fixture against a benchmark price |

## 5. Wheel lifecycle state machine — `app/src/lifecycle/`

| Requirement | Module | Durable output | Test |
|---|---|---|---|
| Lifecycle state machine (TRD §21, Schema enum `lifecycle_state`) | `lifecycle/state_machine.ts` | `trade.lifecycle_event` (append-only) | Every documented state transition has a fixture; no transition skips required reconciliation (STATE-001) |
| Assignment/expiry/exercise reconciliation | `lifecycle/reconciliation.ts` | `ops.reconciliation_event`, updates `position_episode`/`stock_lot` | Reconcile from REST activities + positions, never WebSocket-only (ALP-003, LIFE-001) |
| Roll engine | `lifecycle/roll.ts` | `trade.roll_link` (old/new leg distinct, `UNIQUE(old_leg_id,new_leg_id)`) | Old leg `realized_pnl` never mutated after a roll — this is a DB-permission-enforced invariant (§3.2 above), not just an application check |
| Covered-call coverage | `lifecycle/coverage.ts` | `trade.coverage_reservation` | Preflight: confirmed stock qty ≥ contracts×multiplier before `SELL_CC` intent (LIFE-003, schema invariant "No uncovered CC") |
| Corporate actions affecting open positions | `lifecycle/corporate_actions.ts` | Quarantines affected symbol if deliverables become ambiguous (CA-003) | Split/merger fixture forcing `QUARANTINED` |

## 6. Accounting and economic ledger — `app/src/accounting/`

| Requirement | Module | Durable output | Test |
|---|---|---|---|
| Economic ledger | `accounting/ledger.ts` | `trade.economic_ledger_entry` (immutable, DB-permission enforced) | Append-only; no UPDATE path exists at the DB role level |
| P&L snapshot | `accounting/pnl.ts` | `trade.pnl_snapshot` — `whole_chain_pnl` computed from the exact formula in Schema §21, never re-derived ad hoc | **Short-option P&L sign fixture is explicitly required by the schema's own invariant list**: STO→BTC, BTO→STC, assignment, and roll chains each need a dedicated fixture (schema §35 "No short-option P&L sign error") |
| Capital usage / capital-days | `accounting/capital.ts` | `trade.capital_usage_snapshot` | Reconciles against `risk.sizing_decision` and AEGIS collateral figures |
| Outcome labeling (post-resolution) | `accounting/outcomes.ts` | `trade.outcome_label` | Managed-episode win/loss only assigned at economic resolution boundary, never on interim MTM |

## 7. Observability, ops, and Docker — `app/src/monitoring/`, `app/src/ops/`, infra

| Requirement | Module | Durable output | Test |
|---|---|---|---|
| Provider health | `monitoring/provider_health.ts` | `ops.provider_health_snapshot` | Latency/error-rate/entitlement dashboard fixture |
| Alerts/incidents | `monitoring/alerts.ts` | `ops.alert`, `alert_delivery`, `alert_ack`, `incident` | Critical alerts exist independent of delivery-channel preference (schema §23) |
| Audit trail | `ops/audit.ts` | `ops.audit_event` (immutable, DB-permission enforced) | 100% privileged/config/security actions recorded (AUDIT-001) |
| Job scheduler | `ops/scheduler.ts` | `ops.job_run` | DST-aware exchange calendar drives cadence, never a fixed UTC clock (CADENCE-001) |
| Docker/CI | `docker-compose.yml`, `.github/workflows/` | — | Empty-DB migration + lint + typecheck + unit tests green (Phase 0 exit gate) |

## 8. Migration plan (from bootstrap → forward-only migrations)

Follow the schema doc's own migration order (§34) exactly — it is already numbered
001–016 and reflects real dependency order (e.g. `core.bot_instance` before anything
referencing it, `research.model_version` before `market.regime_snapshot`'s deferred FK
add). Do not re-derive a different ordering. Concretely:

1. Split the bootstrap's single transaction into files `001`–`016` along the
   boundaries the schema doc already names.
2. Add the partitioning strategy (audit §3.2) into the *first* migration that creates
   each high-volume table, not a later retrofit migration.
3. Add DB role/permission separation and UPDATE/DELETE denial on immutable tables as
   migration `015` (indexes/partitions/views/permissions) — the schema doc already
   reserves this slot.
4. Add the 7 missing `analytics.v_*` views (audit §3.2) into migration `015` alongside
   the 6 already in the bootstrap.
5. CI: build an empty database, migrate up, run schema/invariant tests (schema §35's
   "Invariants and Validation Queries" table is a literal test-writing checklist), load
   fixtures — this is the Phase 0 exit gate, not optional polish.

## 9. Cross-cutting: what to check before merging anything in `app/`

This list is what Claude's adversarial review (see `docs/OWNERSHIP.md`) will check —
engineering should self-check it before requesting that review:

- Every Optionomics-derived field traces to an ACTIVE `optionomics_feature_family_contract` — no guessed JSON paths.
- Every order-producing decision has a `risk.sizing_decision` row where `final_qty` can legitimately be `0`.
- No code path lets a WebSocket event alone confirm assignment/expiry/exercise — REST reconciliation is mandatory (ALP-003).
- No roll implementation ever updates a closed leg's `realized_pnl`.
- No formula in `execution/` or `accounting/` deviates from TRD Appendix A's exact expressions, including sign conventions.
