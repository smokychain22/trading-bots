# Assignment/Recovery Policy Hypotheses (Phase 5 view)

Authoritative source remains `research/data/hypotheses.json`'s H-A-01/H-A-02/H-A-03/
H-A-04 — unchanged. This file adds the one genuinely new angle this Phase 5 task's
framing surfaces: how assignment/recovery interacts with the *management*-time
decision (not just the entry/acceptance decision H-A-01 already covers).

## New angle: pre-assignment CLOSE-vs-HOLD as its own decision point

H-A-01 governs whether to *accept* assignment once it is imminent/triggered. It does
not, on its own, govern whether to proactively CLOSE a CSP *before* assignment becomes
imminent, purely to avoid the possibility of assignment altogether. That is exactly
`MANAGEMENT_HYPOTHESIS_LIBRARY.md`'s H-M-03 (new), registered there rather than
duplicated here — this file exists only to make the connection explicit: H-A-01 and
H-M-03 are related but answer different questions (accept-vs-avoid a happening
assignment, vs. proactively-close-vs-continue-holding before assignment risk rises).

## Recovery-bound sweep (H-A-04) — no change, restated for completeness per this task

The pre-registered sweep of bounded recovery-wait policies (distinct max-wait-days /
thesis-invalidation-trigger combinations) remains exactly as specified in
`hypotheses.json`, including its three-step leakage guard (define the sweep before
touching OOS; select via purged walk-forward only; confirm on a separate untouched OOS
split). This Phase 5 pass does not alter that design — the management competing-risk
model in `MANAGEMENT_MODEL_SPECIFICATION.md` is a candidate *source* for the survival
curve H-A-04's sweep is evaluated against, not a replacement for the sweep's own
discipline.

## Assignment-frequency as a management-quality diagnostic (new, minor)

A policy's realized assignment frequency (how often CSPs actually get assigned vs.
close/expire/roll) is itself a useful diagnostic to report alongside `EV_net`/DD when
comparing management policies — a policy with dramatically higher assignment
frequency than another is taking on more `RECOVERY_WAIT`/stock-holding exposure, which
should be visible in reporting even before any conclusion is drawn about whether that's
good or bad (consistent with H-H-02/H-A-03's whole-chain reporting discipline).
**Classification: RETAIN as a reporting requirement**, not a new trading hypothesis.

## Status

No modification to `hypotheses.json`. One cross-reference to a new Phase 5 hypothesis
(H-M-03) and one new reporting-discipline item. No performance claimed.
