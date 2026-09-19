# THETA R6 evidence integration receipt

Receipt version: `theta-r6-evidence-integration-v1`

Baseline canonical main: `4abeb11b170fa8ab4a849314e0c9f76ecb6ebcba`

This receipt covers the bounded closed-market research and evidence integration pass. It does not authorize a broker order, change the Paper champion, enable followers, or permit live money.

## Integrated and repaired

- Integrated the R6 outcome-label contract from Claude commit `4944df64df2d9f027334d4fc97b2804aeb587b39` after source and test review.
- Repaired drawdown labeling so unordered observations are rejected as `UNKNOWN` instead of silently changing chronology.
- Repaired fill-rate labeling so negative quantities, non-positive requested quantities, and overfills are rejected as `UNKNOWN`.
- Preserved the canonical accounting boundary. The label engine reads whole-chain economics and managed-episode path features. It does not recompute broker accounting, subtract execution cost twice, or claim broker authority.
- Integrated research-only volatility-risk-premium arithmetic and Pareto underlying diagnostics from Claude commit `7d5b26417cb7aff73f62f8c2a7124816b3c7885e`.
- Integrated point-in-time realized-volatility baselines and a transparent HAR-RV research implementation from Claude commit `f4f1aedaeeee5255b0fe77b7843a1a90a2e2b6ef`.

## Deliberate non-duplication

No new database tables, export schema, resolver, backtester, execution model, strategy router, or broker coordinator were added.

The current canonical repository already provides:

- immutable candidate sets, candidates, shadow candidates, management snapshots, lifecycle outcomes, whole-chain outcomes, execution observations, policy-learning records, path checkpoints, action frontiers, and timing snapshots;
- deterministic `theta-r6-dataset-v6` export identity and hashing;
- a Python loader that enforces schema identity, chronological ordering, point-in-time provenance, causal label availability, exact-contract identity, and the feature-label firewall;
- automatic export and research handoff after eligible worker scans;
- WAIT, strategy, contract, action-regret, management, and whole-chain outcome subjects;
- chronological grouped walk-forward planning, embargo support, untouched OOS planning, calibration primitives, DSR/PBO evidence fields, and explicit human promotion approval;
- option-chain expiration, strike, delta, structure, Optionomics attachment, and counterfactual evidence.

Adding parallel versions would create a second research truth. The new modules stay behind the existing research contracts.

## Authority and empirical status

- `BROKER_AUTHORITY = FALSE` for every newly integrated module.
- `EXECUTION_AUTHORIZATION_CHANGED = NO`.
- `STRATEGY_THRESHOLDS_CHANGED = NO`.
- `AEGIS_CHANGED = NO`.
- `SIZING_CHANGED = NO`.
- `PROMOTION_STATE_CHANGED = NO`.
- `FOLLOWER_EXECUTION = LOCKED`.
- `LIVE_MONEY_AUTHORIZED = NO`.

VRP, Pareto underlying selection, realized-volatility estimators, and HAR-RV are challenger evidence only. A positive VRP is not a sell signal. Pareto nondominance is not an entry signal. HAR-RV forecast accuracy alone cannot promote a strategy. Each feature family must prove incremental after-cost economic value, tail behavior, calibration, execution quality, and stability on independent OOS evidence.

## Verification

- Focused TypeScript research tests: `37 passed`.
- HAR-RV and realized-volatility tests: `23 passed`.
- Full Node suite: `1191 passed`, `11 skipped`, `0 failed`.
- Full Python suite: `500 passed`, `0 failed`.
- ESLint: `PASS`.
- TypeScript check: `PASS`.
- Production build: `PASS`.
- Security scan: `889 paths`, `0 findings`.
- Diff whitespace check: `PASS`.
- Browser tests: `PLAYWRIGHT_NOT_REQUIRED`, no browser surface changed.
- PostgreSQL migration: `NO_NEW_MIGRATION`.
- Redis: `NOT_APPLICABLE_TO_THIS_RESEARCH_ONLY_CHANGE`.

## Remaining blockers

### Empirical blockers

- No naturally selected and resolved master Paper episode exists yet.
- Independent sample size is insufficient for model fit, calibration, DSR/PBO, ablation conclusions, or promotion.
- WAIT-regret, contract-regret, management-regret, assignment, recovery, covered-call, and whole-chain targets need real causal future observations.
- `EV_MODEL_NOT_EMPIRICALLY_READY = YES`.

### Operational blockers

- The resident Windows worker remains the active host. An external always-on host has not been deployed.
- The first Paper canary still depends on a naturally valid open-session candidate and all existing execution gates. No trade may be forced to manufacture evidence.

### Provider blockers

- No new provider blocker was introduced by this change.
- Optionomics intelligence and Alpaca broker truth remain separate authorities under the existing provider contracts.
- Unsupported, stale, missing, or not-entitled provider fields remain `UNKNOWN` and cannot be converted to zero or pass.

## Closure map

- `R6_LABEL_CONTRACT = COMPLETE_BUILDABLE`.
- `R6_LABEL_CORRECTNESS_REPAIR = COMPLETE`.
- `R6_PIT_EXPORT = ALREADY_COMPLETE_NO_DUPLICATE_CHANGE`.
- `R6_AUTO_INGEST = ALREADY_COMPLETE_NO_DUPLICATE_CHANGE`.
- `R6_VRP_CHALLENGER = COMPLETE_RESEARCH_ONLY`.
- `R6_UNDERLYING_PARETO_CHALLENGER = COMPLETE_RESEARCH_ONLY`.
- `R6_RV_BASELINES = COMPLETE_RESEARCH_ONLY`.
- `R6_HAR_RV_BASELINE = COMPLETE_RESEARCH_ONLY`.
- `R6_WALK_FORWARD_AND_CALIBRATION = ALREADY_COMPLETE_BUILDABLE`.
- `R6_PROMOTION_GATE = ALREADY_COMPLETE_BUILDABLE`.
- `R6_EMPIRICAL_CONCLUSIONS = BLOCKED_ON_REAL_EVIDENCE`.
- `READY_FOR_FIRST_PAPER_ORDER = UNCHANGED`.

