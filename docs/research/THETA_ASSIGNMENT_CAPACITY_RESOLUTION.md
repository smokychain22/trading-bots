# THETA assignment-capacity semantic resolution (Wave 6 Batch J)

> **CLOSED (2026-09-22, main `b9cd49a` "Wire broker-backed management
> assignment capacity and PIT timing")**: Codex built a real producer for
> concept 3 below. Not via the exact patch this doc proposed (`riskState`
> in `theta-shadow-cycle.ts` is still `null` -- unchanged) -- Codex instead
> computed `assignmentCapacity`/`assignmentCapacityEvidence` directly in
> `management-input-state.ts` (real, broker-backed:
> `assignmentApplicable && accountFreshForCapacity && collateralPerContract`),
> with an explicit `ManagementAssignmentCapacityEvidence` state machine
> (`NOT_APPLICABLE`/`UNKNOWN`/`KNOWN`) rather than a bare `number | null`.
> This is a stronger fix than proposed (adds explicit evidence state, PIT
> freshness gating via `accountFreshForCapacity`) and independently solves
> the same real gap this doc identified. Verified via `git merge` + full
> test suite (1812 pass) + `tests/management-input-state.test.ts` (61 new
> lines of coverage from Codex). **No further action needed on this item.**

Traced every construction site of every field with "assignmentCapacity" in
its name across `src/theta/`, `src/research/`, `src/customer/`, and
`bots/theta/quant/`. There are **three distinct real concepts**, not one
field under two names -- and one genuine, concrete production gap.

## The three concepts

### 1. `assignmentCapacityUsedPct` -- REAL_FIELD, portfolio-level percentage

- **Type**: `number | null`, a fraction of total assignment capacity
  already used across the whole portfolio.
- **Real producer**: `src/theta/account-exposure.ts:381` -- computed from
  `cspCollateralRequired` against total capacity.
- **Real consumer**: an AEGIS stress input (`bots/theta/quant/runtime/aegis_contract.py:58`,
  `assignment_capacity_used_pct=_required(...)`) -- feeds the risk engine's
  family assessment, not sizing directly.
- **Disposition**: `KEEP_SEPARATE_WITH_NAMES`. This is a real, reachable,
  portfolio-wide risk signal. No action needed.

### 2. `assignmentCapacityQty` -- REAL_FIELD, per-candidate quantity

- **Type**: `number | null`, a contract-count cap for one entry candidate.
- **Real producer**: `src/theta/canonical-strategy-frontier.ts:281-282`.
  The upstream value from `theta-shadow-cycle.ts:1014` (`assignmentCapacityQty: null`)
  is always null on arrival, but `canonical-strategy-frontier.ts` has a
  real fallback: `input.buyingPower / collateral`, floored -- a genuine
  computed value, not a placeholder. Persisted per-candidate in
  `postgres-theta-cycle-store.ts:615/648`.
- **Real consumer**: entry-candidate sizing/eligibility
  (`ASSIGNMENT_CAPACITY_CAP` in the same file, `assignment-assembly.ts`,
  `assignment-orchestrator.ts`, `first-paper-order-readiness.ts`).
- **Disposition**: `KEEP_SEPARATE_WITH_NAMES`. Real, reachable, entry-time
  concept. No action needed.

### 3. `ManagementInputState.context.assignmentCapacity` -- MISSING_PRODUCER

- **Type**: `unknown | null` (`management-input-state.ts:73`).
- **Read site**: `management-input-state.ts:217,270` --
  `riskState.assignmentCapacity ?? null`, where `riskState = object(snapshot.riskState)`.
- **The actual producer of `snapshot.riskState`**: `theta-shadow-cycle.ts:384`
  -- `riskState: null`, hardcoded, unconditionally, for every cycle. There
  is no fallback derivation here the way there is for `assignmentCapacityQty`
  in `canonical-strategy-frontier.ts`.
- **Consequence, traced through `management-action-frontier.ts:134-136`**:
  ```ts
  if (action === 'ACCEPT_ASSIGNMENT' && input.context.assignmentCapacity === null) blockers.push('ASSIGNMENT_CAPACITY_UNKNOWN');
  if (action === 'ACCEPT_ASSIGNMENT' && typeof input.context.assignmentCapacity === 'number'
    && input.context.assignmentCapacity <= 0) blockers.push('NO_ASSIGNMENT_CAPACITY');
  ```
  Because `riskState` is always `null`, `assignmentCapacity` is always
  `null`, so `ACCEPT_ASSIGNMENT` is **structurally blocked on every real
  cycle today** with `ASSIGNMENT_CAPACITY_UNKNOWN` -- not because capacity
  is genuinely exhausted, but because the field was never wired to a real
  producer. This is a real, concrete engineering gap in a canonical
  lifecycle transition (`STOCK_HELD` requires `ACCEPT_ASSIGNMENT` to have
  been evaluable at the assignment event).
- **Disposition**: `BUILD_PRODUCER`.

## Exact Codex integration change (BUILD_PRODUCER)

In `theta-shadow-cycle.ts`, `riskState` is built as a single object at
line ~384 alongside `expertPriorState`/`strategyRouterState`. The minimal,
non-duplicating fix reuses the SAME real derivation already proven correct
in `canonical-strategy-frontier.ts:281-282` (buying power / collateral at
the position's actual strike), rather than inventing a second formula:

```ts
// theta-shadow-cycle.ts, replacing the hardcoded `riskState: null`:
riskState: stockShares > 0 && finite(buyingPower) && stockStrike !== null && stockMultiplier !== null
  ? { assignmentCapacity: Math.floor((buyingPower as number) / (stockStrike * stockMultiplier)) }
  : stockShares > 0
    ? { assignmentCapacity: null } // real gap: buying power or strike/multiplier unavailable this cycle
    : null, // no assigned stock position this cycle -- assignment capacity is not applicable, not unknown
```

This requires `theta-shadow-cycle.ts` to have the assigned position's
strike/multiplier and current buying power in scope at the point
`riskState` is assembled -- both are already real, available inputs
elsewhere in the same function (used to build `accountJson`/`positionsJson`
earlier in the cycle). The exact variable names depend on Codex's current
local scope at that call site, which this research pass does not have
write access to confirm without touching `bots/theta/app`-owned code.

**Not applied to `src/theta/` by this research pass** -- `src/theta/` is
Codex's (engineering) ownership per `docs/OWNERSHIP.md`; this document is
the handoff, not the patch.

## Codex handoff checklist (readiness fields)

- **Unit**: whole contracts (integer count, same unit as `assignmentCapacityQty`), not a percentage -- `management-action-frontier.ts:135-136` already type-checks it as `number` and compares `<= 0`, consistent with an integer quantity.
- **Freshness**: must be computed from the SAME cycle's `buyingPower`/position snapshot already in scope when `riskState` is assembled -- never carried over from a prior cycle. No separate staleness field is needed beyond the existing snapshot's own `asOf`/`retrievedAt` provenance, since this value is derived synchronously within one cycle, not fetched from an external provider.
- **Tests Codex should add** (in `tests/theta-shadow-cycle.test.ts` or `tests/theta-cycle-store.test.ts`, whichever owns `riskState` assembly coverage): (1) a cycle with `stockShares > 0` and known buying power/strike/multiplier produces a real positive `riskState.assignmentCapacity`; (2) a cycle with `stockShares > 0` but missing buying power produces `{ assignmentCapacity: null }`, distinct from (3) a cycle with `stockShares === 0` producing `riskState: null` entirely (no assigned position -- not applicable, not unknown); (4) an end-to-end test through `management-input-state.ts` -> `management-action-frontier.ts` confirming `ACCEPT_ASSIGNMENT` is no longer unconditionally blocked by `ASSIGNMENT_CAPACITY_UNKNOWN` once a real value is present.
- **Expected management-transition change**: today, every real `STOCK_HELD` cycle that reaches `management-action-frontier.ts` has `ACCEPT_ASSIGNMENT` in `blockers` via `ASSIGNMENT_CAPACITY_UNKNOWN`, regardless of true capacity. After this fix, `ACCEPT_ASSIGNMENT` becomes reachable (present in `feasibleActions`, not `blockers`) whenever real buying power supports at least one more assigned lot -- this is expected to change management-frontier OUTPUT composition on real `STOCK_HELD` cycles, not just add an unused field, so it should be verified against a real Paper cycle after merge, not just the unit tests above.

**Codex handoff status: READY.** No further research-side investigation remains open on this item.

## Why not CONSOLIDATE

The three fields differ in unit (percentage vs. quantity vs. quantity),
scope (portfolio-wide vs. per-entry-candidate vs. per-assigned-position),
and consumer (AEGIS risk family vs. entry sizing vs. management lifecycle
gate). Consolidating them into one field would conflate a risk-engine
input with two different sizing decisions made at two different lifecycle
stages -- exactly the kind of silent architecture change
`docs/team_charter` and this repo's `CLAUDE.md` prohibit without a
versioned TRD revision. `KEEP_SEPARATE_WITH_NAMES` for concepts 1 and 2;
`BUILD_PRODUCER` for concept 3.
