# THETA Hypothesis Library — Narrative Index

Durability artifact. **This file does not duplicate `research/data/hypotheses.json`,
which remains the single source of truth for all 14 registered hypotheses** (full
field set: mechanism, alternatives, label_type, label_definition, payoff_target,
failure_mode, calibration_requirement, evidence_requirement, acceptance_criterion,
rejection_criterion, status, rationale, data_availability_status). This file is the
narrative summary a reader of the Phase 3 package needs without opening the raw JSON.

## Summary table

| ID | Archetype | Type | Status | One-line statement |
|---|---|---|---|---|
| H-Q-01 | THETA-Q | trading | TEST | Ownership/severe-drawdown screening beats premium/IV-rank-only CSP selection on after-cost EV and DD. |
| H-Q-02 | THETA-Q | trading | TEST | IV-rank-only selection (no ownership screen) produces worse Whole-Chain WR and assignment-drawdown. |
| H-H-01 | THETA-H | trading | TEST | On a separately validated narrow cohort, 2-5 DTE ATM short-puts beat the conventional 30-60 DTE lattice on Managed Episode WR — does not transfer without its own validation. |
| H-H-02 | THETA-H | measurement | RETAIN | Closed-trade WR alone cannot prove this archetype safe; Whole-Chain WR and Open MTM must accompany it. |
| H-R-01 | THETA-R | trading | TEST | Active close/roll beats hold-to-expiration in at least some regimes (contradicts H-R-02). |
| H-R-02 | THETA-R | trading | TEST | Hold-to-cycle beats fixed early close/roll in at least some regimes (contradicts H-R-01). |
| H-R-03 | THETA-R | trading | RETAIN | A roll only adds value when its utility beats the best feasible alternative computed at the same timestamp — never "roll every loser." |
| H-C-01 | THETA-C | trading | RETAIN | Full CCUtility trade-off (premium vs. retained upside vs. call-away regret vs. event risk) beats max-yield-only CC selection. |
| H-C-02 | THETA-C | trading | RETAIN | Recovery-conditioned CC timing beats selling a call immediately after every assignment. |
| H-A-01 | THETA-A | trading | RETAIN | Accepting assignment when ownership-acceptable beats mechanically closing before assignment. |
| H-A-02 | THETA-A | measurement | RETAIN | A recovery-wait policy must have an explicit bound — unconditional unbounded waiting is not acceptable design, independent of the bound's value. |
| H-A-04 | THETA-A | trading | TEST | Among a pre-registered sweep of bounded recovery-wait policies, the walk-forward-selected bound beats unconditional waiting, confirmed on untouched OOS. |
| H-A-03 | THETA-A | measurement | RETAIN | Same Leg-WR-hides-inventory-drawdown guard as H-H-02, restated for the archetype most exposed to it. |
| H-D-01 | THETA-D | trading | TEST (GATED) | A defined-risk spread can express the same premium thesis with bounded downside when full CSP sizing is zero — not to be evaluated before Level 3 + archetype-graduation gates are met. |

## RETAIN vs. TEST discipline (why this split matters)

Seven of fourteen hypotheses are RETAIN — meaning they are already enforced as hard
TRD/charter rules at the architecture level (H-R-03/ROLL-002, H-C-01/LIFE-004,
H-C-02/STRAT-003, H-A-01/STRAT-002, H-A-02/OWN-002, plus the two measurement guards
H-H-02/H-A-03 under OUT-001..004). RETAIN status does not mean "proven by data" — it
means "the design requirement is non-negotiable regardless of what a benchmark run
would show," with the associated benchmark (`BA-1`/`BA-2`/`BA-3`/`BC-1`/`BC-2`/`BR-1`
etc.) existing to confirm the effect empirically once possible, not to decide whether
the rule applies. The six TEST-status hypotheses (plus the gated H-D-01) are genuinely
open — no acceptance/rejection has occurred for any of them, because no backtester
exists yet.

## H-A-02 / H-A-04 split (worth restating explicitly)

These two entries were previously one conflated hypothesis that mixed a settled
architectural constraint ("a bound must exist") with a genuinely open empirical
question ("which bound value"). The split — H-A-02 as RETAIN/architecture-only,
H-A-04 as TEST/parameterized-sweep-with-explicit-three-step-leakage-guard — is already
reflected in `hypotheses.json` and is not re-litigated by this durabilization pass; it
is recorded here because a reader encountering only the conversational history of this
engagement (which predates the split) could otherwise miss that it happened.

## Status

Narrative index only. `research/data/hypotheses.json` is unmodified and remains
authoritative.
