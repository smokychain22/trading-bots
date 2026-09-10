# Phase 2 Engineering Status (Codex-takeover tracking)

Tracks actual implementation status against "CLAUDE TAKEOVER — COMPLETE ALL REMAINING
CODEX WORK" Phase 2A-2G / Phase 3A-3D. Updated as each vertical slice lands on
`claude/full-platform-takeover`. This file exists so status is durable rather than only
in chat, per that task's own instruction (§55).

## Phase 2A — Provider + Alpaca PAPER readiness foundation

**Finding at takeover time:** this slice was substantially already implemented by
Codex before this takeover, not merely started. `src/providers/readiness.ts` already
had: a `CapabilityState` enum (`GOOD`/`DEGRADED`/`STALE`/`UNKNOWN`/`INVALID`/
`NOT_ENTITLED`), hard PAPER-only URL enforcement (`assertPaperAlpacaUrl` throws on any
non-`paper-api.alpaca.markets` host), Alpaca checks for account/equity/cash/buying-
power/options-approval/clock/calendar/stock-quotes/option-contract-discovery/OPRA
snapshots-with-Greeks/positions/activities/corporate-actions, and Optionomics checks
that only probe operations actually found in Optionomics's own published docs (never a
guessed endpoint). `src/providers/readiness-handler.ts` is a private, Bearer-token
-gated (timing-safe comparison) operator-only endpoint that unconditionally returns
`trading: 'disabled', orderSubmission: false`. `src/customer/models.ts` already
hardcodes the customer-safe projection (`automation: 'NOT_ENABLED'`, `aegis:
'UNKNOWN'`, `activation_allowed: false`) fully separate from the private readiness
check, so credentials/private broker internals were already correctly never exposed
customer-side.

**Added in this takeover pass:**
- `latencyMs`/`retrievedAt` fields on every `CheckResult`, measured per-request
  (`src/providers/readiness.ts`).
- Deduplicated the three separate hand-written configuration-failure result literals
  (`provider-readiness.ts`, `readiness-handler.ts`, and a duplicate that was in
  `readiness-handler.ts`) into one shared `configurationFailureResult()` export in
  `readiness.ts` — same behavior, one source of truth.
- `tests/readiness-checks.test.ts` — 12 new tests exercising `checkAlpaca`/
  `checkOptionomics`'s actual state-mapping behavior via mocked `fetch`: valid PAPER
  account (all GOOD), invalid credentials (401 → INVALID), missing options/market-data
  entitlement (403 → NOT_ENTITLED), provider unavailable (5xx → DEGRADED), network
  failure (→ UNKNOWN, never a fabricated default), empty vs. populated positions/
  activities, unknown/malformed account body (fields reported unreadable, never
  defaulted), and Optionomics's documented-operations-only discovery discipline
  (including explicit-null-is-a-fact-not-zero).

**Explicitly not changed, with reasoning:**
- `STALE` is declared in `CapabilityState` but never produced by any current check —
  no check function currently evaluates response-body timestamp age against a
  freshness threshold. Adding staleness detection would require a threshold/config
  decision (how stale is stale, per capability) this pass does not have grounds to
  make unilaterally — flagged here rather than silently added or silently ignored.
