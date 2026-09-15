# THETA Codex Acceptance Audit

Author: Claude (research/audit lane). `CURRENT_MAIN_SHA` at authoring time:
`e17b932fd970dcf5b4c049e192264bcde1ad1072`. All findings below verified via
`git show`/`git grep`/an isolated detached worktree against this SHA -- never
this branch's own stale checkout. No Production mutation, no broker order.

## 1. Delta since the last full integration audit

The last full integration audit (this branch, prior session) covered up to
`de9361325ef7c956462bac14f5787cf69ee71ea7` and produced two flagship findings:
(1) `PostgresMasterPaperActionPlanStore.enqueue()` had zero callers (missing
producer), and (2) `master-paper-plan-assembly.ts` only connects `OPEN_CSP`,
naming every other action `ACTION_NOT_YET_CONNECTED`.

Since then, main advanced through `9097206` -> `e213081` -> `e17b932`:

- **Finding (1) is RESOLVED.** `src/execution/master-paper-plan-assembly.ts`
  (new file, `assembleMasterPaperEvidencePlan`) now turns a
  `CanonicalStrategyFrontier` OPEN_CSP selection into an
  `ApprovedMasterPaperActionPlan`, and `src/research/production-shadow-runtime.ts`
  now calls `PostgresMasterPaperActionPlanStore.enqueue(...)` from the
  shadow-evidence scan -- verified via `git grep "\.enqueue(" origin/main` in
  the prior session, re-confirmed unchanged this session. `enqueue()` also
  gained a `chain` parameter that inserts a `trade.economic_chain` row, and
  `claimNext()` now expires stale decisions to `QUARANTINED`.
  **NO_CHANGE_REQUIRED.**
- **Finding (2) is UNCHANGED, confirmed via a zero-line diff** in
  `master-paper-plan-assembly.ts`/`canonical-strategy-frontier.ts`/
  `management-action-frontier.ts` between the prior review and `e213081`, and
  no further changes to `e17b932` either (this round's delta only touched
  `optionomics-quote-qualification*.ts`, `environment.ts`, and windows-worker
  tooling -- see below). Every non-`OPEN_CSP` action still hits
  `ACTION_NOT_YET_CONNECTED`. Reported only, per standing instruction not to
  fix it -- Codex may be actively working here.

## 2. This round's actual main delta (`e213081..e17b932`)

```
docs/DECISIONS.md, docs/HANDOFF.md, docs/THETA_LOCAL_WINDOWS_RUNTIME.md
src/config/environment.ts
src/theta/optionomics-quote-qualification-runtime.ts
src/theta/optionomics-quote-qualification.ts
tests/environment.test.ts, tests/local-worker-auto-export.test.ts,
  tests/optionomics-quote-qualification.test.ts
tools/windows/theta-local-worker.ps1
```

`optionomics-quote-qualification.ts`/`-runtime.ts` gained HTTP-status and
`productionAuth`/`authenticationFailure` (`'401_UNAUTHORIZED'`) tracking per
sample. The report's `ready: false as const` and the unconditional
`'PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED'`/
`'ORDER_PRICING_USE_NOT_DOCUMENTED'` blockers are UNCHANGED -- this is
additive observability, not a semantics change. **NO_CHANGE_REQUIRED**; this
is consistent with, and does not disturb, this branch's own prior-session
current-data-semantics audit (`THETA_OPTIONOMICS_CURRENT_DATA_SEMANTICS_AUDIT_2026-09-14.md`),
whose `CORRECT_ONLY_FOR_OPTION_CHAIN` classification still holds.

## 3. New acceptance-test scenarios from this session's external repo study

Sourced from `THETA_EXTERNAL_REPO_PATTERN_MATRIX.md`'s deep-study dossiers
(`milgar7969/alpaca-options-framework`, `joncovington/MEICAgent`). These are
QUESTIONS this dossier could not fully resolve given this session's time
budget -- framed as acceptance tests for Codex to run against the actual
order-construction/reconciliation code, not asserted defects.

