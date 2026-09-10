# Expert → Strategy-Family Routing Matrix

Durability artifact. Extends `docs/quant/phase3_strategy_dna/STRATEGY_DNA_MATRIX.md`
with the specific "which THETA family, or which future bot" routing this task
requests — grounded strictly in the 11 already-committed experts in
`expert_priors/data/expert_sources.json`. **No additional named traders (from
Alertsify/QuantWheel/Collective2 or elsewhere) are introduced here** — the same
non-fabrication discipline as every prior pass in this engagement, since none of that
additional material has ever been verified or found in this repository.

| Expert | Evidence state | Behavior component | Likely THETA family | Future bot if not THETA | Do-not-assume |
|---|---|---|---|---|---|
| `orange_cat` | OBSERVED | Patience, full CSP→stock→CC cycle, ownership-conditioned holding | THETA-Q (entry), THETA-A (H-A-01), THETA-R (H-R-02 patience side) | — | Exact delta/DTE/roll thresholds |
| `iwm_hold_the_strike` | RECONSTRUCTED | 2-5 DTE ATM entry, intentional assignment, recovery wait before CC | THETA-H, THETA-A | — | That its high WR is universally low-risk or transfers to other tickers |
| `sqqq_hold_the_strike` | OBSERVED (failure DNA) | Same structural pattern as `iwm_hold_the_strike`, but the closed-WR/inventory-drawdown lesson dominates | THETA-H/THETA-A (as a measurement caution, H-H-02/H-A-03), not a trading rule | — | Use headline WR as a safety proof |
| `hendo_67` | OBSERVED | Active CSP/CC/Wheel management, BTC/roll/assignment behavior | THETA-R, THETA-C (H-C-01) | — | A universal 50% close rule |
| `alex` | RECONSTRUCTED | Rolling as a deliberate, compared-against-alternatives tool | THETA-R (H-R-03's alternatives-comparison requirement) | — | That every roll is positive EV |
| `ivan_orehovec` | OBSERVED | Multi-structure routing (CSP/credit spreads), capital-constrained active management | THETA-R; contributes structure-routing evidence to THETA-D (gated) | — | Single fixed CSP algorithm |
| `ivan_small_account` | INFERRED | Defined-risk/small-account structure hints | THETA-D (gated) only | — | That this generalizes to the main-account CSP/Wheel policy |
| `wheeling_to_freedom` | RECONSTRUCTED | Stock inventory management, BUY_CLOSE behavior, active inventory management | THETA-A, THETA-C | — | Exact hidden close threshold |
| `david_romic` | INFERRED | Conservative income process; long stock + CSP + CC + Wheel coexisting with visible interim stock loss | THETA-Q (conservative entry screening), THETA-A (visibility discipline) | — | Large-sample causal edge without sufficient data |
| `lick_neeson` | INFERRED | Structure-routing hypothesis across CSP/CC/spreads/IC | THETA-D (gated) primarily; some THETA-C relevance | NEXUS (range/IC structures are NEXUS's domain, not THETA's — routed there per §4 below) | Production policy until evidence improves |
| `fearless_value` | INFERRED | High historical WR is not sufficient evidence of safe strategy; drawdown proves tail risk matters | Cross-cutting measurement discipline (already `cross_cutting_failure_dna` in `strategy_archetypes.json`), not one family | — | That high headline WR implies low risk without drawdown context |

## Routing discipline (restated from `../phase3_strategy_dna/FUTURE_BOT_ROUTING.md`)

An expert's evidence licenses hypothesis generation only for the archetype it was
cataloged against. `lick_neeson`'s iron-condor/spread-structure hints are the one case
in this table with a plausible non-THETA routing (NEXUS's range/neutral-premium
domain) — flagged here rather than silently forced into THETA-D, consistent with
"do not contaminate THETA with unrelated profitable behavior."

## Status

Fully derived from already-committed `expert_sources.json` and `hypotheses.json`
evidence. No new expert, evidence-state upgrade, or numeric threshold introduced.
