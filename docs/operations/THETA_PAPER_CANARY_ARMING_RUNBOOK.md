# THETA MASTER PAPER: first canary arming runbook

Authority: the owner's typed Paper authorization (2026-10-01) covers autonomous Paper trading without per-trade confirmation. It is Paper only.
LIVE money is not authorized and follower Paper execution stays disabled. Arming does not force an order: a canary happens only when a
natural canonical candidate reaches positive structural sizing, and the first canary is capped at 1 contract.

## State at the end of Phase 3 (2026-10-03)

| Item | State |
|---|---|
| Schema | `068_action_plan_integrity` (trigger, partial unique index, ledger row verified) |
| main = deployed = worker | `5006cdab0f318a78079d1ca6a3f9d43411b2ad56` |
| Worker | ONLINE, one supervisor, database circuit healthy, reconciliation GOOD |
| Execution gate | LOCKED; `master_execution_enabled=true`, `follower_execution_enabled=false` in `ops.paper_execution_control` |
| Orders / plans / positions | 0 / 0 / 0 |

## Why the gate is still LOCKED

The canonical activation (`first-paper-canary-activate`, `firstPaperCanaryActivationBlockers` in `src/execution/paper-execution-authorization.ts`) refuses
unless ALL of these hold at the moment of activation. Two cannot be true outside a trading session:

| Blocker | Condition |
|---|---|
| `MARKET_NOT_OPEN`, `MARKET_SESSION_NOT_CONFIRMED` | the Alpaca clock says open and today's calendar session is confirmed |
| `RECENT_COMPLETE_STRATEGY_SCAN_MISSING` | a COMPLETE strategy scan finished within 15 minutes |
| `MASTER_EXECUTION_ENVIRONMENT_DISABLED`, `ENVIRONMENT_NEW_ENTRY_PAUSE_ACTIVE` | Vercel Production flags: master execution enabled, new-entry pause off |
| `FIRST_CANARY_REQUIRES_ZERO_BROKER_POSITIONS`, `..._ZERO_OPEN_ORDERS`, `UNRECONCILED_LOCAL_ORDER_INTENT` | broker flat and reconciled |
| `FIRST_CANARY_ALREADY_USED`, `ACTIVE_ORDER_INTENT_PRESENT` | no prior broker order, no active intent (both read as exact counts; an unreadable count now blocks) |
| `FOLLOWER_EXECUTION_NOT_LOCKED`, `MASTER_ACCOUNT_ROLE_INVALID`, `MASTER_SELF_COPY_INVARIANT_FAILED` | followers locked; exactly one master account |
| `EXECUTION_QUOTE_AUTHORITY_NOT_READY`, `PRODUCTION_SCHEMA_BASELINE_061_MISSING`, `OPTIONS_CAPABILITY_NOT_VERIFIED`, `MASTER_ACCOUNT_NOT_ACTIVE` | quote authority qualified, schema baseline present, options enabled, account ACTIVE |

## Procedure at the next session (first complete scan after the open)

1. Confirm identity: main, deployed and worker SHAs equal; schema head 068; one supervisor; heartbeat fresh; reconciliation GOOD; zero positions and orders.
2. Confirm the previous night's evidence: the post-migration backup completed, and no `CANONICAL_FRONTIER_POLICY_PAYLOAD_TOO_LARGE` or `POSTGRES_CHECKED_OUT_CLIENT_LOST` failures
   (see `THETA_NEXT_SESSION_ACCEPTANCE_CHECKLIST.md`).
3. Vercel Production flags: master execution enabled, new-entry pause off, follower execution off, live off. A change to a Production flag needs a redeploy, which changes
   the deployed identity: redeploy once, then cut the worker over to the same SHA (a deployment without a worker cutover makes the server reject the worker with
   `RUNTIME_SCHEMA_INCOMPATIBLE` until the worker SHA matches).
4. After a complete scan, call the activation operation with the worker identity and the activation confirmation header. If it returns blockers, record them and stop; do not alter policy.
5. After activation the runtime is `FIRST_CANARY_ARMED` with a 1-contract cap. Stop there. Do not place or size anything manually.
6. If a natural canonical candidate reaches positive sizing, the coordinator submits one capped order. If canonical quantity is 0, no order is placed.
7. After the canary is accepted and reconciled (`first-canary-acceptance`), the runtime transitions to `AUTONOMOUS_PAPER_ACTIVE`: only the 1-contract canary cap is removed.
   Follower execution and live execution remain disabled.

## Known account constraint

At the current account scale every Q-valid SPY put exceeds the single-underlying hard concentration line, so SPY cannot reach positive sizing
(`ACCOUNT_POLICY_INCOMPATIBILITY`, minimum Q-valid collateral about $37,500 against about $100,000 equity). Do not loosen concentration or approve other instruments to
create a canary. "Armed with no order" is a correct outcome.
