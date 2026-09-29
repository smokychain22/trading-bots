# THETA Phase 6 Unified Closure Receipt

Receipt date: 2026-09-29

START_SHA = c9d61d5a3a803b1e7f0be8aa726fddf7cde2eed1

SOURCE_SHA = 4e0278dda98c0eb0f0b279615055883710a09ee2

STATE = SOURCE_COMPLETE_EMPIRICAL_PENDING

This receipt covers research capture, datasets, counterfactual mechanics,
validation and promotion governance. It does not claim fitted profitability,
resolved Paper outcomes, empirical strategy superiority, broker authority or
permission to submit an order.

## Historical provenance

The legacy v1 hash investigation remains immutable. The original exporter
hashed PostgreSQL `Date` values as empty objects in 104 of 109 recovered unique
exports while the files stored timestamp strings. The forensic verifier can
reproduce each producer hash, but those 104 hashes do not protect timestamp
content. They remain `STRUCTURAL_EVIDENCE_ONLY`.

The current v6 export contract serializes `Date` values to ISO-8601, sorts
object keys, binds schema and feature versions, strategy versions, source
window, row counts and row content, and excludes export time from dataset
identity. The Python loader independently reproduces the TypeScript hash and
fails on schema, identity, ordering, lineage, point-in-time or future-label
violations. Historical files were not rewritten or blessed.

Recovered historical reality remains 7,550 unique candidates, 302 decisions,
zero selected candidates and zero resolved outcomes. Candidate count is not
profitability evidence.

## Future observations and outcome resolution

Command-5A provides a GET-only future-observation path with durable local
SQLite WAL jobs, bounded scheduling, retryable provider and market deferrals,
restart-safe claims, exact-leg option marks, underlying marks, provenance,
content hashes and maturation. Checkpoints include intraday, end-of-day,
trading-day, expiration and lifecycle horizons. Not-yet-due observations
remain pending, and exhausted or unobservable paths remain censored rather
than zero.

The canonical adapters, outcome subject materializer, observation store,
resolver and label builders preserve `MARKET_OBSERVED`, `MODELED_RESEARCH` and
`BROKER_ACTUAL` as distinct truth classes. Future marks do not enter T0
features. Assignment, expiration, fill, management and whole-chain labels
require their own evidence. Quote evidence alone cannot become a broker fill.

This source is integrated but not deployed into the frozen current worker.
No real current-release T0 subject has matured through the integrated branch,
so runtime capture remains `FORWARD_DATA_REQUIRED`.

## Datasets and counterfactuals

The research layer has typed materializers for:

- entry episodes and entry-feature ablation
- WAIT outcomes, WAIT regret and strictness economics
- whole-chain episodes
- management snapshots and management counterfactuals
- profit-taking challengers
- cross-strategy common-horizon outcomes
- execution and TCA arrival evidence
- regime evidence
- assignment, expiration and recovery evidence

Every materializer uses explicit identity joins and point-in-time cutoffs.
Open outcomes remain right-censored. Missing fill, fee, assignment, recovery or
future-price evidence remains unknown. The runnable TypeScript dataset command
is exposed as `npm run theta:research:dataset-build`. The Python research CLI
validates the actual feature registry and routes TypeScript-owned dataset and
filter-value capabilities to their single canonical implementation instead of
duplicating them.

WAIT regret distinguishes hard safety rejection from soft or economic WAIT.
A later favorable move does not invalidate a stale-quote or other safety gate.
The failure-attribution system supports multi-cause evidence for strategy,
strike, DTE, timing, underlying, IV, event, liquidity, execution, portfolio,
management, roll and assignment or recovery causes.

## Benchmark execution

The earlier benchmark registry labeled mechanics as implemented while
`execute_benchmark()` could execute only B0. The Phase-6 correction adds a
real deterministic dispatcher and hashed receipt for 13 additional mechanical
benchmarks:

`B3`, `B4`, `B5`, `B6`, `BQ-1`, `BQ-2`, `BR-1`, `BR-2`, `BA-1`, `BA-2`,
`BA-3`, `BC-1` and `BC-2`.