- `DOWN` (named in the takeover instruction's state list) was considered and not
  added: the existing `UNKNOWN` state already covers total network/connectivity
  failure, and introducing a second state with overlapping meaning without a clear,
  non-overlapping trigger condition would be exactly the kind of speculative
  complexity this repository's own discipline (`docs/quant/phase4_method_corpus/
  UNSAFE_PATTERN_REGISTRY.md`'s "opaque uncalibrated scores"/complexity-without-
  evidence caution, applied here to engineering states rather than quant scores)
  warns against. If a real distinguishing signal (e.g. a provider status page,
  or a specific error class the provider itself uses to mean "known outage") is
  identified later, `DOWN` can be added deliberately then.
- A live customer-facing readiness endpoint (calling the real Alpaca/Optionomics
  checks on a customer's behalf) was **not** built in this slice — that is Phase 2E's
  scope (customer broker connection architecture), which itself requires credential
  storage/identity architecture this pass has not yet reached. Building it early would
  risk exposing more surface area than the current secure separation supports.

**Status: substantially complete** (pre-existing + this pass's additions). Remaining
before this slice can be called fully done: staleness detection design decision (not
made here, flagged above), and the `iv_change_since_entry`/`rv_change_since_entry`-
style freshness signal if a future capability needs it.

## Phase 2B-quant / 2C-quant — management/AEGIS/sizing/execution decision models

**Status: IMPLEMENTED (transparent baselines, per MODEL-001).** Built directly in
Python (`bots/theta/quant/models/`) rather than in TypeScript, because the TS runtime
plumbing (Phase 2B/2C's orchestration layer) has nothing real to call without these
models existing first — building the TS shell first would have been hollow
scaffolding. All modules are deterministic, reason-coded, explicit-input formulas, not
fitted models; every UNKNOWN input propagates as `None`/UNKNOWN, never a fabricated
default. 66 new tests, all passing, added alongside:

- `management_action_value.py` — same-state `ManagementUtility` comparison across
  HOLD/CLOSE/EXPIRE/ROLL/ASSIGN/REDEPLOY from one shared `ManagementContext` snapshot
  (H-M-01, RETAIN). Folds `RollUtility`/`NetRollCredit` in directly (no separate roll
  evaluator module) so the "no double counting" and "same timestamp" requirements are
  enforced structurally rather than by convention across two files.
- `assignment_model.py` — H-A-01's accept-vs-mechanically-close economics.
- `recovery_decision.py` — RECOVERY_WAIT / SELL_STOCK / SELL_CC, enforcing H-A-02's
  bound-must-exist rule (no code path for unconditional waiting) and H-C-02's
  never-automatic-CC rule.
- `covered_call_ranker.py` — WAIT / SELL_STOCK / SELL_CC(candidates) frontier via
  `CCUtility`, rejecting a positive-premium CC when `CallAwayRegret` dominates.
- `aegis.py` — the full risk contract (`ALLOW_FULL`/`ALLOW_REDUCED`/
  `DEFINED_RISK_ONLY`/`HOLD_ONLY`/`HARD_VETO`) across 12 independent risk families,
  strictest-wins aggregation, and an explicit, tested **exit-supremacy action-
  permission matrix** (`is_action_permitted`) resolving the correction-audit gap in
  `docs/quant/PHASE2_4_CORRECTION_AUDIT.md` finding 6.
- `sizing.py` — tightest-cap-wins position sizing, AEGIS-gated (HOLD_ONLY/HARD_VETO
  force zero), quantity zero always legitimate, structurally incapable of
  martingale/loss-doubling (no "recent losses" input exists at all).
- `execution_quality.py` — deterministic fill/slippage heuristic baseline, slippage
  measured against the ask (never midpoint), cancels rather than crossing blindly when
  after-cost utility turns negative.

**Also fixed:** `research/candidate_actions.py`'s `CandidateAction` enum was missing
`CALL_AWAY`, even though the runtime-schema docstring at the top of that same file
already named it as a `management_action` value — a real, pre-existing gap, now closed
(with `research/registry.py`'s duplicate validation set and its test updated to match).

**Not yet done:** the TypeScript orchestration layer that would call these models at
runtime (Phase 2C's remaining wiring), reconciliation/ledger (2D), customer broker
architecture (2E), copy engine (2F/2G), UI (3), and empirical/replay engineering (4).

## Phase 2D-2G, Phase 3A-3D, Phase 4

Not started in this takeover pass. See the final takeover report (chat) for an honest
accounting of what remains and why a single-pass "complete everything" claim would not
be credible for security/financial-critical surfaces (broker OAuth, execution state
machine, copy-trading fund flows) this session has not yet built or reviewed.
