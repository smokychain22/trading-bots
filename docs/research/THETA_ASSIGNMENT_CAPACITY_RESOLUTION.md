# THETA assignment-capacity semantic resolution (Wave 6 Batch J)

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
