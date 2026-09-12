# THETA Quant/Research Closure Status

Machine-readable source of truth: `bots/theta/quant/research/phase_status.py`
(self-validating — its own test suite fails if a `COMPLETE` entry names a
module that does not exist, or a `BLOCKED_ON_DATA` entry omits its exact
blocker). This document is the human-readable view of that manifest.

**Purpose: stop the rediscovery loop.** A future session reads
`phase_status.blockers()` and knows immediately what is genuinely left,
without re-deriving it from commit history or re-auditing finished work.

## What is finished (do not rebuild)

| Item | Module |
|---|---|
| Dataset contracts (mirror migration 018; 019 additive-only) | `dataset_contracts.py` |
| Fail-closed Production export intake | `production_export_loader.py` |
| Recursive point-in-time / future-label firewall | `production_export_loader.py`, `point_in_time_join.py` |
| Frozen research targets | `research_targets.py` |
| Dependence / effective N | `dataset_readiness.py`, `correlation_metrics.py`, `regime_report.py` |
| Six-state cumulative readiness machine | `dataset_readiness.py` |
| Preconfigured experiment registry (46 experiments) | `experiment_registry.py` |
| Promotion contract (6 failure classes) | `promotion_checker.py`, `champion_challenger.py` |
| **Auto-empirical pipeline (one entry point)** | `empirical_pipeline.py` |
| Walk-forward engine (purge/embargo/label availability/chain grouping) | `walk_forward.py` |
| Selection bias (DSR sigma-scaled, PBO average-rank ties) | `selection_bias.py` |
| R3 account risk capacity + isolation + exit check | `account_risk_capacity.py` |
| R4 follower sizing, copyability, lifecycle eligibility, roll legs, degradation, master-fill-first, direction-aware pricing, exit check | `follower_copy_economics.py` |
| R5 explanation contracts, consistency validation, exit check | `quant_explanation_contracts.py` |
| R7/R9 research evidence gates (14 / 23 dimensions) | `research_evidence_packet.py` |
| R8 Paper analytics, incident tally, stability recommendation | `paper_validation_analytics.py` |

## What is blocked — and on exactly what

Every item below is BLOCKED_ON_DATA, not unfinished engineering. The
machinery exists and is tested; only real evidence is missing.

| Item | Exact blocker |
|---|---|
| `R6_REAL_PIT_DATA` | No Production dataset export exists. Codex handoff 2026-09-12: zero point-in-time rows, zero shadow candidates, zero resolved labels, zero subsequent quote observations. |
| `R6_MODEL_FIT` | Requires `MODEL_FIT_ELIGIBLE` readiness, which requires resolved labels that do not exist. |
| `R6_WALK_FORWARD` | Requires resolved chains spanning enough sessions to build folds. |
| `R6_OOS` | Requires a walk-forward plan plus a reserved untouched final segment. |
| `R6_CALIBRATION_EMPIRICAL` | Requires predicted probabilities paired with realized binary outcomes. |
| `R6_GATE_REGRET` | Requires defensible counterfactual fill semantics plus resolved outcomes for soft-rejected candidates. |
| `R6_ACTION_REGRET` | Counterfactual management paths branch; requires a defensible branching methodology plus resolved alternative outcomes. |

## The auto-empirical pipeline

`run_theta_empirical_pipeline(raw_export, config, thresholds, ...)` does the
whole sequence in one call: load → schema/hash validation → PIT audit →
feature/label firewall → candidate-set completeness → provenance →
contract/multiplier/unit audit → branch slicing → dependence grouping →
data-quality report → readiness classification → only-eligible experiments
→ deterministic artifacts → machine-readable status.

Behavior by readiness, never bypassable:

| Readiness | What runs |
|---|---|
| `DATASET_ABSENT` | Nothing; returns the missing-artifact name. |
| `DATASET_PRESENT_UNUSABLE` | Integrity diagnostics only; zero experiments, never a fit. |
| `DESCRIPTIVE_AUDIT_ONLY` | Descriptive + strictness experiments only. |
| `MODEL_FIT_ELIGIBLE` | Adds entry/ownership/assignment/management/slice/policy experiments. |
| `WALK_FORWARD_ELIGIBLE` | Adds paired feature and flow ablations. |
| `OOS_EVALUATION_ELIGIBLE` | Adds untouched-OOS evaluation. |

