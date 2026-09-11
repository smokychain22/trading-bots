# THETA Model Promotion Contract (R6)

Requirements before ANY calibrated model may populate an executable
`EV_net` (i.e. before `cross-symbol-economic-frontier.ts`'s
`computeFrontierDisposition` may ever legitimately reach
`EXECUTABLE_SELECTION` off a model-supplied `evNet`/`returnPerCapitalDay`
rather than the honest-null status it reports today). This document
restates and makes checkable — never relaxes — the promotion criteria
already frozen in `docs/quant/phase2/MODEL_REGISTRY.md` (per-model
promotion/failure criteria) and
`docs/quant/phase2/DATASET_AND_LABEL_CONTRACT.md` §5 (walk-forward/OOS
discipline). Where this document and those disagree, those are
authoritative; this document exists to turn their prose into a single,
literal checklist a reviewer can tick off.

## Promotion checklist

A model may NOT populate executable `EV_net` until every item below is
independently verified true, in an artifact reviewable by both Claude and
Codex:

- [ ] **Sufficient independent episodes.** Per TRD §50 / `DATASET_AND_
      LABEL_CONTRACT.md` §5: 300+/500+ INDEPENDENT (chain_id-grouped,
      per `walk_forward.py`'s own grouping discipline) resolved episodes
      — never raw row count.
- [ ] **Point-in-time data.** Every feature the model consumed at
      training and serving time is provably `as_of <= decision_
      timestamp` (per `THETA_REPLAY_ENGINE_SPEC.md` §3), joined via
      `point_in_time_join.py` (never a positional join).
- [ ] **Zero detected leakage.** `walk_forward.py::assert_no_chain_id_
      leakage` returns an empty list for the fold plan actually used;
      the no-future-leakage invariant (§3 of the replay spec) is
      confirmed by an explicit test, not merely assumed.
- [ ] **Locked target definition.** The model was trained against
      exactly `Y = WholeChainPnl` (or `ReturnPerCapitalDay`) as defined
      in `THETA_EV_MODEL_SPEC.md` §2 — never a redefined target chosen
      after seeing results.
- [ ] **Only RESOLVED chains used for training/evaluation.**
      `CENSORED_OPEN`/`INVALID_DATA`/`EXTERNAL_ACTIVITY_CONTAMINATED`
      chains (per `chain_resolution.py`) never enter the training set,
      never enter the evaluation set, and are never silently scored as a
      terminal outcome.
- [ ] **Realistic execution model.** Fill simulation is direction-aware
      (§5 of the replay spec) — no midpoint-fill assumption, no
      directionless slippage formula.
- [ ] **Transaction costs included.** Commissions and modeled slippage
      are line items in the target computation, not folded silently into
      an unexplained residual (per `THETA_EV_MODEL_SPEC.md`'s own named
      gap: currently folded into `fees` — this must be split out before
      promotion, not merely acknowledged as folded in).
- [ ] **Calibrated probabilities where used.** Any modeled P(win)/
      P(assignment)/P(severe drawdown) passes `calibration_metrics.py`'s
      diagnostics: acceptable Brier score, acceptable log loss, a
      reliability diagram with no systematically miscalibrated bucket,
      acceptable expected calibration error, and no material calibration
      drift between an earlier and a more recent window. Delta or
      Black-Scholes `N(d2)` is NEVER substituted for this — see the
      documented `ksanjay/Kelly-Criterion-Option-Selector` negative
      example in `THETA_FORMULA_CATALOG.md`.
- [ ] **Positive OOS after-cost EV.** Confidence interval over the
      untouched final OOS segment (per `walk_forward.py`'s reserved
      `final_oos_chain_ids`) excludes zero.
- [ ] **Acceptable ES/tail behavior.** `tail_risk_metrics.py`'s
      `compute_tail_risk_summary` (with the frozen `Loss = -PnL`
      convention, explicit `alpha`) shows no unacceptable Expected
      Shortfall regression versus the current baseline (the
      unconditional/bucketed-empirical baselines in `baseline_models.py`,
      per item 7's "beat simple baselines OOS" requirement).
- [ ] **Acceptable drawdown.** No material drawdown regression versus
      baseline, evaluated the same walk-forward way.
- [ ] **Stability across walk-forward windows.** The effect (EV
      improvement, calibration quality) is consistent across the ROLLED
      folds, not just the final OOS segment — a model that only "works"
      in one lucky fold is not stable.
- [ ] **Stability across relevant regimes.** Reported per market regime,
      volatility regime, underlying, DTE bucket, delta bucket,
      assignment outcome, and strategy branch (per `THETA_WALK_FORWARD_
      SPEC.md` §3) — a model failing on any one cohort is not promotable
      "on average."
- [ ] **No catastrophic subgroup collapse.** No cohort above shows a
      materially worse ES/drawdown than the aggregate — an average
      improvement hiding a catastrophic subgroup is a rejection, not a
      caveat.
- [ ] **Untouched final OOS.** The final OOS segment (per `walk_
      forward.py`) was used EXACTLY ONCE, for confirmation, never for
      threshold/feature/model selection (ML-002, already frozen).
- [ ] **Reproducible artifact.** The exact trained model (weights/
      coefficients, not just the architecture) is saved and can be
      re-scored against the same evaluation dataset hash to reproduce
      the same reported numbers.
- [ ] **Immutable model version.** A `research.model_version`-style
      identifier (per the existing `MODEL_REGISTRY.md` versioning
      convention) is assigned and never mutated in place — a retrained
      model gets a new version, never an overwrite.
- [ ] **Feature provenance.** Every feature's source (Alpaca/Optionomics/
      derived) and point-in-time-availability timestamp is recorded per
      row, not just per feature definition.
- [ ] **Training dataset hash.** A content hash of the exact training
      set (episode ids + as_of timestamps) is recorded alongside the
      model version.
- [ ] **Evaluation dataset hash.** Same, for the OOS evaluation set —
      distinct from the training hash, and confirmed disjoint from it at
      the `chain_id` level.
- [ ] **Promotion timestamp.** Recorded, not implied.
- [ ] **Promotion justification.** A short, written statement of which
      criterion above was the deciding evidence — never "it looked good."

## Thresholds defined before seeing final OOS results

Per the directive's explicit instruction: wherever feasible, the
acceptance threshold for each checklist item above (what counts as
"acceptable" ES regression, "acceptable" calibration, the confidence-
interval width required to call an EV improvement "excludes zero") must
be written down and agreed BEFORE the final OOS segment is unsealed for
that model's evaluation — never chosen after seeing how the model
performed there. This mirrors `MODEL_REGISTRY.md`'s existing per-model
promotion criteria (e.g. "no DD/ES regression" is already a pre-stated
bar, not something invented post hoc for a specific model) and DATASET_
AND_LABEL_CONTRACT.md §5's DSR/PBO selection-bias discipline — a
threshold chosen after seeing results is exactly the kind of researcher
degree of freedom DSR/PBO exists to catch and penalize.

## What this contract does not do

It does not itself run any of these checks — no calibrated model exists
yet to check (`EV_MODEL_NOT_EMPIRICALLY_READY`). It is the fixed bar a
future model must clear, agreed now, before anyone has an incentive to
relax it in favor of a specific result.
