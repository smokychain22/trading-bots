# THETA professional GitHub reference pack

Status date: 2026-09-14. Canonical THETA baseline reviewed: `33ac67452f58b511edc215a528e8b29a6e04b377`.

This is a file-level source audit. README files were used only to navigate. Every repository was fetched, its default branch and exact HEAD were resolved, the license file and code tree were inspected, and the listed implementation and test files were read. No upstream package was installed. No external source was copied into Production. License labels are an intake screen, not legal advice.

Repositories provide methods and test ideas. Optionomics provides options research observations. Alpaca provides broker, account, order, fill, position, assignment, expiration, and corporate-action truth. None of these repositories proves THETA profitability or a 70 to 80 percent Managed Episode win rate.

## Verification inventory

| Repository | Verified | Default branch | Pinned SHA | Latest commit | License | Source | Tests | Examples |
|---|---:|---|---|---|---|---:|---:|---:|
| QuantConnect/Lean | YES | master | `6eb389012d73c364547d61546ff822fc8432dee2` | 2026-09-11 | Apache-2.0 | YES | YES, 1004 files | YES, 8 files |
| lballabio/QuantLib | YES | master | `ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4` | 2026-09-11 | BSD-style 3-clause | YES | YES, 201 files | YES, 83 files |
| vollib/py_vollib | YES | master | `11f2058f709328339e3906d99cb04ff41af97776` | 2026-04-30 | MIT | YES | YES, 29 files | NO separate examples tree |
| OpenGamma/Strata | YES | main | `987932ee95bf53e2baaff9a6b8e738a00f558b10` | 2026-09-07 | Apache-2.0 | YES | YES, 1533 files | YES, 157 files |
| goldspanlabs/optopsy | YES | main | `40bb8b2aa07ef8763caeadf752961faecb494efd` | 2026-04-02 | AGPL-3.0-or-later | YES | YES, 58 files | YES |
| goldspanlabs/optopsy-mcp | YES | main | `ce3740b127134bafef002298854710466b371dae` | 2026-04-07 | NO LICENSE FILE | YES | YES, 26 files | YES |
| FlashAlpha-lab/flashalpha-python | YES | main | `747335f4bbf69ec89b7eaa2744b7e0ff5743b21f` | 2026-09-09 | MIT | YES | YES, 4 files | YES, 2 files |
| FlashAlpha-lab/flashalpha-examples | YES | main | `524376e12bd29b3774780efb2cd2e9a40e96db7b` | 2026-08-26 | MIT | YES | YES, 27 files | YES, 15 notebooks/scripts |
| FlashAlpha-lab/volatility-surface-python | YES | main | `d1b8da3c4019bfb84bc58dd6140f74e489464520` | 2026-08-26 | MIT | Examples/theory, no library package | YES, 3 files | YES, 11 files |
| quants-net/PyFENG | YES | main | `c3e2e21fdcb0a54e2f82186524a98321f1802b5c` | 2026-08-07 | GPL-2.0 | YES | YES, 15 files | YES |
| domokane/FinancePy | YES | master | `2b9227fea9d832c4033421d6cd53a54316414fca` | 2026-09-12 | GPL-3.0 | YES | YES, unit and regression trees | YES, notebooks |
| pfnet-research/pfhedge | YES | main | `1fc08c73756bc6350f6a66977a5be97497d3bca0` | 2024-08-30 | MIT | YES | YES, 56 files | YES, 23 files |

`UNVERIFIED_REPOS = 0`. GitHub timestamps can move after this audit. The pinned SHA, not a moving branch name, identifies what was reviewed.

## 1. QuantConnect/Lean

