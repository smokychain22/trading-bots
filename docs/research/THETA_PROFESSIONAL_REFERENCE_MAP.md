# THETA professional reference map

Status as of 2026-09-14. This map routes mature external methods into THETA's existing boundaries. It does not promote a library, copy code, or treat a pricing formula as trading alpha. Repository SHAs and license notes for the owner-supplied GitHub corpus are in `GITHUB_REPO_RESEARCH_LEDGER.md`.

| Reference | Method worth retaining | THETA component | Failure risk to test | Status |
|---|---|---|---|---|
| QuantLib | Exchange calendars, day-count conventions, vanilla option pricing, implied-volatility inversion and Greeks | Independent numerical oracle for research fixtures | Wrong calendar, dividend/rate inputs, American exercise mismatch, convergence failure | TEST_ONLY |
| LEAN | Event-driven scheduling, brokerage reconciliation, security identifiers, order/fill models, portfolio accounting | Scheduler, replay architecture, broker adapter and lifecycle tests | Backtest fill assumptions mistaken for broker truth, configuration defaults leaking into policy | ADAPT |
| py_vollib | Black-Scholes/Black-Scholes-Merton pricing, IV and analytical Greeks | Lightweight independent formula cross-check | European assumptions, invalid expiry/price bounds, units and sign conventions | TEST_ONLY |
| OpenGamma Strata | Reference data, holiday calendars, market-data containers, scenario measures | Typed market-state and stress-test design | Heavy dependency and product-model mismatch | REFERENCE_ONLY |
| Optopsy, SHA `40bb8b2aa07ef8763caeadf752961faecb494efd`, AGPL-3.0 | Direction-aware bid/ask cashflows and costs | Execution replay and cost tests | AGPL reuse, midpoint assumptions, date-only joins | REFERENCE_ONLY |
| options_portfolio_backtester, SHA `e53ef86928777de6ee0721424762ea3dc133f993`, MIT | Replaceable clock and fill-model interfaces | Research replay and shadow fill contracts | Positional date zip can join mismatched dates and leak future values | ADAPT_INTERFACE_ONLY |
| ivsurf, SHA `c20072a8f6c09146697bdb55dca566567d7b0535`, MIT | IV inversion residual checks and walk-forward shape | Optionomics validation and R6 research | Mixed-expiry vector bug, skipped failed folds, row-gap instead of label-time purge | TEST_ONLY |
| alpacahq/options-wheel, SHA `3698429289065ceb0c13ffcdc31a966c576779ad`, Apache-2.0 | Broker-position Wheel state reconstruction | Reconciliation fixtures | Market orders, fixed multiplier, quantity one, automatic CC behavior | ADAPT_TEST_CASES_ONLY |
| FlashAlpha GEX, DealerFlow and related GEX references | Explicit gamma, vanna and charm definitions with unit labels | Optionomics market-structure feature validation | Dealer-position sign assumptions, fixed multiplier, zero-crossing ambiguity | RESEARCH_ONLY |

## Required validation pattern

Every numerical adoption must carry inputs, units, convention, version, valid domain and independent comparison tolerance. An unavailable input produces `UNKNOWN`, never zero. QuantLib or py_vollib may validate a provider observation, but neither supplies physical win probability or after-cost expectancy.

Every architecture adoption must pass deterministic replay, timestamp integrity, missing-session, partial-fill, restart, duplicate-event and broker-drift tests. LEAN and reference bots inform these tests. Alpaca remains lifecycle and execution truth.

No external reference currently proves THETA profitability, a 70-80% Managed Episode win rate, or a safe fixed take-profit/stop-loss rule.
