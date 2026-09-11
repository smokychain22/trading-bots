> Historical research snapshot from dc3df23, retained to preserve prior work. Not current guidance. Corrections and current status are in the parent research directory.

# THETA GitHub Top 15 — Ranked Research Priority

Per the authoritative directive to study existing GitHub work systematically
(READ → UNDERSTAND → VERIFY → EXTRACT METHOD → ADAPT → TEST → INTEGRATE)
before reinventing subproblems THETA needs. This ranks the 22-repository
candidate corpus supplied in that directive and selects the 15 to deeply
inspect first. Every repository listed here was verified to exist and be
public via `gh api repos/<owner>/<repo>` on 2026-09-11 — none of this ranking
is based on an unread README screenshot.

Per `docs/research/RESEARCH_REGISTER.md`'s existing REPO-001/REPO-002 rule:
these are implementation-pattern references only, never proof of
profitability, and never adopted without a license/assumption/test review.

Scoring is 0-10 per dimension, based on actual metadata + (for the repos
marked "read" below) real file-level inspection, not the README's own
claims. "Licensing safety" scores the license itself (permissive = higher),
not whether we intend to copy source verbatim.

| # | Repository | Quant | Arch | Exec | Risk | Backtest | THETA relevance | Code quality | License safety | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | goldspanlabs/optopsy | 6 | 8 | 3 | 3 | 9 | 8 | 8 | 4 (AGPL-3.0) | 49 |
| 2 | FlashAlpha-lab/gex-explained | 8 | 5 | 1 | 2 | 2 | 7 | 8 | 9 (MIT) | 42 |
| 3 | HasibVortex369/riskkit | 5 | 7 | 2 | 9 | 3 | 6 | 8 | 9 (MIT) | 49 |
| 4 | alpacahq/options-wheel | 3 | 6 | 8 | 3 | 2 | 7 | 6 | 9 (Apache-2.0) | 44 |
| 5 | lambdaclass/options_portfolio_backtester | 5 | 8 | 3 | 4 | 9 | 7 | 8 | 8 (MIT) | 52 |
| 6 | thedhruvhegde/ivsurf | 7 | 5 | 1 | 2 | 1 | 7 | 5 | 8 (MIT) | 36 |
| 7 | ksanjay/Kelly-Criterion-Option-Selector | 3 | 1 | 1 | 2 | 1 | 5 | 2 | 8 (MIT) | 23 |
| 8 | NavnoorBawa/Options-Flow-Predictor | 4 | 2 | 1 | 2 | 2 | 5 | 3 | 8 (MIT) | 27 |
| 9 | milgar7969/alpaca-options-framework | 2 | 6 | 6 | 2 | 1 | 5 | 5 | 3 (none) | 30 |
| 10 | Ja-Ta/optionstrader | 3 | 5 | 4 | 3 | 4 | 6 | 5 | 8 (MIT) | 38 |
| 11 | joncovington/MEICAgent | 3 | 4 | 4 | 3 | 2 | 4 | 4 | 8 (MIT) | 32 |
| 12 | puneet-chandna/0DTE-dealer-gamma | 6 | 5 | 1 | 1 | 1 | 4 | 5 | 2 (noncommercial) | 25 |
| 13 | zrack/gex-terminal | 4 | 4 | 1 | 1 | 2 | 4 | 4 | 8 (MIT) | 28 |
| 14 | BitraAI/gex_app | 4 | 4 | 1 | 1 | 1 | 3 | 4 | 2 (none-asserted) | 20 |
| 15 | AdamNaghs/Options-Spread-Conviction-Engine | 3 | 3 | 2 | 2 | 1 | 4 | 3 | 8 (MIT) | 26 |
| — | vahagn-madatyan/wheel-it | 3 | 6 | 8 | 3 | 2 | 6 | 6 | 9 (Apache-2.0) | (fork of #4, see note) |
| — | CryptoGnome/WheelForge | 3 | 6 | 8 | 3 | 2 | 6 | 6 | 9 (Apache-2.0) | (fork of #4, see note) |
| — | xiao81/AllYouNeedIsWheel | 1 | 2 | 2 | 1 | 1 | 2 | 3 | 9 (Apache-2.0) | 21 (JS, not options-specific — deprioritized) |
| — | ShayantoDutta/alpaca-wheel-bot | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 1 (none, 10 bytes) | 10 (essentially empty) |
| — | hedarthy/DealerFlow | 3 | 3 | 1 | 1 | 1 | 3 | 3 | 8 (MIT) | 23 |
| — | sgdividends/spx-dealer-gamma | 3 | 2 | 1 | 1 | 1 | 3 | 2 | 1 (none, 5 bytes) | 14 (essentially empty) |
| — | ArashkKH/OptionTradingAssistant | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 (none, no description) | 9 (not options-relevant) |

## Notes on exclusions from the Top 15

- **vahagn-madatyan/wheel-it** and **CryptoGnome/WheelForge** share the exact
  description "Runnable algo template for trading the Options Wheel
  strategy" with `alpacahq/options-wheel` and are almost certainly forks or
  near-copies of it (not independently confirmed file-by-file this pass).
  Deprioritized in favor of studying the canonical `alpacahq/options-wheel`
  once, rather than three near-duplicates — flag for a future diff pass if
  wheel-it/WheelForge are later found to have genuinely diverged logic.
- **xiao81/AllYouNeedIsWheel** is JavaScript with a generic "automated
  trading solutions" description, no options-specific content confirmed —
  deprioritized.
- **ShayantoDutta/alpaca-wheel-bot** (redirected from the requested
  `SayantoDutta/alpaca-wheel-bot` — GitHub reports it as a renamed/moved
  account) is 10 bytes in size, effectively empty. Deprioritized.
- **sgdividends/spx-dealer-gamma** is 5 bytes, effectively empty (an MCP
  server stub per its description, no computable content). Deprioritized.
- **ArashkKH/OptionTradingAssistant** has no description, no license, 57KB
  of JavaScript, unconfirmed relevance. Deprioritized pending a future pass
  if time allows.
- **hedarthy/DealerFlow** has no description and was not yet file-inspected
  this pass; included in the corpus for a future GEX cross-implementation
  check but not in this pass's Top 15 given `gex-explained` and
  `puneet-chandna/0DTE-dealer-gamma` already anchor that category.

## The 15 selected for deep inspection (this pass + near-term follow-up)

1. `goldspanlabs/optopsy` — backtesting representation/architecture (AGPL-3.0: methods/architecture only, no source copying — see licensing note below)
2. `lambdaclass/options_portfolio_backtester` — backtesting representation/architecture (MIT)
3. `HasibVortex369/riskkit` — position sizing / risk (MIT)
4. `alpacahq/options-wheel` — wheel execution/state machine (Apache-2.0) — Codex-led, Claude cross-referenced for candidate-ranking anti-patterns
5. `FlashAlpha-lab/gex-explained` — GEX formula + dealer-hedging theory (MIT)
6. `thedhruvhegde/ivsurf` — IV surface / Black-Scholes / Greeks (MIT)
7. `ksanjay/Kelly-Criterion-Option-Selector` — Kelly sizing (MIT) — primarily a NEGATIVE example (see ledger)
8. `NavnoorBawa/Options-Flow-Predictor` — options flow features (MIT)
9. `milgar7969/alpaca-options-framework` — Alpaca API workaround patterns (no license — reference/idea only, no code reuse)
10. `Ja-Ta/optionstrader` — covered-call/CSP screening + scheduled reporting (MIT)
11. `joncovington/MEICAgent` — 0DTE iron-condor state machine, tastytrade (MIT) — lower priority (different broker, different strategy family)
12. `puneet-chandna/0DTE-dealer-gamma` — real-time GEX dashboard, vectorized Black-Scholes (PolyForm Noncommercial — REFERENCE_ONLY, no reuse of any kind under a commercial platform)
13. `zrack/gex-terminal` — GEX terminal UI + replay research (MIT) — for a future GEX cross-implementation check
14. `BitraAI/gex_app` — real-time options analytics dashboard (no asserted license — REFERENCE_ONLY)
15. `AdamNaghs/Options-Spread-Conviction-Engine` — spread conviction scoring (MIT) — lower priority, not yet file-inspected

Deep, file-level findings for each are in `docs/research/GITHUB_REPO_RESEARCH_LEDGER.md`.
Extracted formulas are in `docs/research/THETA_FORMULA_CATALOG.md`. External
strategy logic is in `docs/research/THETA_STRATEGY_REPO_CATALOG.md` (not yet
populated this pass — strategy-shape extraction is lower priority than the
formula/architecture extraction already done, per the roadmap-priority rule
below). Gaps against THETA's own subsystems are in
`docs/research/THETA_GITHUB_GAP_MATRIX.md`.

## Licensing note on optopsy (AGPL-3.0)

AGPL-3.0 is a strong copyleft license: linking/incorporating its source
into THETA (a project with no intention of releasing its own source under
AGPL) would create a license-compatibility problem. Per the "method vs.
source code" distinction in the directive: THETA may study and
independently reimplement optopsy's *architecture and slippage-model
ideas* (multi-leg join pattern, four named slippage models, commission
calculation) — none of which are copyrightable expression on their own —
but must NOT copy optopsy's actual source lines into this repository.
This is recorded explicitly so a future contributor does not later paste
optopsy code without noticing the license conflict.

## Priority alignment with the current roadmap

Per the directive's own instruction not to let research pause the roadmap:
this pass concentrated on repos directly useful to Claude's active work
(Full-H economic frontier, strategy router, candidate ranking, sizing) —
GEX/IV/Kelly/sizing/backtesting-architecture — over repos with lower
immediate relevance (0DTE iron condors, dashboards). The broker/
reconciliation/scheduler/persistence category (`alpacahq/options-wheel`,
`milgar7969/alpaca-options-framework`) is Codex's lead per the directive;
this pass only lightly cross-referenced `options-wheel`'s candidate-scoring
logic because it directly informs a Full-H/candidate-ranking anti-pattern
finding (see the ledger's `alpacahq/options-wheel` entry).
