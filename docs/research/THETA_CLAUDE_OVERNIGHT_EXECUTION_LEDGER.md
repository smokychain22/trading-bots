# THETA Claude Overnight Execution Ledger

Tracks real implementation performed under `THETA_CLAUDE_LONG_RUN_IMPLEMENTATION_V2.md`
(superseding the original overnight command) on branch
`claude/theta-overnight-quant`. Updated after every commit -- one line per
work package.

## Status vocabulary correction (owner directive, this pass)

A feature family is NOT "fully DONE/COMPLETE" merely because a producer
and unit tests exist. Real states, applied from this point forward:

`SOURCE_IMPLEMENTED` -> `BUNDLE_WIRED` -> `CONSUMER_WIRED` ->
`HISTORICAL_DATA_WIRED` -> `EMPIRICALLY_TESTED` -> `RUNTIME_HANDOFF_READY`
-> `COMPLETE`.

WP01-11 below are re-labeled `SOURCE_IMPLEMENTED` (producer + canonical
`FeatureResult` conversion + unit tests exist; NOT yet in the 20-family
bundle (WP20), NOT yet in the feature-definition registry (WP21), NOT yet
consumed by the router research adapter (WP22, not built), NOT yet fed by
a real historical dataset loader (WP24, not built), and NOT empirically
tested against real data). None of these families may be called `COMPLETE`
until that full chain (producer -> bundle -> registry -> router adapter ->
historical loader -> ablation/strictness consumer -> reproducibility
contract) exists end to end.

**Second correction (this pass)**: `SOURCE_IMPLEMENTED` alone does not say
whether a family's data is real or a real producer even exists yet.
Precise per-family classification now used, orthogonal to the bundle/
consumer/historical-data progression above:

- `REAL_DATA_PRODUCER` -- a genuine producer over real, PIT-safe market/
  account/provider data (e.g. TREND, IV, LIQUIDITY).
- `DERIVED_REAL_PRODUCER` -- computed from other real producers/features,
  never a raw provider passthrough itself (e.g. SKEW derives from IV,
  CORRELATION derives from two return series).
