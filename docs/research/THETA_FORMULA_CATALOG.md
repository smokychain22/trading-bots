# THETA formula catalog

2026-09-11. Canonical specifications win over public examples. Exact source files/commits are supplied below. Proposed standard definitions are labeled separately from extracted implementation. No equation implies proven profit. Earlier versions are preserved in archive/. No source code was copied and no new quantitative feature was promoted.

Cross-implementation outcomes: pricing compared across QuantLib/ivsurf, GEX across at least four implementations, fill direction across optopsy/lambdaclass/LEAN, assignment/accounting across LEAN and both Wheel examples. Agreement on arithmetic does not validate data, market assumptions or alpha.

## European Black-Scholes / Black-76

```text
d1=(ln(F/K)+sigma²T/2)/(sigma sqrt(T)); d2=d1-sigma sqrt(T)
C=D[F N(d1)-K N(d2)]; P=D[K N(-d2)-F N(-d1)]
```

- Variables / units: F forward price, K strike, D discount factor, sigma annualized decimal volatility, T year fraction. Price is currency per underlying unit.
- Source repository / file / commit: [lballabio/QuantLib: ql/pricingengines/blackformula.cpp](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/ql/pricingengines/blackformula.cpp), commit `ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4`; independently compared with [thedhruvhegde/ivsurf: core/black_scholes.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/core/black_scholes.py), commit `c20072a8f6c09146697bdb55dca566567d7b0535`
- Assumptions: For BSM F=S exp((r-q)T), D=exp(-rT). European exercise and carry assumptions. American equity options, discrete dividends and assignment require appropriate models.
- Numerical and missing-data issues: Validate bounds and finite inputs, T=0 separately. ivsurf's any(T==0) batch shortcut is rejected.
- THETA implementation: REFERENCE_ONLY, offline oracle proposed, no replacement for executable BBO.
- Verification tests: Proposed parity, price-IV roundtrip, mixed maturities, dividend/model mismatch fixtures.

## Greeks and their units

```text
Delta_call=exp(-qT)N(d1); Delta_put=exp(-qT)(N(d1)-1)
Gamma=exp(-qT)phi(d1)/(S sigma sqrt(T))
Vega=S exp(-qT)phi(d1)sqrt(T)
```

