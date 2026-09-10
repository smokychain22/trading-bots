# Roll Policy Hypotheses (Phase 5 view)

Authoritative source remains `research/data/hypotheses.json`'s H-R-01/H-R-02/H-R-03 —
unchanged. This file adds the multi-way generalization already registered as H-M-01/
H-M-02/H-M-04 in `MANAGEMENT_HYPOTHESIS_LIBRARY.md` (cross-referenced, not duplicated)
and one roll-specific refinement.

## Roll-specific refinement: a roll's "new leg" must itself clear the same entry bar as a fresh CSP

**New observation (not yet a registered hypothesis):** `RollUtility` already requires a
roll to beat the best feasible alternative (H-R-03, RETAIN). A related but distinct
question this task's framing surfaces: does the *new* leg opened by a roll need to
independently satisfy THETA-Q's own entry hard-vetoes and ownership-acceptability floor
(as if it were a fresh CSP candidate), or can a roll's new leg be opened on a name that
would currently fail the fresh-entry bar, simply because the position was already open?
**Recommendation:** the new leg should clear the same entry bar as any fresh candidate
— rolling should never be a backdoor around THETA-Q's own hard-veto/ownership
screening. This is implied by, but not yet explicitly stated in,
`../phase2/PHASE2_MASTER_SPEC.md` §9's roll-engine contract. Flagged here as a gap for
a future session to state explicitly in that contract (a documentation addition, not a
new hypothesis requiring its own OOS test — this is closer to H-R-03/architecture-level
territory than an open empirical question).

## Status

No modification to `hypotheses.json`. One gap flagged in the roll-engine contract for
a future session. No performance claimed.