| # | FILE (best guess, to confirm) | SYMBOL | QUESTION | WHY IT MATTERS | ACCEPTANCE TEST |
|---|---|---|---|---|---|
| 1 | `src/execution/order-construction.ts` | order side/type construction for closing actions | Does closing a long option leg (relevant once THETA-D exists) ever construct a raw `sell`-type limit order rather than routing through Alpaca's `close_position()`-equivalent path? | Alpaca has been observed (per `milgar7969/alpaca-options-framework`'s README) to misread a sell-limit on an existing option position as an attempt to OPEN a new short position (`error 40310000`) | Construct a `SELL_TO_CLOSE`-equivalent order for a long leg and assert it never uses a bare sell-limit against an existing long position; THETA's current Wheel-only vocabulary (SELL_TO_OPEN/BUY_TO_CLOSE) may make this moot today -- confirm, don't assume |
| 2 | `src/execution/broker.ts` or `paper-order-coordinator.ts` | order-cancellation handling | Is a cancelled order's status re-checked before being treated as cancelled? | A cancel can race a fill at the broker (observed, per the same repo, as a real Alpaca behavior under WebSocket teardown/task cancellation) | After issuing a cancel, assert the code checks the broker's own order status rather than assuming cancellation succeeded, before releasing any collateral/risk budget the order was holding |
| 3 | `src/execution/broker-reconciliation-worker.ts` | handling of `externalOrUnknownCount > 0` | Confirmed (this session): `ORDER_RECONCILIATION`'s job in `autonomous-runtime.ts` returns `degraded('AMBIGUOUS_ORDER_REQUIRES_READ_ONLY_RECONCILIATION')` rather than mutating anything -- i.e. THETA flags, never auto-closes, a broker-side position/order it doesn't recognize locally | `milgar7969/alpaca-options-framework`'s "ghost sweeper" auto-force-closes any untracked option position -- appropriate for a single-owner bot, INAPPROPRIATE for a platform serving other people's own brokerage accounts (could wrongly close a user's manually-placed position) | **NO_CHANGE_REQUIRED** -- THETA's more conservative flag-only behavior is confirmed correct for this platform's actual risk profile, stated explicitly here so it is not mistaken for a gap in a future pass |
| 4 | THETA's management-action frontier (`management-action-frontier.ts`) | `LET_EXPIRE`/`EXPIRE_OTM` vs an active close | Does THETA's active-management decision ever force a CLOSE action on a short option that would otherwise expire worthless, when doing nothing is economically correct? | `MEICAgent`'s own release notes document a previously-shipped bug of exactly this shape ("cash-settled positions are now left to expire, not force-closed") | Confirmed structurally (this session, reading `management-action-frontier.ts`): `LET_EXPIRE` is a listed candidate action alongside `HOLD`/`CLOSE_FULL`/`ROLL`/`ACCEPT_ASSIGNMENT`/`REDEPLOY` for `CSP_OPEN`, evaluated by the SAME `evaluateAction` function with its own blocker (`NOT_AT_EXPIRATION` unless `dte<=0`) -- i.e. the competing-actions structure already exists and does not privilege CLOSE over LET_EXPIRE. **NO_CHANGE_REQUIRED**, but MEICAgent's bug is a useful concrete regression-test prompt: assert a synthetic near-expiry-OTM fixture never selects an active close when `LET_EXPIRE` is feasible and cheaper. |

Items 1-2 are genuinely open questions this session's time budget did not
permit resolving with full code reads; items 3-4 were resolved this session
(both `NO_CHANGE_REQUIRED`, with reasoning). Framing all four this way rather
than as blanket "defects" avoids overclaiming what a repo-derived hypothesis
proves about THETA's own code.

## 4. Copy-trading audit (section 14)

Verified real code exists for this (not previously audited in this
engagement): `src/customer/copy-engine-contract.ts` (370 lines),
`src/customer/paper-copy.ts` (298 lines),
`src/customer/postgres-disabled-copy-planner.ts` (383 lines).

**Sizing discipline, confirmed by direct code read:**
`copy-engine-contract.ts` computes follower quantity as
`Math.min(masterQuantity, capacity)` where `capacity` is itself
`Math.min(collateralCapacity, ...riskCapacities)` -- i.e. the follower's own
quantity is capped by the MINIMUM of its own collateral and risk capacities,
never simply cloned from the master's quantity. This matches the "min-of-
capacities never increases" invariant already independently verified for
`account_risk_capacity.py` (R3/R4) and `applyPaperEvidenceRiskCap` (execution-
authorization-tier.ts) in prior sessions -- the same discipline is applied a
third time, independently, in the follower-copy path. **NO_CHANGE_REQUIRED.**

**Outcome vocabulary, confirmed by direct code read:** `copyOutcomeSchema`
enumerates `COPY_FULL | COPY_REDUCED | SKIP_ACCOUNT | BLOCKED | RECONCILE |
DUPLICATE_NOOP` -- a real `SKIP_ACCOUNT`/`FOLLOWER_SKIPPED_ENTRY` path exists
(not blind copying), and `followerSyncStateSchema` (`SYNCED | PENDING_SYNC |
PARTIAL_SYNC | DIVERGED | BLOCKED | RECONCILING`) gives the follower its own
independent lifecycle-sync state rather than assuming it mirrors the master.

**Execution gate, confirmed by direct code read:**
`PostgresDisabledCopyPlanner` (the class name itself states this) persists
follower-copy plans with a hardcoded hardcoded `'EXECUTION_DISABLED'` status
literal in its INSERT statement (line ~325 at this SHA) -- i.e. copy-trading
PLANNING is real and computes genuine evidence (`followerCopyEvidenceSchema`
tracks `masterFillTime`, `copyEventTime`, `followerObservationTime`,
`quoteTimestamp`/`quoteAgeMs`/`maximumQuoteAgeMs`, `bid`/`ask`,
`economicDirection` (`CREDIT`/`DEBIT`), and imports
`directionAwarePriceDeterioration` from `copy-engine-contract.ts` -- matching
this engagement's own earlier finding that direction-aware credit/debit price
deterioration was a Codex-identified-and-repaired defect in `follower_copy_economics.py`'s
research counterpart), but EXECUTION remains explicitly disabled at the
persistence layer, matching the same "compute evidence, gate execution
separately" pattern already verified for master-paper action plans
(`PAPER_EVIDENCE` vs `EMPIRICALLY_PROMOTED_PAPER` tiers). **NO_CHANGE_REQUIRED**
-- this is the correct, conservative posture for a not-yet-launched feature.

**Test scenarios for Codex (per this directive's section 14, framed as
acceptance tests against the ALREADY-EXISTING schema, not proposals for new
architecture):**

1. Different follower equity/buying power than master: assert
   `Math.min(masterQuantity, capacity)` reduces quantity correctly and never
   raises it, including the `capacity == 0 -> quantity == 0` boundary.
2. Different follower options-trading-level/permission than master: assert
   an insufficient-permission follower reaches `SKIP_ACCOUNT`/`BLOCKED`, never
   `COPY_FULL`.
3. Follower's own fill differs from master's fill (price/timing): assert
   `directionAwarePriceDeterioration` is computed from the FOLLOWER's own
   observed quote, not silently copied from the master's execution price.
4. Master enters a position the follower's own account cannot legally hold
   (e.g. an option type the follower isn't approved for): assert this reaches
   `SKIP_ACCOUNT` with a named reason, never a `DUPLICATE_NOOP` masking a real
   skip.
5. Partial fill at master: assert the follower's own copy plan is sized from
   the master's ACTUAL filled quantity, not the originally intended quantity.
6. Assignment/stock/CC divergence: assert a follower that missed the CSP
   entry (e.g. joined late, or was `SKIP_ACCOUNT`'d) is never later force-
   copied into an ASSIGN/SELL_CC event for a position it was never actually
   long in the first place -- the follower's own `followerSyncStateSchema`
   should reach `DIVERGED`, not silently mirror the master's later lifecycle
   events onto a position the follower never held.
7. Late join mid-cycle: assert a newly-joining follower's FIRST observed
   action is gated by its own current eligibility (permission, capacity,
   market session), never a replay of the master's historical entry.
8. Pause/resume: assert a paused follower correctly resumes at
   `PENDING_SYNC`/`RECONCILING` rather than assuming continuity with events
   that occurred during the pause.
9. Restart: assert `PostgresDisabledCopyPlanner`'s persisted plans survive a
   restart without duplicate submission once execution is eventually enabled
   (same idempotency discipline already verified for
   `PaperOrderCoordinator.getOrCreateIntent`'s identity-hash approach --
   worth confirming the copy-planner uses an equivalent content-hash/
   `ON CONFLICT DO NOTHING` pattern; not independently re-verified line-by-
   line this session given time budget, framed as a question).

## 5. Summary classification (per directive section 13's exact fields)

| # | FILE | SYMBOL | FINDING | SEVERITY | STATUS |
|---|---|---|---|---|---|
| — | `src/execution/postgres-master-paper-action-plan-store.ts` | `enqueue()` | Previously flagged missing-producer gap | (was HIGH) | **RESOLVED by Codex, confirmed this session** |
| — | `src/execution/master-paper-plan-assembly.ts` | `assembleMasterPaperEvidencePlan` | Only `OPEN_CSP` connected; every other action `ACTION_NOT_YET_CONNECTED` | MEDIUM (appears intentional, scoped) | **UNCHANGED, reported only** |
| — | `src/theta/optionomics-quote-qualification*.ts` | `assessOptionomicsQuoteQualification` | Correctly, permanently rejects OPTION_CHAIN for execution use; scope confirmed unchanged by this round's additive HTTP-status tracking | N/A | **NO_CHANGE_REQUIRED** |
| — | `src/execution/broker-reconciliation-worker.ts` | `ORDER_RECONCILIATION` handling | Flags (never auto-closes) an unrecognized broker-side position | N/A -- correct for this platform | **NO_CHANGE_REQUIRED** (confirmed safer than a comparable public repo's more aggressive pattern) |
| — | `src/theta/management-action-frontier.ts` | `evaluateAction`, `LET_EXPIRE` | Competing-actions structure already includes `LET_EXPIRE` alongside `CLOSE_FULL` from the same decision state | N/A -- correct | **NO_CHANGE_REQUIRED** |
| — | `src/customer/copy-engine-contract.ts`, `postgres-disabled-copy-planner.ts` | sizing/outcome/execution-gate | Follower sizing capped by own capacity; execution explicitly disabled at persistence layer | N/A -- correct | **NO_CHANGE_REQUIRED** |
| 1 (open) | `src/execution/order-construction.ts` (to confirm) | closing-order construction | Whether a future long-leg close could hit Alpaca's sell-limit-misread-as-open quirk | LOW today (Wheel-only vocabulary doesn't need it yet), MEDIUM once THETA-D exists | **OPEN QUESTION**, not resolved this session |
| 2 (open) | `src/execution/broker.ts`/`paper-order-coordinator.ts` (to confirm) | cancel-status recheck | Whether a cancel is verified against broker status before being treated as successful | Unknown until checked | **OPEN QUESTION**, not resolved this session |

## 6. What this document is not

This is not a re-derivation of the full 43-section integration audit from two
sessions ago -- that audit's other findings (management-cycle orchestrator
cluster still disconnected, etc.) are UNCHANGED (no diff touched those files)
and are not repeated here mechanically; see that session's own report for
their standing status.

## 7. Precise fix spec: the minimal first step to connect active management (still `e17b932`)

The owner asked whether the remaining blockers can just be fixed. They can't
be fixed from this branch -- only Codex can touch `main`/execution -- but the
root cause of the `ACTION_NOT_YET_CONNECTED` gap (section 1 above) is now
precise enough to hand over as a bounded, minimal, low-risk first PR rather
than a vague "connect everything" ask.

**Root cause, read directly from the code:** `buildManagementActionFrontier`
in `src/theta/management-action-frontier.ts` computes real feasibility for
every action in `actionSets[lifecycleState]` (including `CLOSE_FULL` and
`LET_EXPIRE`), but its final selection step only ever looks for a PASSIVE
action:

```ts
const passive = actions.find((action) => ['HOLD', 'RECOVERY_WAIT', 'HOLD_CC'].includes(action.action));
const selectedAction = passive?.feasibility === 'FEASIBLE' ? passive.action : null;
```

`decisionState` is then unconditionally `'SYSTEM_HOLD_MISSING_EVIDENCE'`.
**`CLOSE_FULL` and `LET_EXPIRE` are not even candidates for selection today,
regardless of their own computed feasibility** -- and critically, neither of
them is in the `opensNewRisk` set (`ROLL`, `SELL_CC`, `ROLL_CC`, `REDEPLOY`
only), so neither carries the `EMPIRICAL_ACTION_EV_UNKNOWN` blocker that
correctly gates the EV-dependent actions. In other words: the empirical-EV
gate is not what's blocking `CLOSE_FULL`/`LET_EXPIRE` today -- the selection
function's own hardcoded action list is.

**Minimal required change (two files, both already-existing, no new
architecture):**

1. `management-action-frontier.ts`: extend the selection candidate set from
   `['HOLD', 'RECOVERY_WAIT', 'HOLD_CC']` to also include `'CLOSE_FULL'` and
   `'LET_EXPIRE'` -- the two actions that (a) never open new risk, (b) never
   require empirical EV under the existing `opensNewRisk` gate, and (c) are
   the structurally simplest to execute (`LET_EXPIRE` requires no broker
   order at all; `CLOSE_FULL` requires exactly one `BUY_TO_CLOSE` order,
   symmetric to the already-built `OPEN_CSP` path's one `SELL_TO_OPEN`
   order). Do NOT extend it to `ROLL`/`SELL_CC`/`ROLL_CC`/`REDEPLOY` in this
   same change -- those still correctly require empirical EV readiness and
   multi-leg plan assembly, a separate, larger piece of work. Set
   `decisionState: 'ACTION_SELECTED'` when one of these is chosen instead of
   the passive default.
2. A new function alongside `assembleMasterPaperEvidencePlan` in
   `master-paper-plan-assembly.ts` (or a sibling file), e.g.
   `assembleMasterPaperManagementPlan`, mirroring the existing function's
   exact validation shape (hard-validity/AEGIS/account/options-level/
   equivalent-exposure/cost-model/expiry checks) but keyed off
   `ManagementActionFrontier.selectedAction` instead of
   `CanonicalStrategyFrontier.primaryAction`, producing a `BUY_TO_CLOSE`
   `ApprovedMasterPaperActionPlan` for `CLOSE_FULL` and a no-order lifecycle
   transition (no plan at all -- just advancing `lifecycleState` toward
   `EXPIRE_OTM`) for `LET_EXPIRE`.

ACCEPTANCE TEST for this specific change: a synthetic `CSP_OPEN` fixture at
DTE=0 with no economic reason to close should select `LET_EXPIRE`, never a
forced `CLOSE_FULL` -- directly exercising the exact regression this
session's `MEICAgent` repo-study dossier flagged (a comparable system
previously shipped a bug forcing an active close on a position that should
have been left to expire).

This is offered as the single highest-leverage, lowest-risk next PR for
Codex -- not a demand, and not something this branch can implement, since it
touches `src/theta/`/`src/execution/` on `main`.

## 8. Refresh against `a8418cb1c273522eb7112bf4aa661393088c49bf` -- management dispatch verified in depth

Verified via a fresh isolated detached worktree (not this branch's stale
checkout). Full delta `e17b932..a8418cb`: 31 files, 1742 insertions -- real,
substantial, matching the owner's description.

**The precise, load-bearing finding this round:** Codex built the entire
management ASSEMBLY/DISPATCH/PERSISTENCE layer this session's own prior fix
spec asked for -- and built it more completely than the minimal two-action
spec suggested (all six order-bearing actions: `CLOSE_FULL`, `ROLL`,
`SELL_STOCK`, `SELL_CC`, `CLOSE_CC`, `ROLL_CC`, not just two). Read in full:

- `src/execution/management-paper-plan-assembly.ts` (new, 241 lines):
  `assembleManagementPaperPlans` validates exact contract/quantity/terms
  identity for closing legs against `ManagementInputState.contract`, exact
  share-count match for `SELL_STOCK`, and a real no-naked-call guard for
  `OPEN_CC`/`ROLL_CC_OPEN` (`confirmedCoveredShares !== openStockShares ||
  coveredShares < quantity*multiplier` both reject). Correctly still gates
  `ROLL`/`SELL_CC`/`ROLL_CC` (risk-opening legs) behind
  `EMPIRICAL_ACTION_EV_UNKNOWN` when `empiricalEconomicsReady` is false.
  `REDEPLOY` explicitly returns `BLOCKED` pending its own future exit/entry
  resolution -- not silently allowed through.
- `migrations/037_management_action_plan_dispatch.sql`: DB-level shape checks
  (`authority_kind` NEW_RISK vs MANAGEMENT tied to required fields by a CHECK
  constraint, not just application code; `leg_sequence=1 <=> depends_on_
  action_plan_id IS NULL`; no-self-dependency; unique `(decision_id,
  action_group_id,leg_sequence)`).
- `src/execution/postgres-master-paper-action-plan-store.ts`'s new
  `publishManagementPlans`: publishes an entire leg group in ONE transaction
  (atomic), re-validates against the authoritative `management_action_
  frontier`/`management_input_snapshot`/`execution_account` rows under
  `FOR SHARE` locks at publish time (defense in depth against a stale/
  tampered plan object), and is idempotent via content-hash collision
  detection. **`claimNext`'s WHERE clause requires `depends_on_action_plan_id
  IS NULL OR EXISTS(...JOIN order_intent oi ON oi.status='FILLED')`** -- the
  open leg of a roll is genuinely unclaimable at the SQL level until the
  close leg's linked order_intent shows a broker-confirmed fill. This is
  real, DB-enforced close-before-open dependency gating, not merely recorded
  metadata.

**Verdict on all of the above in isolation: CORRECT, no defects found.**

**But the actual runtime connectivity claim does not hold, for two
independent, precisely-located reasons -- verified by reading the exact
call site, not inferred:**

1. `src/theta/management-action-frontier.ts`'s `buildManagementActionFrontier`
   is **byte-for-byte UNCHANGED** in this delta (confirmed: it does not
   appear in the 31-file changed list at all). Its selection logic is still
   exactly `const passive = actions.find((a) => ['HOLD','RECOVERY_WAIT',
   'HOLD_CC'].includes(a.action))`, and `decisionState` is still
   unconditionally `'SYSTEM_HOLD_MISSING_EVIDENCE'`. It **never** selects
   `CLOSE_FULL`/`ROLL`/`SELL_STOCK`/`SELL_CC`/`CLOSE_CC`/`ROLL_CC` regardless
   of their own computed feasibility, and never produces `decisionState:
   'ACTION_SELECTED'` -- which `assembleManagementPaperPlans` (and
   `publishManagementPlans`'s own `FOR SHARE` re-check) both require to ever
   leave `NO_BROKER_ACTION`/throw `MANAGEMENT_ACTION_SELECTION_MISMATCH`.
2. The one real runtime call site, `autonomous-runtime.ts`'s
   `POSITION_MANAGEMENT_SCAN` job, calls `assembleManagementPaperPlans` with
   **`executionLegs: []` hardcoded, verbatim, in the diff.** Even hypothetically
   with (1) fixed, every active action would immediately hit
   `MANAGEMENT_EXECUTION_LEG_SEQUENCE_INVALID` (required leg count for any
   non-passive action is >= 1, supplied is always 0) -- there is no code
   anywhere in this delta that computes a real `ManagementExecutionLegDirective`
   (fresh quote, economic boundary, contract identity for the target leg) to
   feed this array.
3. Confirmed by reading `tests/management-paper-plan-assembly.test.ts`
   directly: its own fixtures **manually override** `buildManagementActionFrontier`'s
   real output (`selectedAction`/`decisionState`/per-action `feasibility`)
   to force the exact condition needed to exercise `assembleManagementPaperPlans` --
   proof, by the test's own necessary construction, that this condition does
   not occur from real runtime code today.

**Conclusion: `OLD_E17_MANAGEMENT_FINDING = PARTIALLY_RESOLVED`.** The
dispatch/persistence/dependency-safety engineering (this document's own
prior fix-spec ask) is now genuinely built and well-tested in isolation --
that part is real progress, not a false claim. What remains missing is (a)
the actual decision logic that selects a non-passive action in
`buildManagementActionFrontier`, and (b) the leg-directive computation that
turns a selected action into real `executionLegs`. Both are new, precisely-
located gaps, not a reopening of the old one.

**Everything else verified this round, with no defects found:**
- `src/theta/optionomics-temporal-features.ts` (new, 185 lines):
  `deriveOptionomicsTemporalFeatures` correctly rejects cross-underlying
  comparison, requires strictly-increasing timestamps (rejects same-or-
  reversed order), enforces a caller-supplied `maximumGapSeconds` bound (no
  hardcoded magic number), checks schema-version compatibility, and
  propagates `INVALID`/`UNKNOWN` correctly (never coerces either into a
  computed delta). `executionEligible: false` is a literal type, not just a
  runtime default. **COMPLETE, matches this branch's own prior FlashAlpha-
  inspired recommendation for a temporal layer.** One open refinement, not a
  defect: the bound is a single uniform value across all four feature
  families in one call, not yet a per-family cadence-aware envelope the way
  FlashAlpha's `data_as_of` is per-feed -- **`PER_FEED_FRESHNESS_ENVELOPE =
  ADAPT`** (a real, currently-correct single-bound implementation exists;
  a per-family bound would be a genuine refinement, not required to close a
  gap).
- `migrations/039_cross_branch_candidate_evidence.sql`: `trade.canonical_
  strategy_branch_evidence` has a DB-level `CHECK(execution_authorized=false)`
  constraint (named `canonical_branch_execution_locked`) and `CHECK(
  empirical_economics_ready=false)` -- structurally, not just by convention,
  no row in this evidence table can ever claim execution authority. Action
  vocabulary (`OPEN_CSP`, `OPEN_DEFINED_RISK`, `RECOVERY_WAIT`, `SELL_STOCK`,
  `SELL_CC`) covers zero-leg stock/recovery actions. **COMPLETE at the
  schema level** (did not re-verify the exporter's actual consumption of
  every branch this round, given time budget -- not claimed).
- `strategyFamilyForCanonicalBranch` (new export, `canonical-strategy-
  frontier.ts`) is consumed exactly once, at the persistence boundary in
  `postgres-theta-cycle-store.ts:306` -- a minimal, correctly-scoped
  translation, not a duplicate routing engine. **COMPLETE.**
- Copy-trading files (`copy-engine-contract.ts`, `paper-copy.ts`,
  `postgres-disabled-copy-planner.ts`) do **not** appear in this delta at
  all -- confirmed unchanged; last session's findings (sizing correctly
  capped, execution correctly still `EXECUTION_DISABLED`) stand without
  re-verification.

## 9. One new repo pattern worth flagging (section 10 of this directive)

`sgdividends/spx-dealer-gamma` (no license -- facts about the CBOE public
delayed-quotes feed and Black-Scholes math extracted, no code adopted):
its `find_zero_gamma` function independently derives a gamma-flip level by
re-computing Black-Scholes gamma across a RANGE of hypothetical spot prices
(holding each contract's own IV/strike/T fixed) and finding where cumulative
signed GEX crosses zero -- a "spot-scan" methodology, distinct from reading
a single provider-reported `gamma_flip` scalar at the current spot. THETA/
Optionomics today only consumes the latter (an opaque, provider-computed
value). This is a genuine, currently-unbuilt RESEARCH OPPORTUNITY: an
independent THETA-side cross-check of Optionomics' reported `gammaFlipStrike`/
`totalGex` against a self-computed spot-scan value, using THETA's own
already-available IV/OI/strike/multiplier fields and its own Black-Scholes
reference implementation (`bs_reference.py`) -- not a defect, not urgent,
and not something this pass builds, but worth naming precisely rather than
leaving as a vague "study more repos" note. `FlashAlpha-lab/volatility-
surface-python`'s `arbitrage_detection_butterfly_calendar.py` example also
confirms the exact formal definitions THETA's own deferred SVI/SSVI
arbitrage-diagnostic work would need (`d^2w/dk^2 >= 0` for butterfly-free;
`w(k,T1) <= w(k,T2)` for T1<T2 for calendar-free) -- reference material for
whenever that deferred work is prioritized, not a new requirement.

## 10. Refresh against `934350b35856a1e1f00ad9e32beaccc015a2938e` -- follower-paper-runtime built, still unwired

Verified via a fresh isolated detached worktree. Delta `a8418cb..934350b`:
20 files, 762 insertions -- entirely copy-trading focused this round
(`src/customer/follower-paper-runtime.ts`, new, 174 lines;
`src/customer/postgres-follower-paper-runtime.ts`, new, 132 lines;
`migrations/040_follower_paper_runtime.sql`). **`src/theta/management-action-
frontier.ts` and `src/theta/autonomous-runtime.ts` do NOT appear in this
delta** -- the active-management gap this document's section 7/8 named
(frontier never selects a non-passive action; runtime passes
`executionLegs:[]`) is confirmed **UNCHANGED** this round. Not reopened as a
new finding -- restated only because this directive's own section 25
explicitly asks the question again.

**What this round actually built, read in full:**
`assembleLockedFollowerPaperActionPlan` (`follower-paper-runtime.ts`) is a
genuinely careful piece of engineering: it validates a real BBO-bounded limit
price (`proposedLimit` must fall within `[bid, ask]`), a real quote-provider/
semantics check (Alpaca `CONSOLIDATED_NBBO` or Optionomics
`TRUSTED_TWO_SIDED_ORDER_PRICING` only -- and no live code path today ever
produces the latter for an Optionomics quote, per this branch's own current-
data-semantics audit, so that branch is correctly future-proofed but
currently unreachable, not a live loophole), a real AEGIS check
(`ALLOW_FULL`/`ALLOW_REDUCED` only), a decision-expiry check, and a secret-
leak guard (`assertNoSecretShapedKeys`, recursively rejecting any key whose
normalized name matches secret/token/authorization/apikey/credential). The
safety rail is enforced in the type system itself, not just at runtime:
`executionGate:'FOLLOWER_EXECUTION_DISABLED'` and `executionAuthorized:false`
are literal types on `FollowerPaperActionPlan`, and
`PostgresFollowerPaperRuntimeStore.persistLockedActionPlan` throws if either
is ever anything else. Migration 040 repeats the same lock at the DB level
(`CHECK(execution_gate='FOLLOWER_EXECUTION_DISABLED')`,
`CHECK(execution_authorized=false)`) -- the same "structural lock, not just
convention" pattern already verified for migration 039's canonical-branch
evidence table. `classifyFollowerOrderReconciliation` and
`classifyFollowerLifecycleDivergence` are real, and directly answer several
of this branch's own previously-proposed copy-trading acceptance-test
scenarios (missed master entry, partial fill, per-lifecycle-action
divergence including assignment/recovery/CC/call-away, restart, pause) with
actual enum-backed classification logic, not just documentation.

**But confirmed by direct `grep` (zero hits in `src/customer/api.ts` and
`src/theta/autonomous-runtime.ts`): nothing calls `assembleLockedFollowerPaperActionPlan`
or `PostgresFollowerPaperRuntimeStore` anywhere yet.** This is the same
"implemented, tested, DB-safe, but not yet wired to any producer" pattern
this document has now found twice before (the master-paper-action-plan
`enqueue()` gap, resolved two sessions ago; the management-dispatch
`executionLegs` gap, found last session and still open). Given how safety-
sensitive follower-copy execution is, building the locked-plan/reconciliation/
divergence logic in isolation first, fully tested, before wiring a producer,
is a reasonable and safe sequencing choice -- not a defect, and consistent
with this platform's own stated "no copy execution until every safety
prerequisite is proved" posture from two sessions ago. **`FOLLOWER_EXECUTION`
remains correctly `EXECUTION_DISABLED`; this round added the machinery that
would eventually let it be turned on safely, without turning it on.**

REQUIRED_CODEX_CHANGE (unchanged from section 7, restated because still
accurate): the two management-connectivity gaps (frontier selection,
executionLegs computation) remain the single highest-leverage next step;
this round's copy-trading work, while real progress, did not touch them.
