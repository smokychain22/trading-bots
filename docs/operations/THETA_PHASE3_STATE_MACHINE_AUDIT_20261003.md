# THETA Phase 3: execution state machine audit (2026-10-03)

Source of truth: `ORDER_INTENT_TRANSITIONS` in `src/theta/order-intent-state.ts`, persisted in `trade.order_intent.status`, driven only by
`PaperOrderCoordinator`. Proofs: `tests/phase3-exec-state-machine.test.ts` (exhaustive from x to pair test), `phase3-exec-unknown-submit.test.ts`,
`phase3-exec-fault-injection.test.ts`, `phase3-exec-partial-fills.test.ts`, `order-intent-transition-invariants.test.ts`.

## Concept -> implementation mapping

| Conceptual state | Implemented state(s) | Note |
|---|---|---|
| INTENT | PROPOSED, PREFLIGHT, READY | no broker contact yet; restart re-derives from the persisted row |
| SUBMITTING | SUBMITTING | persisted BEFORE the POST; a crash here is UNKNOWN_SUBMISSION on recovery |
| ACKNOWLEDGED | SUBMITTED (POST returned), ACKNOWLEDGED (broker reports accepted/new) | |
| WORKING | ACKNOWLEDGED | resting order |
| PARTIAL | PARTIAL | filled quantity and remaining quantity both persisted |
| FILLED | FILLED (terminal) | |
| CANCEL_REQUESTED | CANCEL_REQUESTED | a late fill during cancel is a legal edge to FILLED/PARTIAL |
| CANCELED | CANCELED (terminal) | broker expired/rejected/done_for_day while cancelling also map here |
| REPLACE | no in-place state: cancel the original, then (only when policy allows) a NEW intent with a new deterministic client order id; the original ends CANCELED via `closeReplacedOriginal` | a part-filled stock exit is NEVER replaced (`PARTIAL_STOCK_SELL_REPLACE_FORBIDDEN`) |
| REJECTED / EXPIRED | REJECTED / EXPIRED (terminal) | |
| UNKNOWN_RESULT | UNKNOWN_SUBMISSION | reconcile by deterministic client order id before any further action |
| RECONCILED | RECONCILING exits to the broker-observed state | the documented RECONCILING -> PROPOSED edge is legal but never taken by production code (a not-found order stays unresolved, never re-submitted blindly) |

## Properties

| Property | Evidence |
|---|---|
| Legal predecessor/successor for every pair | the exhaustive pair test checks the table against `isLegalOrderIntentTransition` and the DB trigger/guard |
| Terminal -> active resurrection impossible | CANCELED, FILLED, REJECTED, EXPIRED have empty successor lists; test asserts it |
| Duplicate submission impossible | deterministic client order id + unique constraint; concurrent submit test; fault-injection matrix asserts exactly one broker order |
| Unknown-result replay | UNKNOWN_SUBMISSION is only left through RECONCILING; mutations are never retried (`runBoundedRead` is read-only) |
| Restart behavior | `recoverAfterRestart` resumes each non-terminal state; rate-limit tolerant; tests per state |
| Persistent state before broker contact | SUBMITTING is written before the POST |
| Idempotency | same client order id returns the existing intent; replays of fills are keyed by fill id |

## Defects found by the audit (fixed)

1. CANCEL_REQUESTED could stay stuck when the broker reported the order expired or rejected.
2. A cancel request lost to a rate limit was not re-issued.
3. 404/422 on cancel was not re-read to learn the true state.
4. A definite mutation failure left the intent in SUBMITTING (now `settleDefiniteMutationFailure`).
Remaining code-solvable defects: 0.
