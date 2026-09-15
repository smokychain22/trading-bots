# THETA P2D: Empirical Policy Learning Design

Research-only methodology pass. `CURRENT_MAIN_SHA_AT_START`:
`efff4b346f3d4667230476ccfbaf8c4c093a2aa4` (P2C, CLOSED, recorded only --
Codex is building P2D materialization in parallel, not audited this pass).
This document is the design THETA's future empirical policy learning will
follow once real resolved labels (from P2C's engine) accumulate. It
proposes no Production code and trains no model -- every resolved-label
count referenced remains `RESOLVED_*_LABELS_INSUFFICIENT` today.

New module this pass: `bots/theta/quant/research/label_quality_research.py`
(17 tests) -- see section 11.

## Permanent framing (restated, not re-derived)

Per the standing objective definitions this directive restates:
`70_80_WR_OBJECTIVE = ACTIVE_OPTIMIZATION_TARGET`,
`STRONG_RETURN_OBJECTIVE = ACTIVE_OPTIMIZATION_TARGET`. Neither is a floor,
ceiling, per-trade requirement, or take-profit rule. THETA's objective is
open-ended: the best available after-cost opportunity, evaluated on its own
complete economics, not screened by a headline percentage. Every section
below is written to serve that framing, not to smuggle a fixed threshold in
through the back door of a "reference region."

## 1-2. Performance objective (sections 1-2)

Unchanged from the framing above. The methodology below exists to let
THETA DISCOVER whether 70-80% WR / 40%+-return cohorts exist with
acceptable EV/tails -- it does not assume they do, and does not force a
trade toward either number.

## 3. "Good profit does not mean wait for more" -- decision-rule research

The directive's four examples (+5% deteriorating -> CLOSE optimal; +20%
favorable/controlled -> HOLD optimal; +30% rising tail risk -> protect;
+40% still excellent -> do not auto-close) describe a single underlying
learning target: **forward continuation value net of tail risk**, not a
profit-level lookup table. This is already the shape
`profit_preservation_research.py`'s `continuation_value_requirements()`
refuses to fabricate (it explicitly returns
`ContinuationValueBlocker.NO_CALIBRATED_FORWARD_MODEL` today) and exactly
what P2C's `OutcomePathStatistics` (`peakFutureProfit`, `worstGivebackFromPeak`,
`maximumAdverseExcursion`) is designed to eventually supply real values
for. The target to learn, once labels exist, is:

```
CLOSE_vs_HOLD label = sign(forward_net_pnl_if_held_to_next_decision - forward_net_pnl_if_closed_now)
  conditioned on: current_profit_pct (a FEATURE, never a rule), remaining_theta,
  tail_exposure_at_current_state, event_state (EVENT_STATE_CHANGE, closed R7 P2C-pass-2),
  gamma/vanna/charm context, days_to_expiry, capital_opportunity_cost
```

`current_profit_pct` enters as ONE feature among many -- a model trained on
this target will naturally learn that its marginal predictive value is low
once the other state variables are known, which is the mathematically
correct way to prevent the four examples above from collapsing into "close
above X%."

## 4. High-return entry research -- do not mix metrics

Five distinct return definitions, each with a different denominator and a
different failure mode if confused with another:

| Metric | Denominator | Distorts toward | Use case |
|---|---|---|---|
| Premium/collateral | Full secured capital (CSP) | Understates true capital efficiency for spreads | Cross-structure apples-to-apples on capital at risk |
| Credit/width | Max loss (defined-risk width) | Only meaningful within Defined Risk | Comparing defined-risk structures to each other |
| Capital-day return | Capital x holding days | Rewards fast turnover | Redeployment-efficiency ranking (section 19) |
| Annualized return | Capital-day return x 365 | EXPLODES on short holds (a 2-day +2% annualizes to absurd figures) | Only valid with a caller-supplied minimum holding-period floor before annualizing -- never applied raw |
| Max-risk return | Worst-case loss (assignment/gap) | Punishes CSP relative to defined-risk even when CSP's realized economics are better | Tail-adjusted comparison, paired with CVaR, never alone |

Never report one of these labeled generically as "return" -- every
reported figure must name which of the five it is. This directly answers
the directive's "20/30/40/50/60%+ under each return definition" ask: those
percentage bands are STRATIFICATION labels for cohort discovery (section
5), never five parallel entry thresholds.

## 5. High-WR cohort discovery methodology

