# THETA Strategy-DNA Catalog (R6)

## What already exists (do not rebuild)

Converting the profitable-trader corpus into machine-testable hypotheses
is **already substantially done**, discovered by inspection rather than
assumed absent:

- `bots/theta/quant/research/data/hypotheses.json` — 14 registered
  hypotheses, each with mechanism, alternatives, label_type,
  label_definition, payoff_target, failure_mode,
  calibration_requirement, evidence_requirement, acceptance_criterion,
  rejection_criterion, status, rationale, data_availability_status, AND
  (per expert source cited) an explicit **evidence_state**:
  `OBSERVED`/`RECONSTRUCTED`/`INFERRED` (confirmed present in the raw
  JSON this session, e.g. `{"expert_source_id": "orange_cat",
  "evidence_state": "OBSERVED"}`) — this is exactly the evidence-class
  framework item 16 asks for, already wired per-source rather than
  per-hypothesis-in-general.
- `docs/quant/phase3_strategy_dna/THETA_HYPOTHESIS_LIBRARY.md` — the
  narrative index over that JSON, with a RETAIN-vs-TEST discipline
  (RETAIN = already a frozen architectural rule regardless of empirical
  outcome; TEST = genuinely open, unresolved pending a backtester).
- `docs/quant/phase3_strategy_dna/EXPERT_REGISTRY.md`,
  `COMPONENT_LIBRARY.md`, `TRADER_DECOMPOSITION_EXPERIMENTS.md` — the
  per-expert source register and decomposition methodology.
- `docs/research/RESEARCH_REGISTER.md` — the expert-source register
  (Orange Cat, IWM Hold the Strike, Hendo_67, Ivan Orehovec, Alex,
  Wheeling to Freedom, David Romic, etc.), explicitly marked "research
  priors and failure-DNA evidence — not runtime dependencies."

This document does not duplicate any of the above. Its job is narrower:
(1) confirm the existing library already satisfies item 16's schema
requirement, (2) map the GitHub corpus's OWN strategy logic into the
same schema as NEW candidate hypotheses (item 16 explicitly asks for
Alertsify/QuantWheel/Collective2-style sources, but the same schema
applies equally to GitHub reference implementations, which are simply
another observed-strategy source), and (3) give each of THETA's five
strategy branches its own independent validation status (item 17).

## Hypothesis schema (already established; restated for reference)

```
hypothesis_id, source, evidence_class (OBSERVED/RECONSTRUCTED/INFERRED/UNKNOWN),
universe_condition, dte_rule, delta_rule, iv_condition, skew_condition,
entry_condition, event_policy, profit_target, loss_policy, roll_policy,
assignment_policy, recovery_behavior, cc_policy, sizing_behavior,
economic_mechanism, expected_effect, falsification_test, sample_requirement,
oos_result, status (UNTESTED/SUPPORTED/WEAK/REJECTED/PROMOTED_RESEARCH)
```

## New candidate hypotheses from the GitHub corpus (this session)

### GH-H-01: single-score delta/DTE/yield ranking underperforms multi-dimension Pareto ranking on tail-adjusted EV

- **Source:** `alpacahq/options-wheel` (`core/strategy.py`,
  `score_options`), commit `3698429289065ceb0c13ffcdc31a966c576779ad`.
- **Evidence class:** OBSERVED (real, public source code — not a
  reported trader's private methodology, but an observed, verifiable
  implementation).
- **Universe/DTE/delta/IV/skew/entry condition:** delta band + annualized
  yield band + OI floor, scored by `(1-|delta|) * (250/(dte+5)) *
  (bid/strike)`, one scalar, highest score wins per underlying.
- **Economic mechanism (claimed by the reference implementation,
  implicitly):** higher annualized yield within an acceptable delta/OI
  band is a sufficient ranking criterion.
