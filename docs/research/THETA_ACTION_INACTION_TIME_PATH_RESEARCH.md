# THETA Action-vs-Inaction / Time-Path Intelligence Research

Research-only continuation of P2D. `CURRENT_MAIN_SHA_AT_START`:
`efff4b346f3d4667230476ccfbaf8c4c093a2aa4` (P2C, CLOSED; Codex is building
P2D materialization in parallel this pass, not audited). New modules this
pass: `bots/theta/quant/research/position_path_state_research.py` (23
tests) and `bots/theta/quant/research/decision_freshness_research.py` (14
tests).

## Permanent principles (directive section 31, restated as the document's own standing law)

```
HOLD_IS_AN_ACTIVE_DECISION = YES
WAIT_IS_AN_ACTIVE_DECISION = YES
INACTION_HAS_ECONOMIC_COST = YES
RISK_OF_TRADING_MUST_BE_COMPARED_WITH_RISK_OF_NOT_TRADING = YES
WAIT_PARALYSIS_MUST_BE_DETECTED = YES
HOLD_PARALYSIS_MUST_BE_DETECTED = YES
OVERTRADING_MUST_BE_DETECTED = YES
SMALL_PROFIT_OPPORTUNITIES_MATTER = YES
LARGE_WINNER_OPPORTUNITIES_MATTER = YES
TIME_IS_FIRST_CLASS = YES
PATH_HISTORY_IS_FIRST_CLASS = YES
NO_FIXED_PROFIT_TARGET = YES
NO_FIXED_MINIMUM_ENTRY_RETURN = YES
NO_FIXED_MINIMUM_ENTRY_WIN_RATE = YES
```

## 1-2. Action-vs-inaction framing

Every feasible action (OPEN/HOLD/CLOSE/ROLL/WAIT/ASSIGN/RECOVERY_WAIT/
SELL_STOCK/SELL_CC/CLOSE_CC/ROLL_CC/ALLOW_CALL_AWAY) has an economic
consequence, and so does choosing NEITHER (HOLD, WAIT). The methodology
below treats every action symmetrically: a comparison table with an
explicit VALUE(action) and VALUE(inaction) column, never a special
carve-out where "doing nothing" is implicitly free.

## 2-3. HOLD and WAIT are active decisions, not defaults

**HOLD != DO NOTHING.** Continuing to hold a position means continuing to
accept Delta/Gamma/Vega/Theta exposure, assignment risk, event risk, tail
risk, and capital consumption -- all of which this branch's own research
modules already quantify per-checkpoint (`optionomics-temporal-features.ts`
for the Greek/exposure deltas, `event_state_research.py` for event risk,
`gex_spot_scan_research.py` for regime). A `HOLD_JUSTIFIED` state
requires AFFIRMATIVE evidence across these dimensions, never the ABSENCE
of a close trigger:

```
HOLD_JUSTIFIED           -- remaining reward/continuation-probability favorable,
                             tail exposure acceptable, no material giveback risk signal
HOLD_WEAKLY_JUSTIFIED    -- favorable but thin margin, or one dimension UNKNOWN
                             (widened uncertainty per section 23 below, not a fail-closed WAIT)
HOLD_OPPORTUNITY_COST_HIGH -- a superior alternative exists elsewhere (section 26);
                             HOLD remains feasible but is economically dominated
HOLD_DERISK_REQUIRED     -- tail/event/gamma exposure has grown since entry
                             beyond what the position's remaining reward justifies
```

These are RESEARCH STATES for future labeling, never executable rules --
matching this document's own permanent principle
`NO_FIXED_PROFIT_TARGET = YES`.

**WAIT != FREE.** Its potential costs (foregone edge, lost IV/skew
opportunity, a favorable entry disappearing, idle capital, regime decay)
must be weighed against its potential benefits (avoided poor liquidity,
event risk, tail risk, weak edge, concentration, bad timing) -- this is
precisely the false-reject vs. correct-reject distinction
`wait_diagnostics_research.py`'s `evaluate_false_reject` already
formalizes (this branch, P2C-pass-1), extended here with an explicit
opportunity-cost vocabulary: `MISSED_EDGE` (section 4) is the WAIT-side
analogue of `HOLD_OPPORTUNITY_COST_HIGH`.

## 4-5. Anti-paralysis / anti-overtrading metric definitions

