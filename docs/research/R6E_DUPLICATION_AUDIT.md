# R6E Duplication Audit (novelty process applied to Claude's own prior work)

Per R6E's explicit novelty process ("already represented? -> DUPLICATE / link
existing hypothesis"), applied here to Claude's OWN recent work before adding
anything new this phase. Three real overlaps were found by reading
`bots/theta/quant/models/` (not previously inspected before R6D) against
R6D's own new modules. Recorded honestly rather than silently ignored.

## 1. `management_policy.py` (R6D) vs. `management_action_value.py` +
   `candidate_actions.py` (pre-existing, Phase 2B-quant)

`management_action_value.py` already implements a real, tested, versioned
same-state `ManagementUtility` comparison across HOLD/CLOSE/EXPIRE/ROLL/
ASSIGN/REDEPLOY (`evaluate_management_alternatives`, `hold_advantage`), with
an explicit "total-since-entry" valuation convention, a `NetRollCredit`-vs-
`RollUtility` distinction (H-R-03), and a real, canonical action vocabulary
(`research/candidate_actions.py`'s `CandidateAction` enum). R6D's
`management_policy.py` independently defined its OWN parallel
`ManagementAction` enum and a simpler `management_utility()` function --
**a real duplicate action vocabulary**, exactly the failure mode this
phase's novelty process exists to prevent.

**Resolution:** not deleted (already pushed, already has its own tests), but
explicitly reconciled: `management_policy.py`'s `ManagementAction` is
recorded here as a **should-have-been** `CandidateAction` reference, and no
further code in this repository should add a THIRD action vocabulary.
`management_policy.py`'s genuinely non-duplicate contribution --
`ManagementDecisionExplanation` (the QuantWheel-style narrative contract),
`ExitPolicyFamily`/`GlobalWaitReason`/`GlobalWaitEvidence` (taxonomies that
exist nowhere else) -- is retained and extended this phase using
`CandidateAction` directly going forward (see `action_value_distribution.py`,
below).

## 2. Planned `position_sizing.py` (R6E) vs. `sizing.py` (pre-existing,
   Phase 2C-quant)

Before writing a new sizing module for item 12, `sizing.py` was read and
found to ALREADY implement exactly the requested `Qty = min(risk_budget,
collateral, concentration, assignment_capacity, buying_power, broker_
allowed)` formalization, with quantity-zero-is-legitimate and no-martingale
already enforced and tested (`test_sizing.py`). **No new module was written.**
Item 12's specific invariant requests (tighter tail-risk/concentration
budget never increases quantity, zero capacity -> zero contracts, unknown
multiplier -> non-executable) are added this phase as NEW TESTS against the
EXISTING `sizing.py`/`episode_economics.py` (see `test_sizing.py`'s new
`MonotonicityInvariantTests`), not a new implementation.

## 3. Planned "strategy applicability matrix" module (R6E item 6) vs.
   `strategy_router.py` (pre-existing, Phase 6 router)

`strategy_router.py` already implements a real, tested, regime/lifecycle-
based eligibility router (`route_strategies`) across all six strategy
families (THETA-Q/H/R/A/C/D), with `EligibilityState`
(`ELIGIBLE_PRIMARY`/`ELIGIBLE_CHALLENGER`/`ELIGIBLE_REDUCED`/`INELIGIBLE_*`)
already distinguishing primary-vs-challenger eligibility and already
enforcing THETA-H's stricter cohort bar over THETA-Q's. **No new router
module was written.** This phase's actual contribution is
`THETA_STRATEGY_APPLICABILITY_MATRIX.md`, which documents `strategy_router.
py`'s ACTUAL current dimensions against the regime-based matrix format R6E
requests, and names the genuine remaining gaps (vol regime, DTE/delta
continuous buckets, flow context are not yet wired into `route_strategies`'s
own eligibility logic -- currently only lifecycle state, ownership score,
and event-proximity are) as future work, rather than re-implementing what
already exists.

## What is genuinely new this phase (not found duplicated anywhere)

`feature_taxonomy.py` (the finer 8-way HARD_GATE/SOFT_FEATURE/SOFT_PENALTY/
SOFT_BONUS/STRUCTURE_ROUTER_INPUT/MANAGEMENT_ONLY_FEATURE/RISK_ONLY_FEATURE/
EXECUTION_ONLY_FEATURE split -- `HARD_GATE_VS_SOFT_FEATURE_REGISTRY.md`
already exists but only distinguishes the coarser hard/soft binary),
`strictness_diagnostics.py` (candidate-funnel/WAIT diagnostics -- nothing
in the repository currently computes this), `champion_challenger.py`
(CHAMPION/CHALLENGER/RESEARCH_ONLY/RETIRED routing tied to
`promotion_checker.py` -- `strategy_router.py` answers "is this family
eligible RIGHT NOW" but nothing answers "has this family graduated its own
promotion checklist" separately), `action_value_distribution.py` (a
DISTRIBUTIONAL extension of `management_action_value.py`'s point-estimate
utilities -- median/percentiles/ES/probability-positive, none of which
`management_action_value.py` computes), `opportunity_capture.py`,
`strategy_routing_shadow.py` (implements `STRATEGY_ROUTING_SHADOW_RECORD.md`
's SPECIFIED-but-not-coded `StrategySelectionRegret`/`RouteRegret`/
`MissedStrategyOpportunity`/`BadStrategyActivation`/gate-regret contracts as
real Python dataclasses for the first time), and `ProfitTakingPolicy`/
`LossPolicy` enums added to `management_policy.py` (finer-grained than R6D's
single `ExitPolicyFamily`, per this phase's items 10/11).