- `PREEXISTING_CANONICAL_ADAPTER` -- this session built only a thin
  adapter; the real canonical producer already existed (REGIME's
  `regime_v0.py`, EXECUTION_QUALITY's `models/execution_quality.py`).
- `TYPED_UNKNOWN_CONTRACT` -- a real typed contract exists but no
  authorized data source is wired; always paired with `BLOCKED_DATA`.
- `RESEARCH_BASELINE` -- a real formula, but not a canonical THETA-defined
  one (SKEW only, so far).
- `BLOCKED_DATA` -- genuinely blocked by a missing authorized data source;
  MUST NOT be counted toward a "families with real producers" total.

**All 20 canonical families do NOT have real producers.** SECTOR (WP13)
and FUNDAMENTAL_QUALITY (WP17) are `TYPED_UNKNOWN_CONTRACT`/`BLOCKED_DATA`
-- 2 of 20 families remain genuinely unresolved pending a real, authorized
provider Codex or the owner wires in. 18 of 20 have a real producer of
some class (`REAL_DATA_PRODUCER`/`DERIVED_REAL_PRODUCER`/
`PREEXISTING_CANONICAL_ADAPTER`).

SKEW (WP05) carries an additional, permanent classification:
`RESEARCH_BASELINE`, never canonical Production THETA policy -- see
`features/skew.py`'s own `skew_feature_classification()`. It must not
become production-decisive without an explicit canonical-definition/
promotion decision recorded in `docs/quant/` first.

## Work package status (V2's numbered queue)

| WP | Capability | Status | Source files | Tests | Commit |
|---|---|---|---|---|---|
| 01 | Canonical FeatureResult contract | SOURCE_IMPLEMENTED (infrastructure, not a feature producer) | `features/feature_contract.py` | `test_feature_contract.py` (9) | `774a41f` |
| 02 | TREND/MOMENTUM integration into contract | REAL_DATA_PRODUCER | `features/trend.py`, `features/momentum.py` (adapters) | `test_feature_contract.py` | `774a41f` |
| 03 | REALIZED_VOLATILITY integration | REAL_DATA_PRODUCER | `features/realized_volatility.py` (`close_to_close_realized_volatility_result`) | `test_realized_volatility_result.py` (9) | `c15d056` |
| 04 | IV feature | REAL_DATA_PRODUCER | `features/iv.py` | `test_iv.py` (8) | `aae1dd0` |
| 05 | SKEW feature | RESEARCH_BASELINE, DERIVED_REAL_PRODUCER, classification=RESEARCH_BASELINE (no canonical THETA formula existed; documented and function-flagged as such, never production-decisive without explicit promotion) | `features/skew.py` | `test_skew.py` (10) | `368bd25` (+ this pass's classification fix) |
| 06 | TERM_STRUCTURE feature | DERIVED_REAL_PRODUCER | `features/term_structure.py` | `test_term_structure.py` (8) | `c350a67` |
| 07 | VOLATILITY_SURFACE feature | DERIVED_REAL_PRODUCER | `features/volatility_surface.py` | `test_volatility_surface.py` (6) | `d81d32f` |
| 08 | VOLUME_OPEN_INTEREST feature | REAL_DATA_PRODUCER | `features/volume_open_interest.py` | `test_volume_open_interest.py` (6) | `0cd7449` |
| 09 | FLOW feature | REAL_DATA_PRODUCER | `features/flow.py` | `test_flow.py` (11) | `eabbaeb` |
| 10 | UNUSUAL_ACTIVITY feature | DERIVED_REAL_PRODUCER | `features/unusual_activity.py` | `test_unusual_activity.py` (9) | `0a98898` |
| 11 | LIQUIDITY feature | REAL_DATA_PRODUCER | `features/liquidity.py` | `test_liquidity.py` (9) | `bcd04c9` |
| 12 | EVENT_CONTEXT feature | REAL_DATA_PRODUCER | `features/event_context.py` | `test_event_context.py` (7) | `451709d` |
| 13 | SECTOR feature | TYPED_UNKNOWN_CONTRACT, BLOCKED_DATA (no authorized sector/GICS source anywhere in this repo; typed UNKNOWN contract + Codex handoff implemented, NOT a real producer) | `features/sector.py` | `test_sector.py` (3) | `de49efc` |
| 14 | CORRELATION feature | DERIVED_REAL_PRODUCER | `features/correlation.py` | `test_correlation.py` (11) | `c27f6e8` |
| 15 | PORTFOLIO_EXPOSURE feature | DERIVED_REAL_PRODUCER | `features/portfolio_exposure.py` | `test_portfolio_exposure.py` (8) | `ec2b597` |
| 16 | DRAWDOWN_RECOVERY feature | DERIVED_REAL_PRODUCER | `features/drawdown_recovery.py` | `test_drawdown_recovery.py` (8) | `935e674` |
| 17 | FUNDAMENTAL_QUALITY feature | TYPED_UNKNOWN_CONTRACT, BLOCKED_DATA (same situation as SECTOR, NOT a real producer) | `features/fundamental_quality.py` | `test_fundamental_quality.py` (2) | `a3cd9d5` |
| 18 | REGIME wiring (real TREND/REALIZED_VOLATILITY -> real regime_v0.classify()) | PREEXISTING_CANONICAL_ADAPTER, CONSUMER_WIRED (regime_v0.py itself pre-existing, not reimplemented) | `features/regime_adapter.py` | `test_regime_adapter.py` (7, end-to-end through the real classifier) | `2f5f3a6` |
| 19 | EXECUTION_QUALITY (self-caught duplicate-authority bug, fixed) | PREEXISTING_CANONICAL_ADAPTER (adapter over the pre-existing `models/execution_quality.py`, never reimplemented) | `features/execution_quality_adapter.py` | `test_execution_quality_adapter.py` (4) | `f422a0f` |
| 20 | Complete 20-family feature bundle | SOURCE_IMPLEMENTED, BUNDLE_WIRED ( for all 20 families -- every family, wired or not, gets exactly one entry, never silently omitted) | `features/feature_bundle.py` | `test_feature_bundle.py` (8) | `2dc1e99` |
| 21 | Feature definitions registry | SOURCE_IMPLEMENTED (infrastructure, not a feature producer) | `features/feature_definitions_registry.py` | `test_feature_definitions_registry.py` (5) | `199bbfd` |
| 22 | Router research adapter (FeatureBundle -> real `strategy_router.py`) | CONSUMER_WIRED (real `route_strategies()` driven end-to-end; final selection explicitly out of scope) | `features/router_research_adapter.py` | `test_router_research_adapter.py` (6) | `e14b81d` |
| 23 | Strictness funnel engine (real bug found+fixed: rule-order shadowing) | SOURCE_IMPLEMENTED (infrastructure, not a feature producer) | `features/strictness_funnel.py` | `test_strictness_funnel.py` (12) | `00d4688` |
| 24 | Historical loaders | REAL_DATA_PRODUCER for Sep24 (real schema adapter); BLOCKED_DATA for Sep16/Sep18/Sep21 (searched, genuinely do not exist anywhere) | `research/historical_episode_loader.py` | `test_historical_episode_loader.py` (5) | `75b9fe5` |
| 25-26 | Filter-value analysis, Phase 2 ablations | BLOCKED_DATA (WP24 found exactly ONE real historical episode, N=1 -- no ablation/filter-value comparison is statistically meaningful from a single episode; the loader interface exists and is ready the moment more real episodes exist) | -- | -- | -- |
| 27 | Immutable quant snapshot contract | SOURCE_IMPLEMENTED | `research/immutable_quant_snapshot.py` | `test_immutable_quant_snapshot.py` (4) | `ca52afc` |
| 28 | T0 research adapter | SOURCE_IMPLEMENTED | `research/t0_bundle_adapter.py` | `test_t0_bundle_adapter.py` (5) | `d6aa639` |
| 29-31 | Common economic types, Q economics, H economics | RECONCILED, NOT_REBUILT -- real search (before writing anything, per owner correction) found `theta_q_baseline.py`'s `CandidateEconomics`/`CostAssumptions`/`SizingPolicy` (Q), `theta_h_baseline.py`'s `ThetaHEconomics` (H), `covered_call_ranker.py` (C), and `recovery_decision.py`/`recovery_spec.py` (A) already real, mature, and independently tested (`test_theta_h_baseline.py`, `test_covered_call_ranker.py`, `test_recovery_decision.py` all pre-existing). No new competing economic-types module was created for Q/H/C/A. | (pre-existing, unchanged) | (pre-existing, unchanged) | -- |
| 32 | D (THETA_DEFINED_RISK) two-leg economics | REAL_DATA_PRODUCER (genuinely new -- no Python-side D economics module existed; the real canonical formula lives on the TS side, `canonical-strategy-frontier.ts`'s `definedRiskCandidate()`, reproduced exactly here as a Claude-owned quant fixture, plus additive fees/slippage the TS formula does not yet compute) | `models/defined_risk_economics.py` | `test_defined_risk_economics.py` (14: max gain, max loss, between-strikes, both-legs fees, payoff-curve monotonicity) | (this pass) |
| 35 | WAIT outcome representation | REAL_DATA_PRODUCER (genuinely new; T0/matured/counterfactual kept structurally separate) | `research/wait_outcome.py` | `test_wait_outcome.py` (6) | `a61bf4b` |
| 36 | Cost/slippage baseline (liquidity/DTE/leg scaling) | DERIVED_REAL_PRODUCER (additive on top of the pre-existing `models/execution_quality.py`, never duplicated) | `models/cost_slippage_baseline.py` | `test_cost_slippage_baseline.py` (8, all property/monotonicity tests) | `3c89e24` |
| 37 | Fill-probability baseline, label-fitted | SOURCE_IMPLEMENTED, honestly `INSUFFICIENT_SAMPLE` today (0 real BROKER_ACTUAL fill labels exist anywhere in this repo, per WP24's own finding) | `models/fill_probability_baseline.py` | `test_fill_probability_baseline.py` (6) | `3a754b2` |
| 38 | After-cost EV identifiability (IDENTIFIABLE/PARTIAL/NOT_IDENTIFIABLE) | SOURCE_IMPLEMENTED (additive research infra, distinct from `theta_q_baseline.py`'s binary `ev_net`/`ev_net_unknown_reason`) | `research/after_cost_ev_identifiability.py` | `test_after_cost_ev_identifiability.py` (6) | `b8b1d85` |
| 39 | Empirical estimator library (Wilson/bootstrap/PF/AvgWin-Loss/drawdown) | SOURCE_IMPLEMENTED (reuses `dataset_readiness.py`'s real `effective_sample_size`, not duplicated) | `research/empirical_estimators.py` | `test_empirical_estimators.py` (12) | `e2bd5f6` |
| 40 | Assignment label builder (truth hierarchy) | REAL_DATA_PRODUCER (genuinely new; structurally cannot infer from strike crossing -- no such field exists on the input type) | `research/assignment_labels.py` | `test_assignment_labels.py` (7) | `198bf33` |
| 41-46 | Recovery dataset (survival-ready), tail/drawdown dataset, whole-chain outcome builder, management action space, management RTG, 17 profit-taking challengers | **RECONCILED, NOT_REBUILT** -- real search (before writing anything) found ALL SIX already real, mature, and independently tested: `models/recovery_spec.py`'s `SurvivalPoint`/`RecoverySummary`/`summarize_recovery` (WP41, genuinely survival-analysis-shaped already); `models/severe_drawdown_spec.py` + `research/severe_drawdown_dataset.py` (WP42); `research/whole_chain_dataset.py` (WP43); `models/management_action_value.py`'s `evaluate_management_alternatives`/HOLD/CLOSE/EXPIRE/ROLL/ASSIGN/REDEPLOY valuations (WP44); the same module's `hold_advantage` (WP45, RTG); `research/profit_preservation_research.py` (WP46). Verified via their own pre-existing test suites, not assumed: `test_severe_drawdown_and_recovery_specs.py` (21), `test_recovery_decision.py`, `test_whole_chain_dataset.py`, `test_profit_preservation_research.py`, `test_management_action_value.py` (39 combined) -- all pass. No new competing module created for any of the six. | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 47 | Entry dataset | **RECONCILED, NOT_REBUILT** -- `research/entry_episode_training.py`'s `build_entry_episode_training_dataset()` is already a real, mature, PIT-safe entry-episode row builder (dependency grouping, evidence hashes, excluded-reason ledger). Verified via its own pre-existing 18 tests (`test_entry_episode_training.py` + `test_entry_baseline_experiment.py` + `test_entry_feature_ablation.py`), all pass. No new module written. | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 48 | Management dataset | DATASET_BUILDER, genuinely new -- reuses `whole_chain_dataset.py`'s existing chain-join authority; explodes each chain's `ManagementSnapshot`s into T0 rows with the chain's eventual matured label attached under a separate `futureOutcome` key, never merged into the T0 fields. | `research/management_dataset.py` | `test_management_dataset.py` (5) | `4aba63c` |
| 49 | Regime dataset | DATASET_BUILDER, genuinely new -- observed inputs read ONLY through a caller-declared explicit `fieldMapping` (no Codex export key name guessed); baseline regime via existing `models/regime_v0.py`; `challengerRegime` always `NOT_IMPLEMENTED` (no promoted challenger exists per that module's own docstring); future outcome kept separate via the same chain-join reuse as WP48. | `research/regime_dataset.py` | `test_regime_dataset.py` (6) | `7ad0f20` |
| 50 | Fill dataset | DATASET_BUILDER, genuinely new, honestly incomplete by schema -- `dataset_contracts.ExecutionEvidence` mirrors `market.execution_quote_observation` exactly and carries no `filled`/`fillPrice`/`latency`/`cancelReplace` field anywhere in the current Production export schema (read, not assumed). Emits the observable T0 half (arrival BBO/spread/size/contract/quote age/proposed limit as intent) and marks every fill-outcome field explicitly `UNKNOWN` with named `futureIdentifiableFields`. `brokerActualFillCount` is always 0 today, consistent with WP37's own finding. | `research/fill_dataset.py` | `test_fill_dataset.py` (5) | `0f3850e` |
| 51 | Purged walk-forward | **RECONCILED, NOT_REBUILT** -- `research/validation.py`'s `build_purged_walk_forward_plan()`/`build_grouped_walk_forward_plan()` already implement real timestamp/label-aware purging, embargo, dependency-group handling and a frozen final-OOS suffix. Already consumed by `entry_baseline_experiment.py` (WP53). | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 52 | Untouched OOS manifest | SOURCE_IMPLEMENTED, genuinely new -- freezes `final_oos_ids` (already reserved by WP51's plan) into one hashed, immutable manifest (dataset hash, scope/date bounds, creation SHA, split version) plus an explicit `assert_not_used_for_tuning()` guard that raises loudly on any overlap. | `research/oos_manifest.py` | `test_oos_manifest.py` (7) | `bae4a83` |
| 53 | Logistic baselines | **RECONCILED, NOT_REBUILT** -- `research/entry_baseline_experiment.py`'s `execute_entry_baseline()` already fits the shared `fit_logistic_regression` optimizer per purged-walk-forward fold, with `INSUFFICIENT_TRAINING_CLASSES`/`OPTIMIZER_NOT_CONVERGED` states, never a forced fit; `finalOosEvaluated: False` already respects the untouched-OOS rule structurally. | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 54 | Tree baseline | MODEL_BASELINE, genuinely new -- stdlib-only (repo declares zero third-party deps), deterministic depth-limited CART (Gini impurity, midpoint thresholds), `INSUFFICIENT_SAMPLE` below minimum N or with a single class, meant to run on the identical WP51 splits. | `research/tree_baseline.py` | `test_tree_baseline.py` (6) | `bae4a83` |
| 55 | Calibration (Platt/isotonic/Brier/log loss/reliability bins) | **RECONCILED, NOT_REBUILT** -- all already real and tested in `research/validation.py` (`calibration_metrics`, `fit_platt_scaler`, `fit_isotonic_calibrator`), already wired into `entry_baseline_experiment.py`. | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 56 | Cohort calibration | SOURCE_IMPLEMENTED, genuinely new -- groups by any caller-defined cohort key (DTE/delta/regime/ticker/sector) and reuses WP55's `calibration_metrics` per cohort; a cohort below the caller's minimum N is `INSUFFICIENT_SAMPLE`, never a fabricated verdict. | `research/cohort_calibration.py` | `test_cohort_calibration.py` (4) | `3ed6b29` |
| 57 | Model registry | SOURCE_IMPLEMENTED, genuinely new -- generalizes `severe_drawdown_model_contract.py`'s existing `SevereDrawdownArtifactRegistry` pattern (hash-verified, immutable-per-version, promotion-state-gated) to any task instead of adding a second task-specific registry. The severe-drawdown registry itself is untouched, not migrated. | `research/model_registry.py` | `test_model_registry.py` (7) | `3ed6b29` |
| 58 | Experiment registry | **RECONCILED, NOT_REBUILT** -- `research/experiment_registry.py` already persists `ExperimentDefinition`/`ExperimentProtocol` records with `MinimumReadiness` gating and `experiments_eligible_at()`, not only winners. | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 59 | Benchmark execution runner (all canonical IDs classified) | SOURCE_IMPLEMENTED, COMPLETE per V4 section 5 -- `B0` is a full deterministic runner. `B3/B4/B5/B6/BQ-1/BQ-2/BQ-3/BR-1/BR-2/BA-1..3/BC-1/BC-2` each have a real, tested mechanic in `research/benchmark_mechanics.py`; `classify_benchmark_readiness()` assigns exactly one of `RUNNER_IMPLEMENTED_DATA_AVAILABLE`/`RUNNER_IMPLEMENTED_DATA_UNAVAILABLE`/`NOT_APPLICABLE`/`BLOCKED_MISSING_POLICY` to every registered ID -- no ID left as a bare `RUNNER_NOT_IMPLEMENTED` stub. `B1`/`B2`/`BH-1` are `BLOCKED_MISSING_POLICY` (need full multi-stage lifecycle simulation, a real, distinct, larger gap). `A1-A6` are `NOT_APPLICABLE` here (executed by WP60's `entry_feature_ablation.py` instead). Against the real deduped historical archive (WP67-era measurement): every mechanic-implemented ID is `RUNNER_IMPLEMENTED_DATA_UNAVAILABLE` (0 feasible candidates, 0 lifecycle events, no delta field). | `research/benchmark_runner.py`, `research/benchmark_mechanics.py` | `test_benchmark_runner.py` (13), `test_benchmark_mechanics.py` (20) | `dc31cb4` |
| 60 | Ablations (A1-A6 style, baseline vs baseline+one change) | **RECONCILED, NOT_REBUILT** -- `research/entry_feature_ablation.py`'s `execute_entry_feature_ablation()` already runs strict feature-subset variants on identical purged-walk-forward splits, paired via `ablation.py`'s `paired_mean_difference`, with named `INSUFFICIENT_OR_PARTIAL_PAIRED_EVIDENCE` states. Verified via its own 23 pre-existing tests (`test_entry_feature_ablation.py` + `test_ablation.py`), all pass. | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 61 | DSR (Deflated Sharpe Ratio) | **RECONCILED, NOT_REBUILT** -- `research/selection_bias.py`'s `deflated_sharpe_ratio()` already real and tested. | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 62 | PBO (Probability of Backtest Overfitting) | **RECONCILED, NOT_REBUILT** -- `research/selection_bias.py`'s `probability_of_backtest_overfitting()` plus `selection_bias_runner.py`'s `run_selection_bias_campaign()` already real and tested (28 pre-existing tests, all pass). | (pre-existing, unchanged) | (pre-existing, unchanged, verified) | -- |
| 63 | Multiple-testing ledger | SOURCE_IMPLEMENTED, genuinely new -- links `experiment_registry.py`'s real `EXPERIMENTS_BY_ID` trial definitions to `selection_bias_runner.py`'s `trialIdentities` input; an unregistered trial id is rejected, never silently dropped; enforces the runner's own subject-first convention. | `research/multiple_testing_ledger.py` | `test_multiple_testing_ledger.py` (7) | `873267b` |
| 64 | Failure attribution | SOURCE_IMPLEMENTED, genuinely new -- multi-label, evidence-cited attribution across DECISION/CONTRACT/SIZE/LIMIT/EXECUTION/REGIME/FLOW/MANAGEMENT/PROVIDER/STATE_MACHINE/ACCOUNTING/DATA_QUALITY. No catch-all label; unmatched evidence is `UNATTRIBUTED`, never forced into the nearest category. | `research/failure_attribution.py` | `test_failure_attribution.py` (5) | `ca81807` |
| 65 | Experience memory | SOURCE_IMPLEMENTED, genuinely new -- evidence retrieval by strategy/regime/DTE/delta/IV/skew/flow/management/drawdown/recovery/reason code. Returns every match in deterministic order; never ranks, scores, or narrows toward an outcome -- explicitly retrieval, not a hidden selector. | `research/experience_memory.py` | `test_experience_memory.py` (7) | `ca81807` |
| 66 | Reproducibility bundle | SOURCE_IMPLEMENTED, genuinely new -- assembles source SHA/dataset+config hashes/feature+label+model versions/split hash/seed/experiment ID/metric hash into one frozen bundle; `verify_reproducibility_bundle()` rebuilds and re-hashes to catch a hand-edited bundle. Reuses the existing canonical-JSON/SHA-256 convention, no second hashing authority. | `research/reproducibility_bundle.py` | `test_reproducibility_bundle.py` (5) | `ca81807` |

## Historical-data recovery pass (V3 section 4, this pass)

Before permanently accepting WP25/26 `BLOCKED_DATA`, ran one bounded,
non-destructive discovery pass (read-only; no Codex Production file or
database touched):

- `C:\ProjectBackups\trading-bots\daily\` (real, dated backup snapshots):
  found genuine Production research-export artifacts under
  `external-assets/research_exports/` -- 110-111 hash-named export
  directories, each with `manifest.json`/`dataset.json`/`handoff.json`/
  `data-quality.json`. Aggregated `rowCounts` across all of them:
  `candidateSets=12172, candidates=64923, shadowCandidates=76399,
  executionEvidence=102975, outcomeSubjects=822,
  outcomeResolutionReceipts=224` (all other row kinds 0). Source window
  covers **2026-09-14 to 2026-09-15 only** -- this does NOT match the
  V3-cited coarse counts (Sep16=139, Sep18=4590, Sep21=3876, total=8605,
  ~1342 executable). Those specific dates/counts were not found anywhere
  in this pass (also checked `.git/worktrees`, the `theta-mgmt-intelligence`
  worktree, the Codex `read-all-my-files-in-depth/work/*` checkouts, and a
  full home-directory `*.sqlite` sweep -- no `theta-evidence.sqlite` or
  other historical evidence spool was found anywhere reachable from this
  machine account today).
- **Schema-version blocker, not absence**: the found exports declare
  `"schemaVersion": "theta-r6-dataset-v1"`. The current, in-repo loader
  (`research/production_export_loader.py`) requires
  `DATASET_SCHEMA_VERSION = "theta-r6-dataset-v6"` and fails loudly (by
  design -- "there is no best-effort parsing path") on any version
  mismatch. Ingesting these v1 exports today would require either an
  explicit, versioned schema-compatibility bridge or a Codex/owner
  decision to reconcile v1->v6 -- not a silent shim invented in this
  pass. Classified `BLOCKED_CODEX` (schema-version reconciliation), not
  `BLOCKED_DATA` (absence) -- a materially different, more specific
  finding than the prior N=1 conclusion.
- WP25/26 remain **not completed** pending that schema reconciliation
  decision; this does not block WP47-58 above, which operate on
  `DatasetExportArtifact`/`LoadedDatasetExport` fixtures at the current
  v6 schema, per the existing test convention.
## Historical dedupe + v1->v6 bridge (V4, before WP67)

Git-history investigation (commits f9dff66..fa7e589 in
`src/research/point-in-time-evidence.ts`) proved v1->v6 is purely
additive at the row-family level -- no field inside candidates/
candidateSets/shadowCandidates/strategyFrontiers/managementSnapshots/
lifecycleOutcomes/wholeChainOutcomes/executionEvidence was ever renamed,
removed, or had its semantics changed. `research/historical_v1_to_v6_bridge.py`
implements the lenient, research-only loader this proof licenses; found
and documented (not silently worked around) that the archived files'
declared `datasetHash` cannot be reproduced from their own content via the
documented formula -- `source_hash_verified` is always computed and
reported, never assumed. `research/historical_export_dedupe.py` addresses
archive-copy duplication (666 raw directories -> 109 unique by manifest
content) and cross-snapshot row duplication (109 unique snapshots' summed
rowCounts still overcounts vs. 7550 true unique candidateIds). Verified
against the full real archive: 109/109 conversions succeed, 0 errors.

**Re-measured real unique history** (V4 section 3, deduped, not raw sums):
date range 2026-09-14 13:30 to 2026-09-15 15:46 UTC only (Sep16/18/21 were
searched for and NOT found anywhere reachable on this machine -- see the
prior pass's historical-data-recovery note); 302 unique candidate sets
(decisions); 7550 unique candidates; 8731 unique execution-evidence rows;
0 selected candidates; every candidate `hardStatus=DATA_INSUFFICIENT`,
`softStatus=REJECTED`, `rejectionReason=CONTRACT_NOT_EXECUTABLE` (100%,
uniform, zero variance); 0 management snapshots, 0 lifecycle outcomes, 0
whole-chain outcomes anywhere; 13 unique underlyings; every opaque
feature family (volatility/technical/event/flow/ownership/account/
portfolio/aegis/execution/knownEconomics) present on 100% of candidates
(schema populated) but decisive fields UNKNOWN (ownership acceptability,
AEGIS state, event state, open interest all UNKNOWN for 100%; no `delta`
field anywhere).

**WP25/26 status**: real, deduped, unique historical population now
exists (7550 candidates) and supports population-level analysis (this is
new -- the strictness/coverage side of WP25 is no longer purely
`BLOCKED_DATA`), but the economic/filter-VALUE side remains blocked: 0%
selection rate and 100% identical rejection reason means there is no
outcome variance to analyze filter sensitivity against. `WP25_STATUS =
POPULATION_DATA_AVAILABLE_ZERO_OUTCOME_VARIANCE`. `WP26_STATUS =
BLOCKED_DATA` (feature ablation needs a resolved outcome to ablate
against; none exists). The v1 schema-hash-verification gap is
`BLOCKED_CODEX` (needs Codex/owner reconciliation), separate from the
data-availability finding.

| 67 | Future capture contract | SOURCE_IMPLEMENTED, genuinely new -- registry of unrecoverable fields (fills, assignment/exercise/expiration, future BBO/IV/Greeks, management/whole-chain outcome) with full contract + generated Codex handoffs for required fields. | `research/future_capture_contract.py` | `test_future_capture_contract.py` (7) | `e247245` |
| 68 | Horizon adapters | SOURCE_IMPLEMENTED, genuinely new -- +15m/+1h/EOD/+1d/+3d/+5d, no provider calls, `captured=None` -> explicit UNKNOWN. Synthetic tests, labeled. | `research/horizon_adapters.py` | `test_horizon_adapters.py` (8) | `03e457b` |
| 69 | Expiration outcome | SOURCE_IMPLEMENTED, genuinely new -- EXPIRED_OTM/EXPIRED_ITM_NO_ASSIGNMENT_EVIDENCE/ASSIGNED/EXERCISED/CLOSED_BEFORE_EXPIRY/UNKNOWN/CENSORED. ITM alone never infers assignment. | `research/expiration_outcome.py` | `test_expiration_outcome.py` (8) | `45cf65b` |
| 70 | Management checkpoint outcomes | SOURCE_IMPLEMENTED, genuinely new -- composes over management_dataset.py (WP48) + whole_chain_dataset.py's lifecycleEvents into four explicitly separate fields (T0/later-market/later-lifecycle/whole-chain). | `research/management_checkpoint_outcomes.py` | `test_management_checkpoint_outcomes.py` (4) | `45cf65b` |
| 71 | Truth firewall | SOURCE_IMPLEMENTED, genuinely new -- blocks MODELED_RESEARCH->BROKER_ACTUAL / SYNTHETIC_FIXTURE->REAL_HISTORICAL / RECONSTRUCTED->BROKER_ACTUAL / RESEARCH_BASELINE->PRODUCTION_CANONICAL without complete promotion evidence. | `research/truth_firewall.py` | `test_truth_firewall.py` (6) | `8f6b033` |
| 72 | Source data validation | SOURCE_IMPLEMENTED, genuinely new -- non-fatal structured report (schema version, hash, duplicate identity, future timestamps, multiplier sanity, window ordering), distinct from the fail-fast loaders. | `research/source_data_validation.py` | `test_source_data_validation.py` (7) | `8f6b033` |
| 73 | Missingness engine | SOURCE_IMPLEMENTED, genuinely new -- present/missing by any combination of feature/field/date/strategy/schemaVersion/provider/truthClass/reasonCode, schema-agnostic. | `research/missingness_engine.py` | `test_missingness_engine.py` (6) | `ed8928d` |
| 74 | Coverage report (deduped) | SOURCE_IMPLEMENTED, genuinely new -- takes an already-deduplicated Candidate sequence, rejects duplicate candidate_id outright. | `research/historical_coverage_report.py` | `test_historical_coverage_report.py` (5) | `ed8928d` |
| 75 | Strictness/economics join | SOURCE_IMPLEMENTED, genuinely new -- joins only on resolved identity + valid horizon; joined rows carry `executionAuthority=False` and an explicit non-causal label. | `research/strictness_economics_join.py` | `test_strictness_economics_join.py` (5) | `6c95359` |
| 76 | Q-blocked/D-available cohort | SOURCE_IMPLEMENTED, genuinely new -- cohort membership only; `dExecutionAuthority` always False. | `research/q_blocked_d_available_cohort.py` | `test_q_blocked_d_available_cohort.py` (3) | `6c95359` |
| 77 | WAIT analysis | SOURCE_IMPLEMENTED, genuinely new -- classifies wait_outcome.py's (WP35, unchanged) opportunity cost into AVOIDED_LOSS/MISSED_OPPORTUNITY/UNIDENTIFIABLE_COUNTERFACTUAL. | `research/wait_analysis.py` | `test_wait_analysis.py` (4) | `6c95359` |
| 78 | Management accounting fixtures | SOURCE_IMPLEMENTED, genuinely new -- proves roll old-leg realized-loss persistence, fees-once-per-leg, capital-days/basis composition across the full lifecycle. | `research/management_accounting_fixtures.py` | `test_management_accounting_fixtures.py` (7) | `73d64c1` |
| 79 | AEGIS fixtures | **RECONCILED, NOT_REBUILT** -- hard-veto/unknown-fails-safe already real & tested (`test_aegis.py`/`test_aegis_contract.py`, unchanged); added the one missing monotonicity property against real `models.aegis.assess_aegis()`. | (pre-existing + 1 new test file) | `test_aegis_monotonicity_property.py` (2) | `73d64c1` |
| 80 | Sizing fixtures | **RECONCILED, NOT_REBUILT** -- 0/low BP, collateral/assignment/portfolio caps, qty-zero, never-floored-to-1, no-martingale, mismatched-multiplier-blocked all already real & tested. No "strategy cap" dimension exists anywhere today -- named gap, not filled. | (pre-existing, unchanged) | (pre-existing, verified) | -- |
| 81 | Economic property tests | SOURCE_IMPLEMENTED, genuinely new -- fees/slippage/commission increases proven to never increase `defined_risk_economics.py`'s real `net_credit_after_cost`; D's both-leg cost inclusion proven, not assumed. | `test_economic_monotonicity_property.py` (4) | -- | `73d64c1` |
| 82 | Generic PIT leakage harness | SOURCE_IMPLEMENTED, genuinely new -- reusable `assert_pit_invariant()`, applied against real trend/momentum/realized-volatility code. Found+fixed a test-construction pitfall (these modules encode "now" via array length; must mutate future VALUES in place, never append past the end). | `research/pit_leakage_harness.py` | `test_pit_leakage_harness.py` (4) | `6973e7f` |
| 83 | Research CLI | SOURCE_IMPLEMENTED, genuinely new -- unified `research_cli.py` dispatches historical-convert/historical-dedupe/missingness/coverage/strictness/benchmark/ablation/calibration/selection-bias/reproducibility-verify to their real, existing modules. `features`/`dataset-build`/`filter-value` report `BLOCKED_MISSING_INTEGRATION` honestly. | `research/research_cli.py` | `test_research_cli.py` (9) | `c02c2bc` |
| 84 | Performance/memory | SOURCE_IMPLEMENTED, genuinely new -- no O(N^2) algorithmic issue found in `production_export_loader.py`'s validation helpers (both O(N)/O(N log N)); the real gap was `historical_export_dedupe.py`'s eager API forcing every archive copy's dataset.json to be parsed even for known duplicates. `deduplicate_historical_exports_lazy()` fixes this, proven by a test that counts thunk invocations (a known duplicate's dataset.json is never loaded). | `research/historical_export_dedupe.py` (extended) | `test_historical_export_dedupe_lazy.py` (5) | `1a45be8` |
| 85 | Storage classification | SOURCE_IMPLEMENTED, genuinely new -- reuses (imports, not re-declares) `future_capture_contract.py`'s five-class vocabulary. An artifact over 1MB can never classify `SOURCE_CONTROL` regardless of kind. | `research/storage_classification.py` | `test_storage_classification.py` (7) | `6e36804`, fixed `5efed7d` |
| 86 | Codex handoff pack | SOURCE_IMPLEMENTED, genuinely new -- generalizes `future_capture_contract.py`'s handoff shape to any runtime/app need. Rejects a handoff missing any required field or targeting a non-Codex-owned layer. | `research/codex_handoff_pack.py` | `test_codex_handoff_pack.py` (6) | `6e36804` |
| 87 | Phase 6 real experiment run | DOCUMENTATION, real run recorded -- maximum honest campaign against the full deduplicated real archive: 0 selected candidates, 0 outcomes anywhere, 100% uniform `CONTRACT_NOT_EXECUTABLE` rejection. No model fit, no split, no calibration/DSR/PBO run -- nothing to fit them from. No target-WR tuning occurred. | -- | -- | `docs/research/THETA_CLAUDE_PHASE6_REAL_EXPERIMENT_RECEIPT.md`, `636d8ec` |
| 88 | Shadow prediction receipts | SOURCE_IMPLEMENTED, genuinely new -- model/version/input hash/prediction/calibration/uncertainty/T0/truth class; `broker_authority` always False structurally; `truth_class` must be research-tier, cross-checked against `truth_firewall.py` (WP71, unchanged) at construction. | `research/shadow_prediction_receipt.py` | `test_shadow_prediction_receipt.py` (6) | `48b3c02` |
| 89 | Promotion evidence assembler | SOURCE_IMPLEMENTED, genuinely new -- refuses to assemble a promotion packet unless every mandatory category (PIT/baseline/ablation/OOS/cost/risk/calibration/sample size/selection-bias controls/reproducibility) is present and substantive. Never grants promotion itself. | `research/promotion_evidence_assembler.py` | `test_promotion_evidence_assembler.py` (6) | `48b3c02` |
| 90 | Drift detection | SOURCE_IMPLEMENTED, genuinely new -- one generic comparator covers feature/prediction/calibration/regime-mix/label drift, each with minimum-N gating and window-bounds metadata. | `research/drift_detection.py` | `test_drift_detection.py` (6) | `828e6b3` |
| 91 | Paper analysis readiness | SOURCE_IMPLEMENTED, genuinely new -- fills/partials/cancel-replace/TCA/assignment/expiry/exercise/management/whole-chain adapters. No real Paper trading has occurred in this repo yet; `evidence=None` reports `NOT_YET_CAPTURED_NO_REAL_PAPER_DATA` explicitly. | `research/paper_analysis_readiness.py` | `test_paper_analysis_readiness.py` (6) | `8668de5` |
| 92 | Paper-vs-model discrepancy | SOURCE_IMPLEMENTED, genuinely new -- fill-probability/fill-price/slippage/assignment/management-RTG/cost-model error, computed only when both modeled and real sides are present. Calibration-drift piece reuses `validation.py`'s real `calibration_metrics` (WP55, unchanged). | `research/paper_model_discrepancy.py` | `test_paper_model_discrepancy.py` (10) | `8668de5` |
| 93 | Graduation metric engine | SOURCE_IMPLEMENTED, genuinely new -- assembles the full graduation metric set from real, existing per-metric producers elsewhere; the one genuinely new piece is `expected_shortfall` (ES/CVaR), which had no producer anywhere in this repo before. `liveAuthorization` always `NOT_GRANTED`. | `research/graduation_metric_engine.py` | `test_graduation_metric_engine.py` (7) | `4edf846` |
| 94 | Release evidence matrix | SOURCE_IMPLEMENTED, genuinely new -- classifies each named release criterion into exactly one of `PASS_EVIDENCE_PRESENT`/`FAIL`/`INSUFFICIENT_DATA`/`EXTERNAL_RUNTIME_REQUIRED`/`NOT_APPLICABLE`. | `research/release_evidence_matrix.py` | `test_release_evidence_matrix.py` (9) | `4edf846` |
| 95 | Cross-module E2E | TESTED, real chain -- `models.aegis.assess_aegis` -> `models.sizing.compute_sizing` (risk state proven to propagate through to zero size under `HARD_VETO`) -> `entry_episode_training.py` (WP47) -> `entry_baseline_experiment.py` (WP53/55) -> `reproducibility_bundle.py` (WP66). No defects found in this specific chain. | -- | `test_cross_module_e2e.py` (2) | `2eddef0` |
| 96 | Adversarial matrix | TESTED, 2 real defects found and fixed -- most of the 19 named conditions were already covered by their own producer module's suite (documented in the test file). Found: `convert_historical_export()` silently defaulted a missing `rows` key to `{}` (fabricating a zero-candidate result for a corrupted archive) and never validated `sourceWindow.start`/`end` presence. Both are now hard `DatasetLoadError` rejections. | `research/historical_v1_to_v6_bridge.py` (fixed) | `test_adversarial_matrix.py` (4) | `3a23d94` |
| 97 | Duplicate authority search | TESTED, 1 real duplicate found and fixed -- `storage_classification.py` (WP85) had re-declared `future_capture_contract.py`'s (WP67) exact `STORAGE_CLASSES` tuple as a literal copy instead of an import. Fixed. `model_registry.py` vs `severe_drawdown_model_contract.py`'s registry is an intentional, already-documented non-migration (left as is). | `research/storage_classification.py` (fixed) | (existing tests re-verified) | `5efed7d` |
| 98 | TODO/placeholder elimination | VERIFIED CLEAN -- searched `bots/theta/quant/{research,features,models}` for TODO/FIXME/NotImplementedError/bare stubs. Found exactly one: `models/severe_drawdown_spec.py`'s `NotImplementedError` for non-`PERCENT_FROM_ENTRY` drawdown threshold families -- already deliberately documented as "deferred until a concrete need is validated, rather than guessed here," a legitimate scope boundary, not a lazy stub. Not touched (per this WP's own instruction: never erase legitimate blocked truth). | -- | -- | (no code change; verification only) |
| 99 | Full test gate | PASS -- `python -m pytest bots/theta/tests -q`: **1224 passed, 11 subtests passed, 0 fail.** 0 TypeScript/JavaScript files touched across the entire session (verified via `git diff --name-only` against the frozen start SHA) -- no `tsc`/`eslint` re-run needed. Security: no `.env`/credential files touched, no secret-shaped strings found in the full session diff. Research CLI smoke-tested via an actual subprocess invocation (`benchmark B0` -> real JSON on stdout). | -- | (full suite) | -- |
| 100 | Final ledger reconciliation | See the dedicated section below. | -- | -- | -- |

## Design decisions carried across every DONE package (so future packages stay consistent)

- One canonical `FeatureResult` contract (WP01) -- every feature family
  converts into it via a thin adapter next to its own producer, never a
  parallel/competing shape.
- Truth class (`MARKET_OBSERVED`/`DERIVED_FROM_OBSERVED`/`MODELED_RESEARCH`/
  `POLICY`/`MANUAL`/`UNKNOWN`) is orthogonal to state (`OK`/`UNKNOWN`/
  `STALE`/`INSUFFICIENT_HISTORY`/`INSUFFICIENT_COVERAGE`/
  `INSUFFICIENT_SAMPLE`/`INVALID`/`NOT_APPLICABLE`) -- never conflated.
  A value can be `state=OK, truth_class=MODELED_RESEARCH`.
  A missing wing/coverage never silently produces a value.
- Every module reuses `research/parquet_archive.py`'s existing canonical-
  JSON/SHA-256 convention for hashing -- no second hashing authority
  introduced.
  - Staleness composes across the stack: `iv.py` filters stale IVs to
  `UNKNOWN` before they ever reach `skew.py`/`term_structure.py`/
  `volatility_surface.py` -- those modules never re-implement staleness,
  they just correctly report `INSUFFICIENT_COVERAGE` when an upstream
  producer already excluded a stale point.
- Where no canonical THETA-specific formula exists in `docs/quant/` (SKEW,
  WP05), the module says so explicitly and documents the baseline
  convention chosen, rather than inventing silent policy or blocking.

## Full Python suite after WP11

797 passed, 11 subtests, 0 fail (`python -m pytest bots/theta/tests -q`).
No TypeScript/JavaScript file touched this session; `tsc`/`eslint` were
verified clean once at session start (no reason to re-run per-package
since no TS file changed).

## WP100 — Final ledger reconciliation

Every WP number below has **exactly one** current state, drawn only from
the seven states V4 section 39 specifies:
`COMPLETE_SOURCE` / `RECONCILED_EXISTING` / `BLOCKED_DATA` / `BLOCKED_CODEX`
/ `BLOCKED_FUTURE_TIME` / `NOT_APPLICABLE` / `EMPIRICAL_INSUFFICIENT_SAMPLE`.
This table is the authoritative final state; the detailed rows earlier in
this document are the evidence trail behind each one and are not
separately authoritative where they used an earlier, superseded
vocabulary (`SOURCE_IMPLEMENTED`, `REAL_DATA_PRODUCER`, etc. — those terms
remain accurate *description*, but the state that counts for graduation
purposes is the one here). `COMPLETE_SOURCE` means real, tested source
code exists and is complete for its stated scope — it is **not** a claim
of empirical/statistical validation; every WP that attempted real
empirical validation and came up short on sample is marked
`EMPIRICAL_INSUFFICIENT_SAMPLE` explicitly, never folded into
`COMPLETE_SOURCE`.

| WP | Final state |
|---|---|
| 01 | COMPLETE_SOURCE |
| 02 | COMPLETE_SOURCE |
| 03 | COMPLETE_SOURCE |
| 04 | COMPLETE_SOURCE |
| 05 | COMPLETE_SOURCE (RESEARCH_BASELINE classification permanently attached — never production-decisive without a separate promotion decision) |
| 06 | COMPLETE_SOURCE |
| 07 | COMPLETE_SOURCE |
| 08 | COMPLETE_SOURCE |
| 09 | COMPLETE_SOURCE |
| 10 | COMPLETE_SOURCE |
| 11 | COMPLETE_SOURCE |
| 12 | COMPLETE_SOURCE |
| 13 | BLOCKED_DATA (no authorized sector/GICS provider exists) |
| 14 | COMPLETE_SOURCE |
| 15 | COMPLETE_SOURCE |
| 16 | COMPLETE_SOURCE |
| 17 | BLOCKED_DATA (no authorized fundamental-quality provider exists) |
| 18 | COMPLETE_SOURCE |
| 19 | COMPLETE_SOURCE |
| 20 | COMPLETE_SOURCE |
| 21 | COMPLETE_SOURCE |
| 22 | COMPLETE_SOURCE |
| 23 | COMPLETE_SOURCE |
| 24 | COMPLETE_SOURCE (Sep24 loader real and complete; the missing Sep16/18/21 sub-finding is carried under WP25/26 below, not duplicated here) |
| 25 | EMPIRICAL_INSUFFICIENT_SAMPLE (a real, deduplicated 7550-candidate population exists — this is not `BLOCKED_DATA` absence — but 0% selection rate and 100% identical rejection reason leave no outcome variance to measure filter sensitivity against) |
| 26 | BLOCKED_DATA (feature ablation requires a resolved outcome label; none exists anywhere in the recovered archive) |
| 27 | COMPLETE_SOURCE |
| 28 | COMPLETE_SOURCE |
| 29-31 | RECONCILED_EXISTING |
| 32 | COMPLETE_SOURCE |
| 33-34 | RECONCILED_EXISTING (folded into the WP29-31 reconciliation: A/C economics) |
| 35 | COMPLETE_SOURCE |
| 36 | COMPLETE_SOURCE |
| 37 | EMPIRICAL_INSUFFICIENT_SAMPLE (label-fitted baseline is real and tested; 0 real `BROKER_ACTUAL` fill labels exist anywhere in this repo) |
| 38 | COMPLETE_SOURCE |
| 39 | COMPLETE_SOURCE |
| 40 | COMPLETE_SOURCE |
| 41-46 | RECONCILED_EXISTING |
| 47 | RECONCILED_EXISTING |
| 48 | COMPLETE_SOURCE |
| 49 | COMPLETE_SOURCE |
| 50 | COMPLETE_SOURCE (schema-honest: fill outcome fields are structurally `UNKNOWN`, not a partial implementation) |
| 51 | RECONCILED_EXISTING |
| 52 | COMPLETE_SOURCE |
| 53 | RECONCILED_EXISTING |
| 54 | COMPLETE_SOURCE |
| 55 | RECONCILED_EXISTING |
| 56 | COMPLETE_SOURCE |
| 57 | COMPLETE_SOURCE |
| 58 | RECONCILED_EXISTING |
| 59 | COMPLETE_SOURCE (the classification engine and every mechanic are complete; `B1`/`B2`/`BH-1`'s own internal state is `BLOCKED_MISSING_POLICY` and every mechanic-implemented ID's real-data state is `RUNNER_IMPLEMENTED_DATA_UNAVAILABLE` — both are sub-details carried in the WP59 narrative row above, not separate top-level WPs) |
| 60 | RECONCILED_EXISTING |
| 61 | RECONCILED_EXISTING |
| 62 | RECONCILED_EXISTING |
| 63 | COMPLETE_SOURCE |
| 64 | COMPLETE_SOURCE |
| 65 | COMPLETE_SOURCE |
| 66 | COMPLETE_SOURCE |
| 67 | COMPLETE_SOURCE |
| 68 | COMPLETE_SOURCE |
| 69 | COMPLETE_SOURCE |
| 70 | COMPLETE_SOURCE |
| 71 | COMPLETE_SOURCE |
| 72 | COMPLETE_SOURCE |
| 73 | COMPLETE_SOURCE |
| 74 | COMPLETE_SOURCE |
| 75 | COMPLETE_SOURCE |
| 76 | COMPLETE_SOURCE |
| 77 | COMPLETE_SOURCE |
| 78 | COMPLETE_SOURCE |
| 79 | RECONCILED_EXISTING (plus one new property test) |
| 80 | RECONCILED_EXISTING |
| 81 | COMPLETE_SOURCE |
| 82 | COMPLETE_SOURCE |
| 83 | COMPLETE_SOURCE |
| 84 | COMPLETE_SOURCE |
| 85 | COMPLETE_SOURCE |
| 86 | COMPLETE_SOURCE |
| 87 | EMPIRICAL_INSUFFICIENT_SAMPLE (the maximum honest campaign against the full deduplicated real archive: 0 selected candidates, 0 outcomes anywhere — a real, negative empirical result, not an infrastructure gap) |
| 88 | COMPLETE_SOURCE |
| 89 | COMPLETE_SOURCE |
| 90 | COMPLETE_SOURCE |
| 91 | COMPLETE_SOURCE |
| 92 | COMPLETE_SOURCE |
| 93 | COMPLETE_SOURCE |
| 94 | COMPLETE_SOURCE |
| 95 | COMPLETE_SOURCE |
| 96 | COMPLETE_SOURCE (2 real defects found and fixed as part of completing this WP) |
| 97 | COMPLETE_SOURCE (1 real duplicate found and fixed as part of completing this WP) |
| 98 | COMPLETE_SOURCE (verification found nothing to fix; the one `NotImplementedError` found is a deliberate, documented, pre-existing scope boundary, not touched) |
| 99 | COMPLETE_SOURCE (full gate passed: 1224 passed / 11 subtests / 0 fail; 0 TS files touched; no secrets found) |
| 100 | COMPLETE_SOURCE (this reconciliation itself) |

**Cross-cutting finding not owned by a single WP number**: the real
archived exports' declared `datasetHash` cannot be reproduced from their
own content via the documented Production hashing formula (found during
the historical-bridge work preceding WP67). This is `BLOCKED_CODEX` —
resolving it requires Codex/owner input into why the archived files and
the documented formula disagree — and is tracked there, not attached to
any single WP number above.

No `BLOCKED_FUTURE_TIME` state applies to any WP above: every genuine
future-dependency (real fills, real Paper trading, real assignment
events) is already correctly represented as either `BLOCKED_DATA` (WP26,
WP37) or `EMPIRICAL_INSUFFICIENT_SAMPLE` (WP25, WP87), since the
blocking condition is "this data has never existed in this repo," not "a
specific future date has not yet arrived."
