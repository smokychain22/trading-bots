# THETA Model Registry

Durability artifact (see `PHASE2_MASTER_SPEC.md` for status). Records each model family
named in the Phase 2 contract: baseline, challenger, promotion target, features, label,
calibration requirement, promotion/failure criteria, data dependency, leakage guard.
**Deep-learning challengers are governed by one standing rule: challenger-only, never
promoted, unless simpler baselines are demonstrably inadequate AND the improvement
survives untouched OOS** — this is restated per-model below rather than assumed once.

## Ownership model

- **Baseline:** `models/ownership_v0.py` — transparent multiplicative product of five
  named components (see `FORMULA_REGISTRY.md`, `PHASE2_MASTER_SPEC.md` §3).
- **Challenger:** a fitted model (e.g. gradient-boosted trees over the same feature
  families) is a legitimate future challenger, but per `MODEL-001` (baseline-first)
  must first be beaten against v0 on untouched OOS, not adopted because it is more
  sophisticated.
- **Target:** replace or supplement individual components (most likely
  `TailQuality`/`RecoveryQuality`, which are explicitly proxy formulas today) once
  `severe_drawdown_spec.py`/`recovery_spec.py` have real fitted models behind them.
- **Features:** `research/data/feature_families.json` — liquidity, structural/trend,
  tail/drawdown, recovery-history, event-proximity families (see that file for exact
  `feature_family_id` values and `data_availability_status`).
- **Label:** none directly — `Ownability` is itself an input feature to downstream
  entry/management decisions, not a label predicted from data. A future challenger
  would instead be trained against the severe-drawdown and recovery labels below.
- **Calibration:** N/A for v0 (deterministic formula, not a probabilistic model). Any
  future fitted challenger must meet `shared_calibration_requirement`.
- **Promotion criteria:** untouched-OOS EV_net improvement over v0 with an interval
  excluding zero, no DD/ES regression, calibration acceptable, effect survives
  clustered-bootstrap/regime resampling.
- **Failure criteria:** no OOS improvement, or improvement only present when the final
  OOS split was used to select the challenger (ML-002 violation — automatic rejection).
- **Data dependency:** historical Alpaca bars (available), historical option
  chain/IV data (`UNCERTAIN_PENDING_ALPACA_ENTITLEMENT` per `feature_families.json`).
- **Leakage guard:** every component must be computed from data available strictly at
  or before the decision timestamp — v0 already respects this by construction (no
  component reads forward-looking fields); a future fitted challenger must be trained
  under the same purged walk-forward discipline as every other THETA model.

## Regime model

- **Baseline:** `models/regime_v0.py` — five independent axis classifiers
  (Trend/Volatility/Event/Liquidity/Stress) plus a confidence field, never collapsed
  into one scalar.
- **Challenger:** a probabilistic/soft regime model (continuous state probabilities
  rather than hard categorical classification) is a plausible future challenger —
  named explicitly in the "preserve useful method findings" list carried over from the
  Phase 4 method corpus (see `../phase4_method_corpus/METHOD_EXTRACTION_REGISTRY.md`).
- **Target:** improve cohort-conditioning precision for every archetype's hypothesis
  `state` field (all of which already reference these five axes qualitatively in
  `hypotheses.json`).
- **Features:** derived from `ret_*`, `rv*`, `drawdown`, event-distance, liquidity
  feature families.
- **Label:** none directly for v0 (rule-based classifier); a soft/probabilistic
  challenger would need its own definition of what it is calibrated against (e.g.
  forward realized volatility regime, forward drawdown regime) — not yet specified.
- **Calibration:** N/A for v0. Required for any soft/probabilistic challenger.
- **Promotion criteria:** demonstrated improvement in downstream hypothesis
  acceptance/rejection reliability (i.e. does conditioning on the soft regime model
  change which hypotheses would have been accepted/rejected in a way that itself
  survives OOS) — this is a two-level validation, harder than a typical model swap, and
  is SPECIFIED rather than reduced to a simpler criterion that would understate the
  difficulty.
