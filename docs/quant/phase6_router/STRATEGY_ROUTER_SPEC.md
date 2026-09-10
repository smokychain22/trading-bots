# THETA Contextual Strategy Router — Specification

Durability artifact for `bots/theta/quant/models/strategy_router.py` and
`src/theta/strategy-router-contract.ts` (both IMPLEMENTED, tested). Records the design
rationale so the "specialists, not voters" architecture is documented, not just coded.

## The problem this solves

Treating every strategy family as an independent yes/no voter ("ownership says yes,
trend says no, expert A says yes, expert B says no → WAIT") produces paralysis,
because profitable approaches frequently apply in *different* states, not
simultaneously in all of them. The fix is not consensus-building — it's **routing**:
determine which strategy family may even compete given the current lifecycle and
market state, and let only eligible families' candidates compete economically. That
economic competition itself remains `opportunity_frontier.py`'s and
`management_action_value.py`'s job — the router only answers "who gets to compete,"
never "who wins."

## A. Strategy Family Registry (restated, already IMPLEMENTED as data/enum)

`StrategyFamily`: `THETA_Q` (conventional ownership-aware premium harvesting),
`THETA_H` (short-DTE hold-the-strike challenger, stricter ownership bar, no
near-term event), `THETA_R` (roll/management intelligence — existing option exposure
only), `THETA_A` (assignment/recovery — assignment risk or stock ownership only),
`THETA_C` (covered-call monetization — confirmed stock inventory only), `THETA_D`
(defined-risk challenger — gated, per `strategy_archetypes.json`'s existing gate
condition). This mirrors `research/data/strategy_archetypes.json`'s existing six
archetypes exactly — the router's enum is not a new taxonomy, it's the runtime-
routing view of the same six families already registered there.

## B. Strategy Eligibility Contract (IMPLEMENTED)

`StrategyEligibilityResult` (Python) / the Zod-validated response (TS): every family
gets a result every cycle — `eligible`, `eligibility_state`
(`ELIGIBLE_PRIMARY`/`ELIGIBLE_CHALLENGER`/`ELIGIBLE_REDUCED`/`INELIGIBLE_STATE`/
`INELIGIBLE_RISK`/`INELIGIBLE_DATA`/`INELIGIBLE_STRUCTURE`/`PASS`), reason codes,
policy version. The TS contract enforces exactly six results, one per family, never a
partial set — this is what makes "routing, not voting" a checkable invariant rather
than just a design intention.

## C. Router hierarchy (IMPLEMENTED, Layers 0/1/3 of this task's 9-layer model)

- **Layer 0 (data validity):** invalid critical data is a blanket exclusion applying
  identically to all six families — the one case where every family is excluded
  together, and even then each still gets its own `INELIGIBLE_DATA` result rather than
  a single opaque "system down" signal.
- **Layer 1 (lifecycle state):** `LifecycleState` (`CASH_AVAILABLE`/`CSP_OPEN`/
  `ASSIGNMENT_RISK`/`STOCK_HELD`/`RECOVERY`/`CC_OPEN`/`ROLL_PENDING`/`ORDER_PENDING`/
  `UNKNOWN_SUBMISSION`) determines which families are even relevant: THETA-R only
  when an option is open, THETA-A only with assignment risk or stock held, THETA-C
  only with *confirmed* stock (never speculative), THETA-Q/H/D only in a fresh-entry
  state.
- **Layer 3 (strategy eligibility, within the fresh-entry branch):** THETA-Q and
  THETA-H apply the *same* continuous `ownership_acceptable` score
  (`ownership_v0.py`'s `ownability`) against **different floors** —
  `theta_q_min_ownership_acceptability` vs. the stricter
  `theta_h_min_ownership_acceptability` — so THETA-H never inherits THETA-Q's bar
  automatically, per its own "only in validated cohorts" requirement. THETA-H is
  additionally excluded near any known event. THETA-D remains gated on
  `theta_d_gate_satisfied` regardless of any other condition.
- **Layers 2, 4-8** (market-state axes, candidate generation, economic frontier,
  AEGIS/sizing, execution, reassessment) are **not** this module's job — they belong
  to `regime_v0.py`, `theta_q_lattice.py`, `opportunity_frontier.py`,
  `management_action_value.py`, `aegis.py`, `sizing.py`, `execution_quality.py`, and
  the scheduler, respectively. The router hands its `eligible_families()` output to
  candidate generation and stops.

## D. Lifecycle → strategy eligibility mapping (restated from the code, for visibility)

| Lifecycle state | THETA-Q | THETA-H | THETA-R | THETA-A | THETA-C | THETA-D |
|---|---|---|---|---|---|---|
| CASH_AVAILABLE | ✓ (if ownership/liquidity clear) | ✓ (if stricter bar + no event) | ✗ | ✗ (unless assignment_imminent) | ✗ (unless stock held) | ✓ (if gated condition met) |
| CSP_OPEN | ✗ | ✗ | ✓ | conditional | conditional | ✗ |
| ASSIGNMENT_RISK | ✗ | ✗ | ✗ | ✓ | conditional | ✗ |
| STOCK_HELD | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| RECOVERY | ✗ | ✗ | ✗ | ✓ | conditional (needs confirmed shares) | ✗ |
| CC_OPEN | ✗ | ✗ | ✓ | conditional | conditional | ✗ |
| ROLL_PENDING | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |

"Conditional" = depends on `stock_shares_held > 0`, independent of the lifecycle label
itself (e.g. `RECOVERY` with zero shares held — a data-consistency edge case — leaves
THETA-C ineligible, tested explicitly).

## Non-voting guarantee (tested directly)

`test_theta_r_ineligibility_does_not_block_theta_q_eligibility` and
`test_every_family_gets_a_result_even_when_ineligible` are the load-bearing tests: one
family's ineligibility is structurally incapable of suppressing another's
independent eligibility, and no family is ever silently dropped from the result set.

## Status

IMPLEMENTED and tested — 14 Python tests (`test_strategy_router.py`), 6 TS contract
tests (`strategy-router-contract.test.ts`). Not yet wired into a live candidate-
generation pipeline (that requires the Python-TS bridge and real option-chain data,
both still `NOT_STARTED`/`SPECIFIED` — see `docs/CURRENT_ENGINEERING_HANDOFF.md`).
