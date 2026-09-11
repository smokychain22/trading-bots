# THETA Walk-Forward / OOS Validation Specification (R6)

Builds on `docs/quant/phase2/DATASET_AND_LABEL_CONTRACT.md` §5 (already
frozen: purged walk-forward, untouched OOS, clustered/regime resampling,
raw-vs-independent N, DSR/PBO selection-bias diagnostics) — this document
does not redefine those disciplines, it makes the concrete protocol and
reporting structure explicit enough to implement against, and folds in
what the GitHub research corpus contributes to the mechanics.

## 1. Fold structure

```
[  TRAIN  ][ purge/embargo ][ VALIDATION ][ purge/embargo ][ FORWARD TEST ]
                                                                   |
                                                     roll window forward, repeat
                                                                   |
                                     [ ... additional rolled folds ... ]
                                                                   |
                                          [ FINAL UNTOUCHED OOS -- touched exactly once ]
```

- **TRAIN:** fits any calibrated model (entry-outcome, management-action,
  severe-drawdown, recovery-curve) per `MODEL_REGISTRY.md`'s existing
  per-model calibration requirement.
- **Purge/embargo (per `DATASET_AND_LABEL_CONTRACT.md` §5):** excluded
  entirely from both TRAIN and the immediately-following VALIDATION/
  FORWARD TEST window, sized to exceed the longest label-resolution
  horizon **for the specific label being validated** — this is not one
  global constant:
  - `entry_label`: embargo >= the longest realistic CSP DTE in the
    universe (THETA-Q's `latticeConfig.maxDte`, currently up to 60 days)
    plus any roll-extension time, so an episode's resolution never
    straddles the train/test boundary.
  - `recovery_label`: embargo >= the P95 recovery duration observed so
    far (per `recovery_spec.py`'s own `p95_recovery_days`), which can be
    materially longer than a single option's DTE — an under-sized embargo
    here is the single most likely purged-walk-forward mistake, since
    recovery episodes are the longest-horizon label THETA has.
  - `roll_label`/`cc_label`: embargo >= one full additional cycle's DTE
    beyond the base entry embargo, since a roll or CC decision can itself
    extend an episode's resolution horizon past the original entry's own.
- **VALIDATION:** used for model/threshold/feature selection — the ONLY
  segment that may be touched more than once during development (ML-002
  already forbids touching FORWARD TEST or the final OOS for this
  purpose).
- **FORWARD TEST:** the fold's own untouched check — confirms the
  VALIDATION-selected configuration generalizes to data it never
  influenced selection on, before rolling the window forward.
- **Roll and repeat:** the whole TRAIN/embargo/VALIDATION/embargo/FORWARD
  TEST block slides forward by a fixed step; each rolled fold is an
  independent confirmation, not a re-tuning opportunity.
- **Final untouched OOS:** a single, fixed final segment, held out from
  every rolled fold above, touched exactly once, for confirmation only
  (per `DATASET_AND_LABEL_CONTRACT.md` §5's "used exactly once" rule).

## 2. Grouping overlapping lifecycle observations

Per item 9's explicit instruction: highly correlated trades must not leak
across folds. THETA's own lifecycle structure gives an exact grouping key
already, rather than needing an invented one:

- **Group by `chain_id`** (the `economic_chain`/`trade.economic_chain`
  primary key already used throughout `runtime-state.ts`/
  `management-cycle.ts`/the persistence schema) — every row belonging to
  the same economic chain (the original CSP, any roll, the assignment, the
  recovery period, the eventual covered call, the final close) must be
  assigned to the SAME fold, never split across TRAIN and VALIDATION/TEST.
  A chain is a single, indivisible, temporally-extended observation for
  fold-assignment purposes, even though it produces many per-decision-type
  rows (`entry_label`, `roll_label`, `management_label`,
  `assignment_label`, `recovery_label`, `cc_label`) along its length.
- **Secondary grouping by time-overlap across DIFFERENT chains on the
  same underlying:** two chains on the same underlying whose entry/exit
  windows overlap substantially share regime/volatility exposure and
  should be treated as correlated for the clustered-bootstrap step below,
  even though they are formally different `chain_id`s.
- **Effective N, not raw N:** the number of INDEPENDENT chains (after the
  above grouping), not the number of rows, is what TRD §50's 300+/500+
  threshold is measured against — a chain that got rolled three times and
  produced 6 management-decision rows is still one independent
  observation for this purpose, exactly as `DATASET_AND_LABEL_CONTRACT.md`
  §5 already states.

## 3. Regime/volatility stratified reporting

Per item 9's explicit instruction, report performance broken out by:

- Market regime (`regime_v0.py`'s existing classification: bull/bear/
  range, already computed and available on every `RegimeSnapshotResponse`)
- Volatility regime (`regime_v0.py`'s RV-band classification — LOW/
  NORMAL/HIGH/SHOCK, already computed)
- Underlying (per-ticker breakout — required to catch a model that only
  works on the specific names most represented in the training sample)
- DTE bucket (a versioned bucketing, e.g. 0-14/15-30/31-45/46-60+, not a
  single pooled number — since THETA-Q and THETA-H deliberately operate
  in different DTE regimes)
- Delta bucket (mirrors THETA-Q's own `deltaBands` lattice config)
- Assignment outcome (assigned vs. not-assigned chains reported
  separately, per H-A-01's "assignment is never automatically failure"
  discipline — pooling them would hide whether the model's edge survives
  the assignment path specifically)
- Strategy branch (THETA_Q/THETA_H/THETA_R/THETA_A/THETA_C/THETA_D
  reported separately — pooling across branches with genuinely different
  entry/management logic would produce a meaningless blended number)

A model that shows an aggregate improvement but fails (interval spans
zero, or a DD/ES regression) on a specific cohort above must not be
promoted "on average" — per `MODEL_REGISTRY.md`'s promotion criteria,
already stated per-cohort for the severe-drawdown model
("calibration acceptable... by regime/DTE/delta/ticker-family cohort"),
extended here to apply to the entry-outcome model's promotion decision
too.

## 4. Selection-bias diagnostics

Per `DATASET_AND_LABEL_CONTRACT.md` §5: DSR (Deflated Sharpe Ratio) or PBO
(Probability of Backtest Overfitting) — or an equivalent correction — is
required before any finding is accepted as general, and this requires
retaining every variant actually tried (winning or not), not just the
final reported configuration. This document adds the concrete mechanics:
every fold/hyperparameter/feature-set variant attempted during
VALIDATION must be logged (mirroring `experiments.json`'s existing
convention for strategy-level ablations) so the DSR/PBO correction has
the full search breadth to correct against, not just the winning variant
in isolation.

## 5. What the GitHub corpus contributes to the mechanics

- `goldspanlabs/optopsy` (AGPL-3.0, method-only): its explicit pipeline
  staging (validation → evaluation → strategy construction → output
  formatting) and its separate calendar/diagonal-spread matching path are
  a useful architectural precedent for keeping THETA's own future
  backtest-replay pipeline's stages auditable and independently testable,
  rather than one monolithic function.
- `lambdaclass/options_portfolio_backtester` (MIT): its composed
  `BacktestEngine` (data provider / strategy / execution / portfolio /
  risk / analytics, each independently swappable) and its
  `HedgeFillWarning` pattern (an explicit, named signal when a strategy's
  assumed contract band silently found nothing tradeable in a given
  historical era — directly relevant to THETA's own point-in-time
  optionability discipline in `universe-discovery.ts`) are both
  `ADOPT_METHOD` candidates for a future THETA backtest engine's
  architecture, never its source (see the licensing/method-vs-source
  distinction in `THETA_GITHUB_TOP15.md`).
- QuantLib/LEAN: not yet deep-inspected for this specific mechanics
  question (calendars, backtest/live parity) — flagged as a follow-up in
  the Gap Matrix, not assumed to already have been reviewed.

## 6. Status

This is a specification only — no backtester/replay engine exists yet
(Phase 6 gate, per `docs/PHASED_PLAN.md`), so nothing in this document has
been run against real data. Any claim that a walk-forward result exists
before that infrastructure and real historical option-chain data both
exist would be exactly the fabricated-empirical-result item 12 forbids.