- **Failure criteria:** no measurable improvement in downstream decision quality, or
  the soft model's own regime calls are themselves poorly calibrated.
- **Data dependency:** same as ownership model's structural/tail features.
- **Leakage guard:** regime state at decision time only; never computed using data from
  after the decision timestamp, including never using a "final" regime label that was
  itself determined with hindsight (e.g. labeling a period as CRISIS only after the
  full extent of a drawdown is known).

## Entry outcome model (THETA-Q)

- **Baseline:** `models/theta_q_baseline.py` — deterministic hard-veto + ownership
  product scoring, explicitly not a probability model (`EV_net` returned as `None`,
  never fabricated).
- **Challenger:** TRD §17's calibrated entry-outcome model — logistic/tree baseline
  first (MODEL-001), sequence models are TEST/challenger-only, never a first attempt.
- **Target:** produce a real `P(managed-episode outcome | candidate state)` that can
  feed a genuine `EV_net`, replacing the current `ev_net=None` placeholder.
- **Features:** the full feature set referenced by H-Q-01/H-Q-02 in
  `hypotheses.json`'s `feature_families_required`.
- **Label:** `entry_label` per `hypotheses.json`'s `label_type_enum` — managed-episode
  after-cost outcome under the fixed training policy/version, not simple expiry
  ITM/OTM (TRD §46).
- **Calibration:** full `shared_calibration_requirement` applies.
- **Promotion criteria:** beats `BQ-1`/`BQ-2`/`BQ-3` (see `benchmarks.json`) on
  untouched-OOS `EV_net` per H-Q-01/H-Q-02's acceptance criteria.
- **Failure criteria:** per H-Q-01/H-Q-02's rejection criteria verbatim.
- **Data dependency:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA` per
  `hypotheses.json` — contingent on option-chain historical entitlement resolving.
- **Leakage guard:** purged walk-forward, untouched final OOS never used for threshold
  selection (ML-002), point-in-time feature construction only.

## Assignment model

- **Baseline:** none implemented — current assignment reasoning is entirely
  architectural (H-A-01/02/03, RETAIN) rather than a fitted probability. The only proxy
  in code is `theta_h_baseline.py`'s `assignment_probability_proxy` diagnostic, which
  that module's own naming makes clear is a proxy, not a model.
- **Challenger:** a fitted `P(assignment | candidate state, DTE, moneyness)` model —
  not yet attempted.
- **Target:** feed the assignment decision (accept vs. mechanically close, per H-A-01)
  with a real probability rather than the current hard-veto/architectural-only
  reasoning.
- **Features:** `dte`, `log_moneyness`, `delta`, `ownership_acceptability`.
- **Label:** `assignment_label` — assignment event plus post-assignment
  downside/recovery path, never simply "assigned=loss" (TRD §46).
- **Calibration:** full requirement applies once a model exists.
- **Promotion/failure criteria:** per H-A-01's acceptance/rejection criteria.
- **Data dependency:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA`.
- **Leakage guard:** same purged walk-forward discipline; must not use post-assignment
  stock performance to retroactively adjust the pre-assignment probability estimate.

## Management model

- **Baseline:** none implemented as a unified model — `H-R-01`/`H-R-02`/`H-R-03`
  currently govern management decisions structurally (H-R-03's alternatives-comparison
  requirement is RETAIN, a hard rule) without a fitted utility model behind
  `ManagementUtility`.
- **Challenger:** a model estimating `EV_net` for each of the 8 candidate management
  actions at a decision timestamp, feeding `ManagementUtility` directly.
- **Target:** replace ad hoc/heuristic close-vs-roll-vs-hold logic with a genuine
  utility comparison, per `PHASE2_MASTER_SPEC.md` §10.
- **Features:** `premium_capture`, `dte`, `capital_days`, `contract_iv`,
  `ownership_acceptability`.
- **Label:** `management_label` / `roll_label` per `hypotheses.json`.
- **Calibration:** full requirement.
- **Promotion/failure criteria:** per H-R-01/H-R-02/H-R-03's acceptance/rejection
  criteria, run on the *same* candidate set and period for H-R-01 vs. H-R-02 so the
  contradictory pair is compared fairly (both hypotheses' `failure_mode` fields require
  this explicitly).