A thin CLI wraps the same function with no logic of its own:

```
PYTHONPATH=bots/theta/quant python -m research.empirical_pipeline \
  --export path/to/dataset.json --output research_outputs/ \
  --evidence-source LIVE_SHADOW --strategy-branch THETA_CONVENTIONAL \
  --experiment-id E1 --target-version v1 --feature-version v1 \
  --cost-model-version v1 --split-definition s1
```

It exits non-zero on a missing or structurally invalid export, and refuses
a partial `--min-*` threshold set rather than inventing the missing ones.

Artifacts land at `research_outputs/<dataset_hash>/<experiment_id>/` with
`manifest.json`, `data_quality.json`, `readiness.json`, `descriptive.json`,
`experiments.json`, `failures.json`. A repeat run of the same experiment
against the same dataset **raises** rather than overwriting a prior result.

Every run's manifest carries dataset hash, schema version, source window,
evidence source class, strategy branch and versions, feature/cost-model/
split identifiers, experiment and hypothesis ids, target-definition
version, source-code commit, run timestamp, and a derived
`experiment_config_hash`.

## Evidence-class separation

`HISTORICAL_REPLAY`, `LIVE_SHADOW` and `PAPER_EXECUTION` are never pooled.
`paper_validation_analytics.require_paper_evidence` raises on non-Paper
evidence rather than analyzing it as if it were Paper execution.

## No invented thresholds

No minimum trade count, drawdown ceiling, Sharpe floor, profit-factor
floor, EV floor, calibration bar or effective-N minimum is invented
anywhere. Every such number is caller-supplied and caller-justified
(`SufficiencyThresholds`, `PromotionCheckInputs`'s `min_*`/`max_*` fields);
absent one, the result is `UNKNOWN`/refused, never a made-up default.

## Failure-DNA regression coverage

`tests/quant/test_failure_dna_regression.py` holds one test per known
project failure mode: delta-as-probability, forced quantity ≥ 1, roll
resetting the old loss, midpoint fills, UNKNOWN→zero (including the
`(x or 0)` sufficiency-counting variant Codex's port caught and this
branch then fixed), missing fees→zero,
stale quotes passing, soft signals acting as hidden hard gates, partial
candidate sets treated as complete, research branches becoming executable,
followers copying skipped lifecycle events, master self-copy, follower size
copied from master, uncalibrated probability shown to a user, Paper evidence
mixed with shadow evidence, future labels inside feature payloads, open
chains counted as wins, premium-based return denominators, fabricated fill
probabilities, duplicate experiment-result overwrites, readiness-gate
bypass, martingale/loss-conditioned sizing, **direction-agnostic copy price
deterioration**, and **copying a master order intent that never filled**.

### The direction-aware copy-pricing repair

Codex found that `follower_price - master_price` is correct only for a
DEBIT. THETA is a premium *seller*, so most copied events are CREDITs,
where receiving **less** is worse — the opposite arithmetic. The old
formula therefore scored adverse credit fills as improvements and
improvements as adverse, inverting any limit built on it.

`CashflowDirection` (CREDIT/DEBIT) is now explicit and required.
Direction is never inferred from CALL/PUT (either can be bought or sold)
nor from OPEN/CLOSE alone; `cashflow_direction_for_event` supplies only
the conventional value for the short-premium lifecycle and can be
overridden. One sign convention holds everywhere: **positive = adverse,
negative = price improvement**. A roll's two legs carry opposite
directions (close-old DEBIT, open-new CREDIT), which is precisely why a
roll is never scored as one combined deterioration number. The percentage
form divides by `abs(master price)` and returns `None` — never `0.0` —
when that is zero or unknown.

## Standing truth

`EV_MODEL_NOT_EMPIRICALLY_READY = YES`.
`RESEARCH_READY_FOR_PAPER = NO` (all fourteen dimensions unknown).
`RESEARCH_ELIGIBLE_FOR_LIVE_SMALL = NO` (all twenty-three unknown).
`PAPER_READY = NO` — and that remains Codex/owner authority regardless of
any research gate's output.