Every metric below is a RATIO or COUNT over a caller-defined observation
window -- no numeric acceptable-range is invented here (matching this
engagement's standing no-arbitrary-threshold rule); the definitions
themselves are the deliverable, not a promotion bar.

**Anti-paralysis (section 4):**

| Metric | Definition | Existing building block |
|---|---|---|
| `WAIT_RATE` | WAIT decisions / total decision cycles | `wait_diagnostics_research.py`'s `WaitCycleFunnel` already counts cycles per `WaitKind` |
| `HOLD_RATE` | HOLD decisions / total management decisions | new -- a simple ratio over P2C's `MANAGEMENT_ACTION_OUTCOME` label counts once they accumulate |
| `OPPORTUNITY_CAPTURE_RATE` | selected positive-EV / detected positive-EV | `opportunity_capture.py` (existing, this branch) -- already reports `UNKNOWN` until real empirical EV exists, never a fabricated rate |
| `FALSE_REJECT_RATE` / `CORRECT_REJECT_RATE` | `evaluate_false_reject` outcomes / total rejections | `wait_diagnostics_research.py` (existing) |
| `MISSED_EDGE` | sum of `regret` (section 10, existing `resolved-outcome-engine.ts` `ACTION_REGRET`/`CONTRACT_REGRET` label types once materialized) across FALSE_REJECT-classified WAITs only -- never across every rejection | new definition, no code needed beyond existing regret labels |
| `CAPITAL_IDLE_TIME` | time with available buying power and zero open positions, regardless of whether opportunities existed | new -- a pure duration metric from portfolio state, distinct from `VALID_OPPORTUNITIES_REJECTED` below |
| `VALID_OPPORTUNITIES_REJECTED` | count of candidates that cleared every structural/risk gate but received a soft-policy WAIT | `WaitCycleFunnel.candidates_soft_policy_rejected`, already the exact field this maps to |
| `TIME_SINCE_LAST_VALID_ENTRY` | wall-clock/session time since the last OPEN action, gated on at least one eligible candidate having existed since | new duration metric |
| `WAIT_REGRET` / `HOLD_REGRET` | the regret-target formula from `hypotheses` research (section 10 below), scoped to WAIT/HOLD actions specifically | composition of existing regret-formula design |
| `OPPORTUNITY_DECAY_AFTER_WAIT` | change in a candidate's own Pareto ranking/edge between the WAIT decision and its next re-evaluation | `decision_freshness_research.py` (new, this pass) supplies the re-evaluation trigger; the decay MAGNITUDE itself is a simple before/after edge comparison, not new code |
| `CANDIDATE_IMPROVEMENT_AFTER_WAIT` | the inverse of the above -- an edge that got BETTER after waiting, confirming the WAIT was not merely costless but positively rewarded | same mechanism |

**Anti-overtrading (section 5):**

| Metric | Definition |
|---|---|
| `ENTRY_RATE` | OPEN actions / total decision cycles |
| `LOW_EDGE_ENTRY_RATE` | entries whose modeled edge was below a caller-chosen "comfortable margin" threshold (never a hard entry gate itself -- purely a reporting stratification) |
| `TRADE_CHURN` | open+close pairs / average concurrent open-position count, over a window |
| `SWITCHING_CHURN` | `strategy_switch_research.py`'s `SwitchDecision.SWITCH` count / total management decisions (existing, this branch) |
| `TRANSACTION_COST_DRAG` | sum of `execution_tca_research.py`'s TCA costs / gross P&L, over a window (existing, this branch) |
| `UNNECESSARY_ENTRY` | an entry later resolved with `ACTION_REGRET` positive AND `capital_days` below a caller-chosen minimum-commitment floor -- a short-lived, low-conviction trade whose cost outweighed its edge |
| `CAPITAL_TURNOVER` | capital deployed / average capital available, over a window |

The directive's own framing is upheld throughout: neither set of metrics
exists to push a target rate. They exist to DETECT when a policy has
drifted into either failure mode, so a human reviewer (promotion review,
section 25 of the P2D design doc) can see it.

## 6. Action-vs-inaction frontier -- field spec only

```
ActionEvidence {
  action: OPEN | HOLD | CLOSE | ROLL | WAIT | ASSIGN | RECOVERY_WAIT |
          SELL_STOCK | SELL_CC | CLOSE_CC | ROLL_CC | ALLOW_CALL_AWAY
  futureOutcomeDistribution: quantiles | null      // never a fabricated point estimate
  tailRisk: value | null
  executionCost: value | null                       // execution_tca_research.py
  capitalTimeCost: value | null                      // capital-days, existing
  portfolioImpact: value | null
  inactionCost: {                                    // NEW field this section formalizes
    kind: 'PROFIT_GIVEBACK_EXPOSURE' | 'MISSED_EDGE' | 'CAPITAL_LOCK' | 'NONE_APPLICABLE'
    estimate: value | null
  }
}
```

For HOLD, `inactionCost` is the exposure/giveback/capital-lock risk of
continuing to hold (section 2). For WAIT, it is the missed-edge/opportunity-
decay risk of not entering (section 3). No numeric utility is computed
here -- this is a field spec for a future `ManagementPolicyEvidenceProvider`
output (matching the P2D design doc's own `PerActionEvidence` spec,
extended with this explicit inaction-cost field it did not yet carry).

## 7. Path-state field inventory -- CLOSED this pass

Full inventory (ALREADY_AVAILABLE / MISSING / DERIVABLE / PROVIDER_BLOCKED
per named field) is in
`bots/theta/quant/research/position_path_state_research.py`'s own
`PATH_STATE_FIELD_INVENTORY` dict -- reproduced in summary:

- **ALREADY_AVAILABLE**: ENTRY/CURRENT/PEAK/TROUGH PNL (P2C's
  `OutcomePathStatistics` shape, mirrored here for still-open positions),
  PROFIT_GIVEBACK/RATIO (`profit_preservation_research.py`), FLOW_* family
  (`optionomics_flow_temporal_research.py`), EVENT_STATE_* family
  (`event_state_research.py`), UNDERLYING_* (spot captured on every PIT
  snapshot), SPREAD_* (bid/ask on every quote observation),
  CAPITAL_DAYS_USED (P2C's `capitalDays` observation field).
- **DERIVABLE** (methodology exists, only the raw per-checkpoint capture
  pipeline is missing upstream): TIME_SINCE_* fields, DTE_AT_*,
  DISTANCE_TO_STRIKE_*, IV_* velocity/acceleration, SKEW_* delta,
  GEX_REGIME_* transition (new comparator, this pass -- see below).
- **PARTIALLY_DERIVABLE**: DELTA_*/GAMMA_* (first-order deltas exist via
  `optionomics-temporal-features.ts`; acceleration and AT_PEAK capture do
  not).
- **MISSING** (genuine engineering gaps, named honestly): THETA_AT_ENTRY/
  THETA_NOW (no `bs_theta()` exists yet in `bs_reference.py`),
  TIME_SINCE_LAST_MANAGEMENT (no field tracks the last management-action
  timestamp separately from position-open time), EXPECTED_MOVE_* (no
  canonical formula yet, though its IV/DTE inputs are available/derivable).

`position_path_state_research.py`'s `compute_path_state()` implements the
DERIVABLE fields directly (peak/trough-by-PnL identification, giveback,
time-since-entry/peak/trough), `dte_at()` and `distance_to_strike()`
implement the pure-arithmetic derivations, and `compute_trajectory()`
implements velocity/acceleration generically over any numeric checkpoint
field (PnL, Delta, Gamma, IV, underlying price) -- one function, not five
near-duplicates.

**A real external lesson incorporated into this design**: `charlieyanhx/
exitkit` (MIT, real, 27-exit-model library, deep-read this pass -- see
section 29) documents a genuine bug it found and fixed: its
`get_holding_hours()` depended on a side-effecting `update_pnl()` call
having run first; a position that had never been "marked" reported ZERO
holding hours regardless of how long it had actually been open, silently
suppressing a time-based exit model. This branch's own
`compute_trajectory`/`compute_path_state` are deliberately built as PURE
functions of an ordered checkpoint list with no stateful "mark" step --
directly avoiding the class of bug exitkit's own test suite caught.

## 8-9. Trade-path classification and the winner-to-loser distinction -- CLOSED this pass

`position_path_state_research.py`'s `TradePathState` enum names all
eleven directive-listed states (`ENTRY_IMMEDIATE_LOSS` through
`RECOVERY_DETERIORATING`) plus the three winner-to-loser-specific states
(`NORMAL_GIVEBACK`, `MATERIAL_EDGE_DETERIORATION`,
`WINNER_TO_LOSER_WARNING`) -- descriptions, never management commands (no
function anywhere maps a `TradePathState` to an action).

`assess_winner_to_loser()` directly answers the directive's own worked
example: a position stable at -5% and a position that peaked at +25% then
fell to -5% are NOT the same state (real test:
`test_a_stable_at_negative_5_pct_position_differs_from_one_that_peaked_at_25_then_fell`
-- the two calls produce different `TradePathState` values despite
identical current P&L). The classification requires a caller-justified
`minimum_material_giveback` (never invented here) and distinguishes a
material-but-still-profitable giveback WITH deteriorating context
(`MATERIAL_EDGE_DETERIORATION`) from the same giveback WITHOUT it
(`WINNER_TO_LOSER_WARNING`, deliberately the WEAKER label -- a warning,
not a deterioration finding) -- upholding the directive's explicit
instruction not to turn any single state into an automatic close.

## 10. Loss velocity -- CLOSED this pass (via the same trajectory function)

`compute_trajectory()` (section 7) is the SAME function for PnL velocity,
Delta velocity/acceleration, IV velocity/acceleration, and (via
`distance_to_strike()`'s output series) distance-to-strike velocity --
one generic implementation rather than eight near-duplicate formulas,
directly answering the directive's own "formalize trajectory features"
ask. `GAMMA_RISK_ACCELERATION` is the same function applied to a
caller-supplied Gamma checkpoint series (already listed as
PARTIALLY_DERIVABLE in the inventory -- the computation exists, only the
per-checkpoint Gamma capture pipeline is missing upstream). The
directive's own worked example (a stable -20% vs. a rapidly deteriorating
-7% position) is exactly what `giveback_velocity_per_hour` (fed into
`assess_winner_to_loser`) is designed to distinguish -- a -7% position with
high negative PnL velocity may carry worse forward economics than a
stable -20% one, a genuinely non-obvious research question this
machinery now has the vocabulary to test once labels exist.

## 11-12. Time as a first-class input / session state

Session-state categories (`MARKET_CLOSED`, `OPENING_WINDOW`,
`REGULAR_SESSION`, `MID_SESSION`, `LATE_SESSION`, `CLOSING_WINDOW`,
`EXPIRY_DAY`, `EXPIRY_FINAL_WINDOW`, `POST_CLOSE`, `EARLY_CLOSE_SESSION`,
`EVENT_WINDOW`) are named here as the canonical vocabulary but their
CLASSIFICATION must come from broker/exchange truth (Alpaca's own market-
calendar/clock data), never a hardcoded wall-clock table -- per the
directive's explicit instruction and matching this engagement's standing
"no invented universal threshold" discipline. No new code implements this
classification this pass (it requires a live calendar source, which is
Codex's provider-adapter domain, not research code) -- named honestly as a
design specification pending an engineering owner, not claimed complete.
`decision_freshness_research.py`'s `session_state` field (a plain string
comparison) is built to CONSUME whatever session-state classification
eventually exists, without depending on its specific implementation.

Session-state interaction hypotheses (spread/liquidity/Gamma/Theta/Flow/
execution differing by session) are plausible but untested -- flagged as
future hypothesis candidates, not asserted.

## 13-14. Decision expiry and re-evaluation triggers -- CLOSED this pass

New module: `decision_freshness_research.py` (14 tests). Implements the
directive's exact requested contract fields
(`decision_created_at`/`decision_valid_until`/`decision_invalidated_at`/
`invalidation_reasons`) via `assess_decision_freshness()`, checking ALL
ten named invalidators (quote age, spot move, IV move, Delta/Flow/GEX
regime change, session-state transition, event-state transition,
portfolio change, time decay) and reporting EVERY one that fired, not
just the first (real test:
`test_multiple_reasons_all_reported_not_just_the_first`). Every numeric
bound (`max_quote_age_seconds`, `max_spot_move_fraction`,
`max_iv_move_absolute`, `max_time_decay_seconds`) is
`Optional[float] = None` by default -- a caller must explicitly opt each
one in, so this module never silently applies "hyperactive polling"
defaults (real test: `test_unset_bounds_are_never_checked`, confirming a
999-point spot move does NOT invalidate a decision when no spot-move
bound was configured). Categorical invalidators (regime/session/event/
portfolio) fire on ANY change with no magnitude judgment built in --
that granularity decision belongs to whoever defines the categories, not
this module.

## 15. Strategy timing router -- design restated, not re-derived

The selector relationship (time state + chain + vol state + flow/exposure
+ event state + portfolio + open-position state -> strategy
applicability) is exactly what `canonical-strategy-frontier.ts`'s
five-branch comparison (CONVENTIONAL/HOLD_STRIKE/DEFINED_RISK/RECOVERY/CC)
plus WAIT already implements structurally (verified COMPLETE, P1/P2B
audits) -- this section's contribution is naming the NEW inputs this
pass's modules add to that router's evidence: `EventState`
(`event_state_research.py`), `GexSpotScanState`
(`gex_spot_scan_research.py`), and now `TradePathState`/
`PositionPathSnapshot` (this pass) as additional context for an OPEN
position specifically (the frontier's existing evidence is PIT-entry-
focused; path state is the missing ongoing-position context layer). No
strategy loyalty is proposed or implied anywhere in this design --
matching the existing frontier's own no-loyalty Pareto behavior.

## 16. Short-DTE specialization

0DTE/1DTE/2-5DTE positions differ from 30-45DTE ones specifically in
Gamma-acceleration rate (their own Gamma near expiry can be an order of
magnitude larger for the same moneyness), intraday-Theta share of total
Theta, pin-risk concentration near the strike, and GEX instability
(`gamma_regime_research.py`'s existing 0DTE-instability flag already
covers this). `compute_trajectory()` applied to a Gamma checkpoint series
on a short-DTE position is expected to show much larger acceleration
magnitudes than the same computation on a 30-45DTE position -- a testable,
falsifiable claim once real Gamma-checkpoint data exists, not asserted as
proven. No fixed short-DTE rule is proposed.

## 17. Expiry management research

`CLOSE`/`ROLL`/`LET_EXPIRE`/`ACCEPT_ASSIGNMENT`/`ALLOW_CALL_AWAY` near
expiry should be compared using moneyness, intrinsic/extrinsic split,
Gamma, Delta, time-to-close (session-state, section 12), pin risk, and
liquidity -- all either ALREADY_AVAILABLE or DERIVABLE per section 7's
inventory. **Decision vs. broker fact, kept distinct**: `ACCEPT_ASSIGNMENT`
(a research/policy DECISION to not defend against assignment) is a
DIFFERENT event from the broker's own confirmed assignment FACT -- this
distinction already exists structurally in P1's engineering
(`applyConfirmedTerminalLifecycle`, broker-reconciliation-gated) and this
section confirms the research layer must preserve it, never conflating a
policy's tolerance for assignment with the broker's actual report of one.

## 18-19. Small-profit and large-winner research

Directly addresses the directive's own anti-bias instructions: a quick
+8% must be compared via capital-days return (section 19 of the P2D
design doc, `SLICE_METRICS`) against a slow +30%, with the annualization-
explosion guard already specified there (a minimum holding-period floor
before annualizing). A large winner (+40/+60%+) should be allowed to
continue ONLY when `HOLD_JUSTIFIED` (section 2 above) holds from forward
economics -- never rejected merely because a smaller profit is already
locked in, and never held merely because the percentage is large. Both
directions are already covered by this document's `ActionEvidence`/
`inactionCost` framing (section 6) -- no separate mechanism is needed for
"small" vs. "large" opportunities, since the SAME evaluation applies
regardless of magnitude, which is the entire point of the open-ended
objective.

## 20. Opportunity spectrum -- two independent axes

```
SIZE:    VERY_SMALL | SMALL | MEDIUM | LARGE | VERY_LARGE
QUALITY: LOW_QUALITY | MARGINAL | GOOD | STRONG | EXCEPTIONAL
```

Deliberately reported as a 5x5 grid, never collapsed to one axis --
a `VERY_SMALL` + `EXCEPTIONAL` opportunity (tiny capital, excellent
risk-adjusted economics, highly repeatable) and a `VERY_LARGE` +
`MARGINAL` one (large headline payoff, poor risk-adjusted economics)
must both be representable and neither automatically ranked above the
other, directly implementing the directive's own "large percentage !=
automatically good" instruction.

## 21-22. Entry-paralysis and HOLD-paralysis diagnostics

**`ENTRY_PARALYSIS`** (section 21): a policy-behavior diagnostic, not a
psychological inference (per the directive's own explicit instruction),
evidenced by a sustained co-occurrence of (a) `VALID_OPPORTUNITIES_REJECTED`
remaining high, (b) rejected candidates' own Pareto quality being
genuinely GOOD/STRONG (not MARGINAL), and (c) a high `FALSE_REJECT_RATE`
-- exactly the composite `POSSIBLE_LOGIC_PARALYSIS` category
`wait_diagnostics_research.py` already names (this branch, P2C-pass-1),
requiring BOTH `consecutive_wait_cycles` and a caller-supplied
`consecutive_wait_bound` to be exceeded before firing -- this section
confirms that existing mechanism IS the correct implementation of
`ENTRY_PARALYSIS`, not a new one.

**`DEFAULT_HOLD_BIAS` vs. `VALIDATED_HOLD`** (section 22): a HOLD reached
because CLOSE/ROLL genuinely lacked evidence (missing data, `UNKNOWN`
continuation distribution) is `DEFAULT_HOLD_BIAS` -- structurally
different from `HOLD_JUSTIFIED` (section 2), which requires AFFIRMATIVE
favorable evidence. The distinction matters because a policy that reaches
HOLD via `DEFAULT_HOLD_BIAS` systematically is failing closed correctly
(never fabricating a decision from missing data) but may still be
economically underperforming an alternative that a richer data pipeline
would have surfaced -- worth tracking as a DATA gap, never resolved by
forcing a close.

## 23. Missing-data bias -- the REQUIRED vs. OPTIONAL distinction

```
REQUIRED_UNKNOWN  -- a field without which the action cannot be safely evaluated
                     at all (e.g. exact contract identity, decision timestamp) --
                     MUST fail closed, exactly as every hard gate in this codebase
                     already does. Never weakened.

OPTIONAL_UNKNOWN  -- a field that would refine the comparison but whose absence
                     does not make the comparison meaningless (e.g. Flow state,
                     GEX regime when a spot-scan wasn't run this cycle) --
                     SHOULD widen the decision's own uncertainty band (matching
                     HOLD_WEAKLY_JUSTIFIED, section 2) rather than forcing WAIT/HOLD
                     purely because one optional dimension is unpopulated.
```

This section exists specifically to prevent the failure mode the
directive names: "if missing optional evidence always produces WAIT/HOLD,
THETA may become systematically inactive." No hard execution or risk gate
is touched or weakened by this distinction -- it applies ONLY to the
research/policy comparison layer, exactly as the directive requires.

## 24. Risk of missing a trade

Candidate-edge tracking across time (`edge at decision` / `edge after
waiting` / `candidate disappeared` / `improved` / `worsened`) is precisely
what `decision_freshness_research.py`'s re-evaluation triggers (sections
13-14) feed into: a WAIT decision's freshness check firing on
`FLOW_REVERSED` or `IV_MOVED_BEYOND_BOUND` is the operational signal that
a candidate's edge likely changed, prompting a re-look -- not a numeric
label yet (that requires resolved future labels, per the standing
`RESOLVED_*_LABELS_INSUFFICIENT` blocker), but the TRIGGER mechanism
this section needs is now built. Future profit alone still never proves
an entry decision was correct, per section 9's directive-standing
discipline restated from `wait_diagnostics_research.py`.

## 25-26. Capital-idle economics and portfolio awareness

`CAPITAL_IDLE_TIME` (section 4) is not automatically bad -- it becomes an
opportunity cost specifically when validated (`GOOD`/`STRONG`/
`EXCEPTIONAL`, section 20) opportunities existed concurrently and went
unselected (`VALID_OPPORTUNITIES_REJECTED` > 0 during the same window).
Portfolio-relative opportunity ranking (section 26) is the same Pareto-
frontier mechanism already used for candidate selection (P2B/P2D design
doc section 6), applied ACROSS a HOLD-vs.-alternative comparison rather
than only across entry candidates -- HOLD is economically rational
specifically when it remains non-dominated in that same frontier, not
merely when no explicit close signal fired.

## 27. Action-selection target -- restated, not re-derived

Unchanged from the P2D design doc's section 6/27 (Pareto-frontier default,
never "highest realized P&L = best"). This document adds no new
formulation -- the action-vs-inaction framing above (section 6) is a field
spec for the SAME target design, not a competing one.

## 28. Path-state label-quality extension

Extends `label_quality_research.py` (this branch, prior pass) with a
path-specific completeness dimension: `PathCompletenessState`
(`COMPLETE`/`PARTIAL_MISSING_INTERMEDIATE`/`MISSING_PEAK_OBSERVATION`/
`EVENT_AMBIGUOUS`). `assess_path_completeness()` requires the caller's
own AFFIRMATIVE `is_known_peak_search_complete` flag per checkpoint --
never inferring completeness from merely having "some" data points (real
test: `test_gap_flagged_checkpoint_is_partial`). A path overlapping an
`EVENT_DATA_UNKNOWN` window (from `event_state_research.py`) is flagged
`EVENT_AMBIGUOUS` and takes priority over every other completeness signal
(real test: `test_event_overlap_dominates_everything_else`) -- an
event-contaminated path's giveback/velocity attribution to "normal
market behavior" vs. "event-driven" cannot be trusted regardless of how
densely it was otherwise observed. `PEAK_PNL`/`GIVEBACK`/velocity are
never fabricated from an incomplete path -- `compute_path_state()`
structurally ties its own `profit_giveback` field to the completeness
check (real test: `test_no_giveback_reported_without_a_peak_observation`).

## 29. Repository research -- one real, deep-read find

**REPO**: `charlieyanhx/exitkit`. **LICENSE**: MIT. **PUSHED**:
2026-09-11 (four days before this pass -- very fresh). **STARS**: 0 (new,
not yet discovered by the community -- existence/quality verified by
reading the actual source and tests, not by popularity). **FILES_READ**:
`exitkit/base.py` (full), `tests/test_regressions.py` (full).

**PROBLEM**: a catalogue of 27 exit-signal models across six families
(stop-loss, take-profit, time-based, volatility, signal-reversal,
convergence) behind one common interface (`ExitSignalModel.
generate_exit_signals`), extracted from what its own README describes as
"a private options-research program," with a `backtesting.py` adapter.

**Directly relevant findings**:
- `ExitSignalModel`'s own docstring: "missing [required market-data]
  fields... raise `MissingMarketData` rather than defaulting to a
  fabricated value" -- independent convergence with this engagement's own
  UNKNOWN-never-zero discipline, from a completely unrelated codebase.
- `tests/test_regressions.py`'s three named, real bugs found while
  writing the test suite (its own docstring: "Defects found while
  extracting this package. Each test is named for one.") -- the most
  valuable one for THIS document: `get_holding_hours()` depended on a
  prior `update_pnl()` call to populate `holding_period`, so a 9-hour-old
  position with no prior mark reported ZERO holding hours and a
  time-based exit model silently never fired
  (`test_time_exit_fires_without_an_explicit_mark`). Directly validated
  this pass's own design choice to make `compute_trajectory`/
  `compute_path_state` pure functions of an ordered checkpoint list with
  no stateful "mark" step (section 7).
- A second named bug: `MarketHoursExitModel` raised `NameError` on every
  call because the module used `time.time()` without importing `time` --
  the model had literally never run in production despite existing in the
  codebase. Worth noting as a general caution for any future
  session-state/market-hours classifier this document's section 12
  eventually motivates: it must be exercised by a real test that actually
  CALLS it against live-shaped input, not merely imported.

**THETA_ALREADY_HAS**: the six exit-model FAMILIES this library
catalogues map conceptually onto features already scattered across this
branch's modules (time-based -> `decision_freshness_research.py`'s
`TIME_DECAY_EXCEEDED`; volatility -> `iv_realized_vol_research.py`/
`volatility_surface_research.py`; signal-reversal -> `optionomics_flow_
temporal_research.py`'s `REVERSING` direction). **THETA_LACKS**: a unified
"stop-loss"/"take-profit" MODEL CATALOGUE the way exitkit organizes one --
not needed given this engagement's standing "no fixed profit target"
discipline (exitkit's own fixed/adaptive stop-loss and take-profit models
are exactly the kind of threshold-rule catalogue this document's
permanent principles explicitly reject as a Production mechanism).
**ADOPT**: no code (MIT license permits it, but the threshold-rule
paradigm itself conflicts with this engagement's open-ended-objective
design). **REFERENCE_ONLY**: the pure-function/no-hidden-state design
lesson (validated this pass) and the `MissingMarketData`-over-fabrication
discipline (independent confirmation of an existing THETA norm).
**LOOKAHEAD_RISK/FILL_BIAS/SURVIVORSHIP_RISK**: N/A (a signal-generation
library, not a backtest engine itself).

Other repos surfaced by search but not deep-read this pass (existence-
verified only): `goldspanlabs/optopsy` (already cited, prior sessions),
`kwisener01/options-system` (auto-exit at 50% profit target / 1DTE force-
close -- a fixed-threshold system, explicitly the OPPOSITE design
philosophy this engagement follows, named for completeness not adoption),
`yogesh-ing/back-test`'s PR #22 (an options exit-policy evaluator with
DTE-squareoff/time-stop/reenter parameters -- plausible future reference,
not read this pass).

## Receipt

```
PREVIOUS_P2D_COMMIT_PUSHED: YES
CURRENT_CLAUDE_SHA: (see the commit this pass produces on claude/theta-r1-real-state)

ACTION_VS_INACTION_RESEARCH: COMPLETE (section 6 -- ActionEvidence field
  spec with an explicit inactionCost field for both HOLD and WAIT)
HOLD_ECONOMIC_COST: COMPLETE (section 2 -- four research states, none an
  executable rule)
WAIT_ECONOMIC_COST: COMPLETE (section 3 -- extends existing evaluate_false_reject
  with explicit opportunity-cost vocabulary)
ANTI_PARALYSIS_METRICS: COMPLETE (section 4 -- eleven named metrics, each
  mapped to an existing or newly specified building block)
ANTI_OVERTRADING_METRICS: COMPLETE (section 5 -- seven named metrics, same treatment)

POSITION_PATH_STATE: COMPLETE (closed this pass -- position_path_state_research.py,
  23 tests; full ALREADY_AVAILABLE/MISSING/DERIVABLE/PROVIDER_BLOCKED inventory)
WINNER_TO_LOSER_RESEARCH: COMPLETE (closed this pass -- assess_winner_to_loser,
  directive's own worked example directly tested)
LOSS_VELOCITY_RESEARCH: COMPLETE (closed this pass -- compute_trajectory, one
  generic function for PnL/Delta/IV/distance-to-strike/Gamma velocity+acceleration)

TIME_STATE_RESEARCH: COMPLETE (sections 11/13/14 -- time-as-input interactions
  named; decision-freshness machinery closed this pass)
SESSION_STATE_RESEARCH: GAPS (vocabulary specified, section 12; classification
  itself requires a live broker/exchange calendar source -- Codex's provider-
  adapter domain, not built this pass, named honestly)
DECISION_FRESHNESS: COMPLETE (closed this pass -- decision_freshness_research.py,
  14 tests, all ten directive-named invalidators, multi-reason reporting)

STRATEGY_TIMING_ROUTER: COMPLETE (section 15 -- restates canonical-strategy-
  frontier.ts's existing verified behavior, names this pass's new evidence inputs)
SHORT_DTE_TIMING: COMPLETE (section 16 -- testable Gamma-acceleration-magnitude
  claim specified, not yet tested against real data)
EXPIRY_MANAGEMENT_RESEARCH: COMPLETE (section 17 -- decision-vs-broker-fact
  distinction confirmed already structurally preserved)

SMALL_PROFIT_RESEARCH: COMPLETE (section 18 -- unified under the same
  ActionEvidence/inactionCost framing as large winners, no separate mechanism)
LARGE_WINNER_RESEARCH: COMPLETE (section 19 -- same)
OPPORTUNITY_SPECTRUM: COMPLETE (section 20 -- two independent 5-point axes,
  size and quality never conflated)

ENTRY_PARALYSIS_DIAGNOSTIC: COMPLETE (section 21 -- confirmed as the existing
  POSSIBLE_LOGIC_PARALYSIS category from wait_diagnostics_research.py, not a
  new mechanism)
HOLD_PARALYSIS_DIAGNOSTIC: COMPLETE (section 22 -- DEFAULT_HOLD_BIAS vs.
  VALIDATED_HOLD distinction, new)
MISSING_DATA_BIAS_RESEARCH: COMPLETE (section 23 -- REQUIRED_UNKNOWN vs.
  OPTIONAL_UNKNOWN, no hard gate touched or weakened)
CAPITAL_IDLE_RESEARCH: COMPLETE (section 25 -- idle time is a cost only when
  concurrent validated opportunities existed, not unconditionally)
PATH_LABEL_COMPLETENESS: COMPLETE (closed this pass -- extends label_quality_research.py
  with PathCompletenessState, EVENT_AMBIGUOUS dominates every other signal)

REPOS_DEEP_STUDIED: charlieyanhx/exitkit (MIT, base.py + test_regressions.py
  read in full)
NEW_HYPOTHESES: 0 new hypotheses.json entries this pass (section 16's Gamma-
  acceleration claim and section 3's WAIT opportunity-cost framing are stated
  as testable but require real path-checkpoint/resolved-label data neither of
  which exists yet -- flagged as future-registration candidates, not fabricated
  here)

HIGH_WIN_RATE_OBJECTIVE: ACTIVE_OPEN_ENDED_OPTIMIZATION
REFERENCE_TARGET_REGION: APPROXIMATELY_70_TO_80_PERCENT_WHOLE_CHAIN_WR_BUT_NOT_A_LIMIT_OR_REQUIREMENT
STRONG_RETURN_OBJECTIVE: ACTIVE_OPEN_ENDED_OPTIMIZATION
REFERENCE_HIGH_RETURN_REGION: 40_PERCENT_PLUS_WHERE_ECONOMICS_SUPPORT_IT_BUT_NOT_A_LIMIT_OR_REQUIREMENT
SMALL_PROFIT_CAPTURE: VALUED_WHEN_ECONOMICALLY_OPTIMAL
LARGE_WINNER_CAPTURE: VALUED_WHEN_ECONOMICALLY_JUSTIFIED
WAIT_PARALYSIS: MUST_BE_DETECTED_AND_PENALIZED
HOLD_PARALYSIS: MUST_BE_DETECTED_AND_PENALIZED
OVERTRADING: MUST_BE_DETECTED_AND_PENALIZED
DYNAMIC_PROFIT_PROTECTION: REQUIRED
DYNAMIC_OPPORTUNITY_CAPTURE: REQUIRED
FIXED_40_PERCENT_TAKE_PROFIT: NO
FIXED_MINIMUM_PROFIT_ENTRY: NO
FIXED_MINIMUM_WIN_RATE_ENTRY: NO

MAIN_PUSHED = NO
PRODUCTION_CHANGED = NO
BROKER_ORDERS_BY_CLAUDE = 0
LIVE_OWNER_AUTHORIZATION = NOT_GRANTED
LIVE_ELIGIBLE = NO
```
