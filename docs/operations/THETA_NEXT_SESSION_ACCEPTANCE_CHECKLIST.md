# THETA next market session: runtime acceptance checklist

Purpose: upgrade rows from "deployed, not yet observed" to "current-release runtime observed" using only real evidence from the first full
session after the Phase 3 release. Nothing here authorizes a trade; a Paper canary happens only if a natural canonical candidate reaches
positive sizing. All checks are read-only. Record the deployed SHA first; observations count for the release only if they were made at it.

Session window (US equities): 13:30Z to 20:00Z. Evidence cycles run about every 9 minutes.

## 0. Identity (before the open)

| Check | Pass condition |
|---|---|
| main SHA = deployed SHA = worker SHA | exactly equal; the release receipt names the SHA |
| Production schema | head `068_action_plan_integrity` |
| Supervisor / lease / heartbeat | one supervisor, one active lease, heartbeat fresher than 2 minutes |
| Execution gate | state recorded (LOCKED or FIRST_CANARY_ARMED); followers disabled; live not authorized |

## 1. Frontier persistence (the 2026-10-02 incident, INC-20261002-FRONTIER-PAYLOAD)

| Check | Pass condition |
|---|---|
| Evidence cycles that persisted | every full-chain cycle `SUCCEEDED` or `DEGRADED` with a stated reason; none `FAILED` with `CANONICAL_FRONTIER_POLICY_PAYLOAD_TOO_LARGE` |
| Persisted projection size | well under the 768 KiB inline policy for the largest chain (SPY about 2.9k contracts) |
| Projection truncation state | present and explicit (`BOUNDED_PROJECTION_FULL_LIST_IN_COMPRESSED_CYCLE_ARCHIVE`, counts exact, full-list hash recorded) |
| Archive | the compressed cycle archive holds the complete list and its hash matches the projection hash |

Upgrade `FRONTIER_PROJECTION_BOUND` only after at least one such full-chain cycle persists at the final deployed SHA.

## 2. Decision funnel (every denominator explicit)

Record for each completed scan: universe discovered / ranked / analyzed; per underlying Q input, pass, reject by gate with exact reasons; H and D
in/pass/reject; A and C applicability (NOT_APPLICABLE while flat); AEGIS reached / not reached / pass / capacity-zero / veto with the binding
family; sizing reached / zero / positive; final action and wait reason. A generic "no qualifying candidate" with exact reasons available is a
defect.

SPY account-fit: record the cheapest Q-valid contract's collateral, the soft and hard concentration capacities, and the binding constraint. If the
account cannot hold it, classify `ACCOUNT_POLICY_INCOMPATIBILITY`; do not loosen policy.

## 3. Execution and fence (only if an order exists)

| Check | Pass condition |
|---|---|
| Fence refusals | any `MUTATION_FENCE_LOST` is logged with its reason and the plan returns to WAITING_GATE, never quarantined, never submitted |
| First canary | max 1 contract; exactly one order for the intent; client order id deterministic; lineage plan, intent, broker order, fill recorded |
| Unknown submit | any `UNKNOWN_SUBMISSION` reconciles by client order id before anything else |
| Reconciliation | GOOD before and after |

If no legitimate candidate reaches positive sizing, "armed but no order" is the correct outcome.

## 4. Command-5A marks

| Check | Pass condition |
|---|---|
| Marks ticker | a tick about every 40 s with state OK and zero broker mutations |
| 1m and 5m marks | observed counts per horizon with lateness p50 / p95; misses split into provider-limited (no usable indicative quote), host-offline, and code-caused |
| Fresh starvation | no pending past-due fresh job older than its retry window |

## 5. Provider, latency, memory

Typed provider failures by class (auth, entitlement, rate limit, network, server, malformed, stale); cycle wall-clock p50 / p95; per-stage latency and
memory only where instrumentation exists (do not fabricate stages that were not reached).

## 6. Board upgrade rule

A row becomes runtime-observed only with real data at the deployed SHA. Tested, replayed or shadow-observed rows stay at their lower class.
