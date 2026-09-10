# THETA Action-Value Formulas (Phase 5)

Preserves the canonical formulas already registered in `../phase2/FORMULA_REGISTRY.md`
(`ManagementUtility`, `RollUtility`, `CCUtility`, `THETA_CycleUtility`) verbatim — none
are redefined here, per the "one source of truth per concept" rule. This file adds the
same-state counterfactual derivation this Phase 5 task specifically asks for: how each
action's utility is compared *at the same decision timestamp*, and the explicit
no-double-counting discipline across all of them together.

## Same-state counterfactual comparison (the actual decision rule)

At decision timestamp `T`, for an open position, compute:

```
U(HOLD, T)               = EV_net(no action, hold to next re-evaluation) - CapitalDaysPenalty(continuing to hold)
U(CLOSE, T)               = EV_net(realize current P&L now) - ExecutionCost(close)
U(ROLL, T)                = RollUtility(T)  [already nets against best of HOLD/CLOSE/ASSIGN/REDEPLOY per its own formula]
U(ASSIGN, T)              = EV_net(accept assignment | ownership state) - ExecutionCost(none, assignment has no order)
U(EXPIRE, T)              = EV_net(let expire OTM, realized as max profit) - 0  [only a feasible comparison point when clearly OTM near expiration]
```

`ManagementUtility(action) = U(action, T)` for whichever action is being evaluated —
this is not a new formula, it is `ManagementUtility`'s formula
(`EV_net(action) - OpportunityCost(best alternative not taken) - TailRiskPenalty(action)
- CapitalDaysPenalty(action)`, per `../phase2/FORMULA_REGISTRY.md`) applied
consistently across all five actions at the same `T`, which is exactly H-M-01's
requirement (`MANAGEMENT_HYPOTHESIS_LIBRARY.md`) that all actions be compared jointly,
not sequentially.

**The action taken is `argmax` over every *feasible* action's `U(., T)`** — HOLD is
always feasible; CLOSE requires a liquid market to close into; ROLL requires a
replacement contract to exist; ASSIGN is only feasible if assignment has actually been
triggered (not a proactive choice at arbitrary `T`); EXPIRE is only a meaningful
comparison point very near expiration.

## No-double-counting discipline (explicit, per this task's requirement)

- **Transaction/execution costs** appear exactly once, in the `ExecutionCost` term of
  whichever action actually incurs them (CLOSE, ROLL's close-leg) — never also folded
  into `CapitalDaysPenalty` or `TailRiskPenalty`, which are distinct economic effects
  (time-value-of-capital and tail-risk exposure, respectively, not transaction cost).
- **`RollUtility`'s own internal alternatives comparison** (against HOLD/CLOSE/ASSIGN/
  REDEPLOY) must not be re-run a second time at the outer `ManagementUtility`
  comparison level for the ROLL action specifically — `U(ROLL, T)` **is**
  `RollUtility(T)` directly, not `RollUtility(T)` further discounted by a second
  opportunity-cost term, which would subtract the same alternatives comparison twice.
- **`CCUtility`'s `CallAwayRegret`** is a cost specific to the SELL_CC action's
  eventual call-away outcome and must not be additionally subtracted from `ASSIGN`'s
  utility just because assignment is what made a covered call possible in the first
  place — the two are sequential, separately-timestamped decisions (assignment first,
  covered-call decision later, potentially much later given `RECOVERY_WAIT`), each
  with its own utility evaluated at its own decision time.
- **`WholeChainPnL`'s realized-vs-open-MTM split** (per `../phase2/FORMULA_REGISTRY.md`)
  must be respected when computing any `EV_net(...)` term above for a position with
  prior legs already realized (e.g. a rolled position's old leg) — the old leg's
  realized P&L is never re-included in the new leg's `EV_net` computation, consistent
  with the charter's roll-immutability rule and F9 in `../phase3_strategy_dna/FAILURE_DNA.md`.

## `THETA_CycleUtility` (unchanged status)

Still TEST, not RETAIN, per `../phase2/FORMULA_REGISTRY.md` — this pass does not
propose resolving that status. The same-state action comparisons above operate at the
individual-decision level; `THETA_CycleUtility` would be the full-cycle aggregate,
which remains an open composition question this pass does not need to resolve to
specify management-decision comparisons correctly.

## Status

No new formula introduced — this file is a derivation/discipline layer over the four
already-canonical formulas in `../phase2/FORMULA_REGISTRY.md`. No performance claimed.
