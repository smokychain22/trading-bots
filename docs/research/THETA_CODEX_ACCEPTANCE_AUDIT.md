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
