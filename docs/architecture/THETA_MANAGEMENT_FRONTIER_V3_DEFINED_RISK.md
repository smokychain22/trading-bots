# THETA management-authority revision v3: defined-risk spreads join the sovereign management frontier

- **Revision:** `theta-management-action-frontier-v3`
- **Date:** 2026-10-07
- **Authority:** The repository owner explicitly authorized this versioned revision on 2026-10-07. The authorization says to create a versioned management-authority revision, add a defined-risk lifecycle state, and keep the Wheel states backward compatible.
- **Status:** SOURCE_COMPLETE. Not deployed. `D_PAPER_AUTHORIZED = NO`.

## Problem

Before v3, the management frontier (`src/theta/management-action-frontier.ts`, contract v2) decided only Wheel lifecycle states: `CSP_OPEN`, `STOCK_HELD`, `RECOVERY_WAIT` and `CC_OPEN`. A native defined-risk spread (THETA_D) was decided by `assessDefinedRiskManagement`, which acted as its own final authority. Its output was executed directly by the D management runner. In effect there were two final management authorities.

## Decision

The defined-risk branch becomes a producer for the one sovereign management frontier.

```
D producer (assessDefinedRiskManagement)       -> proposal (evidence only)
  definedRiskManagementProposal(decision, position)
sovereign frontier (buildDefinedRiskManagementActionFrontier, v3) -> selects exactly one action, or none
PaperOrderCoordinator                          -> executes the selected action only
```

- **New lifecycle state:** `DEFINED_RISK_OPEN`. It is used only for a frontier built over a native spread on a `chain_kind = 'DEFINED_RISK'` chain.
- **Actions enumerated for `DEFINED_RISK_OPEN`:**
  - `HOLD`
  - `CLOSE_FULL`: one native two-leg close. Required intents are `BUY_TO_CLOSE` and `SELL_TO_CLOSE`.
  - `EMERGENCY_RISK_REDUCTION`: new in v3 and valid only in `DEFINED_RISK_OPEN`.
- **Selection rules, in order:**
  1. A terminal spread (closed, expired, or converted to stock) has no frontier action. The selection is `null`.
  2. Unknown broker leg truth gives `HOLD` with `SYSTEM_HOLD_MISSING_EVIDENCE`. That is never a pass, and no order is sent.
  3. An emergency selects `EMERGENCY_RISK_REDUCTION`. Examples are an unhedged short put, contradictory legs, or short stock from a one-leg exercise. `HOLD` and `CLOSE_FULL` are both infeasible in that case, because the approved structure no longer exists.
  4. A required close selects `CLOSE_FULL` only when all of these hold:
     - both exact legs are freshly and executably quoted;
     - there is at least one hedged package to close.

     Otherwise the selection is `HOLD`, with `D_MANDATORY_CLOSE_FULL_NOT_FEASIBLE` recorded.
  5. Otherwise the selection is `HOLD`.
- **Persistence:** the `trade.decision` row stores the frontier's selection as `action_code`, not the producer's proposal. The full v3 frontier is stored in `receipt_json.managementActionFrontier`.

## Backward compatibility

- Wheel frontiers keep `managementActionFrontierVersion = 'theta-management-action-frontier-v2'`. Their builder, `buildManagementActionFrontier`, is unchanged, so persisted Wheel frontier hashes are unaffected.
- `ManagementActionFrontier.contractVersion` is now the union `v2 | v3`. `lifecycleState` additionally admits `DEFINED_RISK_OPEN`.
- The research action mapper (`mapManagementFrontierActions`) never maps `EMERGENCY_RISK_REDUCTION`. It is not a modeled research choice.
- Q, H, A and C management are untouched. H keeps its no-roll policy.

## What v3 deliberately does not do

- **`EMERGENCY_RISK_REDUCTION` is escalation-only in this revision.**
  - New risk is blocked. `trade.defined_risk_position.state = 'DIVERGED_EMERGENCY'` drives `hasEmergency()`, which pauses new orders.
  - The emergency is persisted and escalated.
  - No improvised single-leg order is generated.
  - Automating a buy-to-close of an unhedged short needs its own governed order path and tests, and is a follow-up.
- **No profit target or stop-loss number is introduced.** Those are owner policy that needs empirical evidence (TRD section 40). A healthy spread is held to its safety triggers: expiry/pin/assignment risk, event, AEGIS, and liquidity deterioration.
- **No D Paper authority is granted.** D still needs:
  - the governed `THETA_DEFINED_RISK` receipt;
  - a deployed release;
  - account multi-leg (mleg) entitlement evidence.

## Regression evidence

| File | What it covers |
| --- | --- |
| `tests/management-frontier-v3-defined-risk.test.ts` | Selection rules, the mapping from producer to frontier, and the authority guard (the runner executes only `frontier.selectedAction`). |
| `tests/db/defined-risk-management-runner.test.ts` | Real PostgreSQL. The persisted decision carries the v3 frontier and `EMERGENCY_RISK_REDUCTION`. A close is submitted exactly once, including across a restart. |
