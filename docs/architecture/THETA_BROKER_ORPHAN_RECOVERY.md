# THETA broker-confirmed orphan position recovery

Status: SOURCE ONLY. The pure module is complete and tested. It is not wired into the runtime, and the mode defaults to `OFF`.

## Problem (2026-10-07)

A THETA `SELL_TO_OPEN` filled at the broker, but the `SHORT_PUT_OPEN` lifecycle application was rejected by the schema-069 CHECK (23514).

- The chain stayed `WAIT` with zero option legs.
- The management loader reads DB chains only and excludes a `WAIT` chain that has no legs, no lots and only terminal intents.
- Result: a real short put had no management owner.

Classification: `BROKER_CONFIRMED_POSITION_LIFECYCLE_REGISTRATION_BLOCKED`.

## Module

The module is `src/execution/broker-orphan-position-recovery.ts`. It provides four functions.

**`classifyBrokerConfirmedOrphan(position, lineages)`**

- **Input:** an exact broker position from a GOOD reconciliation snapshot.
- **Match rule:** exactly one THETA lineage must match on every field: symbol, `OPEN_CSP` / SELL / `sell_to_open`, intent FILLED, broker order FILLED, fill quantity equal to the broker quantity, fill price within 0.005 of the broker average entry, chain `WAIT` / WHEEL / open, the same chain and decision, no open option leg, no applied lifecycle, and no in-flight order.
- **Output on a match:** a frozen, content-hashed representation whose permitted actions are exactly `HOLD` and `CLOSE_RISK`, with `HOLD` as the default.
- **Otherwise:** a typed refusal (`ORPHAN_*`). An unexplained position is never adopted.

**`decideOrphanRiskAction(rep, market, policy)`**

- With no owner policy it returns `HOLD` with `ORPHAN_RISK_CLOSE_POLICY_NOT_CONFIGURED`. It never invents a threshold.
- The triggers are an ask multiple of entry, spot within a fraction of the strike, and maximum DTE.
- If a trigger fires but no fresh, valid quote is available, it returns `HOLD` with `ORPHAN_CLOSE_REQUIRED_QUOTE_NOT_FRESH`. A close is never priced blind and is never a market order.

**`buildOrphanRiskClosePlan(input)`**

- **Output:** one `ApprovedMasterPaperActionPlan`: `CLOSE_CSP`, MANAGEMENT authority, the whole broker quantity, and the economic boundary set to the current ask (the adaptive limit starts at the bid).
- **Structural refusals:** a sell or open side, a roll action, contract substitution, a quantity above or below the broker position, a tampered representation, a directive/representation mismatch, a decision window longer than the management plan window (30 s), a kill switch, and invalid IDs.

**`parseOrphanRecoveryMode`**

- Values are `OFF` (default), `OBSERVE` and `CLOSE_RISK_CERTIFIED`. Any unknown value maps to `OFF`.

## Proven (no submit)

The tests are in `tests/broker-orphan-position-recovery.test.ts`. They use the exact XLE lineage with synthetic IDs.

- A risk trigger produces a plan that passes `prepareMasterPaperAction` (the read-only half of the PaperOrderCoordinator handoff) as `READY_TO_SUBMIT`: buy, `buy_to_close`, qty 1, a limit inside the bid/ask, and only the exact contract quoted.

## Remaining before runtime use (not hotfix-ready before 070)

1. **Authority rows.** `PostgresMasterPaperActionPlanStore.publishManagement` requires a persisted `management_input_snapshot` and a `management_action_frontier` (selecting `CLOSE_FULL`) for the chain. The orphan path needs a governed writer for an orphan input snapshot and frontier (`lifecycle_state=WAIT`, which passes `managementDecisionIsCurrent`).
2. **Close-fill lifecycle.** `routeConfirmedFillLifecycle(CLOSE_CSP)` needs an `optionLegId`, and an orphan has none. A close filled before 070 would reduce broker risk, but it would be lifecycle-unregistered too. After 070 the replay must apply `SHORT_PUT_OPEN` first, which creates the leg, and then `OPTION_CLOSE` resolving that leg. This ordering is not implemented.
3. **Loader surfacing.** Management and reconciliation must call the classifier for unowned broker positions. In `OBSERVE` mode they emit the representation and the HOLD decision, with no broker action.
4. **Owner policy.** `OrphanRiskClosePolicy` values must be owner-approved. There is no default.

**Before 070**, a genuine XLE risk event still has the existing manual-free option of applying migration 070 (which unblocks normal management). The orphan close should not be deployed mid-session without items 1 and 2.
