# R6H Model-Fit Readiness Contract

Implemented as real code in `bots/theta/quant/research/dataset_readiness.py`
(`DatasetReadinessState`, `SufficiencyThresholds`,
`assess_model_fit_sufficiency`, `classify_dataset_readiness`,
`run_empirical_program`), tested in `test_dataset_readiness.py`.

## States

```
DATASET_ABSENT
  -> DATASET_PRESENT_UNUSABLE   (failed production_export_loader.py's intake gate)
  -> DESCRIPTIVE_AUDIT_ONLY     (loaded, valid, but insufficient for any model fit)
  -> MODEL_FIT_ELIGIBLE         (sufficient sample; no walk-forward plan yet)
  -> WALK_FORWARD_ELIGIBLE      (valid walk-forward plan; final OOS not yet confirmed untouched)
  -> OOS_EVALUATION_ELIGIBLE    (walk-forward valid AND final OOS confirmed untouched)
```

Each state requires the PRIOR condition to hold -- `classify_dataset_
readiness` cannot jump to `OOS_EVALUATION_ELIGIBLE` from a `walk_forward_
plan_valid=False` input even if `final_oos_untouched=True` is also passed
(tested explicitly: `test_final_oos_alone_cannot_skip_the_walk_forward_
precondition`). This state is a RESEARCH READINESS classification only --
it never implies Production strategy promotion, which remains `promotion_
checker.py`'s (much stricter, EMPIRICAL-evidence-gated) job downstream.

## Sufficiency contract (no invented universal minimum)

`SufficiencyThresholds` requires the CALLER to supply and justify every
number: `min_raw_n`, `min_independent_n`, `min_positive_outcomes`, `min_
negative_outcomes`, `min_branch_coverage`, `min_regime_coverage`. `assess_
model_fit_sufficiency` reports EVERY failing dimension at once (not just
the first), so a caller sees the whole sufficiency picture -- e.g. "raw N
is fine but independent N and branch coverage are both short" is a single,
legible report, not three separate re-runs.

## Branch dataset slices (never mixed)

`slice_by_branch` takes an ALREADY branch-grouped mapping (branch
membership requires a real join back to the candidate/chain that produced
each `EconomicEpisode` -- `research.theta_outcome_label` itself is subject-
type/subject-id keyed, not branch-keyed, confirmed from migration 018's own
schema) and splits each branch's episodes into `resolved_episodes`/
`censored_episodes`/`invalidated_episodes` buckets. CSP-entry, recovery,
and CC samples are structurally prevented from being pooled into one
training target -- there is no code path that merges two `BranchDataset
Slice`s together.

## Dependence groups / effective N

`DependenceGroupKey` (wheel_chain_id, economic_episode_id, underlying,
session_date, correlation_cluster) + `build_dependence_groups`/`effective_
sample_size` implement the "1000 correlated decisions is not N=1000" rule
directly: `effective_sample_size` returns the count of DISTINCT dependence
groups, never the raw row count. Tested with an explicit 1000-row-into-1-
group case.

## The empirical runner (`run_empirical_program`)

The one controlled entry point. It:
1. Classifies readiness from the loaded export + sufficiency report.
2. Determines which experiment classes (`DESCRIPTIVE_AUDIT`/`MODEL_FIT`/
   `WALK_FORWARD`/`OOS_EVALUATION`) are eligible under that state --
   strictly cumulative, never skipping a stage.
3. REFUSES every ineligible class explicitly (`refused_experiments`),
   rather than silently omitting them.
4. Computes a reproducibility fingerprint (via `reproducibility.py`'s own
   canonical-JSON + SHA-256 convention) over the experiment's full identity
   (dataset hash, target/feature/cost-model versions, strategy branch,
   split definition, experiment/hypothesis id, evidence-source label) --
   but ONLY once a dataset is actually present; `None` otherwise.

It never trains a model, computes a calibration metric, or claims a
strategy result on its own -- those remain the job of the (still
`BLOCKED_ON_DATA`) downstream modules this contract exists to eventually
unblock.

## `ExperimentConfig` fields (item 21)

`dataset_hash`, `target_version`, `feature_version`, `strategy_branch`,
`cost_model_version`, `split_definition`, `experiment_id`, `hypothesis_id`
(nullable -- a pure data-quality finding is never forced to cite a
hypothesis it isn't testing), `evidence_source`
(`HISTORICAL_REPLAY`/`LIVE_SHADOW`/`PAPER_EXECUTION`, item 25 -- these
three evidence classes are never blended in one experiment run).
