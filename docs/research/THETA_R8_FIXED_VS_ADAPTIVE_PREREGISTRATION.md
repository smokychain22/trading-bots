# R8 fixed-versus-adaptive preregistration

Status: historical v1 research protocol only. Registered against `9f03fb960c50ab21b1d6c81297d9654ec81def8d` on 2026-09-21. The active machine-readable V8 preregistration is `theta-experiment-registry-v2` in `bots/theta/quant/research/experiment_registry.py`. This document remains immutable protocol history rather than current registry truth. None of these challengers has Paper execution authority or a demonstrated edge. `NO_COMPARISON` is the correct shadow result while required empirical models are absent.

Every comparison uses the same point-in-time candidate set, account state, broker lifecycle, event state, and executable quote evidence. A selected action, a rejected action, and WAIT remain distinct. Hypothetical fills require a separately versioned fill model and may resolve to `NO_FILL`. Feature rows end at decision time. Labels start after it. Whole-chain episodes, including rolls, assignment, stock, and covered calls, stay in the same train or test fold.

| ID | Baseline | Challenger | Eligible population | Decision features | Primary metric | Secondary metrics |
| --- | --- | --- | --- | --- | --- | --- |
| A | Fixed DTE cohort | State-aware DTE | Same underlying and feasible CSP expiries | PIT quotes, IV, event state, liquidity, capital days | Whole-chain after-cost return per capital-day | Tail loss, fill rate, assignment rate |
| B | Fixed delta/strike cohort | State-aware strike | Same feasible CSP lattice | Delta, moneyness, skew, expected move, quote and event state | Whole-chain after-cost net P&L per secured dollar | Drawdown, assignment burden, TCA |
| C | Fixed 50% premium capture close | Management frontier | Broker-confirmed open short-option episodes | Remaining executable reward, risk, event state, alternatives | Managed-episode after-cost P&L | Giveback, tail loss, capital days |
| D | Fixed quantity rule | State-aware constrained size | Same feasible candidate and account state | Collateral, assignment capacity, AEGIS, concentration, stress | Portfolio after-cost return on equity | Expected shortfall, drawdown, capital utilization |
| E | Conventional only | Cross-strategy frontier | Cycles with two or more applicable and feasible branches | Branch applicability, common-horizon economics, risk | Whole-chain after-cost portfolio utility | Regret bounds, tail burden, coverage |
| F | Mechanical credit roll | Economic roll frontier | Managed short options with broker-confirmed roll alternatives | Old-close price, new-open BBO, capital days, assignment state | Incremental after-cost whole-chain value | Roll frequency, recovery duration, TCA |
| G | Immediate covered call | Recovery frontier | Broker-confirmed assigned stock eligible for a call | Stock basis/mark, call BBO, retained upside, events | After-cost assigned-inventory value | Call-away regret, recovery duration, stock drawdown |
| H | Current underlying cap | Wider-universe challenger | Same cycle with discoverable additional symbols and complete PIT evidence | Ownership, concentration, sector/correlation where known, liquidity | Portfolio after-cost value per capital-day | Tail concentration, turnover, data coverage |

The table names features to preserve, not coefficients or signal thresholds. Missing hard-safety evidence blocks the candidate. Missing optional evidence stays UNKNOWN and is reported by cohort. Event `knownAt` must be no later than the decision timestamp. A wider universe cannot borrow future membership or hindsight survivors.

## Locked evaluation method

- Analysis unit: independent managed episode or whole chain for trade outcomes, and day/account for portfolio sizing. Report raw and effective independent N. Cluster uncertainty by underlying and overlapping market session. Do not count individual legs as independent wins.
- Primary estimand: paired challenger minus baseline on the eligible intersection. Also report coverage and excluded population so a selective challenger cannot hide missed opportunities. For hypothetical trades, show results separately by fill-model version and `NO_FILL` rate.
- Secondary economics: Profit Factor, average win/loss, max drawdown, expected shortfall, assignment/recovery burden, capital days, TCA, and Paper-versus-replay discrepancy. Win rate is descriptive, never the sole objective.
- Split: chronological walk-forward with an untouched final out-of-sample window. Embargo overlapping episodes and group complete chains across folds. Model, thresholds, universe, cost model, and fill model are frozen before each OOS window.
- Minimum independent N: not specified by current evidence. The research owner must pre-register a power or precision analysis before any result is eligible for promotion. Until then every result remains `INSUFFICIENT_DATA`, regardless of apparent return.
- Stop rule: stop a challenger immediately for a hard safety violation, data leakage, identity mismatch, duplicate broker mutation, or non-reproducible export. Economic futility or superiority stopping requires a pre-registered sequential test; none exists yet.
- Promotion: requires positive OOS paired after-cost effect with uncertainty bounds that exclude a materially adverse effect, acceptable tail and operational metrics, calibrated models where probabilities are used, adequate independent N, and successful Paper observation. No automatic promotion follows a favorable backtest.

Before outcome inspection, publish the exact cohort filters, feature versions, cost assumptions, fill model, effective-N target, confidence method, and OOS dates as an immutable experiment fingerprint. A protocol change creates a new experiment ID. Current status for A-H is `PREREGISTERED_DESIGN_ONLY`, with zero empirical superiority claims.