A cohort is a caller-defined intersection over: Delta bucket, DTE bucket
(existing `DTE_BINS`/`DELTA_MAGNITUDE_BINS` in `experiment_registry.py`),
IV/VRP regime, skew regime, term-structure regime, `EventState` (new,
`event_state_research.py`), Flow state, `GexSpotScanState` (new,
`gex_spot_scan_research.py`), liquidity tier, strategy branch, and
management-style tag. Discovery procedure, explicitly anti-cherry-picking:

1. Define ALL candidate cohort dimensions and their bucketing BEFORE
   looking at any resolved-label outcome (pre-registration, matching
   `walk_forward.py`'s existing "thresholds fixed before final OOS" norm).
2. Compute `effective_n` (existing `dataset_readiness.py`
   `DependenceGroupKey`/`effective_sample_size`) per candidate cohort, not
   raw row count.
3. Report EVERY cohort tested, not only the ones that cleared a bar --
   multiple-testing correction (section 24, DSR/PBO) applies across the
   FULL tested set, not the survivors.
4. A cohort claiming 70-80% WR must ALSO report EV, PF, AvgWin/AvgLoss,
   DD, CVaR, and `effective_n` in the same breath -- a high-WR cohort with
   `AvgLoss >> AvgWin` fails section 18's screen regardless of WR.
5. Cohort must be found stable across the regime-stability requirement
   (section 15) before being reported as a real finding, not a single-
   regime artifact.

No cohort-discovery code is built this pass -- it requires real resolved
labels to run against, which do not exist yet
(`RESOLVED_WHOLE_CHAIN_LABELS_INSUFFICIENT`). This section specifies the
PROCEDURE so it is ready to execute the moment labels accumulate.

## 6. Policy objective function

Never WR alone, per the directive. Three candidate formulations, compared
honestly rather than one chosen prematurely:

- **Hard-constrained optimization**: maximize EV subject to `CVaR >= floor`,
  `effective_n >= minimum`, `DD <= ceiling`. Simple, interpretable,
  but a single infeasible constraint zeroes out an otherwise-excellent
  policy near the boundary -- brittle at the margin.
- **Pareto frontier**: exactly `canonical-strategy-frontier.ts`'s own
  existing dominance approach (`dominatesExpiration`, already verified in
  the P2B audit), extended to (WR, EV, PF, DD, CVaR, capital-efficiency,
  time-underwater). No single winner is forced; every non-dominated policy
  is retained. This is the framing this engagement has consistently
  preferred (see the P2C-pass-2 receipt's own `POLICY_TARGET_DESIGN`
  entry) and remains the recommended default.
- **Utility function**: collapses the vector to one scalar via
  caller-chosen weights. Most decision-ready, but the weights themselves
  are a policy choice that shifts the "best" answer -- must be justified
  and versioned like any other threshold, never defaulted.
- **Distributional policy scoring**: score the full predicted P&L
  distribution (quantiles, not a point EV) per action -- most information-
  preserving, most demanding of the underlying model (section 22).

**Recommendation**: Pareto-frontier reporting as the default research
artifact (never hides a dimension), with a utility-function ranking
layered on top ONLY at the explicit promotion-review step (section 25),
where a human reviewer inspects and justifies the weights rather than a
model silently choosing them.

## 7. Winner-management targets

The percentages in the directive (+5/+10/.../+60%) are COHORT FEATURES for
stratified reporting, never rule thresholds -- restated per section 3's
framing. The target itself: `P(profitable continuation | state)`, a
continuation-value distribution (not a point estimate), and a
giveback-risk distribution, jointly. `profit_preservation_research.py`'s
existing `PROFIT_GIVEBACK`/`GIVEBACK_RATIO`
(`GIVEBACK_RELATIVE_TO_REMAINING_REWARD` composition, noted in the
P2C-pass-1 receipt) plus P2C's `OutcomePathStatistics` supply the raw
ingredients; no new formula is invented here, only the target
specification: predict the FULL future path shape (MFE, MAE, terminal),
not a single HOLD/CLOSE binary divorced from magnitude.

## 8. Loss-management targets

`HOLD`/`CLOSE`/`ROLL`/`ASSIGN`, learned from forward economics
(`compute_roll_execution_cost` and `RollUtility`, both existing). Three
named failure modes to guard against explicitly, each with a concrete
detection signal:

- **Breakeven obsession**: a model that systematically prefers HOLD/ROLL
  whenever the position is near breakeven, regardless of forward
  economics -- detectable as a spurious feature-importance spike on
  "distance from breakeven" once real data exists; the target itself
  (forward net economics from NOW) structurally excludes breakeven as an
  input, so a well-specified model cannot learn this bias from the LABEL,
  only from a leaked feature.
- **Roll spirals**: a sequence of rolls where each individual roll's
  modeled edge is small-positive but cumulative transaction cost/capital-
  days dominate -- guarded by `strategy_switch_research.py`'s own
  `evaluate_strategy_switch` discipline (every switch/roll charged its
  real cost, never assumed free) plus a NEW required aggregate check:
  `cumulative_roll_count` per chain as an explicit regret-label input
  (section 10).
- **Loss masking**: absorbing an old leg's realized loss into a new
  trade's presentation -- structurally prevented by ROLL-001 (old leg
  P&L immutable) and by P2C's label-side/PIT-side separation itself (a
  resolved label is a new row, never a rewrite).

