# THETA Dynamic Profit Preservation, Strategy Switching, and Professional Trader Method Mining

Author: Claude (research lane, `claude/theta-r1-real-state`). Research-only
pass; no `main` code read or audited this round (Codex is actively working
on the P1 management phase -- per explicit instruction, this pass does not
fetch/inspect intermediate `main` SHAs). `CURRENT_MAIN_SHA` recorded only for
the receipt, not inspected: `bbd13cb9028636d080fe6ec4bb093a7de1dfb243`.

## A. Profit preservation model

The owner's core correction (directive section 1) is now the framing for
everything below: THETA must never blindly wait for a fixed target while
giving back a real, already-achieved profit, and must never take a fixed
small profit reflexively just because a position is green. The only
question that matters is **from the current state, is holding still better
than closing** -- answered from present facts and (where genuinely required)
an explicit model, never from where the position started or a round-number
target.

Six concepts this section formalizes, each with a precise scope boundary
(what's a pure fact vs. what needs a model):

| Concept | Computable now from observed facts? |
|---|---|
| `PROFIT_PRESERVATION` (has this position's peak profit been protected) | YES -- pure arithmetic on peak vs. current |
| `PROFIT_GIVEBACK` (how much of the peak has been surrendered) | YES |
| `REMAINING_REWARD` (structural upside still available) | YES, as a bound -- not a probability-weighted estimate |
| `REMAINING_RISK` | Partially -- requires a caller-supplied tail estimate (ES/CVaR-style), not fabricated here |
| `CONTINUATION_VALUE` (expected value of holding from here) | NO -- requires a calibrated forward model (`FORWARD_EV_MODEL_REQUIRED`) |
| `CAPITAL_OPPORTUNITY_COST` (value of redeploying elsewhere) | NO -- requires a real, current alternative-opportunity set (`REDEPLOY_OPPORTUNITY_SET_REQUIRED`) |

## B. Profit-giveback features -- exact formulas, units, edge cases

Implemented and tested this pass: `bots/theta/quant/research/profit_preservation_research.py`
(11 new tests, all passing). Every formula below is quoted verbatim from
that module's own docstrings, not restated loosely.

```
PROFIT_CAPTURE_RATIO = current_unrealized_pnl / max_favorable_credit_or_debit
PEAK_CAPTURE_RATIO   = peak_unrealized_pnl / max_favorable_credit_or_debit

PROFIT_GIVEBACK = max(0, peak_unrealized_pnl - current_unrealized_pnl)
GIVEBACK_RATIO  = profit_giveback / peak_unrealized_pnl   -- defined ONLY when peak_unrealized_pnl > 0

REMAINING_REWARD = max_favorable_credit_or_debit - current_unrealized_pnl
REMAINING_REWARD_PER_CAPITAL_DAY = remaining_reward / remaining_capital_days
REMAINING_REWARD_TO_RISK = remaining_reward / downside_tail_estimate   -- MODEL_REQUIRED:downside_tail_estimate without a supplied tail estimate

CLOSE_NOW_VALUE = realized P&L at the current executable price, minus closing cost/slippage
  -- the one term that is a CERTAIN, PIT-observable quantity given a real quote, not a model output;
     still EMPIRICAL_REQUIRED:executable_close_quote when no real quote exists.

HOLD_CONTINUATION_VALUE       -- FORWARD_EV_MODEL_REQUIRED (needs a calibrated forward outcome
                                  distribution from the current state, per TRD MODEL-003)
CLOSE_AND_REDEPLOY_VALUE      -- REDEPLOY_OPPORTUNITY_SET_REQUIRED (needs a real current
                                  alternative-candidate set with its own EV, not fabricated)
```
**Edge cases the module explicitly handles, not glossed over:**
- `GIVEBACK_RATIO` is `None` (`UNKNOWN`), never `0`, when `peak_unrealized_pnl <= 0` -- a
  position that was never profitable has no giveback ratio to report; reporting `0` would
  falsely read as "no giveback occurred."
- `peak_unrealized_pnl < current_unrealized_pnl` is structurally impossible (the peak, by
  definition, cannot be below the current value if tracked correctly) and is classified
  `INVALID`, not silently accepted -- this is a caller-side tracking-bug signal, not a
  valid position state.
- A missing/non-positive `max_favorable_credit_or_debit` (the structural ceiling) makes
  every ratio `UNKNOWN`, never a divide-by-zero or a fabricated `0`.
- `HOLD_CONTINUATION_VALUE`/`CLOSE_AND_REDEPLOY_VALUE` are **never computed** by this
  module -- it returns only the named blocker enum. This is a deliberate design choice,
  not an oversight: fabricating either would be the exact violation this directive's
  section 3 explicitly forbids.

## C. Winner-management challengers

Historical protocol note: this section records the 2026-09-15 nineteen-policy
research lattice. The active V8 registry is `theta-experiment-registry-v2` and
contains the canonical seventeen challengers required by V8. The names below
remain legacy research vocabulary for interpreting old rows. They are not the
current preregistration and have no Production authority.

The historical registry extended that pass from 8 to 19 entries:

```
FIXED_25, FIXED_35, FIXED_40, FIXED_50, FIXED_60, FIXED_70, FIXED_75, FIXED_80, FIXED_90,
TIME_EXIT, DTE_EXIT, DTE_21_EXIT, DTE_14_EXIT, DTE_7_EXIT, FIFTY_PERCENT_OR_DTE_21,
DYNAMIC_REMAINING_EV, DYNAMIC_EV_PLUS_HARD_RISK, DYNAMIC_EV_PLUS_FLOW_INVALIDATION,
DYNAMIC_PROFIT_GIVEBACK
```

`DYNAMIC_PROFIT_GIVEBACK` is the new entry this directive's sections 2-5 specifically
motivate: a policy that reacts to `GIVEBACK_RATIO` crossing a caller-supplied bound
GIVEN a real forward-model signal that continuation value has deteriorated (never a bare
"giveback > X% -> close" rule on its own, which would just be `FIXED_X` restated with
extra steps). Distinct from `DYNAMIC_REMAINING_EV` (reacts to remaining reward alone,
regardless of how much profit has already been given back).

**The three worked scenarios from directive section 5, restated as concrete tests:**
- +30% with shrinking remaining reward AND deteriorating tail signals (rising
  Gamma/tail risk, downside flow, worsening skew, negative-gamma regime, approaching
  event) -> CLOSE plausibly dominates. Testable as `DYNAMIC_PROFIT_GIVEBACK` vs
  `FIXED_75`/`FIXED_80` on the same cohort.
- +10% with substantial remaining premium, favorable theta, no event, healthy
  liquidity/regime, low assignment risk -> HOLD plausibly dominates. Testable as
  `DYNAMIC_REMAINING_EV`/`DYNAMIC_PROFIT_GIVEBACK` vs `FIXED_25` on the same cohort.
- +40% with genuinely low remaining risk and minimal remaining capital-days -> HOLD may
  still dominate DESPITE the high percentage, because `REMAINING_REWARD_TO_RISK` and
  `REMAINING_REWARD_PER_CAPITAL_DAY` can both favor continuing even at a high capture
  ratio. This is the clearest illustration of why a bare percentage threshold cannot be
  the deciding variable on its own.

These remain hypotheses to test once real Paper fills exist -- none is asserted true.

## D. Loss-management challengers

`LOSS_POLICIES` (unchanged this pass -- already comprehensive, 6 entries):
`FIXED_OPTION_PREMIUM_STOP`, `THESIS_INVALIDATION`, `DYNAMIC_CONTINUATION_EV`,
`ROLL_WHEN_INCREMENTAL_EV_POSITIVE`, `ASSIGN_WHEN_OWNERSHIP_EV_POSITIVE`,
`HYBRID_HARD_TAIL_LIMIT_PLUS_DYNAMIC`. Already correctly forward-looking (the registry's
own name choices avoid "recover the loss" framing) -- no extension needed this pass. The
core discipline this directive's section 6 restates is already TRD-required
(`ROLL-002`, `H-R-03`, RETAIN status): a loss is economically sunk except where it
affects whole-chain accounting, basis, or portfolio constraints -- "I am down 20%,
therefore I must recover" is explicitly the anti-pattern H-R-03 already guards against.

## E. Roll economics

Already formalized (prior sessions, unchanged): `RollUtility = EV_new - EV_best_alternative
- tail/capital-day/opportunity-cost penalties` (TRD Appendix A), with `NetRollCredit`
explicitly NOT treated as proof of a good roll (H-R-03, RETAIN). This directive's section 7
asks for the same discipline restated for roll SPIRALS specifically -- already tracked as
a named metric bundle in `docs/research/R6_MEGA_PHASE_PARITY_ADDENDUM.md`'s prior
discussion (`roll_count`, `days_extended`, `realized_losses`, `premium_accumulated`,
`breakeven_improvement`, `capital_days`, `opportunity_cost`) and consumed by
`ROLL_ALTERNATIVES = ("HOLD", "CLOSE_FULL", "ROLL", "ACCEPT_ASSIGNMENT", "REDEPLOY")` in
`experiment_registry.py`. No new module needed -- this pass confirms the existing
machinery already covers the roll-spiral/breakeven-obsession/duration-creep concerns
named in section 7, rather than rebuilding it.

## F. Strategy-switching hypotheses

Two new entries added to `hypotheses.json` this pass (`H-Q-03`, `H-Q-04` -- attached to
`THETA-Q` only because the schema requires exactly one `archetype_id` per entry and
THETA-Q is the routing default; both are genuinely cross-branch claims, stated as such in
their own `rationale` fields):

- **`H-Q-03`** (trading, `status: TEST`, gated the same as `H-D-01`): when conditions that
  make `THETA_CONVENTIONAL` attractive deteriorate (rising IV with worsening downside
  skew, accelerating downside aggressive flow, a shift toward negative gamma, approaching
  event risk), evaluating `THETA_DEFINED_RISK`'s frontier ALONGSIDE `THETA_CONVENTIONAL`'s
  from the same decision state produces superior after-cost whole-PORTFOLIO economics
  (EV, ES/CVaR, and max drawdown together -- not EV alone) than only evaluating
  Conventional until it fails outright. Explicitly NOT "Strategy A lost -> use Strategy
  B" -- it's regime-conditioned CO-evaluation, tested against the SAME decision-time
  deterioration signals the directive names in section 8's own examples.
- **`H-Q-04`** (measurement, `status: RETAIN`, architecture-check not data-dependent):
  any strategy-switching evaluation must charge the ORIGIN branch's real exit cost
  (spread, commission, foregone remaining theta) against the DESTINATION branch's claimed
  benefit -- a report showing only the destination's clean forward EV systematically
  overstates the case for switching. `guards_against: ["H-Q-03"]` -- this measurement
  discipline is what keeps H-Q-03's own eventual test honest.

**Directive section 8's other named examples, classified as hypothesis-worthy but NOT yet
separately registered this pass (would need their own archetype-appropriate homes, a
larger addition than this pass's bounded scope):**
- Short-DTE gamma too dangerous -> longer-DTE may be better: this is really H-H-01's
  own regime scope in reverse (H-H-01 already frames THETA_HOLD_STRIKE as a narrow,
  separately-validated challenger, never assumed to transfer) -- no new hypothesis
  needed, H-H-01's existing `regime_scope_note` already covers this direction.
- Assigned stock + low call IV + strong upside trend -> WAIT may beat selling cheap
  calls: this is a genuine gap. `H-C-01`/`H-C-02` cover premium-vs-upside tradeoffs and
  recovery-conditioned CC timing, but neither explicitly frames "no CC at all, just
  WAIT" as a competing action when call premium itself is unattractive. **Flagged as a
  follow-up hypothesis to register in a future pass, not fabricated here under time
  pressure.**
- Very high event uncertainty -> defined risk or WAIT: covered by H-Q-03's own
  deterioration-signal list (event risk is one of the named triggers) -- no separate
  entry needed.

## G. Trader-method evidence (QuantWheel / Alertsify / Collective2)

Per the prior session's finding (re-confirmed, not re-litigated): QuantWheel is a real,
public options-trading TOOLS platform, independently WebSearch-verified. Deepened this
pass, specifically for the DECISION WORKFLOW its tools imply (per directive section 12 --
extracting the workflow, not inventing proprietary algorithms):

- **CSP/CC screener**: implies the workflow "rank candidates by a scoring formula, then
  a human selects" -- consistent with THETA's own `canonical-strategy-frontier.ts`
  producing a ranked candidate set rather than a single auto-selected trade, EXCEPT
  QuantWheel's screener is explicitly human-in-the-loop (a tool FOR a trader), while
  THETA's frontier feeds an autonomous selector. Worth noting as a design-philosophy
  difference, not a defect either way.
- **Roll assistant ("compare rolls before assignment")**: implies the professional
  workflow is roll-vs-alternatives COMPARISON before committing, at or before the
  assignment boundary -- directly consistent with `RollUtility`'s "roll only when it
  beats the best alternative" framing (H-R-03) and with treating assignment/roll/close as
  competing actions rather than roll-as-default. Confirms the existing discipline is
  aligned with what a real professional tool is built to support.
- **Journal with true cost basis**: implies whole-chain cost-basis tracking is considered
  essential professional infrastructure, not optional -- matches THETA's own whole-chain
  accounting requirement (never scoring recovery episodes as wins while stock remains
  underwater).
- **GEX dashboard (gamma flip, walls, Vanna, Charm)**: confirms these four families are
  considered decision-relevant by a real professional tool vendor, independent of
  Optionomics -- supports (does not prove) the priority THETA already gives these
  families in its feature-ablation ladder.

No proprietary QuantWheel algorithm was invented or assumed; only the workflow implied by
its own publicly documented feature set was extracted.

**Alertsify**: existing evidence (`THETA_EXPERT_TO_STRATEGY_MAP.md`'s DannyMtb entry,
`evidence_class: D_EXPERT_DNA`) used as-is; no new public detail found or invented this
pass beyond what the prior session's WebSearch already established.

**Collective2**: no owner-provided or repo-stored trade-history material was found this
pass (same non-fabrication finding as `EXPERT_REGISTRY.md` already documents for the
broader Alertsify/Collective2/QuantWheel gap). If real Collective2 trade-history data is
ever supplied, the adversarial checks this directive's section 14 names (survivorship,
closed-trade bias, hidden open losers, martingale/averaging-down, roll-loss erasure,
strategy drift, unrealistic fills) are exactly this repository's own standing
win-rate-illusion discipline (`wr_illusion_detector.py`'s five checks already cover
several of these) applied to a new evidence source -- no new detector module is needed,
only real data to run the existing one against.

## H. Optionomics management features (design, not implementation)

Directive section 15's named temporal deltas map directly onto the already-built
`optionomics-temporal-features.ts` (verified COMPLETE two sessions ago) family
enumeration: `IV_CHANGE`/`VRP_CHANGE` -> `VOLATILITY` family; `PUT_SKEW_CHANGE` ->
`SKEW` family; `TERM_CHANGE` -> `TERM_STRUCTURE` family; `GEX_REGIME_CHANGE`/
`DISTANCE_TO_GAMMA_FLIP`/`CALL_WALL_DISTANCE`/`PUT_WALL_DISTANCE`/`VANNA_CHANGE`/
`CHARM_CHANGE` -> `EXPOSURE` family. `FLOW_ACCELERATION`/`FLOW_REVERSAL` are NOT yet
covered by that module (it covers scalar metric/skew/term/exposure deltas, not the
aggregate-flow-series-derived features this branch's own `optionomics_flow_event.py`
research already anticipates) -- a real, precisely-located gap for a future pass, not
fabricated as already covered here. `EVENT_STATE_CHANGE` is a categorical transition
(CLEAR -> event-near), not a numeric delta the existing temporal-feature machinery
computes -- would need its own small state-transition detector, not the same
`deriveOptionomicsTemporalFeatures` numeric-delta function.

**None of these are proposed as a deterministic exit trigger** (directive section 15's
own instruction) -- each is a candidate INPUT to a future calibrated management model,
exactly like `H-Q-03`'s deterioration-signal list treats them as conditions to detect,
never as a rule to act on directly.

## I. Repo findings (this pass)

**Deep-read, real source (not README-only):**

- `tfrmma/options-volatility-trading-strats` (MIT). Read `strategies/base_strat.py` in
  full. **PROBLEM**: crypto (Deribit) delta-hedged volatility-arbitrage/dispersion
  strategies -- NOT a wheel/premium-selling framework, a materially different strategy
  class than THETA. **DATA MODEL**: `OptionLeg`/`PortfolioGreeks`/`PnLDecomposition`
  dataclasses; batch-vectorized Greeks via numpy. **MANAGEMENT MODEL**: `partial_close_leg`
  (trims a leg's size, cost basis untouched, only the closed slice realizes P&L -- a
  clean, correct partial-close semantics worth comparing against THETA's own partial-fill
  handling), `close_all` (flattens every leg). **A real, useful engineering lesson found
  in its own code comments**: `close_all`'s comment states two strategy subclasses used
  to each carry their OWN duplicate copy of the exact same flatten logic before being
  consolidated into this one base-class method -- a concrete, first-person example of
  the "duplicate strategy engines" failure mode this engagement's own adversarial-audit
  checklist already watches for in THETA's own codebase. **THETA_ALREADY_HAS**: an
  equivalent-in-spirit close-old+open-new discipline (roll = close + open, never netted).
  **THETA_MISSING**: nothing directly transferable -- the strategy class is too different.
  **VERDICT: REJECT** as a primary source for winner/loss-management economics (wrong
  strategy class); **REFERENCE_ONLY** for the partial-close-semantics and
  duplicate-logic-consolidation lessons specifically. **EXACT_CODEX_RECOMMENDATION**:
  none -- these are patterns to keep in mind, not a specific change to request.

- `FlashAlpha-lab/0dte-options-analytics` (MIT). Read `examples/0dte_theta_decay_monitor.py`.
  **Concrete, quotable fact** (the example's own documentation, not this branch's claim):
  "A standard 0DTE ATM option may lose 30-50% of its value in the final 90 minutes" --
  theta decay is sharply NONLINEAR and back-loaded for very-short-DTE options, not a
  smooth linear burn. Directly relevant to `REMAINING_REWARD_PER_CAPITAL_DAY` for
  `THETA_HOLD_STRIKE`'s 2-5 DTE cohort: remaining theta reward per calendar day is NOT
  constant across that window, it likely accelerates toward the end -- a real, specific,
  testable refinement to how that metric should be computed for the Hold-Strike branch
  specifically (never assumed to transfer to THETA_CONVENTIONAL's 15+ DTE cohorts, and
  this is an INDEX-0DTE example, a different liquidity/dynamics profile than THETA's
  equity/ETF universe -- noted, not glossed over). **VERDICT**: `TEST_ONLY` -- the
  nonlinearity claim is a testable hypothesis for Hold-Strike's own remaining-reward
  formula, not an assumed fact for THETA's universe.

**Triaged, existence/tree-verified, NOT deep-read (thin or off-topic for this specific
research question -- stated honestly rather than padded with a fabricated dossier):**
- `Manuele02/QuantVol` (MIT): two Jupyter notebooks only (Black-Scholes/vol-surface,
  CRR American-option vol-surface). No exit/management/switching logic present at all.
  **REJECT** for this topic.
- `zenith256/live-volatility-surface` (no license): real SVI/SSVI/GARCH/HAR-RV surface
  and forecasting code, but it's a vol-SURFACE tool, not an exit-timing or
  strategy-switching tool. Peeked at the tree only; `analyze_rv_signals.py` was not read
  this pass. **TEST_ONLY at most, not deep-studied** -- honestly marked, not skipped
  silently.
- `Aaaaarin/vol-surface-dispersion` (no license): real dispersion-trading backtest with
  an SVI calibration module and a `signal_generator.py`, but dispersion (index vs.
  component implied/realized correlation) is a different strategy class from THETA's
  wheel, similar to `tfrmma` above. Tree-verified, not deep-read this pass.
- New GitHub search for the directive's named additional query terms ("dynamic option
  exit", "option roll strategy backtest", "regime switching options", "premium selling
  management", "cash secured put management", etc.) was **not performed this pass** --
  the 4 explicitly-named candidates were triaged as instructed, but the open-ended
  search for further new repos was not done given the time this pass spent on the
  formula/hypothesis/document deliverables instead. Named honestly as not attempted,
  not silently skipped.

## J. Management formula cross-validation (bounded to this pass's scope, per directive section 19)

No formula ambiguity or defect found in the profit-preservation formulas built this pass
(they are new, so there is nothing yet to cross-validate against an existing THETA
implementation -- this IS the first implementation). Existing whole-chain/roll-debit-
credit/economic-basis formulas were not re-derived this pass (out of scope per the
directive's own instruction reserving full option-pricing-formula cross-validation for a
later dedicated phase). **MANAGEMENT_FORMULA_ISSUES: NONE FOUND THIS PASS** (bounded
scope, not a claim of exhaustive validation).

## K. Codex implementation recommendations (research-derived only -- not a request to change `main` now)

These are research conclusions Codex may find useful whenever the P1 management phase
reaches profit-taking/loss-management policy selection. None of this is a demand, and
none was implemented on `main` by this branch:

1. When a real forward EV/calibrated model eventually exists, `DYNAMIC_PROFIT_GIVEBACK`
   (section C) is a distinct challenger from the existing `DYNAMIC_REMAINING_EV` and
   should be tested as its own arm, not folded into it -- they react to different signals
   (remaining reward alone vs. remaining reward relative to a protected peak).
2. `REMAINING_REWARD_PER_CAPITAL_DAY` for `THETA_HOLD_STRIKE` specifically should account
   for theta's nonlinear, back-loaded decay near expiry (section I's FlashAlpha finding)
   rather than assuming a linear per-day rate -- worth a dedicated short-DTE variant of
   the formula once real fills exist to calibrate it against.
3. A `H-C-01`/`H-C-02`-adjacent hypothesis ("WAIT may beat a cheap covered call when
   call IV is low and trend is strongly favorable") is a real, currently-unregistered gap
   (section F) -- worth a follow-up research pass to formalize properly rather than a
   rushed addition here.
4. `H-Q-04`'s switching-cost measurement discipline (charge the origin branch's real exit
   cost against the destination branch's claimed benefit) should be a reporting
   requirement on any future strategy-switch evaluation view Codex builds, the same way
   `OUT-001..004` already requires Leg/Managed-Episode/Whole-Chain WR to travel together.

## Receipt

```
CURRENT_MAIN_SHA_AT_RESEARCH_START: bbd13cb9028636d080fe6ec4bb093a7de1dfb243 (recorded only, not inspected)
CURRENT_CLAUDE_SHA: (see final commit on claude/theta-r1-real-state)

DYNAMIC_PROFIT_PRESERVATION: COMPLETE (formulas + tests; forward-value terms correctly
  left MODEL_REQUIRED/EMPIRICAL_REQUIRED, not fabricated)
PROFIT_GIVEBACK_MODEL: COMPLETE

WINNER_MANAGEMENT_HYPOTHESES: 19 challenger policies registered (11 new this pass:
  FIXED_35/40/60/70/80/90, DTE_21/14/7_EXIT, FIFTY_PERCENT_OR_DTE_21, DYNAMIC_PROFIT_GIVEBACK)
LOSS_MANAGEMENT_HYPOTHESES: 6, unchanged -- already comprehensive, no extension needed
ROLL_HYPOTHESES: unchanged -- existing RollUtility/NetRollCredit/H-R-03 discipline already
  covers this directive's roll-spiral/breakeven-obsession concerns
STRATEGY_SWITCHING_HYPOTHESES: 2 new (H-Q-03 trading/TEST, H-Q-04 measurement/RETAIN);
  1 gap named for future registration (WAIT-vs-cheap-CC), 2 directive examples mapped
  onto existing hypotheses without needing new entries

WAIT_AS_COMPETING_ACTION: YES (H-Q-03's alternatives list includes WAIT explicitly;
  matches this engagement's standing GLOBAL_WAIT-must-be-earned discipline)

QUANTWHEEL_METHODS: real public tools platform, workflow extracted (screener/roll-
  assistant/journal/GEX-dashboard imply rank-then-select, roll-vs-alternatives compare,
  whole-chain-basis tracking, GEX-family relevance) -- no proprietary algorithm invented
ALERTSIFY_METHODS: unchanged from existing repo evidence (DannyMtb, D_EXPERT_DNA)
COLLECTIVE2_METHODS: no material found this pass; non-fabrication finding re-confirmed

OPTIONOMICS_MANAGEMENT_FEATURES: IV/VRP/skew/term/GEX-regime/gamma-flip-distance/wall-
  distance/Vanna/Charm all map onto the existing temporal-feature module's families;
  FLOW_ACCELERATION/REVERSAL and EVENT_STATE_CHANGE are real, precisely-named gaps in
  that module, not yet covered -- flagged for a future pass

REPOS_DEEP_STUDIED_THIS_PASS: tfrmma/options-volatility-trading-strats (base_strat.py,
  full read), FlashAlpha-lab/0dte-options-analytics (0dte_theta_decay_monitor.py)
NEW_REPOS_FOUND: none via open-ended search (not attempted this pass, named honestly above)
HIGH_VALUE_PATTERNS: partial-close-without-disturbing-cost-basis semantics
  (tfrmma); duplicate-flatten-logic-consolidation lesson (tfrmma); nonlinear
  back-loaded theta decay near expiry (FlashAlpha 0DTE)

MANAGEMENT_FORMULA_ISSUES: NONE FOUND THIS PASS (bounded scope per directive section 19)

REQUIRED_CODEX_RECOMMENDATIONS: the four items in section K above -- research-derived,
  offered for whenever the P1 management phase reaches policy selection, not urgent

70_80_WR_STATUS: RESEARCH_TARGET_NOT_PROVEN
40_PLUS_RETURN_STATUS: ASPIRATIONAL_OUTCOME_NOT_A_TRADE_EXIT_RULE -- four distinct
  candidate definitions remain unmerged (premium capture / secured-capital return /
  annualized return / return-on-risk), consistent with prior sessions' framing

MAIN_PUSHED = NO
PRODUCTION_CHANGED = NO
BROKER_ORDERS_BY_CLAUDE = 0
LIVE_OWNER_AUTHORIZATION = NOT_GRANTED
LIVE_ELIGIBLE = NO
```

## L. P2 addendum: options-first boundary correction + two new switching hypotheses

**The boundary correction, applied retroactively to this document's own prior content:**
H-Q-03/H-Q-04 (section F above) were already framed at the branch/portfolio level, not as
underlying-price signals -- re-reviewed this pass and found consistent with the options-
first boundary (their deterioration signals are VRP/skew/flow/gamma-regime/event-proximity,
never "the stock went down"). No correction needed to what already existed.

**Two new switching hypotheses added this pass, deliberately restated in strictly
option-chain terms** (per the explicit boundary directive: the research unit is
underlying+expiration+strike+call/put+structure+chain state, not ticker alone):

- **`H-Q-05`** (VRP collapse, options-first): when the SAME candidate contract's own VRP
  (horizon-matched IV-minus-RV, reusing `iv_realized_vol_research.py`'s existing alignment
  discipline -- never the underlying's raw IV level substituted for a genuine comparison)
  compresses on the SAME strike/expiration ladder, evaluating Defined Risk alongside
  Conventional on that SAME ladder is the hypothesis -- not "the stock looks calmer."
- **`H-Q-06`** (skew steepening, options-first): when 25-delta put-minus-call skew on the
  SAME expiration steepens relative to its own recent history, the SPECIFIC downside
  strikes a CSP would sell are pricing disproportionate tail risk -- a defined-risk
  structure priced on that same steepened skew is the hypothesis, not a general
  "volatility regime" label divorced from which strikes are actually affected.

Both explicitly guard against the exact underlying-only-drift risk the boundary directive
names: their `failure_mode` fields each state, verbatim, that substituting a market-wide or
underlying-level proxy for the contract-specific measurement would silently readmit generic
stock-signal thinking.

No external repository method was adopted in this addendum. One additional chain-ranking
repository was proposed on the research branch, but its exact reviewed commit was not pinned,
its tests were not read, and it has no license. It therefore remains unverified and cannot
change THETA's Pareto ranking or missing-data policy.

### Options-first final receipt (this addendum only)

```
OPTIONS_FIRST_RESEARCH = YES

CHAIN_LEVEL_ANALYSIS = GAPS
  (the two hypotheses are chain-level, but full-ladder decision synthesis across strikes
  still requires authenticated point-in-time chain history and resolved labels)

CONTRACT_SELECTION_RESEARCH = GAPS
  (H-Q-05/H-Q-06 are contract-level switching hypotheses; a dedicated "why THIS strike over
  that one" research module, as opposed to a switching hypothesis, was not built this pass)

EXPIRATION_SELECTION_RESEARCH = GAPS (existing DTE lattice + H-H-01's short-DTE scope note
  cover this at the research-lattice level; no new expiration-specific work this pass)

STRIKE_SELECTION_RESEARCH = GAPS (existing delta lattice covers strike selection via delta
  targeting; no dedicated strike-ladder-comparison module built this pass)

DELTA_SELECTION_RESEARCH = NO_CHANGE_REQUIRED (existing 6-bin delta lattice, extended two
  sessions ago, already answers "why 0.15 instead of 0.25" as a research LATTICE -- the
  specific empirical answer remains DATASET_ABSENT/EMPIRICAL_BLOCKER, unchanged)

OPTION_LIQUIDITY_RESEARCH = GAPS (dominickkubica's liquidity-score component read at a
  high level; not deep-read this pass)

OPTION_STRUCTURE_COMPARISON = GAPS (H-Q-05/H-Q-06 compare Conventional vs. Defined Risk at
  the ladder level; no dedicated CSP-vs-put-credit-spread structure-comparison module
  beyond the existing H-D-01 gating)

UNDERLYING_ONLY_STRATEGY_DRIFT = NONE FOUND
  Reviewed this document's own prior content (H-Q-03/H-Q-04) and this pass's new additions
  (H-Q-05/H-Q-06) -- all are framed at the contract/chain/branch level with explicit
  failure-mode guards against underlying-only substitution. No drift found in what exists;
  this is a narrower claim than "the full options-first program is complete," which it is
  not, per the GAPS entries above.
```

## M. Cold-start bootstrap trader-DNA records (P5F, gap-driven)

Not a generic "successful options traders" sweep -- these two records target the EXACT
gap Codex's `THETA_OWNERSHIP_AEGIS_BOOTSTRAP_AUDIT_2026-09-19.md` (commit `c3f3579`,
already canonical) confirmed with real Production evidence:
`COLD_START_BOOTSTRAP_DEADLOCK` -- RecoveryQuality requires prior recovery duration, and
the master account has zero prior THETA Paper chains, so the first Paper trade requires
evidence that can only be generated after prior trades. Both records below are read-only
research; neither proposes a runtime change, and neither is activated by anything in this
document -- that remains a versioned policy decision for the owner/Codex, exactly as the
audit itself states.

### DNA-COLD-01: CBOE S&P 500 PutWrite Index (PUT) -- unconditional systematic sizing, no per-name ownership prior

```
SOURCE_ID = DNA-COLD-01
SOURCE = Cboe Global Indices, "Cboe PutWrite Indices Methodology"; corroborated by
  Wikipedia's CBOE S&P 500 PutWrite Index summary and PM Research's "The Cash-secured
  PutWrite Strategy and Performance of Related Benchmark Indexes"
SOURCE_TYPE = Exchange-published index methodology (top of the directive's source
  hierarchy) + peer-reviewed journal (Journal of Alternative Investments / PM Research)
EVIDENCE_LEVEL = HIGH for the mechanism description (exchange's own rulebook); the PDF
  methodology document itself could not be parsed by this session's tooling (binary
  fetch failure), so the mechanism below is sourced from the search-engine summary and
  secondary descriptions of it, not a direct PDF read -- flagged honestly, not hidden.

VERIFIED_FACT = The PUT index sells one-month, at-the-money SPX puts on a fixed monthly
  roll schedule (3rd Friday), sized so that the T-bill collateral held can finance the
  MAXIMUM POSSIBLE LOSS from final cash settlement of the puts sold that month -- i.e.
  the index's "how many puts to sell" rule is a pure collateral-capacity constraint, with
  NO per-name ownership, liquidity, recovery-history, or event-context screen of any kind.
SOURCE_CLAIM = The index has published daily history back to 1986 and is treated as the
  standard institutional benchmark for the cash-secured put strategy.
INTERPRETATION = This is the single cleanest evidence available that a legitimate,
  long-running, institutionally-benchmarked systematic put-selling PROGRAM does not
  require an ownership-willingness/recovery-history prior to determine HOW MANY puts to
  sell -- because SPX is cash-settled (never assigned into single-name stock), the
  concept of "recovery quality" or "ownership willingness" is structurally inapplicable
  to it. This is a real, important disanalogy, not evidence that THETA's own ownership
  gate is wrong: THETA trades single-name CSPs that DO physically settle into owned
  stock, so an ownership/assignment-willingness check is solving a real problem the PUT
  index never faces. The gap this DOES illuminate is narrower and correct: the index
  shows that SIZING (how much collateral to commit) can be a pure capacity constraint
  independent of any recovery-history prior, even though ownership-WILLINGNESS
  (would-I-want-this-stock) genuinely cannot be benchmarked this way for single names.
ECONOMIC_MECHANISM = Collateral-capacity-bounded position count, decoupled from any
  per-position recovery/ownership judgment.
APPLICABLE_STATE = A cold-start (zero prior chains) SIZING decision for a bounded,
  already-ownership-screened candidate -- i.e. this evidence bears on "how much," never
  on "should I own this name," which THETA's ownership_v0 model already correctly keeps
  separate.
NON_APPLICABLE_STATE = Cannot be used to justify skipping OR relaxing the
  ownership-willingness screen itself; the index's cash-settlement structure makes that
  screen moot for it in a way that does not transfer to single-name Wheel.
DATA_REQUIRED = None beyond what THETA already has (collateral/buying-power figures);
  this record requires no new data ingestion.
POSITION_SIZE_LOGIC = Collateral-capacity constraint only, exactly as
  `account-exposure.ts`'s `cspCollateralRequired` already models per-position collateral
  -- the gap is not in THETA's collateral math, it is in gating QUANTITY on an
  ownership-recovery composite score that has no analog in this benchmark.
MANAGEMENT = Fixed monthly roll on a schedule, not a discretionary early-management rule
  -- out of scope for THETA's own roll-utility research (H-R-03 et al.), noted only for
  completeness.
FAILURE_MODE = None documented in the available secondary sources for the index itself
  (it is a passive benchmark, not a live risk-managed program); its own literature
  concedes cash-secured put writing underperforms during sharp, sustained equity
  drawdowns, consistent with THETA's own standing "delta is not probability of profit"
  discipline.
THETA_COMPONENT = `ownership-contract.ts`'s `RecoveryQuality` component specifically
  (the one component the bootstrap audit identifies as the deadlock's proximate cause);
  `evidence-completeness-diagnostic.ts` (this wave's P5A) already exposes
  `ownershipNotEvaluatedCount`/per-component completeness as the measurable surface any
  future cold-start policy would need to move.
TESTABLE_HYPOTHESIS = "A bounded, bounded-loss, ownership-quality-still-required Paper
  entry tier can use a collateral-capacity sizing rule (independent of RecoveryQuality)
  for candidates where LiquidityQuality/StructuralQuality/TailQuality/EventAdjustment are
  all KNOWN and favorable, without requiring prior recovery history, while
  RecoveryQuality itself remains reported as UNKNOWN (never defaulted to a fabricated
  neutral value)."
EXPERIMENT_PLAN = Would require a versioned cold-start ownership-composition CONTRACT
  change (e.g. a documented `RecoveryQuality: UNKNOWN -> treated as NOT_YET_APPLICABLE
  rather than veto, for the first N chains only, capped by a bounded Paper-only
  exploratory tier`) -- this is exactly the kind of policy decision the bootstrap audit
  says requires an explicit versioned contract, not something this research record
  activates on its own.
VALIDATION_REQUIREMENT = Any such contract change must be proposed by Codex (owner of
  `ownership-contract.ts`/the Python `ownership_v0` model) and requires the standing
  ablation protocol (BASELINE = current AND-gate composition vs. BASELINE + bounded
  cold-start treatment, all else held constant) before promotion beyond Paper.
STATUS = REFERENCE
  (a real, sourced disanalogy worth Codex's attention alongside the bootstrap audit --
  not ADOPT/ADAPT, since it does not hand over a ready-to-implement formula, and the
  audit itself already correctly declines to activate any fix without a versioned policy)
```

### DNA-COLD-02: Kelly / VIX-regime position sizing for systematic put-writing (arXiv 2508.16598)

```
SOURCE_ID = DNA-COLD-02
SOURCE = "Sizing the Risk: Kelly, VIX, and Hybrid Approaches in Put-Writing" (arXiv
  2508.16598, posted August 2026, analyzes data through 2024)
SOURCE_TYPE = Preprint (arXiv) -- not yet peer-reviewed at time of this record; treated
  per the directive's hierarchy as lower-confidence than the Cboe methodology above, and
  explicitly flagged as such.
EVIDENCE_LEVEL = LOW-MEDIUM. This session's WebFetch could only retrieve the abstract,
  not the full paper body -- the specific Kelly/VIX formulas, exact backtest statistics,
  and any cold-start-specific guidance are NOT verified here and must not be treated as
  confirmed until the full paper is read. This is stated explicitly rather than
  interpolated from the abstract's plain-language summary.

VERIFIED_FACT (from the abstract only) = The paper evaluates three position-sizing
  approaches for systematic S&P 500 put-writing -- Kelly criterion, VIX-based volatility
  regime scaling, and a hybrid of the two -- and reports the hybrid method "consistently
  balances return generation with robust drawdown control," with ultra-short-dated,
  far-out-of-the-money options showing superior risk-adjusted returns under low-volatility
  regimes such as 2024.
SOURCE_CLAIM = Regime-conditioned (VIX-based) sizing outperforms a fixed-fraction
  approach for this strategy family.
INTERPRETATION = This is directionally consistent with (but does not prove) an
  alternative cold-start treatment: size a new program's exposure from an EXTERNAL,
  market-observable regime signal (e.g. VIX level) rather than from the program's OWN
  trade history, which is exactly what a genuinely cold-start-safe sizing rule would need
  -- the account has zero prior chains, but the MARKET has a continuously observable
  volatility regime. This does not resolve THETA's specific `RecoveryQuality` deadlock
  (that component is about assignment-recovery duration, not volatility regime), but it
  is the closest sourced evidence this pass found for "a legitimate systematic
  put-writing sizing rule need not depend on the strategy's own realized track record."
ECONOMIC_MECHANISM = Regime-conditioned (not history-conditioned) capital allocation.
APPLICABLE_STATE = Future sizing-policy research only, IF a cold-start contract revision
  is ever pursued -- not applicable to THETA's current fixed structural sizing, and not
  a request to adopt Kelly sizing now (directive section 43 forbids adopting famous
  numbers/formulas as Production truth without the ablation protocol).
NON_APPLICABLE_STATE = Cannot be cited as proof of any specific numeric sizing formula
  until the full paper is read and independently reproduced -- EVIDENCE_LEVEL is
  explicitly LOW-MEDIUM for exactly this reason.
DATA_REQUIRED = VIX level (or an equivalent volatility-regime proxy) at decision time --
  THETA's existing `volatility-acceleration.ts`/`volatility-risk-premium.ts` research
  modules already carry realized/implied vol context that could feed a future regime
  classifier; no new provider would be required to test the concept in research only.
POSITION_SIZE_LOGIC = Not extracted (abstract only) -- would require the full paper
  before any formula could be honestly recorded.
MANAGEMENT = Not extracted (abstract only).
FAILURE_MODE = Not extracted (abstract only); Kelly-family sizing is well known in the
  broader literature to be sensitive to misestimated edge/variance inputs, which the
  directive's "no thresholds from tiny sample" and "no calibration without data" rules
  already guard against for THETA generally.
THETA_COMPONENT = None wired -- pure future-research reference.
TESTABLE_HYPOTHESIS = "A volatility-regime-conditioned sizing multiplier, applied only to
  a bounded cold-start Paper tier, produces less erratic capital-days utilization than a
  fixed-fraction or all-or-nothing (current UNKNOWN-blocks-everything) sizing rule."
EXPERIMENT_PLAN = Read the full paper before any further action; if it holds up, define
  a versioned research experiment through the canonical experiment registry (never a new
  parallel one) comparing current sizing against a VIX-regime-scaled variant on
  synthetic/replay data only, with an explicit note that synthetic data may validate
  math/types but never establish profitability (directive section 51).
VALIDATION_REQUIREMENT = Full paper read + independent formula verification before
  ADOPT/ADAPT; currently REFERENCE-only due to LOW-MEDIUM evidence level.
STATUS = REFERENCE
```

Sources for this section:
- [Cboe PutWrite Indices Methodology](https://cdn.cboe.com/api/global/us_indices/governance/Cboe_PutWrite_Indices_Methodology.pdf)
- [CBOE S&P 500 PutWrite Index - Wikipedia](https://en.wikipedia.org/wiki/CBOE_S&P_500_PutWrite_Index)
- [The Cash-secured PutWrite Strategy and Performance of Related Benchmark Indexes](https://www.pm-research.com/content/iijaltinv/11/4/43)
- [Sizing the Risk: Kelly, VIX, and Hybrid Approaches in Put-Writing (arXiv 2508.16598)](https://arxiv.org/pdf/2508.16598)

### M receipt

```
TRADER_DNA_GAPS_TARGETED = COLD_START_BOOTSTRAP_DEADLOCK (Codex audit c3f3579), ownership
  willingness vs. sizing decoupling
TRADER_DNA_RECORDS_ADDED = 2 (DNA-COLD-01, DNA-COLD-02)
TRADER_SOURCES_REVIEWED = 4 (Cboe methodology, Wikipedia summary, PM Research journal
  citation, arXiv preprint abstract)
METHODS_ADOPTED = 0
METHODS_ADAPTED = 0
METHODS_REFERENCED = 2 (both records above)
METHODS_REJECTED = 0
NO_RUNTIME_CHANGE = YES -- both records are REFERENCE-status research only; no
  ownership-contract.ts, aegis-contract.ts, or sizing code was touched by this section.
NO_FABRICATED_FORMULA = YES -- DNA-COLD-02 explicitly declines to record a specific
  sizing formula because the full paper was not accessible this pass.
```