- **Expected effect (THETA's counter-hypothesis):** a candidate ranked
  highest by this single score can still have materially worse tail risk
  (`expected_tail_loss`), assignment probability, or capital-days than a
  lower-scored alternative — the single scalar hides these dimensions
  rather than resolving them.
- **Falsification test:** on the same candidate set, compute both (a)
  this repo's single score and (b) THETA's full Pareto-frontier ranking
  (`pareto_frontier.py`). If the single-score winner is ALWAYS
  Pareto-non-dominated too, the counter-hypothesis is falsified. If the
  single-score winner is frequently Pareto-DOMINATED by an alternative
  with a lower single score, the counter-hypothesis is supported.
- **Sample requirement:** at least 30 independent candidate sets with
  genuine multi-dimension tradeoffs present (not all candidates
  identical except yield).
- **OOS result:** none yet — requires real historical chain data.
- **Status:** UNTESTED (mechanically testable today against synthetic
  fixtures, per `pareto_frontier.py`'s own test suite already
  demonstrating the general phenomenon; a real-data confirmation is
  still pending R6 data availability).

### GH-H-02: raw N(d2)-as-probability Kelly sizing produces worse tail outcomes than fractional risk-budget sizing

- **Source:** `ksanjay/Kelly-Criterion-Option-Selector`
  (`kelly_leaps.ipynb`), commit
  `43c2443cd202777650bd1c61233054a83fe31771`.
- **Evidence class:** OBSERVED.
- **Economic mechanism (claimed):** Black-Scholes `N(d2)` approximates a
  real win probability closely enough to size a real position with raw
  (unfractionalized) Kelly.
- **Expected effect (THETA's counter-hypothesis):** because `N(d2)` is a
  risk-neutral quantity, not a calibrated real-world win probability,
  sizing off it (especially at full, unfractionalized Kelly) produces
  materially worse `ExpectedShortfall`/max-drawdown than THETA's own
  risk-budget/collateral-cap sizing for the same nominal EV.
- **Falsification test:** replay both sizing policies over the SAME
  candidate stream and compare `tail_risk_metrics.py`'s ES at a fixed
  alpha. If the two policies show statistically indistinguishable ES,
  the counter-hypothesis is falsified.
- **Sample requirement:** per `THETA_MODEL_PROMOTION_CONTRACT.md`'s own
  bar — 300+/500+ independent episodes before any conclusion is trusted.
- **OOS result:** none yet.
- **Status:** UNTESTED. Already treated as REJECTED as a SIZING METHOD
  in `THETA_FORMULA_CATALOG.md` (never adopted) independent of this
  hypothesis's own empirical test — the method itself is rejected on
  first-principles grounds (STAT-001) regardless of what a backtest
  would show, mirroring the RETAIN-vs-TEST distinction the existing
  hypothesis library already uses for architecturally non-negotiable
  rules.

## Strategy-branch independent validation status (item 17)

Per the explicit instruction: no branch may silently borrow another
branch's evidence, and a branch with insufficient data gets its own
honest status rather than inheriting a sibling's.

| Branch | Evidence today | Status |
|---|---|---|
| THETA-Q (conventional) | `theta_q_baseline.py`/`theta_q_lattice.py` implemented and unit-tested; H-Q-01/H-Q-02 registered as TEST in the existing hypothesis library; zero real resolved episodes | `EMPIRICALLY_UNPROVEN` |
| THETA-H (short-DTE challenger) | `theta_h_baseline.py` implemented; H-H-01/H-H-02 registered, H-H-02 is a RETAIN measurement guard (Leg WR alone is insufficient); zero real resolved episodes | `EMPIRICALLY_UNPROVEN` |
| THETA-RECOVERY | `recovery_decision.py`/`recovery_spec.py` implemented and tested (R1H item K2, this branch); H-A-02/H-A-04 registered; zero real resolved recovery episodes | `EMPIRICALLY_UNPROVEN` |
| THETA-CC | `covered_call_ranker.py` implemented and tested (K2/K3); H-C-01/H-C-02 registered as RETAIN (non-negotiable design, not yet empirically confirmed); zero real resolved CC episodes | `EMPIRICALLY_UNPROVEN` |
| THETA-DEFINED-RISK | Not yet built as a distinct candidate-generation path (per `strategy-route-receipt.ts`'s own `strategiesWithoutCandidateGeneration` field — THETA_Q is the only family generating real candidates today); H-D-01 registered but explicitly GATED (Level 3 options approval + archetype graduation required before evaluation) | `EMPIRICALLY_UNPROVEN` (and additionally gated from even beginning evaluation) |

No branch above is permitted to cite another branch's future OOS result
as its own — each requires its own independent resolved-episode sample
per `THETA_MODEL_PROMOTION_CONTRACT.md`'s checklist, applied per branch.

## Status

This catalog adds two new GitHub-derived candidate hypotheses in the
existing schema and formalizes the five-branch independent-validation
requirement; it does not modify `hypotheses.json` (the 14 existing
entries remain that file's sole authority) and does not claim any
hypothesis — new or existing — has been empirically tested against real
data, consistent with `EV_MODEL_NOT_EMPIRICALLY_READY`.
