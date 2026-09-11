# THETA GitHub Top 15

2026-09-11. The owner's explicit list is the bounded working set. The scores below are reviewer judgments about the inspected files, not empirical measurements or strategy returns. A total is only an intake aid. Production priority remains Full-H economics, router, assignment/recovery, execution/reconciliation, scheduler, lifecycle accounting, then backtesting/OOS. QuantLib and LEAN are additional Tier-0 references, outside the fifteen.

Scoring: 0 means no useful verified contribution in this scope, 5 means useful with substantial caveats, 10 means unusually strong fit. License score measures straightforwardness of potential source reuse, not whether reading ideas is allowed. Code quality is provisional because upstream suites were not executed. Exact commits, files and reasons are in [the ledger](GITHUB_REPO_RESEARCH_LEDGER.md).

| Rank | Repository | Quant /10 | Architecture /10 | Execution /10 | Risk /10 | Backtest /10 | THETA relevance /10 | Code quality /10 | Licensing safety /10 | Total /80 | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [lambdaclass/options_portfolio_backtester](https://github.com/lambdaclass/options_portfolio_backtester/tree/e53ef86928777de6ee0721424762ea3dc133f993) | 6 | 7 | 4 | 5 | 6 | 8 | 5 | 9 | 50 | ADAPT |
| 2 | [goldspanlabs/optopsy](https://github.com/goldspanlabs/optopsy/tree/40bb8b2aa07ef8763caeadf752961faecb494efd) | 7 | 7 | 4 | 4 | 8 | 8 | 7 | 2 | 47 | REFERENCE_ONLY |
| 3 | [joncovington/MEICAgent](https://github.com/joncovington/MEICAgent/tree/333ff77b68aaba07c68bcbcacb6d439ebceda4b6) | 5 | 6 | 4 | 5 | 5 | 5 | 5 | 9 | 44 | ADAPT |
| 4 | [alpacahq/options-wheel](https://github.com/alpacahq/options-wheel/tree/3698429289065ceb0c13ffcdc31a966c576779ad) | 4 | 5 | 5 | 3 | 1 | 9 | 5 | 9 | 41 | ADAPT |
| 5 | [zrack/gex-terminal](https://github.com/zrack/gex-terminal/tree/72d68f47a41c2c330351476cef99b48411f9fe3d) | 6 | 6 | 1 | 5 | 3 | 5 | 6 | 9 | 41 | ADAPT |
| 6 | [thedhruvhegde/ivsurf](https://github.com/thedhruvhegde/ivsurf/tree/c20072a8f6c09146697bdb55dca566567d7b0535) | 6 | 5 | 1 | 4 | 4 | 6 | 4 | 9 | 39 | TEST_ONLY |
| 7 | [hedarthy/DealerFlow](https://github.com/hedarthy/DealerFlow/tree/14c7a0f345116c93b43641893aaa372a4cf19085) | 5 | 4 | 0 | 3 | 1 | 4 | 4 | 9 | 30 | REFERENCE_ONLY |
| 8 | [FlashAlpha-lab/gex-explained](https://github.com/FlashAlpha-lab/gex-explained/tree/a11321d62006311c4a72a68552587485024f2bf2) | 5 | 3 | 0 | 3 | 1 | 4 | 4 | 9 | 29 | REFERENCE_ONLY |
| 9 | [milgar7969/alpaca-options-framework](https://github.com/milgar7969/alpaca-options-framework/tree/fd1c411da1abfee9009186fda99d8e9c02ca4166) | 3 | 5 | 6 | 3 | 1 | 8 | 3 | 0 | 29 | TEST_ONLY |
| 10 | [puneet-chandna/0DTE-dealer-gamma](https://github.com/puneet-chandna/0DTE-dealer-gamma/tree/8da6fa67328b4aa34956c033f0b7cbb74431501d) | 5 | 5 | 1 | 4 | 2 | 4 | 5 | 1 | 27 | REFERENCE_ONLY |
| 11 | [NavnoorBawa/Options-Flow-Predictor](https://github.com/NavnoorBawa/Options-Flow-Predictor/tree/da83ec361c1cb7494a0b1b96dbca8edc4a09e788) | 3 | 3 | 0 | 2 | 2 | 4 | 2 | 9 | 25 | REFERENCE_ONLY |
| 12 | [ksanjay/Kelly-Criterion-Option-Selector](https://github.com/ksanjay/Kelly-Criterion-Option-Selector/tree/43c2443cd202777650bd1c61233054a83fe31771) | 1 | 1 | 0 | 1 | 0 | 3 | 2 | 9 | 17 | REJECT |
| 13 | [ShayantoDutta/alpaca-wheel-bot](https://github.com/ShayantoDutta/alpaca-wheel-bot/tree/40c550cf44109028f9a99cdee2863a74c93ba833) | 2 | 2 | 2 | 2 | 0 | 7 | 2 | 0 | 17 | TEST_ONLY |
| 14 | [sgdividends/spx-dealer-gamma](https://github.com/sgdividends/spx-dealer-gamma/tree/4b49ede031a17daa2a18c087e7fdb200a0c1d26f) | 5 | 2 | 0 | 2 | 0 | 4 | 3 | 0 | 16 | REFERENCE_ONLY |
| 15 | [BitraAI/gex_app](https://github.com/BitraAI/gex_app/tree/b1234c65452581fccf5375cb7488b990423ed79c) | 3 | 2 | 0 | 2 | 1 | 3 | 2 | 0 | 13 | REJECT |

## Tier-0 references

- [lballabio/QuantLib](https://github.com/lballabio/QuantLib/tree/ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4): scores in the same column order 9/9/2/7/6/8/9/9, total 59/80. Black-formula parameter validation, implied standard-deviation solvers with convergence criteria, and variance-space interpolation with sorted unique expiries.
- [QuantConnect/Lean](https://github.com/QuantConnect/Lean/tree/8ee075a39918f2df6fe9e0a5944e366fb60d10dc): scores in the same column order 8/9/9/8/9/10/9/9, total 71/80. Holdings use contract multipliers and directional liquidation prices. Exercise emits option adjustment and physical underlying delivery events. Scheduler separates UTC event times and frontier scans.

## What to use first

1. LEAN: directional MTM, explicit exercise/delivery events, pre-submission data rejection and injected event clocks. Keep THETA's stricter freshness and retry controls.
2. Alpaca Wheel and milgar: broker-state reconstruction and cancel/fill race scenarios. Reject market-by-default orders, fixed multiplier, forced quantity and failure-to-empty conversions.
3. optopsy/lambdaclass: separate fill/cost interfaces and replay test structure. Reject midpoint certainty and positional date joins.
4. QuantLib: independent pricing/IV oracle, not a new data provider. Verify instrument model and dividends before American-option use.
5. GEX/flow/surface projects: bounded research comparison only. No GEX feature should displace missing Full-H evidence, durable management or scheduler work.

No source strategy has been promoted. No provider added. Public returns/screenshots were not accepted as evidence. Remaining 50+ corpus entries are deferred deliberately rather than claimed reviewed.
