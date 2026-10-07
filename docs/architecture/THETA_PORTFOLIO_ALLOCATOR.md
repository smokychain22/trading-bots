# THETA Portfolio Budget Allocator

Status: SOURCE ONLY on `claude/portfolio-allocator`. Production behaviour unchanged (mode defaults to OFF). Not deployed.

## What it is (and is not)

An additive capital layer that answers one question: **how much new risk may this strategy consider right now?**

| Authority | Question | Owner |
|---|---|---|
| Router | Which strategies are applicable? | `strategy_router.py` (unchanged) |
| AEGIS | Can this risk be taken? | `aegis.py` (unchanged) |
| Allocator | How much portfolio capacity is available? | `src/theta/portfolio-budget.ts` (new) |
| Strategy | What trade is economic inside that capacity, at what quantity? | Q / H / D sizing (unchanged) |
| Sovereign frontier | Which feasible proposal enters? | `canonical-strategy-frontier.ts` (unchanged) |
| Coordinator | Broker mutation | `PaperOrderCoordinator` (unchanged) |

The allocator never selects a winner, never decides risk, and never resizes a finished proposal. A proposal that no longer fits is
`PORTFOLIO_CAPACITY_CHANGED_REEVALUATE` (new decision cycle). `assertProposalQuantityImmutable` forbids a different quantity under the
same decision id.

## Objects

- `PortfolioBudgetSnapshot`: one immutable, content-addressed snapshot per decision cycle, in integer cents. It is built from the existing
  `deriveAccountExposure` output: positions, the remaining quantity of opening orders counted once, and pending assignment collateral.
- `StrategyBudgetEnvelope`: the constraints one strategy optimises inside, for one underlying. It never carries a contract count.
- `maximumQuantityWithinEnvelope`: the largest whole quantity. One contract that does not fit gives `NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE`
  with the exact binding constraint.

Limits are the **existing** capital policy (`paperBootstrapRuntimePolicy.aegis`, pct × hardCapMultiplier, strictly below). Reserves
(assignment, management, opportunity) and per-strategy ceilings are policy inputs. When absent they are reported as `*_POLICY_NOT_CONFIGURED`
and contribute nothing; no percentage is invented.

Strategy semantics:

- **Q and H** consume CSP collateral. On the same underlying they share one ticker capacity.
- **D** consumes defined maximum loss and no assignment capacity.
- **A and C** are `INVENTORY_MANAGEMENT`. They are never charged against new-risk capacity; their binding resource is shares or free covered
  shares.

## Atomic reservation (ENFORCED only, not wired yet)

`reservePortfolioCapitalInTransaction` runs inside the plan-insert transaction under one account-wide capital advisory lock. The durable
NEW_RISK plan row is the reservation, so there is **no schema change**.

The lock re-reads the capital the snapshot could not see:

- plans not yet at the broker;
- broker orders created after the snapshot (zero-fill terminal ones are released).

An ambiguous submit blocks the reservation (`CAPITAL_RESERVATION_RECONCILING`). A stale snapshot gives `BUDGET_SNAPSHOT_STALE`.

This closes a real gap. Today's only lock is per contract, so two symbols in one scan could together exceed the portfolio or ticker policy.
The first-canary cap of 1 masks this until autonomous Paper is active.

## Modes (`PORTFOLIO_ALLOCATOR_MODE`)

| Mode | Effect |
|---|---|
| OFF (default; anything unrecognised) | Nothing computed. Today's behaviour exactly. |
| SHADOW | Computes envelopes and parity per candidate and emits one aggregate trace line. No decision effect. |
| PARITY | Same as SHADOW, with divergences classified (`EXPECTED_NEW_POLICY`, `ALLOCATOR_DEFECT`, `UNIT_MISMATCH`, ...). No decision effect. |
| ENFORCED | **Not certified.** Observes like PARITY and reports `PORTFOLIO_ALLOCATOR_ENFORCEMENT_NOT_CERTIFIED`. |

## Evidence

- `tests/portfolio-budget.test.ts`:
  - a 600-portfolio seeded differential test against `deriveCandidateCapacityAssessment` with zero divergences and coverage floors;
  - an exact-boundary parity test;
  - $100k scenarios A–F;
  - three strategies each wanting $50k;
  - the opportunity and management reserves;
  - partial fill, zero-fill release and assignment;
  - quantity immutability.
- `tests/portfolio-capital-reservation.test.ts`: two concurrent $12k opportunities against $20k, no shrinking, stale and ambiguous states,
  and in-flight capital from durable plans.
- `tests/db/portfolio-capital-reservation.test.ts`: real Postgres. Concurrent transactions serialise on the lock; the reservation survives a
  restart through a new pool; zero-fill releases; an ambiguous submit holds.
- `tests/theta-shadow-cycle.test.ts`: a real cycle in OFF, SHADOW, PARITY and ENFORCED gives identical results, with the noise floor
  calibrated and bounded, and parity compares real candidates with zero divergences.

## Rollout

1. Release with mode OFF. Verify zero behaviour change. This needs no flag.
2. Set `PORTFOLIO_ALLOCATOR_MODE=SHADOW` and observe `PORTFOLIO_ALLOCATOR_OBSERVED` lines over real sessions.
3. Move to PARITY once divergences are 0 or every divergence is classified.
4. ENFORCED requires all of:
   - wiring the envelope as a required strategy input, and the reservation into plan enqueue;
   - an explicit reserve policy decision by the owner;
   - an exact-SHA certification.

Every deploy changes the release SHA, so the H authority receipt must be re-issued for it.

## Known gaps

- Sector and correlation budgets are known only for a single-underlying portfolio, the same as today. Multi-underlying portfolios need a
  sector/cluster taxonomy policy.
- The final frontier pass computes `selectedQuantity = min(sizing.quantity, decision.quantity)`. Plan enqueue makes a mismatch fail closed
  (`ACTION_PLAN_CANONICAL_QUANTITY_MISMATCH`). Making the frontier select-or-reject only is a separate frontier change.
- ENFORCED wiring and the reserve policy values are owner decisions.
