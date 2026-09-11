# THETA Strategy Applicability Matrix (R6E)

Documents `bots/theta/quant/models/strategy_router.py`'s ACTUAL current
eligibility logic (`route_strategies`) against the regime-based matrix
format R6E requests, rather than building a second, parallel router. Per
`docs/research/R6E_DUPLICATION_AUDIT.md` item 3: no new router module was
written this phase.

## Current dimensions actually wired into eligibility (Layer 0/1)

| Dimension | Values consumed today | Families it gates |
|---|---|---|
| `critical_data_valid` | bool | ALL (Layer 0 blanket exclusion) |
| `lifecycle_state` | `CASH_AVAILABLE` / `CSP_OPEN` / `ASSIGNMENT_RISK` / `STOCK_HELD` / `RECOVERY` / `CC_OPEN` / `ROLL_PENDING` / `ORDER_PENDING` / `UNKNOWN_SUBMISSION` | THETA-Q/H/D (fresh entry only), THETA-R (existing option only), THETA-A (assignment/stock only) |
| `stock_shares_held` | float | THETA-C (confirmed inventory only) |
| `assignment_imminent` | bool | THETA-A |
| `ownership_acceptable` | continuous [0,1], two DIFFERENT floors | THETA-Q (lower floor), THETA-H (stricter floor) |
| `liquidity_acceptable` | bool | THETA-Q |
| `event_near` | bool | THETA-H (excluded near events) |
| `theta_d_gate_satisfied` | bool (Level 3 + graduation) | THETA-D |

## Regime dimensions R6E asks for that are NOT yet wired into
## `route_strategies` -- genuine gaps, not silently assumed to exist

| Requested dimension | Current status |
|---|---|
| Vol regime (low/normal/high, rising/falling) | Not consumed by the router at all. `models/regime_v0.py` computes a `RegimeSnapshot` with a `confidence` field already flagged as "informational only" in `HARD_GATE_VS_SOFT_FEATURE_REGISTRY.md` -- no vol-regime-to-eligibility wiring exists. |
| Trend regime (bull/bear/sideways) | Not consumed. Same `regime_v0.py` gap. |
| DTE / delta continuous buckets | Not consumed by the ROUTER (family eligibility); DTE/delta ARE consumed within a family's own candidate generation (`theta_q_baseline.py`/`theta_q_lattice.py`), a different layer than this matrix's own scope. |
| Underlying family / sector | Not consumed by the router. |
| Flow context | Not implemented anywhere yet (`FeatureFamily.FLOW = NOT_IMPLEMENTED`). |
| Liquidity state (continuous, beyond the current bool) | Currently a bool (`liquidity_acceptable`); no graded liquidity-state dimension. |

## The matrix as it exists today (regime x family, from the code above)

| Lifecycle state | THETA-Q | THETA-H | THETA-R | THETA-A | THETA-C | THETA-D |
|---|---|---|---|---|---|---|
| `CASH_AVAILABLE` | Eligible if ownership+liquidity OK | Eligible (challenger) if stricter ownership bar met AND no event | Ineligible | Ineligible | Ineligible (unless stock also held) | Eligible (challenger) only if gated | 
| `CSP_OPEN` | Ineligible (not a fresh entry) | Ineligible | Eligible (primary) | Ineligible (no assignment/stock yet) | Ineligible (unless stock held) | Ineligible |
| `ASSIGNMENT_RISK` | Ineligible | Ineligible | Ineligible (unless also CSP_OPEN/ROLL_PENDING/CC_OPEN) | Eligible (primary) | Ineligible (unless stock held) | Ineligible |
| `STOCK_HELD` | Ineligible | Ineligible | Ineligible | Eligible (primary) | Eligible (primary, confirmed inventory) | Ineligible |
| `RECOVERY` | Ineligible | Ineligible | Ineligible | Eligible (primary) | Eligible if stock still held | Ineligible |
| `CC_OPEN` | Ineligible | Ineligible | Eligible (primary) | Ineligible (unless assignment_imminent) | Eligible (confirmed inventory) | Ineligible |
| `ROLL_PENDING` | Ineligible | Ineligible | Eligible (primary) | Ineligible (unless assignment_imminent) | Ineligible (unless stock held) | Ineligible |

Every cell above is a genuine `route_strategies` outcome, not an inferred
approximation -- this table is a direct transcription of the tested code
path, so it stays accurate as long as `strategy_router.py`'s own test suite
(`test_strategy_router.py`) continues to pass.

## When would CC management / RECOVERY_WAIT / defined-risk be superior?
## (Research questions, not yet answered -- explicitly UNKNOWN)

These are exactly the kind of question `management_action_value.py`'s
`evaluate_management_alternatives`/`hold_advantage` already computes a
POINT ANSWER for at a given decision timestamp (which action currently has
the highest utility), and `action_value_distribution.py` (this phase) now
specifies the DISTRIBUTIONAL contract for the same question. Neither module
can currently report a real number (`EV_MODEL_NOT_EMPIRICALLY_READY`) --
"when RECOVERY_WAIT beats immediate CC" is answerable in principle by this
existing machinery once real resolved episodes exist, not by a new
regime-lookup table built ahead of that data.

## Status

`strategy_router.py` remains the single, authoritative "which branch may
compete" answer. This document's job was to make its ACTUAL dimensions
explicit in the requested matrix shape and name the real gaps -- not to
introduce a second, competing eligibility system.
