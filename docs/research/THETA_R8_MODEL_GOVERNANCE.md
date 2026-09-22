# THETA R8 model governance

Status: Slice 12 of the pre-VPS master continuation directive. Extends
`src/research/continuation-value-interface.ts` (built in an earlier pass of
this engagement) into general R8 model governance. **No model has been fit in
this engagement.** This document specifies what would be required before one
ever is, not a record of one having happened.

## Required record for any future R8 model

Every real model artifact must record:

- **Experiment ID** -- immutable, unique per attempt (not per model family)
- **Export hash** -- the exact `contentHash` of the canonical export(s) consumed (per `real-data-export-contract.ts`'s v3 envelope, already built in this engagement)
- **Feature-set version** -- an explicit, versioned feature list, never an implicit "whatever columns happened to be in the export"
- **Target/label definition and version** -- exact formula, exact horizon, exact `labelAvailableAt` rule
- **PIT proof** -- `featureAvailableAt <= decisionTimestamp` for every feature, `labelAvailableAt <= trainingCutoff` for the label, both mechanically checked, not asserted by comment
- **Split dates** -- exact chronological train/validation/test boundaries
- **Purge** -- removal of any training row whose label window overlaps a validation/test row's feature window
- **Embargo** -- an explicit buffer period after each split boundary before the next split's data may be used, to prevent leakage through slow-moving features
- **Dependence grouping** -- e.g. group by underlying or by non-overlapping horizon window (per the Hold-Strike v2 protocol's own effective-N discipline), never treat every row as independent by default
- **Model family** -- named explicitly (see the simple-first ladder below)
- **Hyperparameter provenance** -- exact values and how they were chosen (never "tuned on the test set")
- **Calibration method** -- how raw model output was mapped to a real probability/EV, if applicable
- **Uncertainty method** -- how a confidence/interval estimate was produced, if applicable
- **OOS result** -- the full metric set from `THETA_R8_METRIC_CATALOG.md`, never a single headline number
- **Ablation result** -- BASELINE vs. BASELINE+feature, all else held constant, per this engagement's standing ablation protocol
- **Rollback plan** -- how to revert if the model is later found to be wrong or leaking

## Metric compatibility depends on target type -- never apply the wrong metric family

| Target type | Compatible metrics |
| --- | --- |
| Binary classification (e.g. "will this chain be assigned") | Brier score, LogLoss, ECE (calibration) |
| Continuous EV regression (e.g. predicted `WholeChainNetPnL`) | MAE/RMSE as descriptive errors, residual diagnostics, prediction-interval calibration/coverage -- **never Brier/ECE**, which are only defined for probabilistic classification |
| Tail/quantile (e.g. predicted 5th-percentile outcome) | Pinball loss, empirical coverage |
| Survival (e.g. time-to-assignment) | Censoring-aware metrics (e.g. concordance index), never a naive MAE that ignores censored observations |

**This document explicitly forbids applying Brier/ECE to a continuous dollar
EV target** -- a mistake this engagement's governing standard specifically
warns against.

## Simple-first model family ladder

In order of preference, escalate only when a simpler family demonstrably
fails to capture real structure (never skip ahead by default):

1. Cohort descriptive statistics (no model at all -- this is where every R8 study in this engagement currently sits)
2. GLM / logistic regression
3. Quantile regression
4. Survival models (for duration/censored outcomes like recovery duration)
5. A regime-conditioned model (explicit regime as a feature/stratum, not a hidden interaction)
6. Gradient-boosting challenger (only once a simpler family has a real, documented OOS result to beat)

**No neural network / reinforcement learning model is in scope until real
evidence demonstrates the simpler families are insufficient** -- this is an
explicit standing constraint, not merely a preference.

## Current status

Every R8 research module in this engagement is `TOOLING_ONLY` per
`THETA_R8_DATA_SUFFICIENCY.md` -- no experiment ID has ever been issued, no
model has been fit, and `empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED'`
remains honestly hardcoded in the canonical Production frontier. This
document exists to be ready the moment real outcome data justifies the first
real experiment, not to describe one that has happened.
