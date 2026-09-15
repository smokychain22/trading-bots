# THETA Flow, GEX, Volatility-Surface Decision Research + Empirical Policy Design

Author: Claude (research lane). Closes the P2C directive's research-depth
program. `CURRENT_MAIN_SHA_AT_START`: `3855846e093d23b6aa8cb1f5956ef7217d850909`
(recorded only -- Codex working on outcome-resolution infrastructure in
parallel, not audited this pass).

## 0. Corrected data-status terminology (section 1)

`DATASET_ABSENT` is retired as this engagement's blanket term. As of this
pass, the precise, per-item blockers are:

- **`RESOLVED_WHOLE_CHAIN_LABELS_INSUFFICIENT`**: the whole-chain accounting
  machinery (`paper_cohort_analytics.py`, R8) and the P2B option-chain
  decision-evidence schema are both ENGINEERING_COMPLETE; zero real Paper
  cycles have resolved into a whole-chain outcome yet.
- **`RESOLVED_MANAGEMENT_LABELS_INSUFFICIENT`**: `management_action_frontier`
  persistence and the P1 dispatch/leg-compiler machinery are
  ENGINEERING_COMPLETE; zero real management decisions have been made by an
  active policy provider (none is wired -- confirmed unchanged in the P2B
  audit) so there is nothing yet to label.
- **`RESOLVED_COUNTERFACTUAL_LABELS_INSUFFICIENT`**: P2B's
  `counterfactualLabelContract` structurally exists and is schema-validated
  to always be `BLOCKED_ON_FUTURE_OUTCOME`; no resolution engine has run
  against it yet (that is the outcome-resolution work Codex is doing in
  parallel to this pass).
- **`EFFECTIVE_N_INSUFFICIENT`**: even once resolution begins, `effective_n`
  (independent-cluster count, per `research_targets.py`'s existing
  discipline) will start at zero and grow slowly -- this is a sample-size
  blocker distinct from "no machinery exists."

## 1. Formal WAIT research (sections 3-4) -- CLOSED this pass

New module: `bots/theta/quant/research/wait_diagnostics_research.py` (20
tests, all passing). `classify_wait()` maps a per-cycle funnel -- mirroring
`canonical-strategy-frontier.ts`'s own candidate/branch counters, not a
parallel invented shape -- into the ten named categories
(`HEALTHY_WAIT`/`NO_OPPORTUNITY`/`RISK_WAIT`/`DATA_WAIT`/`QUOTE_WAIT`/
`EVENT_WAIT`/`LIQUIDITY_WAIT`/`PORTFOLIO_WAIT`/`OVERSTRICT_POLICY_WAIT`/
`POSSIBLE_LOGIC_PARALYSIS`), **priority-ordered** so a structural blocker
always outranks the two softer categories -- a cycle that was liquidity-
blocked on every candidate is never mislabeled "overstrict policy" merely
because a soft-reject count also happened to be nonzero.

**False-reject research (section 4)**: `evaluate_false_reject()` explicitly
rejects the directive's own named anti-pattern ("future winner = false
reject"). A rejection is FALSE_REJECT only when (a) the would-have-been
outcome, tail-exposure, and fill-feasibility are ALL known (never guessed;
a censored/unresolved case is honestly `UNKNOWN`), (b) the fill was
genuinely modeled as feasible (never assumed from a bare reference price),
and (c) the net outcome clears a caller-justified `minimum_tail_adjusted_edge`
-- profitability alone never qualifies. This directly implements the
counterfactual-caution discipline section 6 (below) requires: a rejected
candidate's "would-have-been" fill needs a `MODELED_EXECUTION_OUTCOME`, not
a bare `MARKET_OUTCOME` reference.

## 2. Flow deep dive (sections 5-7) -- the major gap, now substantively addressed

### New real repo: `LuxAlgo/whale-options` (MIT, deep-read this pass)

REPO: `LuxAlgo/whale-options`. LICENSE: MIT. FILES_READ:
`packages/core/src/classify/aggressor.ts`,
`packages/core/src/classify/classifier.ts` (both full).