- Files and symbols: [`Common/Data/Market/QuoteBar.cs`](https://github.com/QuantConnect/Lean/blob/6eb389012d73c364547d61546ff822fc8432dee2/Common/Data/Market/QuoteBar.cs), `Bid`, `Ask`, and midpoint `Open`; [`Common/Data/Market/OpenInterest.cs`](https://github.com/QuantConnect/Lean/blob/6eb389012d73c364547d61546ff822fc8432dee2/Common/Data/Market/OpenInterest.cs), `TickType.OpenInterest`; [`Common/Securities/SecurityHolding.cs`](https://github.com/QuantConnect/Lean/blob/6eb389012d73c364547d61546ff822fc8432dee2/Common/Securities/SecurityHolding.cs), `GetQuantityValue`; [`Common/Securities/Option/OptionHolding.cs`](https://github.com/QuantConnect/Lean/blob/6eb389012d73c364547d61546ff822fc8432dee2/Common/Securities/Option/OptionHolding.cs); [`DefaultExerciseModel.cs`](https://github.com/QuantConnect/Lean/blob/6eb389012d73c364547d61546ff822fc8432dee2/Common/Orders/OptionExercise/DefaultExerciseModel.cs); [`BrokerageTransactionHandler.cs`](https://github.com/QuantConnect/Lean/blob/6eb389012d73c364547d61546ff822fc8432dee2/Engine/TransactionHandlers/BrokerageTransactionHandler.cs); [`PartialMarketFillModelTests.cs`](https://github.com/QuantConnect/Lean/blob/6eb389012d73c364547d61546ff822fc8432dee2/Tests/Common/Orders/Fills/PartialMarketFillModelTests.cs).
- Method: quote, trade, and open interest are separate event types. Holding value includes contract multiplier. Exercise settlement emits order events. The transaction handler owns queued brokerage events and fill processing.
- Inputs, outputs, units: bid/ask price and size, holdings quantity, security price, currency conversion, contract multiplier, order/fill status. Cash value is price times quantity times multiplier and currency conversion.
- Assumptions and failures: LEAN may derive a midpoint display value from bid and ask. THETA must never treat that display midpoint as an executable fill. Brokerage behavior depends on the selected model.
- Bias risks: event time and data subscription configuration determine causality. A backtest brokerage model is not live fill truth.
- THETA equivalent: typed provider observations, broker reconciliation, partial-fill FSM, order-intent state, multiplier-safe economics already exist.
- Action: `ADAPT_NOW` for event separation and lifecycle test cases. `NO_CHANGE_REQUIRED` for the already-built order FSM. `REFERENCE_ONLY` for brokerage-model internals.

## 2. lballabio/QuantLib

- Files and symbols: [`blackformula.cpp`](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/ql/pricingengines/blackformula.cpp), `blackFormulaImpliedStdDev` and LiRS variant; [`fdblackscholesvanillaengine.cpp`](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/ql/pricingengines/vanilla/fdblackscholesvanillaengine.cpp); [`blackformula.cpp` tests](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/test-suite/blackformula.cpp); [`americanoption.cpp`](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/test-suite/americanoption.cpp).
- Method: bracketed implied-standard-deviation inversion with explicit price and discount bounds. Finite-difference Black-Scholes handles dividends, exercise schedules, local volatility choices, value, delta and gamma.
- Inputs, outputs, units: forward and strike in price units, option premium in discounted currency units, discount factor dimensionless, standard deviation `sigma*sqrt(T)`, volatility annualized decimal, rates/yields aligned to day-count and term.
- Assumptions and failures: European Black inversion and American equity option valuation are distinct. Dividend and yield curves materially affect early exercise. Invalid price bounds and failed convergence must be errors, never a chosen IV.
- Bias risks: point-in-time rate and dividend inputs are required. Current curves used historically create leakage.
- THETA equivalent: provider IV is retained, no independent solver is Production authority.
- Action: `ADAPT_NOW` as independent validation test oracle. No QuantLib runtime dependency added. American exercise awareness is mandatory in research discrepancy interpretation.

## 3. vollib/py_vollib

- Files and symbols: [`black_scholes_merton/implied_volatility.py`](https://github.com/vollib/py_vollib/blob/11f2058f709328339e3906d99cb04ff41af97776/vollib/black_scholes_merton/implied_volatility.py); [`greeks/analytical.py`](https://github.com/vollib/py_vollib/blob/11f2058f709328339e3906d99cb04ff41af97776/vollib/black_scholes_merton/greeks/analytical.py); [`test_issue_28_small_spot_price.py`](https://github.com/vollib/py_vollib/blob/11f2058f709328339e3906d99cb04ff41af97776/tests/test_issue_28_small_spot_price.py); [`test_strike_domain.py`](https://github.com/vollib/py_vollib/blob/11f2058f709328339e3906d99cb04ff41af97776/tests/test_strike_domain.py).
- Method: LetsBeRational IV inversion plus analytical BSM Greeks and numerical test comparisons.
- Inputs, outputs, units: `S`, `K`, price in currency per share, `t` in years, `r` and `q` annual decimals, sigma annual decimal. Theta is per day. Vega is per one volatility percentage point. These units must not be mixed with provider conventions.
- Assumptions and failures: European continuous-yield BSM. Prices below intrinsic and invalid strike/spot domains raise or fail. Zero and small spot cases require explicit tests.
- Bias risks: historical dividend yield and interest rate must be point-in-time.
- THETA equivalent: no second IV solver is present. Provider values are already UNKNOWN-safe.
- Action: `ADAPT_NOW` verification layer candidate for `IVDifference`, `DeltaDifference`, `GammaDifference`, `ThetaDifference`, and `VegaDifference`. Keep discrepancies as evidence. Never pick the value that favors a trade.

## 4. OpenGamma/Strata

- Files and symbols: [`MarketDataId.java`](https://github.com/OpenGamma/Strata/blob/987932ee95bf53e2baaff9a6b8e738a00f558b10/modules/data/src/main/java/com/opengamma/strata/data/MarketDataId.java); [`MarketDataBox.java`](https://github.com/OpenGamma/Strata/blob/987932ee95bf53e2baaff9a6b8e738a00f558b10/modules/data/src/main/java/com/opengamma/strata/data/scenario/MarketDataBox.java); [`BlackFormulaRepository.java`](https://github.com/OpenGamma/Strata/blob/987932ee95bf53e2baaff9a6b8e738a00f558b10/modules/pricer/src/main/java/com/opengamma/strata/pricer/impl/option/BlackFormulaRepository.java); scenario data tests under `modules/data/src/test`.
- Method: stable market-data identifiers, single versus scenario values, then separate product, pricer, measure, calculation, and scenario layers.
- Inputs, outputs, units: identifiers carry type. Pricers consume explicit forward, strike, time, volatility, and discount inputs. Measures and scenarios are downstream products.
- Assumptions and failures: a scenario vector is not a live observation. Type identity prevents silently applying the wrong datum.
- Bias risks: calibration inputs and valuation time need a consistent snapshot.
- THETA equivalent: raw Optionomics observation and feature snapshot layers exist.
- Action: `ADAPT_NOW`. Migration 029 and feature schema v2 strengthen `RAW OBSERVATION -> NORMALIZED STATE -> DERIVED FEATURE -> STRATEGY/RISK`. No second risk engine added.

## 5. goldspanlabs/optopsy

- Files and symbols: [`optopsy/pricing.py`](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/optopsy/pricing.py), `_calculate_fill_price`, `_calculate_commission`, `_assign_profit`; [`optopsy/metrics.py`](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/optopsy/metrics.py); [`optopsy/simulator.py`](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/optopsy/simulator.py); [`test_simulator_portfolio.py`](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/tests/test_simulator_portfolio.py); [`test_tools_iv_surface.py`](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/tests/test_tools_iv_surface.py).
- Method: direction-aware bid/ask, spread, liquidity and per-leg simulated fill models. Signed entry/exit cashflows, commissions, capital constraints, and risk metrics include drawdown, VaR, CVaR, Sharpe, Sortino, Calmar, Omega and profit factor.
- Inputs, outputs, units: option prices per share, multiplier and commission conventions must be bridged explicitly. Volume and fill ratio drive modeled liquidity.
- Assumptions and failures: midpoint is an optional simulation, not fill truth. Missing volume is sometimes filled with zero or a default ratio. Some empty metric cases return zero. Both conflict with THETA UNKNOWN rules.
- Bias risks: chronological input does not alone prove publication-time safety, expired-contract completeness, or survivorship safety.
- THETA equivalent: cost, TCA, lifecycle accounting, dataset firewall and metrics contracts exist.
- Action: `REFERENCE_ONLY` and `TEST_ONLY`. AGPL blocks direct proprietary Production reuse. Add comparators in R6, never import its stop, take-profit, DTE, or sizing thresholds as truth.

## 6. goldspanlabs/optopsy-mcp

- Files and symbols: [`scripts/strategies/wheel.trading`](https://github.com/goldspanlabs/optopsy-mcp/blob/ce3740b127134bafef002298854710466b371dae/scripts/strategies/wheel.trading); [`src/engine/walk_forward.rs`](https://github.com/goldspanlabs/optopsy-mcp/blob/ce3740b127134bafef002298854710466b371dae/src/engine/walk_forward.rs); [`src/engine/metrics.rs`](https://github.com/goldspanlabs/optopsy-mcp/blob/ce3740b127134bafef002298854710466b371dae/src/engine/metrics.rs); [`tests/next_bar_execution.rs`](https://github.com/goldspanlabs/optopsy-mcp/blob/ce3740b127134bafef002298854710466b371dae/tests/next_bar_execution.rs); [`tests/script_wheel.rs`](https://github.com/goldspanlabs/optopsy-mcp/blob/ce3740b127134bafef002298854710466b371dae/tests/script_wheel.rs); [`tests/permutation_gate.rs`](https://github.com/goldspanlabs/optopsy-mcp/blob/ce3740b127134bafef002298854710466b371dae/tests/permutation_gate.rs).
- Method: Rust strategy DSL, parameter injection, next-bar market execution, touched-limit tests, wheel simulation, walk-forward, permutation, Bayesian and hypothesis infrastructure.
- Inputs, outputs, units: bar data, strategy parameters, cash and multiplier. The sample wheel fixes multiplier 100 and fixed strategy thresholds.
- Assumptions and failures: next-bar open preserves causality better than same-bar fill. Limit touch does not establish queue priority. The sample uses midpoint slippage and fixed rules.
- Bias risks: synthetic wheel tests do not prove real assignment, broker state, or execution. Parameter sweeps need multiple-testing controls.
- THETA equivalent: deterministic export and replay, shadow fill qualification and experiment fingerprints exist.
- Action: `RESEARCH_CHALLENGER`. No license file means no code reuse. Adopt only the next-observation causality test idea. Reject sample strategy parameters as Production truth.

## 7. FlashAlpha-lab/flashalpha-python

- Files and symbols: [`src/flashalpha/client.py`](https://github.com/FlashAlpha-lab/flashalpha-python/blob/747335f4bbf69ec89b7eaa2744b7e0ff5743b21f/src/flashalpha/client.py), typed endpoint methods and `_handle`; [`tests/test_client.py`](https://github.com/FlashAlpha-lab/flashalpha-python/blob/747335f4bbf69ec89b7eaa2744b7e0ff5743b21f/tests/test_client.py); [`tests/test_response_envelope.py`](https://github.com/FlashAlpha-lab/flashalpha-python/blob/747335f4bbf69ec89b7eaa2744b7e0ff5743b21f/tests/test_response_envelope.py); [`examples/quickstart.py`](https://github.com/FlashAlpha-lab/flashalpha-python/blob/747335f4bbf69ec89b7eaa2744b7e0ff5743b21f/examples/quickstart.py).
- Method: distinct methods for quote, options, volatility surface, SVI, GEX, DEX, Vanna/Charm exposures, flow and VRP. Error handling separates 401, 403, 429 and server errors and reads Retry-After.
- Inputs, outputs, units: provider-specific responses. Response generation time, data-as-of time, spot feed and option feed remain separate.
- Assumptions and failures: a bare array can lose response metadata. Missing gamma flip stays unavailable rather than zero. Feed activity does not prove each contract quote is fresh.
- Bias risks: provider rankings and exposure sign conventions are vendor-specific.
- THETA equivalent: typed Optionomics adapter, explicit UNKNOWN, provenance and rate-limit policy exist.
- Action: `ADAPT_NOW` architecture only. Migration 029 records request, response and rate-limit provenance. Reject proprietary scores, thresholds, and marketing claims.

## 8. FlashAlpha-lab/flashalpha-examples

- Files: [`examples/02_gex_dashboard.py`](https://github.com/FlashAlpha-lab/flashalpha-examples/blob/524376e12bd29b3774780efb2cd2e9a40e96db7b/examples/02_gex_dashboard.py), [`04_vol_surface_3d.py`](https://github.com/FlashAlpha-lab/flashalpha-examples/blob/524376e12bd29b3774780efb2cd2e9a40e96db7b/examples/04_vol_surface_3d.py), [`08_advanced_volatility.py`](https://github.com/FlashAlpha-lab/flashalpha-examples/blob/524376e12bd29b3774780efb2cd2e9a40e96db7b/examples/08_advanced_volatility.py), [`12_realized_vol_and_forecast.py`](https://github.com/FlashAlpha-lab/flashalpha-examples/blob/524376e12bd29b3774780efb2cd2e9a40e96db7b/examples/12_realized_vol_and_forecast.py), [`tests/test_layer0_secrets.py`](https://github.com/FlashAlpha-lab/flashalpha-examples/blob/524376e12bd29b3774780efb2cd2e9a40e96db7b/tests/test_layer0_secrets.py), and cassette-integrity tests.
- Method: separate dashboards and notebooks for exposure, surface, VRP, flow and screening, plus secret and recorded-response test layers.
- Assumptions and failures: examples demonstrate use, not validated alpha. Recorded cassettes can become stale and may omit provider metadata.
- Bias risks: notebook ordering and downloaded current data can leak future state into historical experiments.
- THETA equivalent: family separation and security scan exist.
- Action: `REFERENCE_ONLY` and `TEST_ONLY`. Use notebook structure as experiment templates. Recompute formulas and preserve point-in-time cutoffs.

## 9. FlashAlpha-lab/volatility-surface-python

- Files and symbols: [`examples/svi_calibration_example.py`](https://github.com/FlashAlpha-lab/volatility-surface-python/blob/d1b8da3c4019bfb84bc58dd6140f74e489464520/examples/svi_calibration_example.py); [`examples/implied_volatility_surface.py`](https://github.com/FlashAlpha-lab/volatility-surface-python/blob/d1b8da3c4019bfb84bc58dd6140f74e489464520/examples/implied_volatility_surface.py); [`tests/test_unit.py`](https://github.com/FlashAlpha-lab/volatility-surface-python/blob/d1b8da3c4019bfb84bc58dd6140f74e489464520/tests/test_unit.py).
- Method and formulas: forward log moneyness `k = ln(K/F)`, total variance `w = IV^2*T`, raw SVI `w(k)=a+b*(rho*(k-m)+sqrt((k-m)^2+sigma^2))`, fit residual `market IV - fitted IV`. The material discusses butterfly and calendar consistency.
- Inputs, outputs, units: strike and forward in the same currency units, `T` in years, IV annual decimal, total variance dimensionless. Forward and rates/dividends need point-in-time inputs.
- Assumptions and failures: this repo has substantive examples and tests but no reusable library package. Sparse strikes, crossed markets and unstable forwards can produce a false smooth surface.
- Bias risks: global fit across future expiries or revised rates leaks data. Surface residual is relative value, not a sell signal.
- THETA equivalent: v1 stores raw IV grid only. No fitted surface engine exists.
- Action: `ADAPT_NOW` for transparent raw quote economics and total-variance research design. `RESEARCH_CHALLENGER` for SVI/SSVI. Do not force-fit or promote without OOS value and arbitrage diagnostics.

## 10. quants-net/PyFENG

- Files and symbols: [`pyfeng/bsm.py`](https://github.com/quants-net/PyFENG/blob/c3e2e21fdcb0a54e2f82186524a98321f1802b5c/pyfeng/bsm.py), price, delta, gamma, vega and impvol; [`pyfeng/sabr.py`](https://github.com/quants-net/PyFENG/blob/c3e2e21fdcb0a54e2f82186524a98321f1802b5c/pyfeng/sabr.py); [`pyfeng/heston.py`](https://github.com/quants-net/PyFENG/blob/c3e2e21fdcb0a54e2f82186524a98321f1802b5c/pyfeng/heston.py); [`tests/test_bsm_norm.py`](https://github.com/quants-net/PyFENG/blob/c3e2e21fdcb0a54e2f82186524a98321f1802b5c/tests/test_bsm_norm.py); SABR and Heston tests.
- Method: BSM, Bachelier, CEV, SABR, Heston, Schöbel-Zhu and other analytical or numerical models.
- Inputs, outputs, units: model-specific spot/forward, strike, time, rates, volatility and shape parameters. Outputs are model prices, IV and Greeks.
- Assumptions and failures: calibration can be underidentified. Advanced stochastic-vol models add estimation error and compute cost.
- Bias risks: calibrating and testing on the same surface overstates fit. Future surfaces cannot tune past decisions.
- THETA equivalent: simple provider features exist and empirical EV remains blocked.
- Action: `RESEARCH_CHALLENGER` only. GPL blocks direct proprietary reuse. Reject Production integration until an ablation beats Optionomics IV, skew, term, surface and IV-versus-RV baselines OOS.

## 11. domokane/FinancePy

- Files and symbols: [`financepy/models/black_scholes.py`](https://github.com/domokane/FinancePy/blob/2b9227fea9d832c4033421d6cd53a54316414fca/financepy/models/black_scholes.py); [`financepy/market/volatility/equity_vol_surface.py`](https://github.com/domokane/FinancePy/blob/2b9227fea9d832c4033421d6cd53a54316414fca/financepy/market/volatility/equity_vol_surface.py); [`unit_tests/test_FinEquityVolSurface.py`](https://github.com/domokane/FinancePy/blob/2b9227fea9d832c4033421d6cd53a54316414fca/unit_tests/test_FinEquityVolSurface.py); [`unit_tests/test_FinEquityAmericanOption.py`](https://github.com/domokane/FinancePy/blob/2b9227fea9d832c4033421d6cd53a54316414fca/unit_tests/test_FinEquityAmericanOption.py).
- Method: separates market curves and surfaces, models, products and utilities. Supports European and American methods including CRR, LSMC, finite difference and PSOR. Surface calibration supports SSVI/SABR-style choices and delta-to-strike work.
- Inputs, outputs, units: curves, dividends, expiries, strikes, delta conventions, prices and volatility.
- Assumptions and failures: surface calibration and American exercise results depend on convention and numerical method. Convergence and fit quality are evidence.
- Bias risks: historical curves, dividends and volatility quotes require time-correct snapshots.
- THETA equivalent: raw/derived boundary exists, full surface calibration does not.
- Action: `REFERENCE_ONLY`. GPL blocks direct reuse. Adopt test cases and layer boundaries, not code.

## 12. pfnet-research/pfhedge

- Files and symbols: [`pfhedge/nn/functional.py`](https://github.com/pfnet-research/pfhedge/blob/1fc08c73756bc6350f6a66977a5be97497d3bca0/pfhedge/nn/functional.py), expected shortfall, entropic risk, transaction-cost-aware P&L and `ww_width`; [`pfhedge/nn/modules/loss.py`](https://github.com/pfnet-research/pfhedge/blob/1fc08c73756bc6350f6a66977a5be97497d3bca0/pfhedge/nn/modules/loss.py); [`pfhedge/nn/modules/ww.py`](https://github.com/pfnet-research/pfhedge/blob/1fc08c73756bc6350f6a66977a5be97497d3bca0/pfhedge/nn/modules/ww.py); [`tests/nn/modules/test_hedger.py`](https://github.com/pfnet-research/pfhedge/blob/1fc08c73756bc6350f6a66977a5be97497d3bca0/tests/nn/modules/test_hedger.py); loss and Whalley-Wilmott tests.
- Method and formula: cost-aware hedging P&L subtracts transaction costs proportional to spot and absolute hedge changes. Expected shortfall averages tail losses. The Whalley-Wilmott half-width is proportional to `(cost * 3/2 * gamma^2 * spot / risk_aversion)^(1/3)` under its model.
- Inputs, outputs, units: simulated price paths, hedge units, proportional cost, risk aversion, gamma and spot. Outputs are P&L distributions, risk measures and hedge bands.
- Assumptions and failures: model-driven paths and differentiable hedgers do not represent an assignment-aware CSP ledger by themselves.
- Bias risks: training and test paths, simulated dynamics, transaction costs and regime coverage control validity.
- THETA equivalent: ES/CVaR requirements and execution TCA exist.
- Action: `RESEARCH_CHALLENGER` for future tail and transaction-cost research. Reject as current CSP entry authority.

## Methods changed in THETA

- `ADAPTED_NOW`: documented-only Optionomics chain query, immutable request and rate-limit provenance, one-way credential identity reference, distinct derived mid/spread/relative spread, CSP downside cushion, multiplier-safe credit yield, expected-move context, and strategy-specific feature-family routing.
- `NO_CHANGE_REQUIRED`: second order lifecycle, second backtester, second GEX calculation, second risk governor and duplicate IV solver were avoided.
- `RESEARCH_CHALLENGERS_ADDED`: IV/Greek cross-check design, SVI/SSVI surface fit, advanced stochastic-vol ablation, transaction-cost-aware hedging, and next-observation fill causality. These are documented research candidates, not promoted runtime models.
- `REJECTED`: midpoint-as-fill, missing volume or metrics as zero, fixed multiplier 100, fixed sample wheel thresholds, inferred dealer sign as observed truth, provider proprietary scores, and advanced model complexity without OOS improvement.
- `LICENSE_BLOCKERS`: Optopsy AGPL, PyFENG GPL-2.0, FinancePy GPL-3.0, and Optopsy-MCP with no license file. No source was imported.

## Acceptance summary

`PRODUCTION_METHODS_ADOPTED = 8` focused, independently implemented contracts and features.

`RESEARCH_CHALLENGERS_ADDED = 5` method families, all non-executable.

`DUPLICATES_AVOIDED = 5` major duplicate engines.

`LICENSE_BLOCKERS = 4` repositories requiring legal review or forbidding unlicensed reuse.

`UNVERIFIED_REPOS = 0` for repository identity and source presence. Quantitative value remains unverified until THETA PIT/OOS experiments run.
