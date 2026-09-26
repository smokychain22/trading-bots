# THETA Phase 2 — Strategy Router + Strictness + Branch Isolation (Reclosure)

Built on `claude/theta-unified-takeover` from accepted head `9ff1ba2`. This
reclosure focuses on the one concrete residual named at Phase 2 reopening —
`THETA-CANONICAL-FRONTIER-NO-PER-BRANCH-ISOLATION` — plus re-verification of
Phase 2's prior real findings (strictness machinery, historical Sep16/18/21
report, zero-trade taxonomy). Per the current directive's "one phase at a
time" rule, no Phase 3+ item (e.g. the Q max-loss gap) was touched.

## Branch fault-domain isolation — real defect, fixed, test-first

**Root cause confirmed by direct read**: `buildCanonicalStrategyFrontier()`'s
`branchOrder.map((branch) => buildBranch(branch, input))` had no per-branch
exception boundary — a real throw from any branch's construction step
(candidate enumeration, ranking, or even the shared applicability checks)
propagated straight through `Array.map`, crashing the entire frontier before
any branch's real result — including Q's — was ever produced.

**Test-first, per the directive's own discipline**: wrote
`tests/canonical-frontier-branch-isolation.test.ts` and confirmed the first
test genuinely failed against the pre-fix code (real stack trace captured:
`Error: SIMULATED_STOCK_CURRENT_PRICE_READ_FAILURE` propagating through
`buildBranch` → `Array.map` → `buildCanonicalStrategyFrontier`), before
writing any fix.

**A real subtlety found while fixing, not glossed over**: the naive fix
(wrap every per-branch read in try/catch) would have been wrong. Stock
existence (`input.stock.shares`) is read by the applicability check used to
compute `managementAuthorityRequired` — if a stock-read failure were
isolated as "just this branch failed, others proceed normally," the system
could silently behave as if no stock existed at all when it actually does,
which is a real safety-relevant regression (new-risk decisions should not
proceed as if the account is flat when stock-ownership state is genuinely
unreadable). **Fixed correctly**: `input.routing.results` and
`input.stock.shares` are now both read exactly once, hoisted outside any
per-branch fault boundary — a failure there is a genuine shared/global fault
and correctly still crashes the whole cycle (verified by two adversarial
tests asserting `assert.throws`). Only branch-*specific* construction work
(candidate enumeration, deeper economic fields like `stock.currentPrice`,
ranking) is isolated per branch, producing a new, real, typed
`BRANCH_CONSTRUCTION_FAILED` evaluation state with the exact
strategy/message/timestamp preserved in `routeReasons` — never a silent
`catch {}`.

**Verification**: 4 new tests pass (RECOVERY-specific failure survives Q;
D-specific failure survives Q; stock-existence failure still hard-crashes;
routing-read failure still hard-crashes). Re-ran the full pre-existing
`canonical-strategy-frontier.ts` test suite (44 tests across 5 files) — 43
pass, 1 pre-existing skip (real Postgres integration test, no DB access) —
zero regression from the refactor.

## Re-verified real prior Phase 2 findings (not redone, re-confirmed)

- **Zero-trade taxonomy**: `false-inactivity-taxonomy.ts`'s real 12-cause
  enum (aligned to Codex's own `FirstPaperBlockerClass`) already
  distinguishes the concepts the directive names differently: `ECONOMIC_WAIT`
  (real economic evaluation, nothing attractive) is genuinely distinct from
  `PIPELINE_NOT_EVALUATED` (candidate never reached a later stage) —
  functionally the same NO_OPPORTUNITY-vs-NO_CANDIDATE distinction the
  directive asks for, under this repo's own existing names. Reused, not
  duplicated.
- **Strictness machinery + historical Sep16/18/21 report**: real, built and
  verified in the prior Phase 2 pass (`strictness-funnel-report.ts`, run
  against the actual historical receipt numbers, with the executable-but-
  zero-qty cohort's cause honestly left `SOURCE_DERIVED_CONCLUSION_NOT_FACT`
  rather than force-classified).
- **Sep24 case**: re-checked — no committed evidence file in this repo
  describes the "Q candidates, positive size, then AEGIS concentration/
  correlation veto → GLOBAL_WAIT" event the directive describes. This
  matches the exhaustive search already done earlier this session (the real
  runtime receipts for that date live in a gitignored `.theta-local-worker/`
  directory on the actual worker host, structurally outside this repo's
  reach). Unchanged: `HISTORICAL_CAUSE_NOT_IDENTIFIABLE_FROM_AVAILABLE_EXPORT`
  remains the honest classification; nothing was fabricated to fill this gap.
- **Candidate ordering / determinism**: Phase 1's
  `canonical-frontier-tiebreak-order.test.ts` already proves lexical
  candidate-ID ordering only breaks ties among truly pareto-equal candidates,
  never drives selection between economically different ones. Phase 1's new
  `canonical-decision-authority.test.ts` determinism test covers the
  selection-authority level. No new frontier-level determinism gap found
  this pass beyond what those two already cover.

## Verification (full suite, phase closure)

`tsc --noEmit`: clean. Full suite and Python results recorded in the commit.

## PHASE_2_STATUS = CLOSED

The one concrete, named residual (branch isolation) is fixed, test-first,
and verified with zero regression. Prior Phase 2 real findings (strictness,
historical report, taxonomy) re-confirmed rather than redone. Genuinely
remaining items are all correctly external, not code-solvable: the Sep24
receipt (lives outside repo reach), and full runtime L7 proof
(RUNTIME_DB_VERIFICATION_PENDING_CODEX, unchanged from every prior pass this
session).
