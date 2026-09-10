# Strategy-Routing Shadow Record & RouteRegret Specification

Durability artifact extending `docs/quant/phase5_management/OPPORTUNITY_FRONTIER_ENGINE.md`
and `src/theta/shadow-opportunity-book.ts` with the strategy-routing-specific record
this task requests (items H/I of its deliverable list). **SPECIFIED only** — no
persistence exists (R2's job), and no `RouteRegret` metric is computed (requires real
historical outcomes, `BLOCKED_BY_DATA` until an empirical engine exists).

## What must be persisted per routing decision

- `eligible_strategy_families` — the full `StrategyRoutingResponse` (all six
  families' eligibility results, per `strategy_router.py`), not just the winner.
- `selected_strategy_family` — which family's candidate was actually chosen.
- `rejected_strategy_families` — the others, with their eligibility state and reason.
- `best_candidate_each_family` — per eligible family, its single best candidate's
  economics (`EV_net`, tail-adjusted EV, `ReturnPerCapitalDay`, capital required,
  uncertainty) — so a later analysis can ask "was the runner-up family's best
  candidate actually better after the fact?"
- Risk, capital-days, execution estimate, uncertainty, reason — already covered by
  `ShadowOpportunityEntry`'s existing fields; a routing record extends rather than
  replaces that shape by adding the family-level breakdown above it.
- `later_reconstructable_outcome` — nullable until the empirical engine (R6) can
  causally reconstruct it, exactly like `ShadowOpportunityEntry.eventualOutcomeKnown`/
  `eventualRealizedPnl`.

## Future metrics (not computed now — definitions only)

- **StrategySelectionRegret** — the difference between the selected family's
  realized/reconstructed outcome and the best *eligible* alternative family's
  candidate's outcome, holding the decision timestamp fixed. Answers "did THETA pick
  the wrong family, given what was actually eligible" — distinct from
  `TradeRegret`/`WaitRegret` (which ask about a single family's own candidate
  selection).
- **RouteRegret** — the broader version: was the *routing itself* (which families were
  even considered eligible) wrong, e.g. a family that should have been eligible was
  excluded by an overly strict Layer-1/Layer-3 gate. Requires comparing realized
  outcomes against a counterfactual re-run of the router with a relaxed gate — a
  genuinely harder empirical question than `StrategySelectionRegret`, since it
  requires re-deriving eligibility counterfactually, not just comparing already-
  generated candidates.
- **MissedStrategyOpportunity** — a family was ineligible, but its (never-generated)
  candidate would very likely have been strongly positive-EV had it been evaluated —
  requires a retrospective re-run of the ineligible family's candidate generation
  against the same historical state, which is exactly the kind of "pretend empirical
  experiment without the required historical data" this repository's discipline
  prohibits until real historical data and a backtester exist.
- **BadStrategyActivation** / **BadRegimeRoute** — a family was eligible and selected,
  but its realized outcome was poor specifically because the routing/regime context
  was misjudged (as opposed to the candidate's own economics being wrong) —
  distinguishing "wrong family" from "right family, wrong candidate" requires the
  `best_candidate_each_family` breakdown above to even be answerable.

## Status

SPECIFIED. No code implements persistence or any regret metric. This document exists
so R2's ledger schema and R6's empirical engine have an exact target shape rather than
inventing one under time pressure later.
