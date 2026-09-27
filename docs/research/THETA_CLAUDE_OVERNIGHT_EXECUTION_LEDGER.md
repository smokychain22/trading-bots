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
| 33-46 | A/C economics extension (if genuinely incomplete), WAIT outcomes, cost/slippage baseline, fill-probability baseline, after-cost EV identifiability, empirical estimators, assignment/recovery/tail datasets, whole-chain outcomes, management action space/RTG, profit-taking challengers | NOT_STARTED (next) | -- | -- | -- |
| 47-58 | Entry/management/regime/fill datasets, purged walk-forward, untouched OOS, logistic/tree baselines, calibration (+cohort), model registry, experiment registry | NOT_STARTED | -- | -- | -- |
| 59-66 | Benchmarks B0-B6, ablations A1-A6, DSR, PBO, multiple-testing ledger, failure attribution, experience memory, reproducibility bundle | BLOCKED_DATA for real-data runs (same N=1 constraint as WP25-26); infrastructure NOT_STARTED | -- | -- | -- |
| 67-77 | Future capture contracts, outcome-horizon adapters, expiration/management-checkpoint outcomes, observed/modeled/broker firewall, source validation, missingness audit, coverage report, strictness-vs-economics join, Q-vs-D cohort, WAIT alternatives analysis | NOT_STARTED | -- | -- | -- |
| 78-84 | Management-chain accounting fixtures, AEGIS/sizing quant contract fixtures, economic monotonicity property tests, leakage test harness, research CLI, performance/memory | NOT_STARTED | -- | -- | -- |
| 85-100 | Storage classification, Codex handoff pack, Phase 6 real experiment run, shadow prediction receipts, promotion evidence assembler, drift detection, Paper analysis readiness, Paper-vs-model discrepancy, graduation metric engine, release-gate evidence matrix, final integration test, adversarial matrix, duplicate-authority search, TODO elimination, full test gate, final ledger reconciliation | NOT_STARTED | -- | -- | -- |

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
