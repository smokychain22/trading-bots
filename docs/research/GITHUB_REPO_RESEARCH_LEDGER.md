# GitHub repository research ledger

## Audited pass, 2026-09-11

Baseline: `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. Scope: the owner's named 15 repositories plus QuantLib and LEAN. This is targeted file-level review, not a claim to have read every line of every repository. Complete small modules and selected functions/tests in larger modules were inspected using GitHub's raw-content API at the commits below. No upstream code was executed, no upstream test suite was run, and no repository was installed as a dependency. Test suggestions below are extracted cases, not claims of passing upstream tests.

This pass supersedes conflicting earlier research claims. GitHub repository size is reported in KB, so size5 and size10 do not mean empty repositories. Bitra has a restrictive custom license, not an absent license. Call-positive/put-negative GEX is a positioning assumption, not a mathematical consequence of dealers short both options. No inspected repository demonstrates calibrated THETA full-H expectancy or a validated 70-80% Managed Episode win rate.

License labels are an engineering intake screen, not legal clearance. MIT/Apache/BSD source reuse still requires notice/attribution review. AGPL code is not imported into this project without a separate licensing decision. Noncommercial and no-license source is not copied. All changes in this milestone are independently written from THETA's canonical missing-data requirement.

## alpacahq/options-wheel

- Repository / URL: [alpacahq/options-wheel](https://github.com/alpacahq/options-wheel)
- Commit SHA inspected: `3698429289065ceb0c13ffcdc31a966c576779ad`
- Last inspected: 2026-09-11
- License: Apache-2.0. License file or absence checked against repository tree.
- Category: Wheel / broker adapter
- Relevant files: [core/execution.py](https://github.com/alpacahq/options-wheel/blob/3698429289065ceb0c13ffcdc31a966c576779ad/core/execution.py), [core/state_manager.py](https://github.com/alpacahq/options-wheel/blob/3698429289065ceb0c13ffcdc31a966c576779ad/core/state_manager.py), [core/broker_client.py](https://github.com/alpacahq/options-wheel/blob/3698429289065ceb0c13ffcdc31a966c576779ad/core/broker_client.py).
- Problem solved / algorithms / architecture: Reconstructs cash/put/stock/call state from broker positions, paginates contracts and batches snapshots. The temporary short-call-awaiting-stock state handles position iteration order.
- Strategy logic: Sells score-ranked puts and covered calls on held shares. Single-symbol state reconstruction is a useful starting point, not a durable lifecycle ledger.
- Risk logic / assumptions: Tracks put collateral with 100 × strike × quantity. Hardcoded multiplier must be replaced by verified contract metadata.
- Execution logic / weaknesses: Market sells, default quantity one, no deterministic client_order_id or explicit option intent in reviewed request construction. Liquidation does not wait for the option close to settle before stock liquidation.
- Backtesting logic: No point-in-time replay or OOS evidence established from these files.
- Useful tests / invariants: Extract state reconstruction with stock before/after short call, empty positions, incompatible long options, adjusted multiplier, pending-order collateral. External tests not executed.
- Weaknesses: Automatic covered calls do not implement recovery economics. Positions alone cannot explain fills, assignment activities, or immutable roll losses.
- Look-ahead risk: Current snapshots only, not a historical feature archive.
- Survivorship-bias risk: Historical universe and delisted symbols unverified.
- THETA relevance / existing equivalent: `assignment-orchestrator.ts, order-intent-state.ts, account-exposure.ts`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: ADAPT.
- Integration status: State/reconciliation test requirements extracted, no external code imported.

## goldspanlabs/optopsy

- Repository / URL: [goldspanlabs/optopsy](https://github.com/goldspanlabs/optopsy)
- Commit SHA inspected: `40bb8b2aa07ef8763caeadf752961faecb494efd`
- Last inspected: 2026-09-11
- License: AGPL-3.0. License file or absence checked against repository tree.
- Category: Backtest / costs
- Relevant files: [optopsy/pricing.py](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/optopsy/pricing.py), [tests/test_timestamps.py](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/tests/test_timestamps.py).
- Problem solved / algorithms / architecture: Separates strategy leg direction/quantity from bid/ask fill and commission calculation. Exit direction is reversed correctly in the reviewed fill transformation.
- Strategy logic: Generic multi-leg representation. This is a strategy evaluator, not a validated Wheel policy.
- Risk logic / assumptions: No full-H assignment-capacity or inventory-tail guarantee established by pricing.py.
- Execution logic / weaknesses: Spread, midpoint, liquidity and per-leg sensitivity models. These are simulated prices, not broker fill probabilities.
- Backtesting logic: Compares entry/exit cashflows. Daily date normalization tests are useful for EOD joins, but stripping timestamps is unsuitable for THETA intraday freshness.
- Useful tests / invariants: Read timestamp normalization and cross-source matching cases. Proposed tests: buy/sell reversal, fees both ways, missing exit quote, quote after order, zero quantity. Not executed upstream.
- Weaknesses: Missing volume may become zero or use fallback ratio. Commission and price units need an explicit dollar/contract bridge. Midpoint mode is not an executable assumption.
- Look-ahead risk: Date-only joins lose publication time. Require historical availability timestamps before replay.
- Survivorship-bias risk: Caller data must contain expired/delisted contracts and point-in-time universe.
- THETA relevance / existing equivalent: `execution-quality-contract.ts, R6 dataset/cost contracts`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: REFERENCE_ONLY.
- Integration status: Methods only. No AGPL source reuse or dependency added.

## lambdaclass/options_portfolio_backtester

- Repository / URL: [lambdaclass/options_portfolio_backtester](https://github.com/lambdaclass/options_portfolio_backtester)
- Commit SHA inspected: `e53ef86928777de6ee0721424762ea3dc133f993`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: Event backtest / portfolio
- Relevant files: [options_portfolio_backtester/engine/clock.py](https://github.com/lambdaclass/options_portfolio_backtester/blob/e53ef86928777de6ee0721424762ea3dc133f993/options_portfolio_backtester/engine/clock.py), [options_portfolio_backtester/execution/fill_model.py](https://github.com/lambdaclass/options_portfolio_backtester/blob/e53ef86928777de6ee0721424762ea3dc133f993/options_portfolio_backtester/execution/fill_model.py), [tests/engine/test_clock.py](https://github.com/lambdaclass/options_portfolio_backtester/blob/e53ef86928777de6ee0721424762ea3dc133f993/tests/engine/test_clock.py).
- Problem solved / algorithms / architecture: Composes clock and fill model interfaces. MarketAtBidAsk is a clear baseline and fill assumptions are replaceable independently of strategy.
- Strategy logic: Generic options portfolios, not a complete recovery-aware Wheel. Prior ledger also reviewed engine/engine.py and convexity/scoring.py.
- Risk logic / assumptions: Volume-aware pricing delegates to Rust. Python wrapper alone does not verify Rust numerical behavior.
- Execution logic / weaknesses: Bid/ask, midpoint and volume-aware alternatives. A modeled fill does not imply a fill occurred.
- Backtesting logic: Critical issue: iter_dates zips grouped stock and option frames and discards the option group's date. Missing dates can pair future option data with earlier stock dates and truncate the longer stream.
- Useful tests / invariants: Read clock test cases. They use matching date sets, so they do not establish missing-date alignment. Add mismatched-calendar/unequal-stream tests before reuse.
- Weaknesses: Do not adopt the positional date zip or assume business-day ranges are exchange sessions.
- Look-ahead risk: Concrete cross-date alignment hazard, including independent monthly first dates.
- Survivorship-bias risk: Dataset completeness and historical constituents remain caller responsibilities.
- THETA relevance / existing equivalent: `scheduler-engine.ts, R6 replay, execution model interface`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: ADAPT.
- Integration status: Interface pattern retained as reference. Clock implementation explicitly rejected.

## FlashAlpha-lab/gex-explained

- Repository / URL: [FlashAlpha-lab/gex-explained](https://github.com/FlashAlpha-lab/gex-explained)
- Commit SHA inspected: `a11321d62006311c4a72a68552587485024f2bf2`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: GEX research
- Relevant files: [code/compute_gex.py](https://github.com/FlashAlpha-lab/gex-explained/blob/a11321d62006311c4a72a68552587485024f2bf2/code/compute_gex.py).
- Problem solved / algorithms / architecture: Transparent BSM gamma, OI aggregation and strike-bucket crossing formulas make a useful independent formula check.
- Strategy logic: Positive/negative aggregate GEX heuristic, not a complete trade policy.
- Risk logic / assumptions: Call-positive/put-negative signs are assumed positioning, not observed dealer inventory.
- Execution logic / weaknesses: No execution engine reviewed.
- Backtesting logic: No validated OOS profitability evidence established.
- Useful tests / invariants: Extract empty chain, unknown IV/OI, expiry, adjusted multiplier, multiple crossings. Reviewed implementation, no upstream test run.
- Weaknesses: Rough midpoint-derived IV, fixed100 multiplier, expired T floored positive, first strike crossing. Invalid inputs may return0.
- Look-ahead risk: A current chain cannot support historical GEX labels without archived availability times.
- Survivorship-bias risk: Current-chain sampling omits historical unavailable contracts.
- THETA relevance / existing equivalent: `cboe-regime.ts research boundary, optional future GEX contract`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: REFERENCE_ONLY.
- Integration status: Cross-checked against DealerFlow, zrack and sgdividends. No GEX runtime module added.

## thedhruvhegde/ivsurf

- Repository / URL: [thedhruvhegde/ivsurf](https://github.com/thedhruvhegde/ivsurf)
- Commit SHA inspected: `c20072a8f6c09146697bdb55dca566567d7b0535`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: IV / surface / validation
- Relevant files: [core/black_scholes.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/core/black_scholes.py), [core/surface_model.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/core/surface_model.py), [core/surface_smoothing.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/core/surface_smoothing.py), [engine/backtest/walk_forward.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/engine/backtest/walk_forward.py).
- Problem solved / algorithms / architecture: IV inversion with Newton/Brent and explicit residual checks. Rolling train/test indices include a purge gap. Surface smoothing methods exist, but core/surface_model.py explicitly raises NotImplementedError.
- Strategy logic: Pricing/research utilities are not a THETA entry policy.
- Risk logic / assumptions: Surface smoothness alone does not establish absence of calendar/butterfly arbitrage.
- Execution logic / weaknesses: No production fill behavior validated in this scope.
- Backtesting logic: Walk-forward evaluator catches exceptions and skips failed folds, returns0 with no successful folds. Fixed row gap is not lifecycle-label purging.
- Useful tests / invariants: Required: mixed T=[0,positive], nonfinite inputs, failed inversion, no folds, failed folds, overlapping labels. Smoothing file inspected selectively, not line-complete.
- Weaknesses: black_scholes_price uses if any(T==0) then intrinsic for every batch element. This is a concrete mixed-maturity bug. Scalar Brent path cannot simply be assumed vector-safe.
- Look-ahead risk: Purge by actual label interval, not just five rows. Input order must be verified.
- Survivorship-bias risk: No historical-universe proof from inspected files.
- THETA relevance / existing equivalent: `Optionomics feature verification and R6 walk-forward`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: TEST_ONLY.
- Integration status: Prefer QuantLib as independent numerical oracle. Do not duplicate Optionomics surface service.

## ksanjay/Kelly-Criterion-Option-Selector

- Repository / URL: [ksanjay/Kelly-Criterion-Option-Selector](https://github.com/ksanjay/Kelly-Criterion-Option-Selector)
- Commit SHA inspected: `43c2443cd202777650bd1c61233054a83fe31771`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: Sizing anti-pattern
- Relevant files: [kelly_leaps.ipynb](https://github.com/ksanjay/Kelly-Criterion-Option-Selector/blob/43c2443cd202777650bd1c61233054a83fe31771/kelly_leaps.ipynb).
- Problem solved / algorithms / architecture: Explicit example of Kelly inputs and integer contract conversion, valuable primarily for negative tests.
- Strategy logic: ATM long LEAPS on a fixed four-symbol list. Uses N(d2) as probability and current spot payoff proxy.
- Risk logic / assumptions: Raw Kelly and forced one contract after rounding can violate budget. Each symbol may independently spend the bankroll.
- Execution logic / weaknesses: No broker reconciliation path established.
- Backtesting logic: No credible managed-episode OOS result in notebook inspection.
- Useful tests / invariants: No dedicated test suite found in tree. Test negative edge=>0, unaffordable=>0, aggregate budget, probability provenance.
- Weaknesses: Risk-neutral ITM probability is not physical profitable-episode probability. b=(S-K)/premium-1 is not a forecast payoff distribution.
- Look-ahead risk: Current option lastPrice/expiry selection does not reconstruct historical entry data.
- Survivorship-bias risk: Hand-picked surviving symbols.
- THETA relevance / existing equivalent: `sizing.py, AEGIS, EV model provenance`.
- Better than current THETA: NO, limited to the specific method above, never a profitability ranking.
- Recommended action: REJECT.
- Integration status: No sizing or strategy adoption.

## joncovington/MEICAgent

- Repository / URL: [joncovington/MEICAgent](https://github.com/joncovington/MEICAgent)
- Commit SHA inspected: `333ff77b68aaba07c68bcbcacb6d439ebceda4b6`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: Iron condor simulation / lifecycle
- Relevant files: [src/paper.py](https://github.com/joncovington/MEICAgent/blob/333ff77b68aaba07c68bcbcacb6d439ebceda4b6/src/paper.py), [tests/test_paper_calendar.py](https://github.com/joncovington/MEICAgent/blob/333ff77b68aaba07c68bcbcacb6d439ebceda4b6/tests/test_paper_calendar.py).
- Problem solved / algorithms / architecture: Compares risk-profile variants using a shared market snapshot. Separates paper simulation settlement behavior and fee calculation.
- Strategy logic: Intraday iron-condor simulation with different stop/management profiles. Not a CSP/stock recovery system.
- Risk logic / assumptions: Cash settlement versus physical-delivery force-close distinction is useful. Missing strike/spot can return0 in settlement helper, unsafe for accounting.
- Execution logic / weaknesses: Synthetic fills, not Alpaca Paper brokerage. Tastytrade-specific fee assumptions must not become Alpaca cost truth.
- Backtesting logic: Same-snapshot variants are dependent observations. Snapshot dates plus wall-clock _now_et timestamps require replay audit.
- Useful tests / invariants: Calendar test file read. Proposed physical/cash settlement, missing marks, holiday shifts, injected-clock replay tests. Upstream tests not run.
- Weaknesses: Date heuristics must defer to actual exchange schedule. No Wheel assignment/recovery model demonstrated.
- Look-ahead risk: Wall clock in historical replay can contaminate event timing.
- Survivorship-bias risk: Fixed product scope does not establish delisted equity handling.
- THETA relevance / existing equivalent: `management ablation, assignment/expiration fixtures`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: ADAPT.
- Integration status: Variant lineage and settlement tests proposed, strategy not integrated.

## NavnoorBawa/Options-Flow-Predictor

- Repository / URL: [NavnoorBawa/Options-Flow-Predictor](https://github.com/NavnoorBawa/Options-Flow-Predictor)
- Commit SHA inspected: `da83ec361c1cb7494a0b1b96dbca8edc4a09e788`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: Flow / ML research
- Relevant files: [Options Flow Predictor.ipynb](https://github.com/NavnoorBawa/Options-Flow-Predictor/blob/da83ec361c1cb7494a0b1b96dbca8edc4a09e788/Options%20Flow%20Predictor.ipynb).
- Problem solved / algorithms / architecture: Volume/OI and volatility-context feature families plus TimeSeriesSplit are candidates for a feature audit, not trading evidence.
- Strategy logic: RF/XGBoost directional predictions over stock history and currently fetched options context. Selected notebook code inspected, not every output cell.
- Risk logic / assumptions: Missing features are ffilled/fillna(0), RSI may default50 and missing VIX9D may use VIX. These substitutions fabricate neutral knowledge.
- Execution logic / weaknesses: No audited executable BBO/partial-fill/accounting engine.
- Backtesting logic: TimeSeriesSplit alone cannot fix stale/current options context, symbol grouping or overlapping labels. No untouched-OOS Wheel economics proven.
- Useful tests / invariants: No dedicated tests in tree inspected. Require feature available_at, per-date chain archive, missingness mask, purged label windows, fold failure accounting.
- Weaknesses: README/notebook academic-return rhetoric is not repository performance proof. Large volume does not identify initiator, opening/closing or dealer inventory.
- Look-ahead risk: Current-chain data attached to stock-history modeling requires explicit date proof before historical use.
- Survivorship-bias risk: User-selected current tickers and provider history do not establish point-in-time universe.
- THETA relevance / existing equivalent: `Optionomics feature-family contracts and dataset lineage`.
- Better than current THETA: NO, limited to the specific method above, never a profitability ranking.
- Recommended action: REFERENCE_ONLY.
- Integration status: No model, threshold or performance claim adopted.

## puneet-chandna/0DTE-dealer-gamma

- Repository / URL: [puneet-chandna/0DTE-dealer-gamma](https://github.com/puneet-chandna/0DTE-dealer-gamma)
- Commit SHA inspected: `8da6fa67328b4aa34956c033f0b7cbb74431501d`
- Last inspected: 2026-09-11
- License: PolyForm Noncommercial 1.0.0. License file or absence checked against repository tree.
- Category: GEX / quality
- Relevant files: [backend/app/core/gex_calculator.py](https://github.com/puneet-chandna/0DTE-dealer-gamma/blob/8da6fa67328b4aa34956c033f0b7cbb74431501d/backend/app/core/gex_calculator.py).
- Problem solved / algorithms / architecture: Vectorized signed OI gamma and explicit crossing_found metadata improve interpretability over an unexplained number.
- Strategy logic: Intraday dealer-gamma context, not validated THETA routing.
- Risk logic / assumptions: GEX thresholds and call/put signs are assumptions.
- Execution logic / weaknesses: No broker execution reviewed.
- Backtesting logic: No OOS incremental THETA value established.
- Useful tests / invariants: Tree exposes snapshot-quality/GEX tests, not executed. Extract no-crossing versus zero, empty array, stale chain and multiplier tests.
- Weaknesses: Cumulative-by-strike crossing is not aggregate spot-repricing zero gamma. Fixed100 assumptions and raw coverage need separate quality flags.
- Look-ahead risk: Current0DTE chain context requires timestamped archival for replay.
- Survivorship-bias risk: No historical availability guarantees established.
- THETA relevance / existing equivalent: `research-only feature validation`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: REFERENCE_ONLY.
- Integration status: Noncommercial code not imported. Formula semantics compared only.

## hedarthy/DealerFlow

- Repository / URL: [hedarthy/DealerFlow](https://github.com/hedarthy/DealerFlow)
- Commit SHA inspected: `14c7a0f345116c93b43641893aaa372a4cf19085`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: GEX / vanna / charm
- Relevant files: [spy_gex/exposure.py](https://github.com/hedarthy/DealerFlow/blob/14c7a0f345116c93b43641893aaa372a4cf19085/spy_gex/exposure.py).
- Problem solved / algorithms / architecture: Names separate gamma, vanna and charm exposure units, with a minimum gross-exposure condition on cumulative crossings.
- Strategy logic: GEX-sign regime heuristic. No proven entry/exit policy.
- Risk logic / assumptions: Dealer signs, zero crossing windows and rates are assumed. Returns0 for unavailable crossing and negative regime when total0.
- Execution logic / weaknesses: No execution engine in inspected module.
- Backtesting logic: No independent OOS strategy proof.
- Useful tests / invariants: Extract missing IV/OI, invalid type, multiple crossings, expiry timezone, vanna per-unit-vol and charm per-day dimensional tests.
- Weaknesses: Fixed100, missing-data defaults, expiry floor and duplicated product calculations. Crossing is cumulative strike profile, not repriced aggregate.
- Look-ahead risk: Naive local expiry construction can create timezone inconsistencies.
- Survivorship-bias risk: Current chain cannot establish historical coverage.
- THETA relevance / existing equivalent: `formula validation / research provenance`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: REFERENCE_ONLY.
- Integration status: Units/sign/crossing comparison documented, no runtime adoption.

## zrack/gex-terminal

- Repository / URL: [zrack/gex-terminal](https://github.com/zrack/gex-terminal)
- Commit SHA inspected: `72d68f47a41c2c330351476cef99b48411f9fe3d`
- Last inspected: 2026-09-11
- License: MIT. License file or absence checked against repository tree.
- Category: GEX semantics / replay
- Relevant files: [gex_terminal/engine.py](https://github.com/zrack/gex-terminal/blob/72d68f47a41c2c330351476cef99b48411f9fe3d/gex_terminal/engine.py).
- Problem solved / algorithms / architecture: Explicit positive finite contract multipliers, distinguishable strike_profile_flip semantics and observed-volume proxy descriptions are useful quality contracts.
- Strategy logic: Positioning display/context, not validated Wheel economics.
- Risk logic / assumptions: Volume-based counterparty sign remains an assumption. Black76/BSM conventions must match instruments.
- Execution logic / weaknesses: No broker engine audited.
- Backtesting logic: Tree includes replay/chronology tests. Listing them does not prove they pass or prove alpha.
- Useful tests / invariants: Extract no-crossing without fallback, adjusted multiplier, empty chain, missing proxy source, expiry-separated aggregation. Engine read selectively.
- Weaknesses: Legacy nearest-neutral fallback must not be promoted to true zero-gamma crossing. Extensive surface does not prove economics.
- Look-ahead risk: Replay ordering and provider timestamp integrity must be checked independently.
- Survivorship-bias risk: Coverage of expired/delisted contracts unverified.
- THETA relevance / existing equivalent: `contract-multiplier quality and optional GEX semantics`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: ADAPT.
- Integration status: Metadata/invariant methods only, no GEX routing enabled.

## BitraAI/gex_app

- Repository / URL: [BitraAI/gex_app](https://github.com/BitraAI/gex_app)
- Commit SHA inspected: `b1234c65452581fccf5375cb7488b990423ed79c`
- Last inspected: 2026-09-11
- License: Custom personal/noncommercial. License file or absence checked against repository tree.
- Category: GEX dashboard research
- Relevant files: [calculations.py](https://github.com/BitraAI/gex_app/blob/b1234c65452581fccf5375cb7488b990423ed79c/calculations.py), [LICENSE](https://github.com/BitraAI/gex_app/blob/b1234c65452581fccf5375cb7488b990423ed79c/LICENSE).
- Problem solved / algorithms / architecture: Illustrates several exposure labels, but units and cross-product fallbacks need substantial skepticism.
- Strategy logic: Exposure visualization, not audited THETA trade policy.
- Risk logic / assumptions: VEX calculation is vega exposure rather than DealerFlow's vanna exposure. Same acronym does not imply same quantity.
- Execution logic / weaknesses: No executable broker path reviewed.
- Backtesting logic: No OOS evidence established.
- Useful tests / invariants: Extract exposure-unit and exact-contract-identity checks. No upstream tests run.
- Weaknesses: Duplicate compute_totals definitions and cross-underlying closest-delta substitution. Commercial use/integration requires written permission under inspected license.
- Look-ahead risk: Substituted Greeks across products and dates lose provenance.
- Survivorship-bias risk: Historical coverage unverified.
- THETA relevance / existing equivalent: `provenance/schema rejection fixtures`.
- Better than current THETA: NO, limited to the specific method above, never a profitability ranking.
- Recommended action: REJECT.
- Integration status: No code, design assets or implementation imported.

## sgdividends/spx-dealer-gamma

- Repository / URL: [sgdividends/spx-dealer-gamma](https://github.com/sgdividends/spx-dealer-gamma)
- Commit SHA inspected: `4b49ede031a17daa2a18c087e7fdb200a0c1d26f`
- Last inspected: 2026-09-11
- License: No license found. License file or absence checked against repository tree.
- Category: Aggregate GEX spot scan
- Relevant files: [gamma.py](https://github.com/sgdividends/spx-dealer-gamma/blob/4b49ede031a17daa2a18c087e7fdb200a0c1d26f/gamma.py), [server.py](https://github.com/sgdividends/spx-dealer-gamma/blob/4b49ede031a17daa2a18c087e7fdb200a0c1d26f/server.py).
- Problem solved / algorithms / architecture: Recomputes aggregate signed gamma across hypothetical spot levels, interpolates all crossings and selects nearest spot. This is conceptually distinct from strike/cumulative crossings.
- Strategy logic: SPX positioning context, not a complete strategy.
- Risk logic / assumptions: Fixed-IV spot scan is a scenario convention, not actual dealer inventory or a forecast.
- Execution logic / weaknesses: MCP read tool, not broker execution.
- Backtesting logic: No OOS evidence or dedicated tests found in tree.
- Useful tests / invariants: Extract no root, multiple roots, all-missing IV, unit consistency, exercise-time timezone. Full gamma/server files read.
- Weaknesses: Fixed100 and rate, missing inputs may become0. Expiry uses16 UTC despite ET comment. All-zero curves can produce false roots.
- Look-ahead risk: Cboe delayed chain timestamps and expiry timezone are material.
- Survivorship-bias risk: Current SPX chain only.
- THETA relevance / existing equivalent: `future research gamma definition, no new API`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: REFERENCE_ONLY.
- Integration status: Not empty: GitHub size5 is KB. No code copying without license.

## milgar7969/alpaca-options-framework

- Repository / URL: [milgar7969/alpaca-options-framework](https://github.com/milgar7969/alpaca-options-framework)
- Commit SHA inspected: `fd1c411da1abfee9009186fda99d8e9c02ca4166`
- Last inspected: 2026-09-11
- License: No license found. License file or absence checked against repository tree.
- Category: Execution / state / risk
- Relevant files: [orders.py](https://github.com/milgar7969/alpaca-options-framework/blob/fd1c411da1abfee9009186fda99d8e9c02ca4166/orders.py), [state.py](https://github.com/milgar7969/alpaca-options-framework/blob/fd1c411da1abfee9009186fda99d8e9c02ca4166/state.py), [risk.py](https://github.com/milgar7969/alpaca-options-framework/blob/fd1c411da1abfee9009186fda99d8e9c02ca4166/risk.py).
- Problem solved / algorithms / architecture: Poll, cancel on timeout, then query once more to detect a fill racing the cancellation. Entry/exit pending flags expose useful concurrency states.
- Strategy logic: Long-option framework with stop/risk policy, not a Wheel assignment engine.
- Risk logic / assumptions: Daily counters can be restored, but stop-distance sizing forces at least1. Counter restoration is not durable reservations.
- Execution logic / weaknesses: Explicit BUY_TO_OPEN, cancellation/fill race handling. Partial fills are not resolved adequately. get_positions failure=>[] and fill-price failure=>0 are unsafe.
- Backtesting logic: No OOS validation established.
- Useful tests / invariants: Extract cancel/fill race, partial fill before rejection, positions failure!=flat, unknown fill price!=0, restart with pending order.
- Weaknesses: In-memory flags and CSV cannot replace atomic lease/idempotent event ledger. No deterministic submission identity in inspected path.
- Look-ahead risk: Real-time functions not a replay implementation.
- Survivorship-bias risk: Universe history unverified.
- THETA relevance / existing equivalent: `order-intent-state.ts, scheduler/reconciliation infrastructure`.
- Better than current THETA: PARTIAL, limited to the specific method above, never a profitability ranking.
- Recommended action: TEST_ONLY.
- Integration status: Use failure scenarios only. No unlicensed source reuse.

## ShayantoDutta/alpaca-wheel-bot

- Repository / URL: [ShayantoDutta/alpaca-wheel-bot](https://github.com/ShayantoDutta/alpaca-wheel-bot)
- Commit SHA inspected: `40c550cf44109028f9a99cdee2863a74c93ba833`
- Last inspected: 2026-09-11
- License: No license found. License file or absence checked against repository tree.
- Category: Wheel failure cases
- Relevant files: [wheel_bot.py](https://github.com/ShayantoDutta/alpaca-wheel-bot/blob/40c550cf44109028f9a99cdee2863a74c93ba833/wheel_bot.py).
- Problem solved / algorithms / architecture: Small real Wheel script with JSON state and put/stock/call handling. Requested SayantoDutta URL resolves to this canonical owner.
- Strategy logic: Delta0.25±0.1, DTE14-28, IV-rank30,50% profit target,2× premium loss threshold, five-day wait in inspected configuration. Static NVDA event estimates.
- Risk logic / assumptions: Order quantity1 and assumed100 multiplier. Static2026 holiday list lacks full exchange-session behavior.
- Execution logic / weaknesses: Limit order pricing is an estimate. Stores midpoint premium before fills and treats disappearing option as full-premium realization before stock inspection.
- Backtesting logic: No dedicated test suite or validated OOS record found.
- Useful tests / invariants: Extract disappearance without activity, partial assignment, canceled order, no fill, restart during JSON write, unknown IVrank. Key code excerpts inspected, not every line.
- Weaknesses: Automatic inference can book a false win. No deterministic clientid/position intent, atomic persistence or full-H recovery policy proven.
- Look-ahead risk: Static earnings/calendar approximations and current IV snapshots.
- Survivorship-bias risk: Fixed chosen symbol(s), no historical-universe proof.
- THETA relevance / existing equivalent: `lifecycle/accounting regression fixtures`.
- Better than current THETA: NO, limited to the specific method above, never a profitability ranking.
- Recommended action: TEST_ONLY.
- Integration status: Not empty: GitHub size10 is KB. Reject trading/accounting implementation.

## lballabio/QuantLib

- Repository / URL: [lballabio/QuantLib](https://github.com/lballabio/QuantLib)
- Commit SHA inspected: `ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4`
- Last inspected: 2026-09-11
- License: BSD-style three-condition license. License file or absence checked against repository tree.
- Category: Mature pricing / numerical oracle
- Relevant files: [ql/pricingengines/blackformula.cpp](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/ql/pricingengines/blackformula.cpp), [ql/termstructures/volatility/equityfx/blackvariancesurface.cpp](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/ql/termstructures/volatility/equityfx/blackvariancesurface.cpp), [LICENSE.TXT](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/LICENSE.TXT).
- Problem solved / algorithms / architecture: Black-formula parameter validation, implied standard-deviation solvers with convergence criteria, and variance-space interpolation with sorted unique expiries.
- Strategy logic: No trading policy inferred.
- Risk logic / assumptions: European Black pricing does not replace American exercise/dividend/assignment modeling. Surface interpolation is not a blanket arbitrage certificate.
- Execution logic / weaknesses: Pricing does not provide executable fills.
- Backtesting logic: Numerical reference, not a THETA historical data source.
- Useful tests / invariants: Extract price-to-IV roundtrip, option bounds, near expiry, failed solver, sorted expiry, dimensional shape and independent Greeks tests. Functions inspected selectively, suite not executed.
- Weaknesses: Mature library still needs instrument/day-count/calendar/curve configuration. No new dependency justified in this slice.
- Look-ahead risk: Evaluation date and point-in-time curves must be injected, not today defaults.
- Survivorship-bias risk: Outside numerical library scope.
- THETA relevance / existing equivalent: `independent Optionomics/Alpaca Greeks validation, R6 oracle`.
- Better than current THETA: YES, limited to the specific method above, never a profitability ranking.
- Recommended action: ADOPT_METHOD.
- Integration status: Validation methodology selected, no pricing library installed.

## QuantConnect/Lean

- Repository / URL: [QuantConnect/Lean](https://github.com/QuantConnect/Lean)
- Commit SHA inspected: `8ee075a39918f2df6fe9e0a5944e366fb60d10dc`
- Last inspected: 2026-09-11
- License: Apache-2.0. License file or absence checked against repository tree.
- Category: Mature lifecycle / accounting / scheduling
- Relevant files: [Common/Securities/Option/OptionHolding.cs](https://github.com/QuantConnect/Lean/blob/8ee075a39918f2df6fe9e0a5944e366fb60d10dc/Common/Securities/Option/OptionHolding.cs), [Common/Securities/SecurityHolding.cs](https://github.com/QuantConnect/Lean/blob/8ee075a39918f2df6fe9e0a5944e366fb60d10dc/Common/Securities/SecurityHolding.cs), [Common/Orders/OptionExercise/DefaultExerciseModel.cs](https://github.com/QuantConnect/Lean/blob/8ee075a39918f2df6fe9e0a5944e366fb60d10dc/Common/Orders/OptionExercise/DefaultExerciseModel.cs), [Common/Scheduling/ScheduledEvent.cs](https://github.com/QuantConnect/Lean/blob/8ee075a39918f2df6fe9e0a5944e366fb60d10dc/Common/Scheduling/ScheduledEvent.cs), [Tests/Common/Orders/Fills/ImmediateFillModelTests.cs](https://github.com/QuantConnect/Lean/blob/8ee075a39918f2df6fe9e0a5944e366fb60d10dc/Tests/Common/Orders/Fills/ImmediateFillModelTests.cs).
- Problem solved / algorithms / architecture: Holdings use contract multipliers and directional liquidation prices. Exercise emits option adjustment and physical underlying delivery events. Scheduler separates UTC event times and frontier scans.
- Strategy logic: Platform architecture, no THETA strategy assumed.
- Risk logic / assumptions: Holding valuation includes approximate liquidation fees. THETA must keep broker-confirmed basis and premium allocation consistent.
- Execution logic / weaknesses: Tests prohibit fills from data before submission. Other default models may warn and still use stale data, stricter THETA veto remains required.
- Backtesting logic: Shared event concepts support replay/runtime parity. ScheduledEvent.Scan can fire skipped events back-to-back, unsafe for blindly replaying trade submissions after outage.
- Useful tests / invariants: Read exercise model and selected holding/scheduler functions and fill test cases. Extract pre-submit data, buy ask/sell bid, physical vs cash, restart catch-up tests. No LEAN suite run.
- Weaknesses: Do not transplant entire engine or treat default fill/exercise simulation as broker truth. Catch-up needs idempotency, reconciliation and stale-intent expiry.
- Look-ahead risk: Inject event clock and preserve data availability frontier.
- Survivorship-bias risk: Historical data completeness remains separate from engine maturity.
- THETA relevance / existing equivalent: `ledger-contract.ts, assignment reconciliation, scheduler-engine.ts`.
- Better than current THETA: YES, limited to the specific method above, never a profitability ranking.
- Recommended action: ADAPT.
- Integration status: Concrete THETA UNKNOWN-valuation fix and regression tests implemented in this milestone. Broader scheduler adaptation pending.

## vollib/py_vollib

- Repository / URL: [vollib/py_vollib](https://github.com/vollib/py_vollib)
- Commit SHA inspected: `11f2058f709328339e3906d99cb04ff41af97776`
- Last inspected: 2026-09-14
- License: MIT (repository LICENSE, verified via GitHub API). The wrapped `lets_be_rational` core carries Peter Jäckel's own separate "free to use, copy, modify, distribute, provided this notice is preserved" grant, checked via the file's own header comment -- not a standard OSI license, so any adoption would need to preserve that exact notice, not just cite MIT.
- Category: Mature pricing / IV-solver numerical oracle
- Relevant files: [vollib/black_scholes_merton/implied_volatility.py](https://github.com/vollib/py_vollib/blob/11f2058f709328339e3906d99cb04ff41af97776/vollib/black_scholes_merton/implied_volatility.py), [vollib/lets_be_rational/core.py](https://github.com/vollib/py_vollib/blob/11f2058f709328339e3906d99cb04ff41af97776/vollib/lets_be_rational/core.py), [LICENSE](https://github.com/vollib/py_vollib/blob/11f2058f709328339e3906d99cb04ff41af97776/LICENSE).
- Problem solved / algorithms / architecture: Wraps Peter Jäckel's "Let's Be Rational" method -- a rational-function initial guess refined by Householder iteration, converging to machine (float64) precision in a bounded, small number of iterations, with explicit `PriceIsAboveMaximum`/`PriceIsBelowIntrinsic` exceptions rather than a silent NaN or an unbounded Newton loop. This is the industry-standard fast/robust IV-solving algorithm, not a hand-rolled bisection.
- Strategy logic: No trading policy inferred; this is a pricing/IV utility only.
- Risk logic / assumptions: `black_scholes_merton` variant assumes European exercise with a continuous dividend yield -- does not model discrete dividends, early exercise, or American-style assignment risk. Matches this repo's own `bs_reference.py` documented limitation, not a new gap.
- Execution logic / weaknesses: No execution/fill logic; pricing only.
- Backtesting logic: Not a data source; a verification oracle only.
- Useful tests / invariants: Re-verified against this repo's own `bs_reference.implied_volatility` (not merely assumed): it already returns `None` (never raises, never guesses) for exactly the same two conditions `py_vollib` raises `PriceIsBelowIntrinsic`/`PriceIsAboveMaximum` for -- below-intrinsic price, and an unbracketed bisection root (structurally equivalent to "above the maximum achievable price"). Same invariant, different failure signal (`None` vs. exception), each idiomatic to its own codebase -- **not a gap**, recorded here to avoid a future session "fixing" a non-defect.
- Weaknesses: A new runtime dependency; this repo's own `bs_reference.py` is deliberately dependency-free for the identical verification-only role, so adopting `py_vollib` outright would duplicate rather than replace it.
- Look-ahead risk: Not applicable -- a pure numerical solver has no data-timing concept of its own; the CALLER must inject only PIT-valid quote/rate/dividend inputs.
- Survivorship-bias risk: Not applicable.
- THETA relevance / existing equivalent: `bs_reference.py` (this repo's own dependency-free reference Black-Scholes/IV solver, R6D).
- Better than current THETA: YES, limited to the specific numerical method (Jäckel's rational-function IV solver is faster and more robust across the deep-ITM/deep-OTM/near-expiry edge cases `bs_reference.py`'s own tests already document as catastrophic-cancellation-prone) -- never a profitability ranking.
- Recommended action: TEST -- cross-check `bs_reference.py`'s existing IV fixtures (including the documented catastrophic-cancellation deep-ITM case) against `py_vollib`'s solver output as an independent second oracle, without adding it as a runtime dependency.
- Integration status: Not adopted. Reference-only; no code copied into this repository.

## SVI / SSVI / eSSVI volatility-surface parameterization

- Repository / URL: none meeting this repository's credibility bar. GitHub search (`SVI implied volatility calibration`, `SSVI volatility surface`) returned only low-star (0-8 stars), unmaintained student/hobby implementations -- none is a credible near-primary source per the standing evidence hierarchy (TEAM_CHARTER: prefer institutional methodology and peer-reviewed research over an arbitrary repository).
- Commit SHA inspected: not applicable -- no repository adopted as a reference.
- Last inspected: 2026-09-14
- License: not applicable.
- Category: Volatility-surface parameterization (research method, not a repository)
- Primary sources instead: Gatheral, "A parsimonious arbitrage-free implied volatility parameterization with application to the equity and FX markets" (2004) for raw SVI; Gatheral & Jacquier, "Arbitrage-free SVI volatility surfaces" (2013) for SSVI and the explicit no-butterfly/no-calendar-arbitrage conditions on the SSVI parameter surface.
- Problem solved / algorithms / architecture: SVI parameterizes one expiry's total implied variance as a function of log-moneyness `k = ln(K/F)`: `w(k) = a + b(ρ(k−m) + sqrt((k−m)² + σ²))`. SSVI ties the five per-expiry SVI parameters to two global functions of at-the-money total variance, collapsing the calibration surface to far fewer free parameters and making a calendar-consistent surface easier to keep arbitrage-free.
- Strategy logic: None -- a market-data smoothing/interpolation method, not a trading policy.
- Risk logic / assumptions: SVI/SSVI fit already-observed IVs; a poor fit (few strikes, thin liquidity, wide spreads) can silently produce an arbitrable or unstable surface unless the closed-form no-arbitrage conditions in Gatheral & Jacquier (2013) are checked explicitly.
- Execution logic / weaknesses: No execution content.
- Backtesting logic: Not a data source.
- Useful tests / invariants: Butterfly-arbitrage (`w'(k)` boundedness) and calendar-arbitrage (`w` non-decreasing in `T` at fixed `k`) checks from the 2013 paper are the two invariants worth implementing as tests BEFORE any curvature-based feature (`SurfaceResidual`) is trusted.
- Weaknesses: Both papers assume liquid enough strikes/expiries to fit a stable surface; Optionomics' own documented coverage/liquidity limits must be checked before assuming a THETA-relevant underlying has enough quoted strikes to calibrate against.
- Look-ahead risk: A surface must be fit using ONLY quotes with `provider_timestamp <= decision_time` -- fitting against same-day-but-later strikes would leak.
- Survivorship-bias risk: Not applicable.
- THETA relevance / existing equivalent: none yet -- `THETA_OPTIONOMICS_FEATURE_CATALOG.md`'s "Surface shape" row (status `TEST`) and this run's requested `SurfaceResidual = MarketIV - FittedIV` feature would need an SVI/SSVI fit as their input, which does not exist in this repository yet.
- Better than current THETA: N/A -- no current THETA surface-fitting method exists to compare against.
- Recommended action: TEST -- implement raw SVI (five parameters per expiry) as the simpler baseline before SSVI's cross-expiry constraint, per the standing "earn complexity through OOS economics" discipline; verify the two named arbitrage invariants before trusting any fitted value.
- Integration status: Not implemented. `BLOCKED_ON_DATA` -- requires enough real per-expiry strike/IV observations to fit against, which does not exist (`DATASET_ABSENT`).