Every execution requires a non-empty policy version, retains
`brokerAuthority=false` and `empiricalPromotion=false`, and hashes the exact
input and output. BQ-2 now uses deterministic absolute-delta distance and
fails if a feasible candidate lacks delta.

`B1`, `B2` and `BH-1` remain `BLOCKED_MISSING_POLICY` because their full
multi-stage lifecycle policies are not completely specified. `BQ-3` remains
blocked until one exact transparent-baseline policy is frozen. No policy was
invented to make those states green. A1-A6 continue through the separate
ablation runner.

## Model ladder and validation

The implemented research ladder starts with deterministic baselines,
regularized logistic and shallow-tree candidates. Calibration contracts,
cohort calibration, grouped dependence, purged chronological walk-forward,
embargo, untouched OOS manifests, DSR/PBO selection-bias evidence, drift
detection and reproducibility bundles are present and tested. Complex models
must beat registered simpler baselines and cannot skip stage order.

Targets remain separate: positive after-cost whole-chain probability,
after-cost PnL, downside and tail loss, holding period, assignment, target
before risk event, close cost, slippage and management continuation value.
No delta-derived POP or missing-EV substitution is allowed.

The promotion flow remains:

`OBSERVE -> LABEL -> DATASET -> CHALLENGER -> WALK_FORWARD -> OOS -> ECONOMIC_REVIEW -> PROMOTION`.

Promotion receipts require dataset identity, model identity, calibration,
economic metrics, sufficient independent N, untouched OOS and human approval.
Shadow predictions have no broker authority. One loss cannot rewrite
Production policy.

## Adaptive comparison and profitability truth

Q, H, D, A, C and WAIT can be represented on a common deterministic horizon
where their evidence is comparable. Research comparison keeps Pareto tradeoffs
visible and does not manufacture one winner from incomplete evidence. Learned
adaptive strategy switching remains shadow-only and empirically unpromoted.

Profitability evaluation includes expectancy, profit factor, average win and
loss, payoff ratio, drawdown, Expected Shortfall, capital-days, turnover,
assignment and recovery burden, execution cost, slippage, calibration, regime
robustness and effective independent sample size. A 70-80 percent win rate is
a research target, not a result or configuration objective.

## Validation

FOCUSED_PHASE_6_TESTS = PASS, 49 passed

NODE_SUITE = PASS, 3007 passed, 15 skipped, 0 failed, 3022 total

PYTHON_QUANT_SUITE = PASS, 1227 tests

BROWSER_SUITE = PASS, 23 tests

TYPECHECK_LINT_BUILD = PASS

SECURITY_SCAN = PASS, 0 findings

GIT_STORAGE_POLICY = PASS

SOURCE_EXACT_SHA_CI = PASS, run 36553793427 at 4e0278dda98c0eb0f0b279615055883710a09ee2

RECEIPT_EXACT_SHA_CI = PENDING_FOR_RECEIPT_COMMIT

## Reality and remaining dependencies

SOURCE = COMPLETE for Phase-6 research infrastructure

HISTORICAL_PROMOTION_GRADE = false

REAL_SELECTED_OUTCOMES = 0 in the recovered historical corpus

REAL_RESOLVED_OUTCOMES = 0 in the recovered historical corpus

FUTURE_OBSERVATION_RUNTIME = FORWARD_DATA_REQUIRED

EMPIRICAL_EV_POP_CALIBRATION = EMPIRICALLY_UNPROVEN

ADAPTIVE_STRATEGY_SWITCHING = SHADOW_ONLY_EMPIRICALLY_UNPROVEN

BENCHMARK_POLICY_GAPS = B1, B2, BH-1, BQ-3

PAPER_AND_BROKER_AUTHORITY = false

CODE_SOLVABLE_PHASE_6_BLOCKERS = 0 known after source validation

ORDER_SUBMISSIONS = 0

BROKER_MUTATIONS = 0

FOLLOWER_SUBMISSIONS = 0

LIVE_AUTHORIZATION = NOT_GRANTED

FINAL_STATUS = SOURCE_COMPLETE_EMPIRICAL_PENDING