- Variables / units: Delta per share, gamma delta change per unit spot, vega price change per1.00 sigma. Vega per volatility point equals Vega/100.
- Source repository / file / commit: [FlashAlpha-lab/gex-explained: code/compute_gex.py](https://github.com/FlashAlpha-lab/gex-explained/blob/a11321d62006311c4a72a68552587485024f2bf2/code/compute_gex.py), commit `a11321d62006311c4a72a68552587485024f2bf2`; [thedhruvhegde/ivsurf: core/black_scholes.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/core/black_scholes.py), commit `c20072a8f6c09146697bdb55dca566567d7b0535`
- Assumptions: Positive gamma for a long vanilla call AND long vanilla put. Portfolio sign derives from position ownership, not option right.
- Numerical and missing-data issues: At expiry/zero volatility singular Greeks must not be relabeled valid zero. Finite-difference cross-check needed.
- THETA implementation: Provider Greeks retained, independent numerical validation proposed.
- Verification tests: Proposed analytical vs finite difference, multiplier scaling, per-point vs per-unit vega.

## IV inversion

```text
Find sigma such that model_price(sigma)-observed_price=0, with bounded search and residual <= tolerance
```

- Variables / units: sigma annualized decimal. Price residual in currency per underlying unit.
- Source repository / file / commit: [lballabio/QuantLib: ql/pricingengines/blackformula.cpp](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/ql/pricingengines/blackformula.cpp), commit `ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4`; [thedhruvhegde/ivsurf: core/black_scholes.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/core/black_scholes.py), commit `c20072a8f6c09146697bdb55dca566567d7b0535`
- Assumptions: Observed price must satisfy model bounds. A midpoint can be an IV research input, never an assumed executable fill.
- Numerical and missing-data issues: No convergence=>UNKNOWN/INVALID, not0 or default20%. Scalar Brent and vector Newton need distinct shape tests.
- THETA implementation: REFERENCE_ONLY, provider contract validation first.
- Verification tests: Proposed invalid price bounds, deep ITM/OTM, small vega, nonfinite and no-convergence tests.

## Total variance / term interpolation

```text
w(K,T)=sigma(K,T)^2 T
forward_variance=(w(K,T2)-w(K,T1))/(T2-T1)
```

- Variables / units: w dimensionless variance, forward variance per year. K/forward-moneyness coordinate must be specified.
- Source repository / file / commit: [lballabio/QuantLib: ql/termstructures/volatility/equityfx/blackvariancesurface.cpp](https://github.com/lballabio/QuantLib/blob/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4/ql/termstructures/volatility/equityfx/blackvariancesurface.cpp), commit `ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4`
- Assumptions: QuantLib inspected surface interpolates variance with sorted unique times. Choice of strike vs forward-moneyness affects calendar comparisons.
- Numerical and missing-data issues: Bilinear interpolation is not a universal no-arbitrage guarantee. Negative forward variance is a sanity warning, not silently clipped evidence.
- THETA implementation: REFERENCE_ONLY, no new surface service.
- Verification tests: Proposed sorted dates, duplicate maturity, sparse wings, extrapolation flags.

## Realized volatility and IV/RV spread

```text
r_t=ln(S_t/S_(t-1)); RV=sample_std(r_t)*sqrt(A)
spread=IV_matched_horizon-RV
```

- Variables / units: A observations/year. Both volatilities annualized decimal, spread in decimal volatility.
- Source repository / file / commit: [NavnoorBawa/Options-Flow-Predictor: Options Flow Predictor.ipynb](https://github.com/NavnoorBawa/Options-Flow-Predictor/blob/da83ec361c1cb7494a0b1b96dbca8edc4a09e788/Options%20Flow%20Predictor.ipynb), commit `da83ec361c1cb7494a0b1b96dbca8edc4a09e788`; equation here is a normalized research definition, not a claim every notebook estimator matches it.
- Assumptions: Use point-in-time corporate-action-consistent prices and matching horizon; historical RV is not future realized volatility.
- Numerical and missing-data issues: Few observations or missing prices=>UNKNOWN. Annualization, estimator and adjustment convention must be versioned.
- THETA implementation: Existing regime features are not changed.
- Verification tests: Proposed split/dividend jump handling and no future observations.

## IV rank / percentile

```text
rank=100*(IV_now-min(IV_history))/(max(IV_history)-min(IV_history))
percentile=100*count(IV_history<=IV_now)/N
```

- Variables / units: Percent0..100. Tie convention shown explicitly. Same underlying/tenor/definition required.
- Source repository / file / commit: [ShayantoDutta/alpaca-wheel-bot: wheel_bot.py](https://github.com/ShayantoDutta/alpaca-wheel-bot/blob/40c550cf44109028f9a99cdee2863a74c93ba833/wheel_bot.py), commit `40c550cf44109028f9a99cdee2863a74c93ba833`; percentile is an independent comparison definition, not claimed extracted code.
- Assumptions: Rank and percentile differ. Current mean of a few contracts is not a stable historical-tenor series.
- Numerical and missing-data issues: Constant range, insufficient N, missing history=>UNKNOWN. No fabricated neutral rank.
- THETA implementation: REFERENCE_ONLY, history prerequisite remains.
- Verification tests: Proposed constant history, outliers, ties and missing dates.

## Skew and volatility term ratio

```text
skew_25d=IV_put_at_abs_delta_0.25-IV_call_at_delta_0.25
term_ratio=IV_near/IV_far
```

- Variables / units: Skew in decimal volatility, ratio dimensionless. Same timestamp and named tenors required.
- Source repository / file / commit: [thedhruvhegde/ivsurf: core/surface_model.py](https://github.com/thedhruvhegde/ivsurf/blob/c20072a8f6c09146697bdb55dca566567d7b0535/core/surface_model.py), commit `c20072a8f6c09146697bdb55dca566567d7b0535`; these are proposed normalization definitions, not extracted functionality: that module is a placeholder.
- Assumptions: Delta convention, forward/spot, interpolation and maturity must match. Cboe index ratio stays a separate proxy.
- Numerical and missing-data issues: Missing wing or zero far volatility=>UNKNOWN. Smoothing cannot create observed data.
- THETA implementation: No new formula wired. Discover actual Optionomics alias semantics first.
- Verification tests: Proposed wing absence, crossed expiries and timestamp mismatch.

## Signed GEX proxy

```text
GEX_i=z_i Gamma_i OI_i M_i S²*0.01
GEX_total=sum_i GEX_i
```

- Variables / units: M actual contract multiplier, OI contracts, z assumed position sign. Dollars of delta-notional change for a1% spot move.
- Source repository / file / commit: [FlashAlpha-lab/gex-explained: code/compute_gex.py](https://github.com/FlashAlpha-lab/gex-explained/blob/a11321d62006311c4a72a68552587485024f2bf2/code/compute_gex.py), commit `a11321d62006311c4a72a68552587485024f2bf2`; [hedarthy/DealerFlow: spy_gex/exposure.py](https://github.com/hedarthy/DealerFlow/blob/14c7a0f345116c93b43641893aaa372a4cf19085/spy_gex/exposure.py), commit `14c7a0f345116c93b43641893aaa372a4cf19085`; [zrack/gex-terminal: gex_terminal/engine.py](https://github.com/zrack/gex-terminal/blob/72d68f47a41c2c330351476cef99b48411f9fe3d/gex_terminal/engine.py), commit `72d68f47a41c2c330351476cef99b48411f9fe3d`
- Assumptions: The common z_call=+1/z_put=-1 is imposed positioning. It cannot mean dealers short both, which gives negative gamma for both. No observed dealer inventory inferred.
- Numerical and missing-data issues: Unknown IV/OI/multiplier cannot become0. Coverage, OI date and expiry treatment must accompany aggregate.
- THETA implementation: RESEARCH_ONLY, not added to runtime.
- Verification tests: Proposed same-input cross-implementation values, OI/multiplier scaling, empty and partial chain.

## Three different zero crossings

```text
linear_root=x1-g1*(x2-x1)/(g2-g1)
A: g=strike bucket net GEX, x=strike
B: g=cumulative strike GEX, x=strike
C: g=aggregate GEX recalculated at hypothetical spot x
```

- Variables / units: Root is a price level, but A/B/C represent different quantities.
- Source repository / file / commit: [FlashAlpha-lab/gex-explained: code/compute_gex.py](https://github.com/FlashAlpha-lab/gex-explained/blob/a11321d62006311c4a72a68552587485024f2bf2/code/compute_gex.py), commit `a11321d62006311c4a72a68552587485024f2bf2`; [hedarthy/DealerFlow: spy_gex/exposure.py](https://github.com/hedarthy/DealerFlow/blob/14c7a0f345116c93b43641893aaa372a4cf19085/spy_gex/exposure.py), commit `14c7a0f345116c93b43641893aaa372a4cf19085`; [sgdividends/spx-dealer-gamma: gamma.py](https://github.com/sgdividends/spx-dealer-gamma/blob/4b49ede031a17daa2a18c087e7fdb200a0c1d26f/gamma.py), commit `4b49ede031a17daa2a18c087e7fdb200a0c1d26f`
- Assumptions: A is FlashAlpha. B is DealerFlow/puneet. C is sgdividends fixed-IV spot scan. Selected definition for a future aggregate zero-gamma scenario is C, with its model assumptions disclosed. A/B must retain distinct names.
- Numerical and missing-data issues: No bracket=>no crossing, not0. All-zero or all-missing curve is indeterminate. Multiple roots require all roots and selection rule.
- THETA implementation: Definition only, not a promoted indicator.
- Verification tests: Proposed curves where A/B/C differ, no crossing, allzero and multiple roots.

## Call / put walls

```text
bucket_wall_max=argmax_K signed_bucket_GEX(K)
bucket_wall_min=argmin_K signed_bucket_GEX(K)
```

- Variables / units: Strike price. Pure call/put walls would require separate type-specific series.
- Source repository / file / commit: [FlashAlpha-lab/gex-explained: code/compute_gex.py](https://github.com/FlashAlpha-lab/gex-explained/blob/a11321d62006311c4a72a68552587485024f2bf2/code/compute_gex.py), commit `a11321d62006311c4a72a68552587485024f2bf2`
- Assumptions: Names must match aggregation. Net extrema are not guaranteed support/resistance or uniquely call-only/put-only exposure.
- Numerical and missing-data issues: Empty chain=>UNKNOWN. Noisy OI can dominate one strike.
- THETA implementation: REFERENCE_ONLY.
- Verification tests: Proposed tied extrema and single noisy strike.

## Vanna / charm exposure

```text
VEX=sum_i z_i (dDelta/dsigma)_i OI_i M_i S
CEX_day=sum_i z_i (dDelta/dt)_i OI_i M_i S / days_per_year
```

- Variables / units: VEX dollar delta-notional per1.00 sigma, divide100 for one vol point. Charm sign depends on calendar time versus time-to-expiry derivative.
- Source repository / file / commit: [hedarthy/DealerFlow: spy_gex/exposure.py](https://github.com/hedarthy/DealerFlow/blob/14c7a0f345116c93b43641893aaa372a4cf19085/spy_gex/exposure.py), commit `14c7a0f345116c93b43641893aaa372a4cf19085`; [BitraAI/gex_app: calculations.py](https://github.com/BitraAI/gex_app/blob/b1234c65452581fccf5375cb7488b990423ed79c/calculations.py), commit `b1234c65452581fccf5375cb7488b990423ed79c`
- Assumptions: Bitra's VEX uses vega, so it is not the same quantity as DealerFlow's vanna exposure. Exact Greek and scaling are mandatory metadata.
- Numerical and missing-data issues: No acronym-based merge, no cross-underlying delta substitution.
- THETA implementation: REFERENCE_ONLY, no restricted source reused.
- Verification tests: Proposed finite-difference delta in sigma/time, sign and scale checks.

## Directional modeled fill and TCA

```text
mid=(bid+ask)/2; h=(ask-bid)/2
buy_model=mid+h*rho; sell_model=mid-h*rho
adverse_slippage=side*(actual_fill-reference_price)*M*Q, side=+1 buy,-1 sell
```

- Variables / units: rho is a documented scenario0..1, Q contracts, prices per share, TCA dollars.
- Source repository / file / commit: [goldspanlabs/optopsy: optopsy/pricing.py](https://github.com/goldspanlabs/optopsy/blob/40bb8b2aa07ef8763caeadf752961faecb494efd/optopsy/pricing.py), commit `40bb8b2aa07ef8763caeadf752961faecb494efd`; [lambdaclass/options_portfolio_backtester: options_portfolio_backtester/execution/fill_model.py](https://github.com/lambdaclass/options_portfolio_backtester/blob/e53ef86928777de6ee0721424762ea3dc133f993/options_portfolio_backtester/execution/fill_model.py), commit `e53ef86928777de6ee0721424762ea3dc133f993`; [QuantConnect/Lean: Common/Securities/SecurityHolding.cs](https://github.com/QuantConnect/Lean/blob/8ee075a39918f2df6fe9e0a5944e366fb60d10dc/Common/Securities/SecurityHolding.cs), commit `8ee075a39918f2df6fe9e0a5944e366fb60d10dc`
- Assumptions: Quote crossing is a price assumption, not fill certainty. No midpoint production assumption. Volume/leg penalties require empirical fit, not arbitrary promotion.
- Numerical and missing-data issues: Unknown BBO/volume remain explicit. Actual fill-based P&L already contains execution-price slippage, do not deduct it again.
- THETA implementation: THETA execution_quality.py lacks side input, review requested. No quant change.
- Verification tests: Proposed STO/BTC/STC/BTO, quote-before-submit, partial fill and no fill tests.

## Whole-cycle and management utility

```text
CycleUtility = E[whole_chain_pnl] / E[capital_days] - tail_penalty - inventory_penalty
ManagementUtility(a) = RemainingEV(a) - lambda*TailRisk(a) - kappa*CapitalDays(a)
                       - xi*ExecutionRisk(a) - OpportunityCost(a)
```

- Variables / units: Whole-chain P&L and cost terms must use compatible currency units. Capital-day normalization and every penalty weight must be versioned. Action `a` comes from the canonical lifecycle action set.
- Source: owner-supplied THETA strategy and profitability blueprints dated 2026-09-12, reconciled with the canonical formula registry.
- Assumptions: All compared actions share one decision-time FusionSnapshot. Remaining EV uses physical, point-in-time outcome distributions and after-cost economics.
- Numerical and missing-data issues: If any required empirical component or its unit convention is unknown, utility is UNKNOWN. Missing penalties cannot become zero. No arbitrary lambda, kappa, or xi is promoted by this catalog.
- THETA implementation: The action frontier and response contract persist the alternatives and null fields. Empirical calibration is blocked.
- Verification tests: Strategy response rejects non-null EV while empirical readiness is blocked. Management frontier and receipt tests preserve null utilities.

## After-cost expected value and Full-H

```text
EV_net=E[full_lifecycle_cashflows+open_MTM-costs | information_available_at_decision]
```

- Variables / units: Dollars per explicitly stated contract/episode. Distribution includes assignment/recovery/CC/exit paths.
- Source repository / file / commit: THETA [canonical formula registry](../quant/phase2/FORMULA_REGISTRY.md), baseline commit `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. This is an existing THETA definition, not a new external formula.
- Assumptions: Calibrated physical outcome distribution required. Pricing probabilities, score rankings and premium yield cannot substitute for EV.
- Numerical and missing-data issues: Unknown model/features/costs=>UNKNOWN. Separate fixed-horizon MTM labels from resolved-episode labels.
- THETA implementation: Full-H frontier gates positive EV but empirical model not ready.
- Verification tests: Existing cross-symbol tests cover unknown/nonpositive EV. Required untouched OOS, N/effectiveN, PF/DD/ES/Brier.

## Whole-chain P&L / inventory

```text
PnL=option_realized+option_unrealized+stock_realized+stock_unrealized+dividends-fees
open_stock_MTM=(mark-basis)*shares
```

- Variables / units: All components in account currency. Economic basis allocation and costs must reconcile exactly once.
- Source repository / file / commit: THETA [canonical formula registry](../quant/phase2/FORMULA_REGISTRY.md), baseline commit `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. This is an existing THETA definition, not a new external formula. Independently compared with [QuantConnect/Lean: Common/Securities/SecurityHolding.cs](https://github.com/QuantConnect/Lean/blob/8ee075a39918f2df6fe9e0a5944e366fb60d10dc/Common/Securities/SecurityHolding.cs), commit `8ee075a39918f2df6fe9e0a5944e366fb60d10dc`
- Assumptions: If basis already includes option premium, reconcile allocation before also summing that premium. Dividend shares must be entitlement-at-ex-date, not blindly current holdings.
- Numerical and missing-data issues: Missing component makes total UNKNOWN. Open options currently lack mark input. Known realized components stay visible.
- THETA implementation: IMPLEMENTED v2 nullable total/component and valuationIssues. Not complete broker-grade label construction.
- Verification tests: tests/ledger-contract.test.ts: missing option/stock/dividend lot, retained roll loss, assigned stock loss, true zero.

## Capital-days and capital efficiency

```text
CapitalDays=sum_j capital_reserved_j*duration_days_j
ReturnPerCapitalDay=PnL/CapitalDays for a known positive denominator
```

- Variables / units: Currency-days and inverse days. Report horizon and calendar/trading-day convention.
- Source repository / file / commit: THETA [canonical formula registry](../quant/phase2/FORMULA_REGISTRY.md), baseline commit `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. This is an existing THETA definition, not a new external formula.
- Assumptions: Compare same horizon, capital reservation convention and return definition. No arbitrary epsilon to manufacture a finite return for absent denominator.
- Numerical and missing-data issues: Unknown capital intervals=>UNKNOWN. Zero denominator needs explicit not-applicable handling.
- THETA implementation: Whole-chain reservation/time join remains incomplete.
- Verification tests: Proposed reservation changes, partial fills, assignment duration, no overlapping double reservations.

## Expected shortfall / drawdown

```text
L=-net_return; ES_alpha=mean(worst alpha fraction of L)
DD_t=1-equity_t/running_peak_t; MaxDD=max_t DD_t
```

- Variables / units: ES loss fraction or currency explicitly declared, DD nonnegative fraction. alpha=.05 means worst5%.
- Source repository / file / commit: [NavnoorBawa/Options-Flow-Predictor: Options Flow Predictor.ipynb](https://github.com/NavnoorBawa/Options-Flow-Predictor/blob/da83ec361c1cb7494a0b1b96dbca8edc4a09e788/Options%20Flow%20Predictor.ipynb), commit `da83ec361c1cb7494a0b1b96dbca8edc4a09e788`; normalized loss-sign convention here is a review recommendation.
- Assumptions: Tail quantile/tie weighting and sampling interval must be versioned. Include open MTM and external-cashflow treatment.
- Numerical and missing-data issues: Incomplete valuations=>unknown risk series, not flat equity. Small independent N produces wide uncertainty.
- THETA implementation: No tail estimator or threshold changed.
- Verification tests: Proposed exact loss samples, ties, cash deposits, unresolved inventory.

## Kelly and fractional Kelly

```text
b=AvgWin/AvgLoss; f*=p-(1-p)/b
fractional_ceiling=max(0,a*f*), 0<a<1
```

- Variables / units: p physical outcome frequency estimate, wins/losses after cost, b dimensionless.
- Source repository / file / commit: [ksanjay/Kelly-Criterion-Option-Selector: kelly_leaps.ipynb](https://github.com/ksanjay/Kelly-Criterion-Option-Selector/blob/43c2443cd202777650bd1c61233054a83fe31771/kelly_leaps.ipynb), commit `43c2443cd202777650bd1c61233054a83fe31771`; source's N(d2) input is explicitly rejected.
- Assumptions: Binary fixed-payoff formula is only an approximation to variable option lifecycle returns. Fractional sizing still needs calibrated distribution, uncertainty and portfolio caps.
- Numerical and missing-data issues: No raw Kelly, forced1 or independent bankroll reuse. N(d2) is not real-world profit probability.
- THETA implementation: REJECT source selector, preserve AEGIS caps. Fraction a is not assigned a new runtime value.
- Verification tests: Existing sizing cap tests, proposed probability-provenance/aggregate allocation cases.

## Assignment / recovery economics

```text
assignment_cash_and_deliverable + subsequent_stock/CC_cashflows + open_MTM - costs
recovery comparison: hold versus sell/CC alternatives at same decision time
```

- Variables / units: Dollars across one chain and capital-days. No newly invented scalar utility.
- Source repository / file / commit: THETA [canonical formula registry](../quant/phase2/FORMULA_REGISTRY.md), baseline commit `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. This is an existing THETA definition, not a new external formula.
- Assumptions: Broker activities establish assignment, not disappearance of an option. Intentional assignment can still lose. Recovery is censored until observed resolution.
- Numerical and missing-data issues: Unknown deliverable, mark or alternative economics must remain unknown. No automatic CC.
- THETA implementation: Orchestrators exist, full durable outcome joining incomplete.
- Verification tests: Proposed partial assignment, split deliverable, unresolved loss and ex-dividend exercise.

## Roll economics

```text
NetRollCredit=NewCredit-OldDebitToClose-RollCosts
RollUtility=EV_new-EV_best_alternative-tail/capital/opportunity penalties
```

- Variables / units: All price inputs converted to consistent total currency. Penalty weights remain research parameters.
- Source repository / file / commit: THETA [canonical formula registry](../quant/phase2/FORMULA_REGISTRY.md), baseline commit `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. This is an existing THETA definition, not a new external formula.
- Assumptions: Old realized loss remains immutable. Positive net credit alone does not imply favorable utility.
- Numerical and missing-data issues: Close-old filled and new-open rejected must preserve closed loss and real exposure. Missing alternatives=>UNKNOWN.
- THETA implementation: Existing contracts preserved, no new weights adopted.
- Verification tests: Existing roll/ledger tests, proposed partial-close and open rejection lifecycle replay.

## Covered-call economics

```text
CCUtility=EV_premium+EV_stock_retained-CallAwayRegret-EventRiskPenalty-ExecutionCost-TailPenalty
```

- Variables / units: Currency at common decision-time origin.
- Source repository / file / commit: THETA [canonical formula registry](../quant/phase2/FORMULA_REGISTRY.md), baseline commit `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. This is an existing THETA definition, not a new external formula.
- Assumptions: Compare WAIT and stock sale alternatives. Future realized regret is a training label, never a feature known at decision time.
- Numerical and missing-data issues: No double count stock upside or premium. Missing counterfactual estimate=>UNKNOWN.
- THETA implementation: Existing CC ranker preserved, empirical calibration still required.
- Verification tests: Existing WAIT/CC bridge tests, proposed regret horizon and stock-call basis reconciliation.

## Portfolio concentration / correlation

```text
concentration=reserved_exposure/equity
rho_xy=cov(x,y)/(sd(x)*sd(y))
```

- Variables / units: Fraction and dimensionless correlation, respectively.
- Source repository / file / commit: THETA [canonical formula registry](../quant/phase2/FORMULA_REGISTRY.md), baseline commit `dc3df23bebd5144d4bc9eed5cd109ffdbfec0dda`. This is an existing THETA definition, not a new external formula. Concentration/correlation equations are standard comparison definitions, not a claim of a newly extracted complete risk engine.
- Assumptions: Define exposure measure for assignment, not merely premium. Align point-in-time returns across instruments.
- Numerical and missing-data issues: Zero/unknown equity or constant/insufficient return series=>UNKNOWN. Correlation is regime-dependent.
- THETA implementation: AEGIS exposure caps remain, empirical correlation baseline not established by this pass.
- Verification tests: Existing account-exposure tests, proposed simultaneous assignment and missing-series cases.