This is the single strongest Flow-specific reference found across this
entire engagement -- a real, mature, actively-maintained (pushed the same
week as this research pass) aggressor-classification and sweep/block/split
detection engine, MIT-licensed.

**PROBLEM**: classifies a raw options print tape into aggressor side
(buy/sell/mid/unknown) and structural events (sweep/block/split-ladder/
cancel), from real NBBO-relative execution data.

**Aggressor classification (`aggressor.ts`, read in full)**: price >= ask
(within epsilon) => `buy`; price <= bid => `sell`; strictly between =>
`mid`; **no NBBO on the print, a stale NBBO (caller-configured
`nbboStaleMs` bound), or a sale condition that voids trustworthy
classification (`policy.forceUnknownSide`) => `unknown` -- never guessed**.
`throughQuote` distinguishes AT the quote (at-ask/at-bid) from THROUGH it
(above-ask/below-bid) -- this is the exact same five/six-way vocabulary
(`Inside`/`At Ask`/`Above Ask`/`At Bid`/`Below Bid`/`Mid`) this branch's own
`optionomics_flow_event.py` (`ExecutionClassification`) already models
ahead of any observed real payload -- independent convergence confirming
the existing enum shape is correct, not something to redesign.

**The staleness-bound pattern is directly reusable, not just parallel**:
`age > nbboStaleMs || age < -1000` voids the classification -- exactly the
same caller-justified, non-hardcoded bounded-latency discipline this
branch's own `optionomics_flow_chain_fusion.py` already applies
(`max_event_to_chain_latency_seconds`). **New finding worth flagging**:
`forceUnknownSide` for specific SALE CONDITIONS (not just a stale/missing
NBBO) is a more granular UNKNOWN-safety check than THETA's current flow
modules have -- if/when a real Optionomics print payload ever arrives with
sale-condition codes, THETA's own classifier should check for known
untrustworthy-condition codes, not just NBBO presence/freshness.

**Sweep/block/split classification (`classifier.ts`, read in full)**:
- **Sweep**: same contract, same aggressor side, >=2 prints across **>=2
  EXCHANGES** within a rolling window (default 500ms, config-versioned, not
  hardcoded in the classifier itself). Multi-exchange simultaneity is the
  DEFINING feature, not merely "fast."
- **Block**: single print >= a **DYNAMIC, liquidity-bucketed size
  threshold** (a percentile of that bucket's OWN trade-size distribution,
  floored) -- direct quote, worth citing verbatim for THETA's own future
  block-detection design: *"fixed thresholds are how flow tools end up
  flagging noise on illiquid names."* This is a concrete, actionable finding
  distinct from anything found before: a block-size cutoff should never be
  one global dollar figure, it should be relative to the specific
  underlying/liquidity bucket's own recent trade-size distribution.
- **Split/ladder**: >=N same-contract same-side clips spread over MINUTES
  without multi-exchange simultaneity -- "the iceberg worked over time," a
  genuinely distinct mechanism from a sweep, not a slower version of one.
- **Event-time driven, never wall-clock**: *"windows open and close on
  print timestamps, never the wall clock -- which is what makes the
  classifier a pure function of the tape."* This is EXACTLY the
  deterministic-replay discipline THETA's own research modules already
  require -- independent convergence, not a new requirement.
- **Cancels void a matching leg still in an open window; already-emitted
  events are never retracted** -- a real, precise, replay-safe design for
  late-arriving corrections, directly relevant to this engagement's
  standing "duplicate/late/out-of-order event" concerns.

### Flow pipeline restated (section 5's requested shape, evidence-grounded)

