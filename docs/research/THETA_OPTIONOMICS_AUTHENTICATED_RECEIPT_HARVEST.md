# Optionomics authenticated receipt harvest (Wave 13 Batch 1)

Reads `docs/operations/THETA_OPTIONOMICS_AUTHENTICATED_RECEIPT_2026-09-22.md`
(Codex's real, sanitized account probe from main `1bcf854`) and updates
this branch's event/PIT classification accordingly. No new provider
calls made this pass -- pure synthesis of Codex's already-real evidence.

## Classification per this wave's request

```
MACRO_FED_EVENT_PIT = REAL
```
Real Aiven inspection found 6 rows in
`market.optionomics_event_first_observation` -- 5 macro, 1 Fed,
`TIMING_VALID`, provider-known time before THETA's first-observed time,
scheduled time after. This is genuine, verified PIT-safe forward macro/Fed
context. `EVENT_RISK_STATE`'s prior registry classification
(`LEGITIMATE_RUNTIME_UNKNOWN` in the Wave 9 unknown audit) should narrow:
the macro/Fed slice of event evidence is now `REAL`, not merely
`NOT_INDEPENDENTLY_VERIFIED`.

```
PROSPECTIVE_COMPANY_EARNINGS = PARTIAL
```
`expected_moves.earnings_in_sessions` returned real numeric values for
AAPL/MSFT on the tested session -- genuine provider-derived data exists.
But per Codex's own receipt: source announcement time, complete future
earnings coverage, and calendar-day conversion were NOT established by
this probe. **Per this wave's explicit instruction, this field must NOT
be promoted to a hard Production safety gate until those three things are
proven.** Earnings filing analyses returned are historical, not a future
schedule -- explicitly cannot be used to clear a prospective-earnings
UNKNOWN.

```
CORPORATE_ACTION_NEGATIVE_ASSURANCE = OPEN
```
Zero ticker-scoped rows in the 6-row Aiven sample; company/negative
corporate-action coverage was not established. A complete page of company
events is explicitly NOT proof of a complete calendar (Codex's own
receipt states this). Remains open, unchanged from prior waves' finding.

## What does NOT change

This harvest does not modify any Production source, does not touch
`src/theta/`, and does not change any capability registry `currentState`
to `REAL` for the company-earnings or corporate-action rows -- only the
macro/Fed slice, which has genuinely independent, stronger evidence
(direct Aiven row inspection, not just an HTTP 200) than the rest of the
event surface. `EVENT_RISK_STATE`'s registry row should be updated in a
future pass to reflect this narrower, more precise picture (macro/Fed
REAL, company/corporate-action still open) rather than one blended
`LEGITIMATE_RUNTIME_UNKNOWN` -- not changed in this pass to avoid
touching the registry mid-wave without also re-running its full test
suite in the same commit; flagged here for the next registry-touching
pass.

## Codex handoff (informational, not a new queue row)

Codex's own receipt already names the next required proof: "inspect raw
field-level timestamps and units in a bounded sanitized operation,
establish PIT event/corporate-action coverage independently, persist a
capability observation after database recovery, then test current-worker
consumers with new risk locked." This is already Codex's own stated next
step, not a new Claude-side finding -- no duplicate queue row added.
