# THETA Management Policy Hypothesis Library

Extends `../phase2/PHASE2_MASTER_SPEC.md` §10 (management decision engine, previously
SPECIFIED with no hypotheses of its own) and generalizes the existing pairwise H-R-01
vs. H-R-02 comparison into a full multi-way state comparison across
HOLD/CLOSE/ROLL/EXPIRE/ACCEPT_ASSIGNMENT, per this Phase 5 task's explicit requirement
("Compare at every state: HOLD / CLOSE / ROLL / ASSIGN / EXPIRE"). New hypotheses below
are additions to, not replacements of, `research/data/hypotheses.json`'s existing
H-R-01/02/03 — those remain authoritative for the roll-specific claims; this file
registers the broader multi-action comparison the existing pair only partially covers.

**No universal fixed threshold (20% stop, 50% target, 21-DTE exit) is proposed as a
production rule anywhere below — every one of those is registered as a benchmark
counterfactual only, per this task's explicit instruction.**

## H-M-01 (new): Multi-way management action value must be compared jointly, not decided by a sequence of pairwise rules

- **Type:** measurement/architectural.
- **Statement:** At any open-position decision timestamp, `ManagementUtility` must be
  computed for every feasible action in
  {HOLD, CLOSE, ROLL, EXPIRE (if applicable), ACCEPT_ASSIGNMENT (if applicable)}
  simultaneously, and the action with the highest utility taken — never decided by a
  fixed priority ladder (e.g. "always check stop-loss first, then profit-target,
  then...") that could select a dominated action because an earlier rule in the ladder
  fired first.
- **Mechanism:** A sequential rule ladder is a specific bug pattern this hypothesis
  guards against — an early-firing rule (e.g. "close if premium capture > 50%") can
  fire and act before a later, better rule (e.g. "but if a roll's utility is even
  higher, roll instead") is ever evaluated, because the ladder short-circuits at the
  first match rather than comparing all options.
- **Status:** RETAIN — this generalizes H-R-03 (already RETAIN, roll-specific) to every
  management action, and is a direct restatement of `../phase2/PHASE2_MASTER_SPEC.md`
  §10's existing (SPECIFIED, unimplemented) management decision engine requirement.
- **Failure mode:** A naive implementation that reintroduces a priority ladder "for
  simplicity" while claiming utility-based comparison is happening would silently
  violate this — must be checked by inspection (does the implementation compute
  utility for every feasible action before deciding?), not just by testing a few
  scenarios that happen to agree with both approaches.
- **Data availability:** ARCHITECTURE_CHECK_NOT_DATA_DEPENDENT (same class as H-H-02/
  H-A-02/H-A-03).

## H-M-02 (new): DTE-conditioned management improves over a DTE-blind fixed threshold

- **Type:** trading.
- **Statement:** A management policy that conditions its close/roll/hold decision on
  remaining DTE (e.g. tightening or loosening effective thresholds as expiration
  approaches) beats a DTE-blind fixed-percentage stop/target on capital-day-adjusted
  after-cost EV.
- **Mechanism:** Extrinsic value decay is convex in time-to-expiration — the same
  percentage move in premium represents a very different economic event at 45 DTE
  versus 3 DTE (per `theta_h_baseline.py`'s own DTE-window design distinguishing
  THETA-H's 2-5 DTE regime from THETA-Q's 30-60 DTE regime at the *entry* level; this
  hypothesis asks whether the same conditioning should also apply at the *management*
  level within a single position's life, not just at entry).
- **Alternatives:** `BR-4` (fixed premium stop, proposed in `PHASE5_MASTER_SPEC.md` §2),
  `B3`/`BR-2` (fixed profit-take).
- **Label type:** `management_label`.
- **Payoff target:** `ReturnPerCapitalDay`, consistent with H-R-01's own metric choice.
- **Failure mode:** Must be tested on the same candidate set/period as its benchmark
  comparisons, per the shared discipline every R-family hypothesis already follows.
- **Status:** TEST.
- **Data availability:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA`.

## H-M-03 (new): Ownership-conditioned management improves over an ownership-blind fixed threshold

- **Type:** trading.
- **Statement:** A management policy that treats an ownership-acceptable underlying
  differently at the ASSIGN/CLOSE decision point than an ownership-unacceptable one
  (i.e. is more willing to let assignment happen on the former, more willing to close
  early on the latter) beats an ownership-blind fixed stop/target on full-chain
  after-cost EV.
- **Mechanism:** This is the management-time analogue of H-A-01 (already RETAIN at
  entry/assignment-acceptance) — the claim here is that the *same* ownership signal
  should also inform the pre-assignment CLOSE-vs-HOLD decision, not just the
  accept-vs-mechanically-close decision H-A-01 already covers.
- **Alternatives:** `BR-4`, `BA-1` (mechanical close-before-assignment, reused as a
  management-time counterfactual here as well as its original entry-time role).
- **Label type:** `management_label`.
- **Payoff target:** Full-chain after-cost EV (`WholeChainPnL`), consistent with
  H-A-01.
- **Status:** TEST — distinguished from H-A-01 (RETAIN) because H-A-01 is about
  *accepting* assignment once it happens; H-M-03 is about whether ownership should
  *also* change the pre-assignment management decision, which is a related but
  separate, genuinely open claim.
- **Data availability:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA`.

## H-M-04 (new): Regime-conditioned management improves over a regime-blind fixed threshold

- **Type:** trading.
- **Statement:** A management policy conditioned on the 5-axis regime state
  (`regime_v0.py`) — e.g. more conservative (favoring CLOSE over HOLD) under a
  CORRECTION/CRISIS stress state — beats a regime-blind fixed threshold on
  DD/ES-adjusted after-cost EV.
- **Mechanism:** H-R-01/H-R-02 both name regime-conditioning as an open, unverified
  mechanism ("elevated volatility regimes plausibly favor early close (unverified)" /
  "low/normal volatility regimes plausibly favor patience (unverified)") — H-M-04
  registers this as its own testable claim rather than leaving it as an unverified
  aside inside the two contradictory roll-timing hypotheses.
- **Alternatives:** `BR-4`, `B3`/`BR-2`.
- **Label type:** `management_label`.
- **Payoff target:** `EV_net` and DD/ES together (never DD improvement claimed without
  checking EV didn't worsen, and vice versa).
- **Status:** TEST.
- **Data availability:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA`.

## Cross-reference to existing registry

H-M-01 through H-M-04 are additive. The existing `hypotheses.json` entries most
relevant to this Phase 5 task remain unchanged and authoritative: H-R-01/H-R-02
(contradictory early-close-vs-patience pair), H-R-03 (RETAIN, alternatives-comparison),
H-A-01/H-A-02/H-A-03/H-A-04 (assignment/recovery), H-C-01/H-C-02 (covered call),
H-H-01/H-H-02 (Hold-the-Strike). This file does not restate their full field sets — see
`research/data/hypotheses.json` and `../phase3_strategy_dna/THETA_HYPOTHESIS_LIBRARY.md`.

## Status

All four new hypotheses are TEST or RETAIN as marked; none has been run.
`BLOCKED_BY_DATA` pending a backtester (Phase 6 gate). No performance claimed.
