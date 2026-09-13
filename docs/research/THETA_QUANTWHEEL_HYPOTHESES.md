# THETA QuantWheel Hypotheses

Status date: 2026-09-13

| Hypothesis | THETA component | Evidence needed | Owner | Status |
|---|---|---|---|---|
| Expected-move-relative strikes beat delta-only selection | Contract selector | PIT expected move, fills, whole-chain labels, ablation | Claude research, Codex data | INSUFFICIENT_DATA |
| Put-wall distance predicts CSP drawdown or assignment | Entry and assignment | Versioned GEX definition, PIT walls, outcomes | Claude research | INSUFFICIENT_DATA |
| Gamma-flip distance changes optimal strategy route | Router | Regime cohorts and OOS comparison | Claude research | INSUFFICIENT_DATA |
| Vanna improves event-window decisions | Event policy | Event-known-at data and interaction ablation | Claude research | INSUFFICIENT_DATA |
| Charm improves short-DTE Hold-Strike decisions | Management | PIT Charm and action outcomes | Claude research | INSUFFICIENT_DATA |
| Real Cost improves covered-call strike choice | Recovery and CC | Stock lots, immutable chain cashflows, counterfactual method | Joint | INSUFFICIENT_DATA |
| Roll frontier beats credit-first rolling | Management | Same-state feasible actions, costs, capital-days, tails | Joint | TEST CONTRACT READY |
| Equity released improves return per capital-day | Capital allocation | Secured capital and resolved chain duration | Claude research | INSUFFICIENT_DATA |
| Per-ticker chain accounting detects false premium success | Accounting | Whole-chain labels including stock MTM | Codex production | ADOPTED MECHANICALLY |

None of these hypotheses is a strategy rule. Promotion requires PIT data,
realistic fill or explicit no-fill, walk-forward evaluation, untouched OOS, and
failure attribution. A positive roll credit, annualized yield, rating, GEX level,
or sweep size cannot establish positive expectancy by itself.