```
RAW PRINT (schema unconfirmed for Optionomics; LuxAlgo's tape shape used as
  a REFERENCE, not assumed to match)
-> EXACT CONTRACT (optionomics_flow_event.py's exact-match contract identity)
-> TIMESTAMP (event-time, never wall-clock -- LuxAlgo's own discipline)
-> BID/ASK RELATIVE EXECUTION (aggressor.ts's quote-rule classification,
   matching THETA's existing ExecutionClassification enum)
-> STRUCTURE (sweep: multi-exchange rolling window; block: liquidity-
   bucketed dynamic threshold; split: minutes-scale same-side clips)
-> OPENING/CLOSING STATE (LuxAlgo's own tape has no opening/closing field
   either -- this remains UNKNOWN for both systems, not a THETA gap)
-> PREMIUM / WINDOW / CONCENTRATION / PERSISTENCE / ACCELERATION / REVERSAL
   (this pass's new optionomics_flow_temporal_research.py, scoped to the
   CONFIRMED-populated aggregate net-flow series -- see section below)
-> OPTION-STRATEGY FEATURE (feature-destination gating, existing
   optionomics-feature-destinations.ts)
```

**"Never CALL=bullish, PUT=bearish" -- explicitly re-confirmed, not just
asserted**: neither `aggressor.ts` nor `classifier.ts` contains any
call/put-to-direction mapping at all. Direction is not in this repo's
vocabulary -- it classifies EXECUTION MECHANICS (who was aggressive, how
large, how fast), never trader intent or market direction. This is the
correct scope boundary, matching THETA's own standing discipline.

### Flow acceleration/deceleration/reversal/persistence -- CLOSED this pass

New module: `bots/theta/quant/research/optionomics_flow_temporal_research.py`
(15 tests, all passing). Deliberately scoped to the aggregate net-flow
series (the one Optionomics flow surface confirmed populated in real
authenticated runs, per a prior session's capability-census review) --
per-print flow classification/acceleration remains a separate, still
schema-unknown concern (`optionomics_flow_event.py`). `derive_flow_delta()`
mirrors `optionomics-temporal-features.ts`'s exact discipline (same-
underlying, same-window-label, strict causal ordering, caller-supplied
bounded gap, UNKNOWN/INVALID propagation). `classify_flow_direction()`
requires exactly THREE observations (two deltas, since a direction judgment
needs a delta-of-deltas, not a single rate) and a caller-supplied
`persistence_tolerance` -- no hardcoded default anywhere.

### Additional Flow repos found, not deep-read this pass (named honestly)

`pk-ux/options-screener`, `ghamphy/options-screener`,
`lds051332/OptionTradingAgent` -- surfaced in a prior session's search,
existence-verified only, not read this pass (time budget went to
`LuxAlgo/whale-options`, the clearly highest-value find of the search).

## 3. GEX deep dive (sections 8-10) -- spot-scan formalized this pass

### Formula/convention comparison, consolidated from this and prior sessions

