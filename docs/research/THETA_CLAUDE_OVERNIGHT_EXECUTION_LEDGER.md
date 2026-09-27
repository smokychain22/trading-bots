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

SKEW (WP05) carries an additional, permanent classification:
`RESEARCH_BASELINE`, never canonical Production THETA policy -- see
`features/skew.py`'s own `skew_feature_classification()`. It must not
become production-decisive without an explicit canonical-definition/
promotion decision recorded in `docs/quant/` first.

## Work package status (V2's numbered queue)

| WP | Capability | Status | Source files | Tests | Commit |
|---|---|---|---|---|---|
| 01 | Canonical FeatureResult contract | SOURCE_IMPLEMENTED | `features/feature_contract.py` | `test_feature_contract.py` (9) | `774a41f` |
| 02 | TREND/MOMENTUM integration into contract | SOURCE_IMPLEMENTED | `features/trend.py`, `features/momentum.py` (adapters) | `test_feature_contract.py` | `774a41f` |
| 03 | REALIZED_VOLATILITY integration | SOURCE_IMPLEMENTED | `features/realized_volatility.py` (`close_to_close_realized_volatility_result`) | `test_realized_volatility_result.py` (9) | `c15d056` |
| 04 | IV feature | SOURCE_IMPLEMENTED | `features/iv.py` | `test_iv.py` (8) | `aae1dd0` |
| 05 | SKEW feature | SOURCE_IMPLEMENTED, classification=RESEARCH_BASELINE (no canonical THETA formula existed; documented and function-flagged as such, never production-decisive without explicit promotion) | `features/skew.py` | `test_skew.py` (10) | `368bd25` (+ this pass's classification fix) |
| 06 | TERM_STRUCTURE feature | SOURCE_IMPLEMENTED | `features/term_structure.py` | `test_term_structure.py` (8) | `c350a67` |
| 07 | VOLATILITY_SURFACE feature | SOURCE_IMPLEMENTED | `features/volatility_surface.py` | `test_volatility_surface.py` (6) | `d81d32f` |
| 08 | VOLUME_OPEN_INTEREST feature | SOURCE_IMPLEMENTED | `features/volume_open_interest.py` | `test_volume_open_interest.py` (6) | `0cd7449` |
| 09 | FLOW feature | SOURCE_IMPLEMENTED | `features/flow.py` | `test_flow.py` (11) | `eabbaeb` |
| 10 | UNUSUAL_ACTIVITY feature | SOURCE_IMPLEMENTED | `features/unusual_activity.py` | `test_unusual_activity.py` (9) | `0a98898` |
| 11 | LIQUIDITY feature | SOURCE_IMPLEMENTED | `features/liquidity.py` | `test_liquidity.py` (9) | `bcd04c9` |
| 12 | EVENT_CONTEXT feature | IN_PROGRESS | -- | -- | -- |
| 13-20 | SECTOR, CORRELATION, PORTFOLIO_EXPOSURE, DRAWDOWN/RECOVERY, FUNDAMENTAL_QUALITY, REGIME (finish), EXECUTION_QUALITY, 20-family bundle | NOT_STARTED | -- | -- | -- |
| 21-26 | Feature definitions registry, router research adapter, strictness funnel engine, historical loaders, filter-value analysis, Phase 2 ablations | NOT_STARTED | -- | -- | -- |
| 27-28 | Immutable quant snapshot contract, T0 research adapter | NOT_STARTED | -- | -- | -- |
| 29-46 | Economic types + Q/H/D/A/C/WAIT economics, cost/slippage model, fill probability, after-cost EV, empirical estimators, assignment/recovery/tail datasets, whole-chain outcomes, management action space/RTG, profit-taking challengers | NOT_STARTED | -- | -- | -- |
| 47-58 | Entry/management/regime/fill datasets, purged walk-forward, untouched OOS, logistic/tree baselines, calibration (+cohort), model registry, experiment registry | NOT_STARTED | -- | -- | -- |
| 59-66 | Benchmarks B0-B6, ablations A1-A6, DSR, PBO, multiple-testing ledger, failure attribution, experience memory, reproducibility bundle | NOT_STARTED (BLOCKED_DATA for the benchmark/ablation runs specifically -- no unified historical dataset loader exists yet to feed them, per WP24 being not started) | -- | -- | -- |
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
