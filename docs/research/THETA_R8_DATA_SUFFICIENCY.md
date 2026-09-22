# THETA R8 data sufficiency governance

Status: Slice 12 of the pre-VPS master continuation directive. No universal
fixed N threshold is specified anywhere in this document -- promotion always
requires a preregistered precision/power standard for the SPECIFIC experiment
in question, per this engagement's standing rule (established in the
Hold-Strike v2 preregistration and repeated here as general R8 policy).

## Required counts, per study/experiment

| Count | Definition | Current real value (this engagement) |
| --- | --- | --- |
| `RAW_N` | Every candidate/decision row observed, regardless of resolution status | Per the real 2026-09-21 forensic: 3,876 real persisted candidate rows in one session window. No R8 study in this engagement has yet consumed real outcome data at scale beyond this single forensic snapshot. |
| `MATURED_N` | Rows whose horizon window has fully elapsed (label-eligible in principle) | 0 confirmed -- no R8 study has reached a real matured cohort yet |
| `RESOLVED_CHAIN_N` | Rows with a real, realized whole-chain outcome (not `ANALYTICAL_MTM_AT_HORIZON`) | 0 confirmed |
| `CENSORED_N` | Rows still open at the study horizon, valued via the terminal-valuation PIT contract rather than dropped | 0 confirmed (no study has run against real data yet) |
| `STATISTICAL_EFFECTIVE_N` | Independent, non-overlapping observation count after accounting for dependence (e.g. clustering by underlying, or by non-overlapping horizon window per the Hold-Strike v2 protocol) | Not computable -- no real data |
| `TRAIN_N` / `VALIDATION_N` / `TEST_N` | Chronological walk-forward split counts, per this engagement's standing split discipline (embargoed, untouched final OOS window) | 0 / 0 / 0 -- no model has been fit |
| `DISTINCT_UNDERLYINGS` | Real distinct symbols represented in the cohort | 75 underlying evaluations occurred in the one real 2026-09-21 session (not necessarily 75 distinct symbols -- not independently deduplicated this pass) |
| `DISTINCT_REGIMES` | Real distinct regime classifications represented | Not measured this pass |

## Maturity states (per study, not per metric)

- `TOOLING_ONLY` -- the schema/contract/code exists; zero real rows have been run through it. **This is the current state of every R8 research module built in this engagement** (`defined-risk-vs-csp-paired-study.ts`, `universe-opportunity-regret.ts`, `cross-strategy-common-horizon-contract.ts`, `hold-strike-terminal-valuation-pit-contract.ts`, `capital-days-definition.ts`, `management-outcome-schema.ts`, `wait-economic-contract.ts`, `delta-cohort-research.ts`).
- `PIPELINE_PROVEN` -- the tooling has been run against at least one real (even if small) dataset end to end without error, but no descriptive conclusion has been drawn yet.
- `REAL_DATA_DESCRIPTIVE` -- real data has been examined and described (counts, distributions) but no comparison/hypothesis test has been run.
- `EXPLORATORY` -- a real comparison/hypothesis has been examined, results are directional but not yet power-analyzed or preregistered against.
- `OOS_EVALUATED` -- a real, preregistered, chronologically-split, embargoed out-of-sample evaluation has been completed.
- `PROMOTION_ELIGIBLE` -- OOS-evaluated AND meets a specific, preregistered precision/power target for that exact experiment. **No R8 study in this engagement has reached this state, and none is claimed to.**

## Explicit non-goal

There is deliberately **no 70%-win-rate promotion gate** anywhere in this
governance document or any R8 module -- per the standing engagement rule,
realized win rate and calibrated model confidence are different quantities,
and neither is ever used as a headline promotion criterion without the full
metric set (Leg WR, Whole-Chain WR, open MTM P&L, AvgWin/AvgLoss, ProfitFactor,
drawdown) alongside it.