- **Data dependency:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA`.
- **Leakage guard:** management decisions at time T must never use post-T price data,
  including the eventual resolution of the position being evaluated.

## Severe drawdown model

- **Baseline (label spec only):** `models/severe_drawdown_spec.py` — leakage-guarded
  breach/survive/censor label computation. No predictive model fit yet.
- **Challenger:** a fitted `P(severe drawdown | ownership features)` model, feeding
  `ownership_v0.py`'s `p_severe_drawdown` input (currently an external, unfitted input
  to that module).
- **Target:** replace the currently-required-but-unfitted `p_severe_drawdown` input
  across `theta_q_baseline.py`, `ownership_v0.py`.
- **Features:** structural/tail feature families from `feature_families.json`.
- **Label:** the `SevereDrawdownLabelResult` produced by `severe_drawdown_spec.py`
  itself — `BREACHED`/`SURVIVED`/`CENSORED` (plus proposed
  `CORPORATE_ACTION_AMBIGUOUS`, see `PHASE2_MASTER_SPEC.md` §5).
- **Calibration:** full requirement.
- **Promotion criteria:** calibration acceptable (Brier/log-loss/reliability) by
  regime/DTE/delta/ticker-family cohort; downstream `EV_net` improvement over the
  hard-coded ownership-model proxies once wired in.
- **Failure criteria:** poor calibration, or no downstream improvement despite good
  calibration (a well-calibrated-but-useless signal is still a failure for promotion
  purposes, though it may remain informative for monitoring).
- **Data dependency:** requires historical price paths through drawdown episodes —
  available from Alpaca historical bars; a corporate-action-aware dataset is required
  to correctly apply the proposed `CORPORATE_ACTION_AMBIGUOUS` status.
- **Leakage guard:** already implemented in code — the label computation only reads
  `entry_date <= p.as_of <= min(horizon_end, dataset_cutoff)`; a future fitted model
  must preserve this exactly (train only on features available strictly before
  `entry_date`, not on data through the labeling window).

## Recovery model

- **Baseline (spec only):** `models/recovery_spec.py` — survival-curve summary contract
  (median/P95 crossing, three recovery bases). No fitted curve yet.
- **Challenger:** a fitted survival model (e.g. Kaplan-Meier or a parametric survival
  model) producing `S_recovery(t)` from real historical recovery episodes.
- **Target:** feed H-A-04's bounded recovery-wait sweep with a real survival curve
  instead of an unfit placeholder.
- **Features:** none directly (survival analysis over time-to-event data) —
  conditioned by ownership/regime state as covariates in a fuller model.
- **Label:** `recovery_label` — time-to-approved-recovery, or censored at dataset
  cutoff if unresolved (never counted as a win or loss while censored).
- **Calibration:** survival-curve calibration is a distinct discipline from
  classification Brier/log-loss — reliability of `S_recovery(t)` predictions at held-out
  time horizons, not a single Brier number. SPECIFIED, not reduced to Brier/LogLoss
  incorrectly.
- **Promotion criteria:** the fitted curve's OOS predictions of P50/P95 recovery time
  are close to realized outcomes on a held-out cohort; downstream H-A-04 sweep result
  is not corrupted by using this same OOS split for both curve-fitting and bound
  selection (the three-step guard in H-A-04's `failure_mode` applies with equal force
  to the curve itself).
- **Failure criteria:** curve poorly predicts held-out recovery times, or curve-fitting
  and bound-selection cannot be cleanly separated into distinct data splits.
- **Data dependency:** historical assignment/recovery episodes — likely the scarcest
  dataset in the whole registry, since it requires observing full assignment-to-
  recovery-or-censoring cycles, not just price bars.
- **Leakage guard:** `_validate_curve`/`_survival_at`/`_first_crossing` in
  `recovery_spec.py` already enforce curve monotonicity and undefined-before-first-
  observation — a fitted model must not violate either when generating its curve.

## Covered-call ranker

- **Baseline:** none implemented — `CCUtility`'s formula is registered
  (`FORMULA_REGISTRY.md`) but no ranking code exists.
- **Challenger:** N/A until a baseline exists.
- **Target:** rank CC candidates by `CCUtility`, beating `BC-1` (max-yield-only).
- **Features:** `premium_capture`, `earnings_distance`, `ex_div_distance`,
  `expected_move`, `delta`.
- **Label:** `cc_label`.
- **Calibration:** applies to any probabilistic component of `CallAwayRegret`
  estimation.
- **Promotion/failure criteria:** per H-C-01/H-C-02's acceptance/rejection criteria.
- **Data dependency:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA`, plus
  Alpaca corporate-actions data for ex-div distance (`USABLE_NOW_ALPACA_HISTORICAL`).