| Source | Gamma formula basis | Sign convention | OI/volume | Multiplier/scaling | Flip method |
|---|---|---|---|---|---|
| Optionomics (as consumed) | Provider-reported scalar, methodology undocumented | Explicitly UNVERIFIED (THETA's own discipline, unchanged) | Unknown whether OI or volume-weighted | Unknown | Provider-reported `gammaFlipStrike`, methodology undocumented |
| `sgdividends/spx-dealer-gamma` (prior session, method cited, no code adopted) | Black-Scholes gamma per contract | Explicit, documented modeling ASSUMPTION (call OI positive, put OI negative) -- stated as assumption, not fact | OI only (`if oi<=0: skip`), volume not used for GEX itself | `gamma * OI * multiplier * spot^2 * 0.01` (dollar-per-1%-move convention) | Spot-scan: reprice BS gamma across a hypothetical spot range, find signed-exposure zero crossing |
| `gex-terminal` (prior session) | Black-76 (futures) vs. Black-Scholes (equity/index) BEFORE aggregation -- explicit convention SPLIT by instrument type | Explicit PROXY, never claimed as observed dealer inventory | OI, raw volume, and "directionalized volume" kept as THREE SEPARATE models, never blended | Not fully detailed in the prior excerpt | "documented strike-profile flip," methodology not re-read this pass |
| THETA (spot-scan, new this pass) | `bs_gamma()` (new function, `bs_reference.py`) | Explicit `GexSignConvention` dataclass, `verified: bool` field -- never silently assumed true | OI-weighted, matching the `spx-dealer-gamma` convention (volume not used) | Same dollar-per-1%-move convention, cited not independently re-derived | Linear-interpolation zero-crossing across a caller-supplied grid; reports `NO_CROSSING`/`MULTIPLE_CROSSINGS` honestly rather than forcing one answer |

**Documented disagreement, not resolved and not papered over**: no two of
these four sources are confirmed to use the SAME convention. THETA's own
spot-scan uses the `spx-dealer-gamma`-cited convention (OI-weighted,
dollar-per-1%-move) as its documented default, but this is explicitly one
CHOICE among the several found, not proven correct.

### Spot-scan gamma flip -- formalized this pass

New module: `bots/theta/quant/research/gex_spot_scan_research.py` (9 tests)
plus a new `bs_gamma()` function added to the canonical `bs_reference.py`
(5 new tests). `run_spot_scan()`:
- Requires a caller-supplied, sorted, positive spot grid -- never invents a
  band width or step count.
- Requires a caller-supplied `minimum_usable_contracts` -- reports
  `SPARSE_CHAIN` rather than a false-confident crossing when too few
  contracts have usable IV/OI.
- Excludes (never zero-fills) contracts missing IV/OI, and reports the
  excluded count separately from the usable count.
- Reports `NO_CROSSING` and `MULTIPLE_CROSSINGS` as FIRST-CLASS outcomes,
  never silently reducing multiple crossings to "the first one" or
  fabricating a crossing where none exists.
- Carries an explicit `GexSignConvention` with a `verified: bool` field
  that defaults to caller-supplied (this module never marks its own
  assumption verified).

**Real test finding worth noting**: a call and a put at the IDENTICAL
strike have IDENTICAL Black-Scholes gamma at every spot (proven directly,
`test_bs_gamma.py`) -- so a same-strike book's signed-exposure SIGN is
constant across the whole spot grid regardless of the OI mix, and can never
produce a crossing. A genuine crossing requires OI concentrated at
DIFFERENT strikes (since gamma peaks near each contract's own strike,
weighting shifts across the grid) -- confirmed by a second test
constructing exactly that case. This is a real, useful structural insight
about when a spot-scan CAN vs. cannot find a flip, not previously
documented anywhere in this engagement.

**Provider vs. THETA-derived, never merged**: matches the dual-provenance
discipline already verified in `options-chain-decision-intelligence.ts`'s
`ChainScopedAttachment` (`PROVIDER_FACT` vs. `THETA_DERIVED`, proven by a
real test retaining deliberately-conflicting values). This module's own
result is meant to populate a FUTURE `THETA_DERIVED` GEX/gamma-flip
attachment, never overwriting or averaging with Optionomics' own
provider-reported value.

### GEX as a decision feature -- hypotheses (section 10, testable, not asserted)

- Positive vs. negative gamma regime (per THETA's own spot-scan OR the
  provider's reported flip, kept distinct) conditioning `THETA_CONVENTIONAL`
  entry attractiveness -- already partially covered by `H-Q-03`'s
  deterioration-signal list (gamma-regime shift is one named trigger).
- Distance-to-gamma-flip and distance-to-call/put-wall as continuous
  features, not just a binary regime flag -- not yet a registered
  hypothesis; flagged as a follow-up, not fabricated here.
- Candidate strike relative to exposure concentration (is the candidate
  strike itself near a wall?) -- same status, follow-up flagged.

**GEX is never a direction oracle** -- no hypothesis anywhere in this
engagement's registry, nor in either external repo cited, treats a GEX
sign as a forecast of price direction; it is consistently treated as a
DEALER-HEDGING-FLOW regime context only.

## 4. DEX / Vanna / Charm (section 11)

Unchanged from prior sessions' findings: Optionomics' own `totalDeltaExposure`
(DEX) and the confirmed Vanna/Charm exposure heatmaps are consumed as
provider-reported scalars/grids with `PROVIDER_REPORTED_UNVERIFIED` units
and `PROVIDER_DEFINITION_UNVERIFIED` sign convention throughout
(`optionomics_exposure_heatmap.py`, verified COMPLETE and unchanged). No
"Vanna positive therefore X" rule exists anywhere, and none is proposed
here. `optionomics-temporal-features.ts`'s `EXPOSURE` family already covers
temporal deltas for these fields at the scalar level (verified COMPLETE two
sessions ago) -- no new work needed this pass.

## 5. Volatility surface (sections 12-13)

Unchanged from prior sessions: `volatility_surface_research.py`'s SVI fit
with deferred arbitrage diagnostics; the exact butterfly (`d^2w/dk^2 >= 0`)
and calendar (`w(k,T1) <= w(k,T2)` for T1<T2) arbitrage definitions already
confirmed via `FlashAlpha-lab/volatility-surface-python`'s
`arbitrage_detection_butterfly_calendar.py` (prior session). Sparse-chain
behavior reference point:
`dominickkubica/options-scanner`'s `THIN_SURFACE_SOLVE_RATE = 0.5` (prior
session, cited as a reference number, not adopted as THETA's own).
Surface-to-strategy hypotheses (section 13's examples -- rich downside skew
richening CSP premium at higher tail cost; steep put skew favoring Defined
Risk; term backwardation as an event/stress signal; post-event vol
collapse changing premium-selling context) are already formalized as
`H-Q-05`/`H-Q-06` (VRP collapse, skew steepening) and `H-Q-03` (regime
deterioration including event proximity) -- no new entries needed, these
ARE the surface-to-strategy hypotheses this section asks for, already
registered.

## 6. VRP deep dive (section 14)

Unchanged from prior sessions: `iv_realized_vol_research.py`'s 4 RV
estimators (close-to-close, Parkinson, Garman-Klass, Rogers-Satchell) with
explicit horizon-alignment requirements (`compute_vrp` requires matching
horizons, never compares a 30D IV against an unrelated realized window).
`H-Q-01`/`H-Q-02` (VRP-conditioned ownership screening) and `H-Q-05`
(contract-level VRP collapse switching) already the registered hypotheses.
Public evidence: `cboe_put_index`, `carr_wu_2009_variance_risk_premia`
already cite the strongest available public evidence connecting VRP to
put-writing returns (prior sessions). No new empirical connection found
this pass -- would require real data, not further literature search.

## 7. Event/earnings state (section 15)

`EVENT_STATE_CHANGE` remains a genuinely open gap (named two sessions ago,
not closed this pass -- `optionomics-temporal-features.ts`'s families are
numeric-delta-shaped; an event-state transition, e.g. `CLEAR -> APPROACHING
-> CROSSING -> PASSED`, is categorical, needing its own small state-machine-
style detector, not the same `deriveOptionomicsTemporalFeatures` function).
Not built this pass given time budget -- named honestly as still open,
consistent with the directive's own instruction not to leave gaps silently
unaddressed.

## 8. Management outcome labeling methodology (section 16)

Multi-dimensional, never one-dimensional, per the directive's own
instruction. For winner management (CLOSE_NOW vs. HOLD), the label vector
should carry: future net after-cost P&L, `PROFIT_GIVEBACK`/`GIVEBACK_RATIO`
(this branch's own `profit_preservation_research.py`), MFE (maximum
favorable excursion) and MAE (maximum adverse excursion) over the
observation horizon, capital-days, and a tail-risk estimate at the decision
point -- never collapsed to a single scalar "best action = highest realized
P&L," which the directive explicitly forbids and which
`profit_preservation_research.py`'s own `continuation_value_requirements()`
already refuses to fabricate. For losers (HOLD/CLOSE/ROLL/ASSIGN), the same
vector applies, plus `RollUtility` (existing, `H-R-03`) for the ROLL
alternative specifically. For stock (WAIT/SELL/CC), `H-A-04`'s existing
three-step leakage-guarded bound-selection methodology is the template.

## 9. Counterfactual caution (section 17)

Formalized in `wait_diagnostics_research.py`'s own `evaluate_false_reject`
docstring (see section 1 above): the directive's own three named label
types are adopted explicitly --

- **`MARKET_OUTCOME`**: a bare reference price (e.g. a neighboring
  contract's later midpoint) -- NEVER sufficient proof a fill was
  achievable on its own.
- **`MODELED_EXECUTION_OUTCOME`**: a spread-aware, liquidity-aware fill
  ESTIMATE -- what `execution_would_have_been_feasible` in
  `RejectedCandidateOutcome` must actually be derived from.
- **`BROKER_ACTUAL_OUTCOME`**: a real confirmed fill -- the only outcome
  that requires no modeling assumption at all, and the one this whole
  engagement is ultimately waiting on real Paper cycles to produce.

This is not yet wired into any Codex-owned label-engine code (that is
Codex's parallel work) -- this section provides the vocabulary and the
caution, not an implementation.

## 10. Profit-giveback model deepening (section 18)

`profit_preservation_research.py` (prior session) already computes absolute
giveback and giveback-as-%-of-peak (`GIVEBACK_RATIO`). The directive's
additional framings (giveback relative to remaining premium, to Delta/Gamma
risk, to capital-day opportunity) are each a DIFFERENT normalization of the
same `PROFIT_GIVEBACK` numerator -- e.g. `GIVEBACK_RELATIVE_TO_REMAINING_REWARD
= profit_giveback / remaining_reward` (both terms already computed by the
existing module) is a one-line composition, not a new primitive; not added
as new module code this pass to avoid proliferating near-duplicate
formulas ahead of knowing which normalization the eventual policy provider
actually needs. No fixed trailing-stop is promoted anywhere in this
document.

## 11. Management/backtest-infrastructure repos (sections 20-22)

Not deep-read this pass beyond what prior sessions already established
(`goldspanlabs/optopsy`'s slippage-model taxonomy and delta-targeting-range
API shape; `alpacahq/options-wheel`'s baseline-simplicity comparison;
`QuantConnect/Lean` referenced but not re-read). Time budget this pass went
to the Flow (`LuxAlgo/whale-options`) and GEX (spot-scan formalization)
work instead, per this document's own judgment that those were the more
concrete, currently-unaddressed gaps. Named honestly as not attempted this
round rather than silently claimed complete.

## 12. Fill models / TCA / sample independence (sections 22-24)

Unchanged from prior sessions: `execution_simulator.py`'s existing
bid/ask-aware fill discipline; `transaction-cost-analysis.ts` (Codex-owned,
verified present in file listings, not re-read this pass). Optopsy's own
four-way slippage-model taxonomy (mid/spread/liquidity-based/per-leg,
prior session finding) remains the reference vocabulary for a future
multi-model TCA sensitivity design, per that prior session's own
recommendation -- not re-derived here. Sample independence: existing
`effective_sample_size` discipline (`dataset_readiness.py`,
`correlation_metrics.py`) already groups by explicit dependence keys; no
new methodology needed, this section restates rather than extends it.

## 13. Policy targets, calibration, switching labels (sections 25-27)

**Multi-objective label, not single-scalar**: net outcome, tail outcome,
capital-days, drawdown/giveback, assignment consequence, and transaction
cost together -- a Pareto or utility-learning framing (rather than one
argmax) is the natural fit, mirroring `canonical-strategy-frontier.ts`'s
own already-verified Pareto-dominance approach (`dominatesExpiration` in
`options-chain-decision-intelligence.ts`) rather than inventing a new
comparison paradigm. **Calibration**: any future model output must report
Brier/log-loss/ECE/calibration-slope-intercept per cohort (existing
`TRD MODEL-003` requirement, unchanged) -- Delta must never stand in for a
calibrated probability, exactly as `contractSelectionReceipt`'s own
`DELTA_IS_NOT_WIN_PROBABILITY` reason code already encodes structurally.
**Switching labels**: `STAY`/`SWITCH`/`WAIT`, charged against real exit
cost + new entry cost + capital churn + foregone theta -- this is precisely
what `H-Q-04` (switching-cost measurement discipline, RETAIN) already
requires; no new label design needed, `H-Q-04` already specifies it.

## 14. Future policy-provider spec (section 28) -- design only, no Production code

Restating and slightly extending the interface already discovered (P1
audit) at `autonomous-runtime.ts`'s `ManagementPolicyEvidenceProvider`:

```
INPUTS a real provider needs:
  - PIT ManagementInputState (existing)
  - OptionsChainDecisionEvidence for the same fusion snapshot (P2B, existing)
  - Optionomics attachments already scoped CONTRACT/STRIKE/EXPIRATION/CHAIN (P2B, existing)
  - Portfolio/AEGIS state (existing)
  - The full candidate action set for the current lifecycle state (existing, actionSets)

OUTPUTS a real provider must supply (ManagementPolicyEvidence, already the
  exact shape management-action-frontier.ts validates against):
  - complete comparable utilities for every FEASIBLE action (no silent gaps --
    the existing MANAGEMENT_POLICY_UTILITY_UNKNOWN rejection already enforces this)
  - an uncertainty estimate per action (field already exists, currently
    always null from every caller -- a real provider must populate it)
  - model/policy version string (existing field)
  - a reproducible evidence hash (existing, hashJson)
```

No Production code is proposed or implemented here -- this is confirmation
that the P1/P2B schema is already shaped correctly to receive a real
provider, restated for this directive's own explicit ask.

## 15. Promotion standard (section 29)

Unchanged, restated for completeness: purged walk-forward + embargo +
untouched final OOS (`walk_forward.py`, COMPLETE engineering per
`phase_status.py`); effective N (dependence-grouped, `dataset_readiness.py`);
after-cost EV/PF/DD/CVaR/capital-efficiency (`SLICE_METRICS`, existing);
calibration (Brier/ECE, `TRD MODEL-003`); DSR/PBO (`selection_bias.py`,
COMPLETE); regime stability (cross-regime comparison, existing framework);
Paper validation (`paper_validation_analytics.py`, COMPLETE). No testimonial
promotion anywhere in this registry -- every trader-derived hypothesis in
`hypotheses.json` remains `evidence_class: D_EXPERT_DNA` or cites a real
public source with an explicit tier, never asserted as proven.

## Receipt

```
CURRENT_MAIN_SHA_AT_START: 3855846e093d23b6aa8cb1f5956ef7217d850909 (recorded only)
CURRENT_CLAUDE_SHA: (see final commit on claude/theta-r1-real-state)

DATASET_STATUS_CORRECTED = YES (see section 0 above)

WAIT_RESEARCH = COMPLETE (closed this pass -- wait_diagnostics_research.py, 20 tests)
FALSE_REJECT_RESEARCH = COMPLETE (evaluate_false_reject, tail-adjusted-edge +
  feasibility-required discipline)

FLOW_RESEARCH = COMPLETE (this pass's depth -- LuxAlgo/whale-options deep-read,
  pipeline restated with real evidence)
FLOW_ACCELERATION / FLOW_REVERSAL / FLOW_PERSISTENCE = COMPLETE (closed this
  pass -- optionomics_flow_temporal_research.py, 15 tests, scoped to the
  confirmed-populated aggregate series)
FLOW_REPOS_DEEP_STUDIED = LuxAlgo/whale-options (aggressor.ts, classifier.ts, full)

GEX_RESEARCH = COMPLETE (this pass's depth -- 4-source convention comparison table)
SPOT_SCAN_GAMMA_FLIP = COMPLETE (closed this pass -- gex_spot_scan_research.py +
  new bs_gamma(), 14 tests)
GEX_DECISION_HYPOTHESES = GAPS (distance-to-flip/wall as continuous features
  not yet registered as new hypotheses; H-Q-03 already covers the regime-shift
  direction)

DEX_RESEARCH / VANNA_RESEARCH / CHARM_RESEARCH = NO_CHANGE_REQUIRED (unchanged
  from prior sessions' COMPLETE findings)

VOL_SURFACE_RESEARCH = NO_CHANGE_REQUIRED (unchanged; surface-to-strategy
  hypotheses already registered as H-Q-03/H-Q-05/H-Q-06)
VRP_RESEARCH = NO_CHANGE_REQUIRED (unchanged; H-Q-01/H-Q-02/H-Q-05 already
  the registered hypotheses)
EVENT_STATE_RESEARCH = GAPS (EVENT_STATE_CHANGE still genuinely open, named
  honestly, not closed this pass)

MANAGEMENT_LABEL_RESEARCH = COMPLETE (this pass's depth -- multi-dimensional
  vector specified, never one-dimensional)
COUNTERFACTUAL_RESEARCH = COMPLETE (MARKET_OUTCOME / MODELED_EXECUTION_OUTCOME /
  BROKER_ACTUAL_OUTCOME vocabulary adopted, wired into evaluate_false_reject's
  own docstring discipline)

PROFIT_GIVEBACK_RESEARCH = COMPLETE (this pass's depth -- additional
  normalizations specified as compositions of existing primitives, not built
  as new code to avoid formula proliferation ahead of need)

TRADER_METHOD_FINDINGS = unchanged from prior sessions (not re-deepened this pass)

MANAGEMENT_REPOS_DEEP_STUDIED = none new this pass (prior sessions' findings stand)
BACKTEST_REPOS_DEEP_STUDIED = none new this pass

FILL_MODEL_RESEARCH = NO_CHANGE_REQUIRED (Optopsy's 4-way taxonomy remains the
  reference, prior session)
TCA_RESEARCH = NO_CHANGE_REQUIRED (unchanged)

SAMPLE_INDEPENDENCE_RESEARCH = NO_CHANGE_REQUIRED (existing effective_sample_size
  discipline already covers this)

POLICY_TARGET_DESIGN = COMPLETE (multi-objective/Pareto framing specified,
  mirroring canonical-strategy-frontier.ts's own existing Pareto approach)
CALIBRATION_RESEARCH = NO_CHANGE_REQUIRED (existing TRD MODEL-003 standard,
  restated)

STRATEGY_SWITCH_LABELS = NO_CHANGE_REQUIRED (H-Q-04 already specifies this)

FUTURE_POLICY_PROVIDER_SPEC = COMPLETE (design-only, confirms existing P1/P2B
  schema already shaped correctly; no Production code proposed)

PROMOTION_STANDARD = NO_CHANGE_REQUIRED (unchanged, restated for completeness)

NEW_EDGE_HYPOTHESES = 0 this pass (prior sessions: H-Q-01 through H-Q-06)
NEW_WAIT_HYPOTHESES = 10 categories formalized as a classification scheme
  (wait_diagnostics_research.py), not registered as hypotheses.json trading
  hypotheses since they are a DIAGNOSTIC taxonomy, not a strategy claim
NEW_MANAGEMENT_HYPOTHESES = 0 new hypotheses.json entries this pass (existing
  H-R-01/H-R-02/H-R-03/H-A-02/H-A-04 already cover the management-label
  methodology this pass formalizes around)

70_80_WR_STATUS = NOT_PROVEN
40_PLUS_RETURN_STATUS = ASPIRATIONAL_NOT_TAKE_PROFIT

EMPIRICAL_BLOCKERS: RESOLVED_WHOLE_CHAIN_LABELS_INSUFFICIENT,
  RESOLVED_MANAGEMENT_LABELS_INSUFFICIENT, RESOLVED_COUNTERFACTUAL_LABELS_INSUFFICIENT,
  EFFECTIVE_N_INSUFFICIENT (see section 0)
PROVIDER_BLOCKERS: Optionomics production auth/current-data semantics, unchanged

RECOMMENDATIONS_FOR_CODEX: none required -- pure research pass. One design
  note offered (section 14): the ManagementPolicyEvidenceProvider interface's
  `uncertainty` field currently has no populating caller anywhere; worth
  keeping in mind for whenever a real provider is built, not urgent.

MAIN_PUSHED = NO
PRODUCTION_CHANGED = NO
BROKER_ORDERS_BY_CLAUDE = 0
LIVE_OWNER_AUTHORIZATION = NOT_GRANTED
LIVE_ELIGIBLE = NO
```