## 9. WAIT / false-reject targets -- deepened

`wait_diagnostics_research.py`'s `evaluate_false_reject` (existing, this
branch) already distinguishes CORRECT_REJECT from FALSE_REJECT via a
`minimum_tail_adjusted_edge` bar and a feasibility requirement. This
section adds the directive's explicit new distinction: **"future winner
too risky PIT" vs. "genuinely over-strict rejection."** Quantitative
condition, composable from existing primitives:

```
FALSE_REJECT requires ALL of:
  - net_pnl known AND tail_exposure known AND execution_feasible == True  (existing)
  - net_pnl - tail_exposure >= minimum_tail_adjusted_edge                  (existing)
  - the REJECTED candidate's PIT tail/risk profile was itself ACCEPTABLE per the
    policy's own risk gates at decision time (NEW: policy_feasible_at_decision,
    already a field in P2C's WaitAlternativeOutcome/classifyWaitOutcome)

"Too risky PIT" (NOT a false reject) = the above holds except
policy_feasible_at_decision == False -- the candidate was correctly excluded
by the risk gate regardless of its favorable outcome. P2C's own
classifyWaitOutcome already names this case OVERSTRICT_POLICY_WAIT only
when feasible+attractive, and CORRECT_WAIT when infeasible -- this section
confirms that mapping is the right one, not a new one.
```

No hindsight expansion of the risk gate itself is ever permitted -- the
gate used for `policy_feasible_at_decision` must be the ACTUAL gate that
ran at decision time, never a re-evaluation with today's knowledge.

## 10. Regret targets