- **Leakage guard:** `CallAwayRegret` must be computed from the actual realized
  post-call-away path in training data, which is inherently available only after the
  fact for historical episodes — the guard is that this retrospective computation is
  used to *train* the model, never used as a live input the model doesn't actually have
  access to at decision time in production (a subtlety distinct from ordinary
  look-ahead leakage, since the label itself is necessarily retrospective).

## Roll evaluator

- **Baseline:** none implemented — `RollUtility`/`NetRollCredit` formulas registered,
  no evaluator code.
- **Target:** implement the alternatives-comparison H-R-03 requires, beating a naive
  always-roll-if-credit-positive policy.
- **Features/label/calibration/data dependency/leakage guard:** as management model
  above, scoped specifically to the roll action.

## Execution/fill model

- **Baseline:** none implemented — no execution/fill/TCA code exists in
  `bots/theta/quant/` (this is explicitly Codex-owned per `docs/OWNERSHIP.md` for the
  live execution path; the quant side owns the conservative-fill *assumption* used in
  backtesting, which does not yet exist either).
- **Challenger:** a fill-probability/expected-slippage model conditioned on spread,
  quote size, and order aggressiveness.
- **Target:** replace any midpoint-fill assumption in future backtests — the charter's
  non-negotiable rule against assuming midpoint fills applies to this model's design
  from the start, not as a later correction.
- **Features:** `spread_pct`, `quote_age`, `quote_size`, `open_interest`, `volume`.
- **Label:** `execution_label` — realized fill price/slippage vs. the reference quote
  at order time.
- **Calibration:** full requirement.
- **Promotion criteria:** predicted fill/slippage distribution matches realized
  distribution on held-out data across a range of spread/liquidity conditions, not
  just the median case.
- **Failure criteria:** systematic optimism (predicting better fills than realized),
  which would bias every downstream `EV_net` calculation upward.
- **Data dependency:** `UNCERTAIN_PENDING_ALPACA_ENTITLEMENT` for
  `spread_pct`/`quote_age`/`quote_size` per `feature_families.json`.
- **Leakage guard:** fill outcome must be modeled using only pre-order-time quote
  state, never the quote state after the order would have executed.

## Model governance (applies to every model above)

- **Versioning:** every model has an explicit version identifier; no threshold or
  weight may be changed live without creating a new version (TRD §51, restated in
  `theta_q_baseline.py`'s `SizingPolicy.risk_limit_version` pattern — the same
  discipline extends to every model family here, not just sizing).
- **Baseline-first:** MODEL-001 — a simple, interpretable baseline must exist and be
  beaten before any more complex model is promoted, for every model family above.
- **Deep learning:** challenger-only, everywhere in this registry, and promoted only if
  (a) the simpler baseline is demonstrably inadequate (documented, not assumed) and
  (b) the improvement survives untouched OOS under the same discipline as any other
  model.
- **Drift monitoring:** every promoted model is monitored by the same cohort
  granularity as its calibration requirement (regime/DTE/delta/ticker-family), per
  ENS-003 — a single global calibration number is not sufficient monitoring for any
  model in this registry.
- **Retention of failed experiments:** every model challenger that was tried and
  rejected is retained in `research/data/experiments.json` (once it has actually been
  run) for DSR/PBO selection-bias analysis — this registry does not delete a model
  family's history when it fails promotion.
