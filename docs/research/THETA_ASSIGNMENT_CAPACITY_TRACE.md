# THETA assignmentCapacity end-to-end trace

Status: Directive item 10 (Wave 3). Grounded in direct reads of
`src/theta/account-exposure.ts`, `src/theta/management-input-state.ts`,
`src/theta/thesis-invalidation.ts`, `src/theta/loss-state-vector.ts`, and
`bots/theta/quant/models/aegis.py`.

## Two distinct "assignment capacity" concepts exist -- must not be conflated

### 1. `AegisInputs.assignmentCapacityUsedPct` (real, computed, AEGIS-consumed)

- **Source**: `deriveCandidateInclusiveAegisInputs` (`src/theta/account-exposure.ts:334-383`)
- **Formula**: `(cspCollateralRequired + pendingAssignmentCollateral + candidateCapital) / equity` -- a real, computed percentage from real account/collateral figures, not a stub.
- **Can it be `null`?** YES, and honestly so -- `evidenceState: 'UNKNOWN_INSUFFICIENT_ACCOUNT_STATE'` when `baseKnown` is false (any of: equity missing/non-positive, `cspCollateralRequired`/`stockInventoryValue`/`pendingOpeningCapitalAtRisk`/`pendingAssignmentCollateral` missing, unparsed option symbols present, unclassified open orders present, or open-order snapshot count mismatch). Every one of these preconditions is checked explicitly before the formula runs.
- **Can it be stale?** Not independently verified this pass -- no explicit freshness/timestamp field was found on the exposure snapshot itself in the code read.
- **AEGIS consumption**: Real -- `bots/theta/quant/models/aegis.py`'s `_threshold_assessment(RiskFamily.ASSIGNMENT, inputs.assignment_capacity_used_pct, policy.max_assignment_capacity_pct, ...)`. `None` -> `HOLD_ONLY` (same UNKNOWN-is-restrictive discipline as every other threshold family); above the soft cap -> `ALLOW_REDUCED`; above `soft_cap * hard_cap_multiplier` -> `HARD_VETO`; otherwise `ALLOW_FULL`.
- **Strategy consumption**: Feeds AEGIS only, per the code read this pass -- no separate direct strategy-router consumption found.
- **Can quantity be positive without it being known?** NO -- confirmed: a `null` value maps to `HOLD_ONLY` in AEGIS, and `HOLD_ONLY` permits zero new-risk-opening actions (`_NEW_RISK_ACTIONS_BY_STATE[HOLD_ONLY] = frozenset()`, per the AEGIS deep-read this pass). So an unknown assignment capacity is already correctly fail-closed on its own, independent of the separate SYSTEM/LIQUIDITY P0 gap.
- **Does it match real broker buying power?** Not independently verified this pass -- `equity` and `cspCollateralRequired` are presumably sourced from real Alpaca account/position data (per the provider capability matrix's confirmed real `BROKER_ACCOUNT`/`BROKER_POSITIONS` capabilities), but the exact freshness/reconciliation guarantee between this computed figure and a live buying-power check was not traced this pass.

### 2. `ManagementInputState.context.assignmentCapacity` (opaque passthrough, never interpreted)

- **Source**: `management-input-state.ts:270`: `assignmentCapacity: riskState.assignmentCapacity ?? null` -- sourced from an upstream `riskState` object whose construction was NOT traced this pass (the real call site supplying `riskState` was not located).
- **Type**: `unknown | null` in `ManagementInputState` -- deliberately untyped/uninterpreted.
- **Consumption**: `thesis-invalidation.ts` and `loss-state-vector.ts` both treat this field as PRESENCE-ONLY evidence (`assignmentCapacityKnown: state.context.assignmentCapacity !== null`) -- its actual VALUE/meaning is never read or interpreted by either consumer, by explicit design ("Present but not interpreted (no verified schema)").
- **Gap**: this field's real population site (the `riskState` object) was not traced this pass -- flagged as a follow-up, not resolved either way.

## Summary verdict

The AEGIS-consumed `assignmentCapacityUsedPct` is **REAL_AND_REACHABLE** --
computed from real account data, honestly UNKNOWN when incomplete, and
correctly fail-closed (UNKNOWN maps to a restrictive AEGIS state, never a
permissive default). The SEPARATE, opaque `ManagementInputState.context.assignmentCapacity`
field used by loss/thesis analysis is **STRUCTURAL_ONLY** from this pass's
evidence -- its real upstream producer (`riskState`) was not located, so
whether it is ever populated with a real value in Production, or is itself
always unknown, remains an open follow-up. These are two different fields
serving two different consumers and must not be assumed to share a
production/freshness guarantee.