`ACTION_REGRET`, `CONTRACT_REGRET`, `STRATEGY_REGRET` (P2C schema-ready
label types, confirmed present but not yet materialized online per the
P2C acceptance audit's `ENGINEERING_GAPS_REMAINING`). Regret must never be
raw P&L difference. Proposed formula shape:

```
regret(actual_action, counterfactual_action) =
  (counterfactual_net_pnl - actual_net_pnl)
  - tail_risk_premium(counterfactual_action)      # counterfactual's own risk cost, charged
  - capital_days_premium(counterfactual_action)   # capital tied up differently, charged
  - transition_cost(actual_action, counterfactual_action)  # per strategy_switch_research.py, if a switch was implied
```

A counterfactual that "won" but required MORE capital, MORE tail exposure,
or MORE transition cost than what was actually taken can legitimately
carry NEGATIVE regret (the actual action was better) despite a smaller
raw P&L -- this is the direct generalization of section 9's false-reject
discipline to the regret-label family.

## 11. Label quality -- CLOSED this pass

New module: `bots/theta/quant/research/label_quality_research.py` (17
tests). `assess_label_quality()` scores every dimension the directive
names, reading only fields P2C's `ResolvedOutcomeReceipt` already emits:

- **Actual vs. modeled**: `provenance` rank (BROKER_ACTUAL=3,
  MARKET_OBSERVED/REPLAY_OBSERVED=2, MODELED_RESEARCH=1) directly degrades
  the tier; a BROKER_ACTUAL provenance with a mismatched execution model
  is UNUSABLE outright (mirrors P2C's own DB-level CHECK constraint, a
  second independent enforcement layer at the research-consumption side).
- **Quote/path completeness**: `completeness` field (COMPLETE/PARTIAL)
  and `observation_count` vs. a caller-justified
  `observation_count_expected_minimum` (never a hardcoded count).
- **Contract identity**: missing `exact_contract_id` degrades one tier.
- **Horizon completeness**: `horizon_fully_observed` degrades one tier
  when False.
- **Event/corporate-action ambiguity**: `LabelAmbiguityFlag` -- SOFT flags
  (`EVENT_WINDOW_OVERLAP_SOFT`, `THIN_QUOTE_SOFT`) degrade one tier each;
  HARD flags (`CORPORATE_ACTION_UNRESOLVED_HARD`,
  `CONTRACT_ADJUSTMENT_UNRECONCILED_HARD`) force `UNUSABLE` regardless of
  every other dimension, since an unresolved corporate action makes the
  label's very definition suspect, not merely noisy.

Output is a four-tier scale (`HIGH`/`MODERATE`/`LOW`/`UNUSABLE`), never a
single pass/fail -- `training_weight_for_tier()` then maps a tier to a
caller-JUSTIFIED weight (never a built-in default scheme like
"MODERATE=0.7"), returning `None` rather than a guessed weight whenever
the caller's own mapping doesn't cover a case. Low-quality labels are
DOWN-WEIGHTED, not silently equal-weighted, once real training begins.

## 12. Fill-model sensitivity -- built on existing TCA research

`execution_tca_research.py` (this branch, P2C-pass-2) already returns
every fill model side by side. For POLICY evaluation specifically (not
just single-trade fill estimation), the sensitivity procedure is:

1. Evaluate the candidate policy's aggregate EV/PF under `ASK_SIDE`/
   `BID_SIDE` (pessimistic per side), `MID` (optimistic), and
   `LIQUIDITY_ADJUSTED` (order-size-aware) fill models, each as a FULL
   separate backtest pass, not a single blended number.
2. **Kill criterion (feeds section 26)**: if the policy's edge sign
   FLIPS or its EV drops below the promotion bar under the pessimistic
   (`BID_SIDE`/`ASK_SIDE` for the trader's own side, matching
   `execution_tca_research.py`'s `unfavorable_sign` convention) scenario,
   the policy is REJECTED regardless of its optimistic-scenario numbers.
3. Report all three (or more) scenario results together in the
   promotion receipt -- never just the best one.

## 13. Effective N -- deepened

Extends the existing `DependenceGroupKey` (wheel_chain_id,
economic_episode_id, underlying, session_date, correlation_cluster,
`dataset_readiness.py`). The directive's explicit worry ("100 neighboring
strikes = 100 independent wins") is ALREADY structurally prevented by this
key: 100 neighbor-strike counterfactual outcomes from the SAME
`economic_episode_id`/decision cycle collapse to ONE dependence group.
Minimum `effective_n` by category is not invented here (per the standing
no-arbitrary-threshold rule) but the CATEGORIES to set a minimum for are
specified: per-strategy-branch, per-regime-cell (section 15), per-
underlying (concentration guard), and per-date-cluster (autocorrelation
guard) -- four separate minimums, each independently required before a
cohort or policy claim is reported, not one blended minimum.

## 14. Walk-forward design

`walk_forward.py` (existing, `phase_status.py`-confirmed COMPLETE
engineering) already implements purged walk-forward with embargo and a
single untouched final OOS window. For P2D's correlated option-chain data
specifically: rolling windows must be defined on DECISION-CYCLE boundaries
(not calendar days), with the embargo period sized to at least the
LONGEST horizon in `standardOutcomeHorizons` (P2C, up to `FIVE_DAYS` plus
any `EXPIRATION` horizon) so no validation-window label's outcome window
overlaps the training window's most recent decisions -- a direct
consequence of P2C's own causality guarantee (`labelAvailableAt >
decisionTimestamp`) propagated into the split design. No random iid split
is proposed or has ever been proposed anywhere in this engagement.

## 15. Regime stability

Required evaluation cells, restated concretely per the directive's list:
low-vol, high-vol, trend, mean-reversion, event-proximate (`EventState`
IMMINENT/INSIDE_CONTRACT_LIFE), negative-gamma, positive-gamma
(`gex_spot_scan_research.py`'s spot-scan regime), and liquidity-stress.
`regime_report.py` (existing) is the mechanism; this section's addition is
the explicit REQUIREMENT that a policy's promotion receipt report
per-cell performance for ALL eight cells with sufficient `effective_n`,
not an aggregate blend -- a policy strong only in low-vol/positive-gamma
conditions must be labeled as regime-narrow, not "75% WR" without
qualification.

## 16. Options-specific survivorship controls

Six named risks, each with a concrete existing-or-proposed guard:

- **Delisted-underlying exclusion**: dataset export must include chains on
  underlyings that were later delisted/halted, not silently drop them --
  a check for Codex's dataset-materialization layer, not this branch's
  research code; flagged as a verification item for the next P2C/P2D
  engineering audit.
- **Expired-chain omission**: `CensoringState.RESOLVED` vs.
  `RIGHT_CENSORED` (existing, `dataset_contracts.py`) already
  distinguishes a genuinely expired/closed chain from one still open --
  only RESOLVED chains may enter a WR calculation.
- **Unresolved losers**: a resolved-label dataset that happens to contain
  more resolved winners than losers because losers take longer to reach
  a closed horizon (e.g. a losing CSP more often gets rolled, extending
  its horizon) is a SELECTION bias, not a random one -- `effective_n` and
  cohort reporting must include the UNRESOLVED count alongside the
  RESOLVED count so this skew is visible, never silently excluded.
- **Assignment omission**: whole-chain WR (section 17) already requires
  assignment to be part of the SAME chain outcome, never a separate,
  droppable event.
- **Roll masking**: covered in section 8.
- **Open-position exclusion**: any currently-open (PENDING/UNRESOLVED)
  chain must be counted in the denominator of an "opportunity capture
  rate" or "WAIT rate" metric even though it has no outcome yet -- only
  WR/EV specifically require RESOLVED status.

## 17. Whole-chain win rate -- exact definition

**One economic chain = one outcome.** A chain (existing `trade.economic_chain`,
confirmed present via `source_chain_id` in P2C's `theta_outcome_subject`
schema) may span multiple CSP legs, rolls, assignment, stock ownership,
and covered calls -- the WHOLE chain resolves to exactly one WIN/LOSS/
BREAKEVEN classification based on NET economics across every leg, never
one classification per premium credit. A chain with three profitable CSP
rolls followed by assignment and a losing stock exit is ONE loss, not
"three wins and one loss" -- this is precisely what `WHOLE_CHAIN_OUTCOME`
(P2C label type, schema-ready) exists to enforce, and precisely what this
engagement's standing distinction between Leg WR and Whole-Chain WR (TRD
§40/§50, restated in `CLAUDE.md`) has always required.

## 18. Profit factor / loss severity screening

High WR alone never clears a policy. Two concrete, conceptual (not
numerically hardcoded) screens:

- **AvgLoss-dominance screen**: a policy is presumptively rejected if
  `AvgLoss` magnitude exceeds a caller-justified multiple of `AvgWin` --
  the multiple itself is a promotion-review parameter (like every other
  threshold in this engagement), never invented here, but the SCREEN
  EXISTS conceptually and must be evaluated even at 80% WR, since even a
  small tail of large losses can dominate a large win-count at modest
  average size.
- **CVaR-floor screen**: a policy's expected shortfall at a caller-chosen
  quantile must clear a caller-justified floor independent of its WR --
  `promotion_checker.py`'s existing `es_regression_pct`/
  `max_acceptable_es_regression_pct` fields are the exact mechanism this
  already enforces; section 18 confirms this remains correct for
  high-WR cohorts specifically, not just for the general case.

## 19. Capital-day return -- comparing quick vs. slow winners

`return / capital_days` (existing metric family, `SLICE_METRICS`) is the
direct comparator: a quick +10% over 2 capital-days
(`0.10/2 = 0.05/day`) vs. a slow +30% over 20 capital-days
(`0.30/20 = 0.015/day`) -- the quick trade has more THAN 3x the capital-
day efficiency despite the smaller headline return, directly answering
the directive's own worked example. **Annualization-explosion guard**
(directive's own explicit warning): `capital_day_return * 365` must never
be reported for a holding period below a caller-justified minimum floor
(e.g. a 1-day CSP scalp at +2% is NOT genuinely "a 730%/year strategy" --
that figure assumes an impossible repeatability the data cannot support)
-- annualized figures are gated behind that floor or reported as `null`
with a reason code, never silently computed and shown.

## 20. High-return cohort bias

A reported 50% return must be decomposed into WHICH denominator (section
4) produced it, and cross-checked against secured capital, max risk, AND
capital-days simultaneously -- a policy that looks like 50% on a
credit/width basis but only 8% on a secured-capital basis is not lying,
but reporting only the first number without the second is materially
misleading. Every high-return cohort report in this engagement's future
output must carry all three normalizations side by side (matching
section 4's "never mix metrics" instruction, extended to require ALL
relevant ones be shown together, not just one chosen favorably).

## 21. Strategy-specific targets

| Strategy | Primary target distribution | Primary risk measure |
|---|---|---|
| CONVENTIONAL (CSP) | Forward net P&L to assignment/expiry/close, whole-chain-resolved | Max-risk return (assignment/gap), CVaR |
| HOLD_STRIKE | Same-strike continuation value across roll cycles | Cumulative roll-count + roll-spiral regret (section 8) |
| DEFINED_RISK | Net P&L bounded by structure width | Credit/width return, capped-tail CVaR (naturally tighter than CSP's) |
| RECOVERY | Stock P&L path from assignment to exit, unconditioned by original CSP entry | Time-underwater, recovery duration |
| CC | Whole-chain P&L including the stock leg, never CC premium alone | Call-away opportunity cost vs. HOLD_STOCK_NO_CALL, per section 18's WAIT-alternative discipline |

## 22. Management policy model families -- baselines first

Per the directive's explicit instruction, ordered by complexity, no
jump to sequence models without justification:

1. **Logistic/linear baselines**: HOLD-vs-CLOSE as logistic regression on
   a small, interpretable feature set -- the mandatory first baseline any
   later model must beat (matching `ablation.py`'s existing
   BASELINE-vs-CHALLENGER discipline).
2. **Gradient boosting** (e.g. a tree ensemble): handles non-linear
   interactions (the four-example decision rule in section 3 is
   intrinsically non-linear in profit-pct x tail-risk x event-state) --
   the natural second step once the linear baseline's residual structure
   justifies it.
3. **Survival models**: directly appropriate for "time to close" /
   "time to assignment" targets, where CENSORED_OPEN chains are
   right-censored observations, not missing data -- a natural fit given
   `CensoringState` already exists in this codebase's schema.
4. **Distributional regression** (quantile regression / distributional
   heads): needed for the tail-quantile outputs section 29's policy-
   provider spec requires -- not needed for a simple point-EV target.
5. **HMM/regime models**: appropriate specifically for the regime-state
   component of the feature set (section 15), as an input feature
   generator rather than the terminal policy model itself.
6. **Sequence models (LSTM/Transformer)**: NOT justified today -- no
   evidence in this engagement's research corpus that a chain's
   management history has sequence-dependence beyond what survival/
   regime features already capture. Revisit only if a baseline
   comparison (per `ablation.py`) shows a genuine, OOS-confirmed gap a
   sequence model closes.

## 23. Calibration

Unchanged, restated: `calibration_metrics.py`'s Brier score plus reliability
curves, ECE, isotonic/Platt scaling (standard post-hoc recalibration
methods, not yet implemented in this codebase -- flagged as a genuine
future addition to `calibration_metrics.py` once a real probability output
exists to calibrate against). No uncalibrated confidence may ever be
reported as a probability, matching `DELTA_IS_NOT_WIN_PROBABILITY`'s
existing structural discipline.

## 24. DSR / PBO across many challengers

`selection_bias.py` (existing, COMPLETE per `phase_status.py`) computes
DSR/PBO for a SINGLE strategy's selection process. The directive's new ask
is applying this across MANY policy/strategy challengers simultaneously
(P2C's `evaluatePolicyChallenger`, already supporting arbitrary challenger
IDs like `FIXED_25`...`FIXED_90`, `21DTE`...`HOLD_TO_EXPIRY`,
`DYNAMIC_PROFIT_GIVEBACK`, `DYNAMIC_REMAINING_EV`). The correction required:
DSR's own trials-count parameter must equal the TOTAL number of
challengers actually evaluated (not just the ones that looked good) --
directly enforced by P2C's own non-promoting evaluation model, since EVERY
challenger's evaluation is persisted (`theta_policy_challenger_evaluation`,
immutable, `promoted=false`) whether it succeeded or failed, giving DSR/PBO
a complete, un-cherry-picked trial count to condition on. This is a real
structural advantage of P2C's design worth noting: because challenger
evaluations cannot be silently discarded (immutable table), a future DSR/
PBO computation has an honest denominator by construction.

## 25. Promotion standard -- staged ladder

A concrete seven-stage ladder, each stage mapped onto ALREADY-EXISTING
machinery (no new gate invented, only named and sequenced):

```
RESEARCH_ONLY        -- a hypothesis in hypotheses.json, no evaluation yet
SHADOW_EVALUATED     -- evaluatePolicyChallenger / evaluatePolicyStrategy has run,
                        state=EVALUABLE, promoted=false (P2C, structurally enforced)
PAPER_OBSERVED        -- resolved labels exist from real Paper-cycle P2C resolution
                        (not backtest-only), RESOLVED_*_LABELS above the caller's
                        own minimum effective_n (section 13)
OOS_VALIDATED         -- promotion_checker.py's evaluate_promotion() returns
                        PROMOTION_ELIGIBLE_RESEARCH against a genuinely untouched
                        final OOS window (walk_forward.py)
PROMOTION_CANDIDATE   -- an EmpiricalPolicyPromotionReceipt (P2C v2 schema) assembled,
                        assessEmpiricalPolicyPromotion().readyForHumanPromotionReview
                        == true, fill-sensitivity screen (section 12) passed
OWNER_APPROVED        -- promotion.state=='PROMOTED' with approvalIdentity/
                        approvalTimestamp strictly after the OOS window's end
                        (P2C's promoted-management-policy-provider.ts, already built
                        and verified in the P2C acceptance audit)
PAPER_ACTIVE          -- createPromotedManagementPolicyProvider() returns a non-null
                        provider, wired into the actual autonomous runtime cycle
                        (Codex-owned wiring, not yet done -- confirmed NOT_PROMOTED_
                        UNAVAILABLE in the P2C audit)
```

LIVE remains a SEPARATE, explicit future authorization beyond `PAPER_ACTIVE`
-- this ladder terminates at Paper, matching every standing constraint in
this engagement.

## 26. Policy kill criteria

Seven named conditions, each already having a concrete measurement path in
this codebase (no new metric invented, only assembled into a rejection
checklist):

1. **Poor tails**: CVaR/ES floor breach (section 18, `promotion_checker.py`).
2. **Unstable regime behavior**: fails section 15's per-cell reporting
   requirement, or shows a sign flip across regime cells.
3. **Slippage sensitivity**: fails section 12's pessimistic-fill-model
   screen.
4. **Small effective N**: below the caller-justified per-category minimum
   (section 13).
5. **Bad calibration**: Brier/ECE outside a caller-justified bound
   (section 23).
6. **Performance concentration**: a large fraction of total EV coming
   from a small number of `effective_n` clusters (directly checkable via
   `dataset_readiness.py`'s own `DependenceGroupKey` grouping -- if one
   `economic_episode_id` or `session_date` cluster contributes a
   disproportionate share of total P&L, the policy's apparent edge may be
   a single lucky episode, not a repeatable pattern).
7. **Excess assignment/recovery duration**: `time_underwater`/`recovery_duration`
   exceeding a caller-justified bound relative to the policy's own claimed
   capital-day efficiency (section 19) -- a policy whose "efficiency" is
   inflated by excluding long recovery tails from the capital-days
   denominator is a measurement artifact, not real efficiency.

Any ONE of these seven is sufficient to reject a policy regardless of how
favorable its headline WR/EV looks -- matching `promotion_checker.py`'s
own existing "structural failure checked first, unconditionally" pattern.

## 27. Repository research

Time budget this pass went to the code-backed sections above (11-13) and
this design document's breadth; no new repos deep-read this pass beyond
what prior sessions already established for the directive's named
priority list (`QuantConnect/Lean` referenced not re-read;
`lambdaclass/options_portfolio_backtester`'s cost-model/fill-model shape
already cited, prior session; `goldspanlabs/optopsy`'s slippage taxonomy
already cited, prior session). `pfhedge` (PyTorch-based hedging research
library) and `FinancePy`/`QuantLib` were NOT searched this pass -- named
honestly as not attempted rather than silently claimed covered.

## 28. Public evidence

Unchanged from prior sessions' `public_evidence_sources.json` (8 tiered
sources, including Cboe put/covered-call indices and Carr-Wu VRP research,
already cited). The directive's distinction ("prior vs. THETA-specific
proof") is the exact discipline this engagement has followed throughout:
every `hypotheses.json` entry citing a public source carries
`evidence_class` separating a PRIOR (literature-level plausibility) from
`D_EXPERT_DNA`/empirical THETA-specific proof, never conflated. No new
public sources found this pass.

## 29. Future policy-provider spec -- refined outputs

Extends the P2C-pass-1 receipt's existing spec (inputs unchanged: PIT
state, chain evidence, Optionomics attachments, portfolio state, candidate
actions). Refined OUTPUT shape per feasible action, matching the
directive's explicit "not just score=0.82" instruction:

```
PerActionEvidence {
  action: string
  expectedValue: number | null                 // point EV, never the sole output
  distribution: { quantiles: Record<string, number> } | null   // e.g. p10/p50/p90 net P&L
  tailQuantile: { level: number; value: number } | null        // e.g. CVaR at 5%
  uncertainty: { kind: 'MODEL_VARIANCE'|'SAMPLE_SIZE'|'BOTH'; value: number } | null
  calibrationState: 'CALIBRATED'|'UNCALIBRATED'|'UNKNOWN'
  sampleSupport: { effectiveN: number; rawN: number }
  modelVersion: string
}
```

This is a design refinement only -- the existing `ManagementPolicyEvidence`
schema (P1, verified) already has room for an `uncertainty` field (noted
in the P2C audit as currently unpopulated by every caller); this spec
names what should eventually populate it, without proposing any
Production code change.

## Receipt

```
70_80_WR_OBJECTIVE: ACTIVE_OPTIMIZATION_TARGET
STRONG_RETURN_OBJECTIVE: ACTIVE_OPTIMIZATION_TARGET

WINNER_MANAGEMENT_TARGET_DESIGN: COMPLETE (section 7 -- continuation-value
  distribution + giveback-risk, profit-pct as one feature among many, never
  a rule)
LOSS_MANAGEMENT_TARGET_DESIGN: COMPLETE (section 8 -- HOLD/CLOSE/ROLL/ASSIGN
  from forward economics, three named failure modes with concrete guards)
WAIT_TARGET_DESIGN: COMPLETE (section 9 -- deepens existing evaluate_false_reject
  with the "too risky PIT" vs. "over-strict" quantitative distinction)
REGRET_TARGET_DESIGN: COMPLETE (section 10 -- regret formula charges tail/
  capital-days/transition cost against the counterfactual, can be negative)

LABEL_QUALITY_FRAMEWORK: COMPLETE (closed this pass -- label_quality_research.py,
  17 tests, four-tier score consuming only fields P2C's engine already emits)
FILL_SENSITIVITY_FRAMEWORK: COMPLETE (section 12 -- policy-level, not just
  single-trade, sensitivity procedure built on execution_tca_research.py)

HIGH_WR_COHORT_METHOD: COMPLETE (section 5 -- pre-registered dimensions,
  effective_n per cohort, full-tested-set reporting, multi-metric requirement)
HIGH_RETURN_COHORT_METHOD: COMPLETE (sections 4/20 -- five distinct return
  denominators, never mixed, always reported together)

WHOLE_CHAIN_WR_DEFINITION: COMPLETE (section 17 -- one chain = one outcome,
  exact)
EFFECTIVE_N_STANDARD: COMPLETE (section 13 -- four required minimums:
  strategy/regime/underlying/date-cluster, none numerically invented)
WALK_FORWARD_STANDARD: COMPLETE (section 14 -- embargo sized to the longest
  P2C horizon, decision-cycle-boundary rolling windows)
REGIME_STABILITY_STANDARD: COMPLETE (section 15 -- eight required cells,
  per-cell reporting mandatory)

POLICY_OBJECTIVE_DESIGN: COMPLETE (section 6 -- Pareto-frontier default,
  utility-function layered only at human promotion review)
POLICY_MODEL_FAMILIES: COMPLETE (section 22 -- six families ordered by
  complexity, sequence models explicitly not yet justified)
CALIBRATION_STANDARD: NO_CHANGE_REQUIRED (existing calibration_metrics.py;
  isotonic/Platt flagged as a genuine future addition)
DSR_PBO_STANDARD: COMPLETE (section 24 -- P2C's immutable non-promoting
  challenger evaluation gives DSR/PBO an honest, un-cherry-picked trial count
  by construction)

PROMOTION_LADDER: COMPLETE (section 25 -- seven stages, every stage mapped
  onto already-existing/already-verified machinery, terminates at PAPER_ACTIVE,
  LIVE separate)
POLICY_KILL_CRITERIA: COMPLETE (section 26 -- seven named conditions, any one
  sufficient to reject regardless of headline WR/EV)

STRATEGY_SPECIFIC_TARGETS: COMPLETE (section 21 -- five strategies, target
  distribution + primary risk measure each)

REPOS_DEEP_STUDIED: none new this pass
NEW_HIGH_VALUE_PATTERNS: none new this pass -- time budget went to the
  code-backed sections and design breadth instead (see section 27)

70_80_WR_EVIDENCE_STATUS: NOT_YET_PROVEN
STRONG_RETURN_EVIDENCE_STATUS: NOT_YET_PROVEN
FIXED_40_PERCENT_TAKE_PROFIT: NO
DYNAMIC_PROFIT_PROTECTION: REQUIRED

RECOMMENDATIONS_FOR_CODEX: (1) the two options-specific survivorship
  controls flagged as engineering-verification items in section 16
  (delisted-underlying inclusion, unresolved-loser visibility) are worth a
  direct check whenever the P2D materialization layer's dataset export is
  reviewed; (2) section 29's PerActionEvidence output shape is offered as a
  design reference for whenever a real ManagementPolicyEvidenceProvider is
  built -- research-side only, no integration performed or implied.

MAIN_PUSHED = NO
PRODUCTION_CHANGED = NO
BROKER_ORDERS_BY_CLAUDE = 0
LIVE_OWNER_AUTHORIZATION = NOT_GRANTED
LIVE_ELIGIBLE = NO
```