## OpenGamma/Strata

- Repository / URL: [OpenGamma/Strata](https://github.com/OpenGamma/Strata)
- Commit SHA inspected: `987932ee95bf53e2baaff9a6b8e738a00f558b10`
- Last inspected: 2026-09-14
- License: Apache-2.0 (verified via GitHub API).
- Category: Institutional market-data/surface architecture benchmark
- Relevant files: [modules/market/.../surface/Surface.java](https://github.com/OpenGamma/Strata/blob/987932ee95bf53e2baaff9a6b8e738a00f558b10/modules/market/src/main/java/com/opengamma/strata/market/surface/Surface.java), [modules/market/.../surface/SurfaceMetadata.java](https://github.com/OpenGamma/Strata/blob/987932ee95bf53e2baaff9a6b8e738a00f558b10/modules/market/src/main/java/com/opengamma/strata/market/surface/SurfaceMetadata.java), [modules/market/.../surface/interpolator/SurfaceInterpolator.java](https://github.com/OpenGamma/Strata/blob/987932ee95bf53e2baaff9a6b8e738a00f558b10/modules/market/src/main/java/com/opengamma/strata/market/surface/interpolator/SurfaceInterpolator.java).
- Problem solved / algorithms / architecture: Every `Surface` carries its own `SurfaceMetadata` (parameter names, x/y value types, day-count) rather than a bare numeric grid, and interpolation is a distinct, injected `SurfaceInterpolator` strategy -- the architecture directly enforces "a derived/interpolated value can never be mistaken for a raw quoted observation" at the type level.
- Strategy logic: None -- a risk/market-data platform, not a trading strategy.
- Risk logic / assumptions: Institutional-grade FX/rates surface conventions; equity-option-specific skew/smile conventions are thinner than the FX-option module.
- Execution logic / weaknesses: No broker execution content in the reviewed files.
- Backtesting logic: Not reviewed in this pass.
- Useful tests / invariants: The `SurfaceMetadata`-carries-provenance pattern is the direct architectural analogue of this repository's own `ProviderProvenance`/`DataQuality` fields on every candidate/quote row (`dataset_contracts.py`) -- confirms, rather than changes, that existing discipline.
- Weaknesses: A large Java platform; no case exists to add it as a dependency to a Python/TypeScript research stack.
- Look-ahead risk: Not evaluated in this pass -- architecture-only review.
- Survivorship-bias risk: Not applicable.
- THETA relevance / existing equivalent: `dataset_contracts.ProviderProvenance`/`DataQuality`, already independently enforcing the same "provenance travels with every value" discipline this benchmark confirms.
- Better than current THETA: NO CHANGE -- confirms this repository's existing provenance discipline is already aligned with an institutional-grade benchmark; nothing to adopt.
- Recommended action: REJECT (as a dependency) / NO_CHANGE_REQUIRED (as an architectural pattern, already matched).
- Integration status: Reference-only, no code copied, no dependency added.

## vnpy/vnpy

- Repository / URL: [vnpy/vnpy](https://github.com/vnpy/vnpy)
- Commit SHA inspected: `fa5206fe63836f3f8cd1ebd7168fbd19a5e2ff09`
- Last inspected: 2026-09-14
- License: MIT (verified via GitHub API).
- Category: Event-driven trading kernel / OMS architecture reference
- Relevant files: [vnpy/trader/engine.py](https://github.com/vnpy/vnpy/blob/fa5206fe63836f3f8cd1ebd7168fbd19a5e2ff09/vnpy/trader/engine.py), [vnpy/event/engine.py](https://github.com/vnpy/vnpy/blob/fa5206fe63836f3f8cd1ebd7168fbd19a5e2ff09/vnpy/event/engine.py).
- Problem solved / algorithms / architecture: `MainEngine` wraps an `EventEngine` and owns pluggable gateway/app/engine components. `OmsEngine` (verified directly, not assumed) maintains `self.ticks`/`self.orders`/`self.trades`/`self.positions`/`self.accounts` as plain dicts, populated ONLY through registered event handlers (`process_tick_event`, `process_order_event`, etc.) subscribed via `event_engine.register(EVENT_TICK, ...)` and so on -- broker/market truth becomes internal state exclusively through the event bus, never through a strategy writing to state directly.
- Strategy logic: No THETA-relevant strategy content; a broker/OMS architecture only.
- Risk logic / assumptions: No built-in risk engine inspected in this pass; risk is left to app-level plugins.
- Execution logic / weaknesses: Gateway abstraction is generic (many venues); no options-specific execution semantics.
- Backtesting logic: Not reviewed in this pass.
- Useful tests / invariants: The event-registration-populates-state pattern is directly testable: verify that `OmsEngine`'s dicts change ONLY in response to a dispatched event, never via a direct strategy call -- the same invariant this repository's own `theta-shadow-cycle.ts`/reconciliation-owns-broker-truth design already enforces.
- Weaknesses: A large multi-venue Python framework; no case to adopt as a dependency for a TypeScript-plus-Python research stack.
- Look-ahead risk: Not applicable -- architecture-only review.
- Survivorship-bias risk: Not applicable.
- THETA relevance / existing equivalent: Confirms, rather than changes, the existing "broker reconciliation owns factual state transitions" discipline already reviewed in `theta-shadow-cycle.ts`/`canonical-strategy-frontier.ts`.
- Better than current THETA: NO CHANGE -- pattern already matched by existing Production architecture.
- Recommended action: REJECT (as a dependency) / NO_CHANGE_REQUIRED (as an architectural pattern, already matched).
- Integration status: Reference-only, no code copied, no dependency added.

## AsyncAlgoTrading/aat

- Repository / URL: [AsyncAlgoTrading/aat](https://github.com/AsyncAlgoTrading/aat)
- Commit SHA inspected: `c4a07d4102a811c779957033aa26a598c1795cdb`
- Last inspected: 2026-09-14
- License: Apache-2.0 (verified via GitHub API).
- Category: Compact trading-engine reference
- Relevant files: [aat/engine/engine.py](https://github.com/AsyncAlgoTrading/aat/blob/c4a07d4102a811c779957033aa26a598c1795cdb/aat/engine/engine.py).
- Problem solved / algorithms / architecture: **Correction to a claim in this session's user-supplied summary**: `aat` does NOT implement four independent top-level engines (Trading/Risk/Execution/Backtest). Verified directly: a single `TradingEngine(Application)` class COMPOSES `StrategyManager`, `OrderManager`, `PortfolioManager`, and `RiskManager` as constituent manager instances (`from .dispatch import StrategyManager, OrderManager, PortfolioManager, RiskManager`). The separation-of-concerns idea is real and worth noting; the "four engines" framing overstates the file-level structure.
- Strategy logic: No THETA-relevant strategy content.
- Risk logic / assumptions: `RiskManager` exists as a distinct composed object a strategy request passes through -- the separation THETA already has (sizing/AEGIS as distinct from strategy branches) is the same idea, already implemented.
- Execution logic / weaknesses: Not reviewed in depth this pass.
- Backtesting logic: Not reviewed in this pass.
- Useful tests / invariants: The manager-composition pattern (one coordinating class, several single-responsibility composed managers) is a lighter-weight alternative to a fully separate-module architecture -- worth citing as evidence that "separate concerns" does not require "separate top-level engines," if that question ever comes up.
- Weaknesses: Small project (834 stars); general architecture reference only, not a maturity signal.
- Look-ahead risk: Not applicable.
- Survivorship-bias risk: Not applicable.
- THETA relevance / existing equivalent: Confirms the existing strategy/sizing/AEGIS separation is not over-engineered relative to a recognized lighter-weight reference.
- Better than current THETA: NO CHANGE.
- Recommended action: REJECT (as a dependency) / NO_CHANGE_REQUIRED (pattern already matched, framing in the source summary corrected above).
- Integration status: Reference-only, no code copied, no dependency added.

## temporalio/temporal

- Repository / URL: [temporalio/temporal](https://github.com/temporalio/temporal)
- Commit SHA inspected: `9ab3a9f770da20df7d94bcc0030f28eec7b0b947`
- Last inspected: 2026-09-14
- License: MIT (verified via GitHub API).
- Category: Durable-workflow orchestration platform (Go server + multi-language SDKs) -- **not a Python/TypeScript library**, a full distributed system requiring its own server cluster.
- Relevant files: Architecture reviewed at the conceptual/README level only in this pass; no specific file-level extraction performed, consistent with the "adapt concepts, do not add the dependency" recommendation below.
- Problem solved / algorithms / architecture: Workflows are durable: a workflow function's execution history is persisted step-by-step, so a crash mid-workflow resumes from the last completed step rather than re-running from the start or losing state entirely.
- Strategy logic: None -- a general-purpose durable-execution platform.
- Risk logic / assumptions: N/A.
- Execution logic / weaknesses: Requires running and operating a Temporal server cluster (or Temporal Cloud) -- a substantial new infrastructure dependency, explicitly rejected for THETA's current single-laptop-worker scale.
- Backtesting logic: N/A.
- Useful tests / invariants: The CONCEPT worth adapting without the platform: persist each lifecycle step's confirmed outcome (broker fill, not just "order submitted") before proceeding to the next step, so a restart resumes from confirmed broker truth rather than replaying an already-submitted action. THETA's existing migration-backed `trade.decision`/`broker_reconciliation_snapshot`/lease tables (reviewed in prior rounds) already implement an equivalent idea at smaller scale -- this is a durability PATTERN match, not a capability gap.
- Weaknesses: Massive operational surface (a whole distributed server) for a single-worker Paper bot; would violate the standing "no new architecture" and "no new dependency without a proven missing capability" rules.
- Look-ahead risk: N/A.
- Survivorship-bias risk: N/A.
- THETA relevance / existing equivalent: `ops.runtime_worker_lease`/`ops.runtime_worker_status` (migration 020) plus the broker-confirmation-before-persist pattern already reviewed in `postgres-disabled-copy-planner.ts` are the lightweight, already-implemented equivalent of Temporal's core durability guarantee, at a scale appropriate to one worker.
- Better than current THETA: NO -- Temporal solves a distributed-orchestration problem THETA does not have yet (one worker, one broker connection).
- Recommended action: **ADAPT_CONCEPTS_ONLY, REJECT_AS_DEPENDENCY** -- exactly the source summary's own conclusion, independently confirmed rather than merely repeated.
- Integration status: Not adopted. No code, no dependency, no server.

## BehaviorTree/BehaviorTree.CPP

- Repository / URL: [BehaviorTree/BehaviorTree.CPP](https://github.com/BehaviorTree/BehaviorTree.CPP)
- Commit SHA inspected: `9b63b505983f76e46d90d71c87d21fad0001f8a3`
- Last inspected: 2026-09-14
- License: MIT (verified via GitHub API).
- Category: Behavior-tree runtime library -- **C++, not Python/TypeScript**.
- Relevant files: Architecture reviewed at the repository-structure/README level (`src/`, `include/`, `examples/`) -- language mismatch makes file-level code extraction inapplicable; per the standing "use mechanisms, not code" instruction, no implementation detail is extracted below.
- Problem solved / algorithms / architecture: Composable reactive trees of async/concurrent actions with runtime-loadable structure, logging, and replay of past transitions.
- Strategy logic: None -- a general behavior/workflow engine, not a trading strategy.
- Risk logic / assumptions: N/A.
- Execution logic / weaknesses: N/A (C++ library; no direct integration path into this repository's TypeScript/Python stack).
- Backtesting logic: N/A.
- Useful tests / invariants: N/A -- no code inspected.
- Weaknesses: Wrong language for this stack; adopting it would mean reimplementing the PATTERN in TypeScript, not using the library.
- Look-ahead risk: N/A.
- Survivorship-bias risk: N/A.
- THETA relevance / existing equivalent: The pattern (reactive fallback tree for OPERATIONAL sequencing, e.g. management action selection or execution retry/cancel/replace flow) is conceptually similar to what `management-action-frontier.ts`'s blocker-accumulation-then-decide structure already does, and to the execution coordinator's retry/replace state handling (`paper-order-coordinator.ts`, reviewed in prior rounds) -- both already exist as explicit conditional logic, not a tree, and there is no demonstrated gap a tree would close.
- Better than current THETA: NOT DEMONSTRATED -- no concrete THETA workflow was shown to be poorly served by its current explicit-conditional implementation.
- Recommended action: REJECT (as a dependency, wrong language) / NOT_REQUIRED_CURRENT_PHASE (as a pattern to reimplement -- existing conditional logic already covers the same cases; do not introduce a tree abstraction without a demonstrated concrete gap, per the standing "no new architecture" rule).
- Integration status: Not adopted.

## pytransitions/transitions

- Repository / URL: [pytransitions/transitions](https://github.com/pytransitions/transitions)
- Commit SHA inspected: `bd42b38f3627e6bca7274fb4d9af2e105f75da7c`
- Last inspected: 2026-09-14
- License: MIT (verified via GitHub API).
- Category: Finite/hierarchical state-machine library (Python)
- Relevant files: [transitions/core.py](https://github.com/pytransitions/transitions/blob/bd42b38f3627e6bca7274fb4d9af2e105f75da7c/transitions/core.py) (existence and role confirmed; full API not extracted in this pass).
- Problem solved / algorithms / architecture: Explicit states, triggers, conditional transitions, callbacks, and (via extensions) hierarchical/async state machines -- a direct fit for a position lifecycle (`NO_POSITION -> SHORT_PUT_OPEN -> ROLL_PENDING -> ASSIGNMENT_PENDING -> STOCK_ASSIGNED -> RECOVERY -> CC_OPEN -> CALL_AWAY_PENDING -> CLOSED`).
- Strategy logic: None -- a generic state-machine library.
- Risk logic / assumptions: N/A.
- Execution logic / weaknesses: A library-level FSM does not itself enforce that transitions are broker-confirmed rather than model-inferred -- that discipline must still come from the caller (THETA's own standing rule: "broker reconciliation owns factual transitions, never inferred from a model").
- Backtesting logic: N/A.
- Useful tests / invariants: Illegal-transition rejection (e.g. `SHORT_PUT_OPEN -> CC_OPEN` directly, skipping assignment) is the exact invariant worth testing regardless of whether this library or a hand-rolled equivalent is used.
- Weaknesses: A Python dependency; THETA's canonical runtime is TypeScript, so direct adoption would require either a Python subprocess boundary (this repository already has several, e.g. `sizing_contract.py`) or a from-scratch TypeScript equivalent.
- Look-ahead risk: N/A.
- Survivorship-bias risk: N/A.
- THETA relevance / existing equivalent: **Verified directly against `origin/main`, resolving the open question below.** `src/theta/management-cycle.ts` documents and implements an explicit `ThetaLifecycleState` type -- an "ELEVEN-state canonical lifecycle machine" (`WAIT`, `CSP_PROPOSED`, `CSP_OPEN`, `BTC_CLOSE`, `EXPIRE_OTM`, `ROLL_DECISION`, `ASSIGNED`, `STOCK_HELD`, `RECOVERY_WAIT`, `CC_PROPOSED`, `CC_OPEN`, `CLOSE_CC`, `CALL_AWAY`, `CLOSE_STOCK`, `REDEPLOY`, `CLOSED` appear as named states/routes) -- routed through a `ROUTE_BY_LIFECYCLE_STATE` lookup table to one of `SHORT_PUT`/`ASSIGNMENT_PENDING`/`STOCK_RECOVERY`/`COVERED_CALL`/`CLOSED`/`UNKNOWN`. States with no defined management decision from a given cycle's perspective route to `UNKNOWN` explicitly rather than being guessed. This is a real, working, hand-rolled TypeScript state machine -- functionally equivalent to what `pytransitions` would provide, already implemented, already tested (per prior-round review of this file's neighbors).
- Better than current THETA: NO -- the existing hand-rolled TypeScript state machine already provides the exact guarantee (explicit states, fail-closed on an unrouted state) `pytransitions` would add.
- Recommended action: NO_CHANGE_REQUIRED -- confirmed already implemented; do not add a Python dependency or reimplement this in a new library.
- Integration status: Not adopted. Verified equivalent already exists in Production.

## Implemented consequence and retained blockers

The reviewed LEAN holding design reinforces the canonical requirement to value both option and stock inventory. THETA's old ledger returned a numeric total while substituting zero for open option MTM or omitting unmarked stock. The independent fix versions the calculation contract to v2, returns null for incomplete aggregates, exposes deterministic valuation issues, and retains known realized losses. No DB schema, strategy weight, broker endpoint or execution gate changed.

Still required: provenance-aware option MTM input, dividend share entitlement at ex-date, basis/premium allocation reconciliation, cost allocation without double-counting, capital-day integration, and durable lifecycle joins. This fix does not claim the ledger is a complete training-label pipeline.

Claude review items: execution_quality.py is direction-agnostic and uses ask-oriented slippage, so validate SELL_TO_OPEN and BUY_TO_CLOSE separately before using its heuristic. Compare utility units with per-share slippage. No quant source was changed. Replay must not copy positional date pairing from lambdaclass or failed-fold suppression from ivsurf.
