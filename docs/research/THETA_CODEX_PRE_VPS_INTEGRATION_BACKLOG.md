# THETA Codex pre-VPS integration backlog (rebuilt, Slice 14)

Status: Rebuilt after Slice 1 + the full Slice 2-13 pass of the pre-VPS
master continuation directive. Supersedes the Slice-1-only version of this
document (kept in git history, not deleted). Every item is real,
source-grounded, discovered on the research branch
(`claude/theta-management-challenger`). Nothing here has been applied to
Production -- `PRODUCTION_RUNTIME_CHANGED = NO`, `BROKER_MUTATIONS = 0`
throughout. Codex decides integration; this is a handoff, not a change.

## P0_FIRST_PAPER_BLOCKER

### P0-1: Roll/CC candidate source is never wired -- blocks ROLL, ROLL_CC, AND SELL_CC (sharper than previously documented)

- **Defect ID**: P0-1
- **Source**: `src/theta/autonomous-runtime.ts:353`; `src/theta/paper-bootstrap-management-policy.ts:1127-1158` (both the singular `rollCandidate`/`ccCandidate` fields AND the array-based `rollCandidates`/`ccCandidates`/`rollCcCandidates` fields)
- **Current behavior**: `createPaperBootstrapManagementPolicyProvider()` is called with zero arguments; ALL candidate mechanisms (singular and array-based) resolve to empty/null in every real call, confirmed via a repo-wide grep this pass finding zero real population sites outside the policy file's own type definitions.
- **Expected behavior**: A real `PaperBootstrapCandidateSource` implementation enumerating live roll/CC candidates from the current contract lattice.
- **Producer/consumer**: Producer missing entirely; consumer (`evaluatePaperBootstrapManagementPolicy` and its real, tested valuation functions, including a confirmed real safety rule rejecting CC strikes below cost basis) is real and ready.
- **Minimal fix**: Implement and wire a real `PaperBootstrapCandidateSource` at the `autonomous-runtime.ts:353` call site (a research-only reference implementation exists at `src/research/paper-bootstrap-candidate-source.ts`).
- **Tests required**: Integration test with a real open CSP chain and a real roll candidate in the live lattice, proving ROLL is proposed when economically justified; same for SELL_CC.
- **Acceptance proof**: `THETA_PRE_VPS_ACCEPTANCE.md`'s `MANAGEMENT_CANDIDATES_REAL` gate reads MET.
- **Priority**: P0.

### P0-2: `CONTRACT_NOT_EXECUTABLE` root cause -- refined this pass, but still open

- **Defect ID**: P0-2
- **Source**: `src/theta/option-contract.ts:210-224` (the real 10-condition executability gate, not just the multiplier check previously suspected), `src/theta/option-chain-ingestion.ts:139-161`
- **Current behavior**: 3,299/3,876 real candidates rejected `CONTRACT_NOT_EXECUTABLE` in the only real session available. The dominant condition is now hypothesized (not confirmed) to be unquoted contracts in a wide-lattice scan (4 of 10 conditions fail simultaneously for a never-quoted contract), not specifically the multiplier mapping.
- **Expected behavior**: Determined by the verification steps below, not asserted here.
- **Minimal fix**: **No code change proposed until verification completes.** See `THETA_CONTRACT_NOT_EXECUTABLE_INVESTIGATION.md` for the exact two-step Codex verification request: (1) group the ALREADY-PERSISTED `reasons[].detail` strings for the 2026-09-21 session's `CONTRACT_NOT_EXECUTABLE` rows by cause -- requires no new Alpaca call, only Aiven read access once writes are restored; (2) separately pull one live contract-fetch sample to confirm `size`/multiplier field behavior on a healthy session.
- **Tests required**: A real, read-only Alpaca contract-fetch test on a healthy session, per the investigation doc.
- **Acceptance proof**: `THETA_PRE_VPS_ACCEPTANCE.md`'s `QUOTE_FRESHNESS_REAL` gate's open caveat is resolved either way (confirmed defect and fixed, or confirmed non-defect and documented).
- **Priority**: P0.

## P1_PRE_VPS_BLOCKER

### P1-1: AEGIS SYSTEM-family stress signals -- refined this pass: forces a permanent `HOLD_ONLY`, not merely "unevaluated"

- **Source**: `bots/theta/quant/models/aegis.py:157-158` (`_worse()` worst-family-wins design), `src/theta/account-exposure.ts`, `src/theta/aegis-derivation.ts:24-27`
- **Current behavior**: Confirmed this pass: any one of the 3 SYSTEM stress signals being `None` forces `HOLD_ONLY` for the WHOLE AEGIS assessment every cycle -- a continuous, permanent restrictive contribution, not just an unevaluated family.
- **Minimal fix**: Build real IV-shock (Optionomics) and spread-widening (Alpaca BBO history) detectors; OR make an explicit, committed governance decision on an acceptable interim threshold.
- **Tests required**: A test proving the SYSTEM family reaches a real evaluated state once the governed threshold is real.
- **Priority**: P1.

### P1-2: Multi-position sector/correlation concentration -- unchanged

- **Source**: `src/theta/account-exposure.ts` (`soleRiskGroup` proxy, real only for exactly one held underlying)
- **Minimal fix**: Build real multi-position sector classification + correlation-cluster computation.
- **Priority**: P1 (only bites once THETA holds 2+ positions).

### P1-3: Cross-branch Pareto/economic comparison does not exist -- refined this pass: currently latent, not actively triggering

- **Source**: `src/theta/canonical-strategy-frontier.ts:428,452`
- **Current behavior**: Confirmed this pass via the strategy router truth trace: only one branch's candidates ever coexist in the live pipeline today (THETA_Q always; THETA_CC only when stock is held, a different lifecycle phase), so this gap is currently non-triggering in practice. It becomes live the moment a second branch's entry-candidate generation is ever built.
- **Minimal fix**: Fix proactively before Hold-Strike/Defined-Risk candidate generation is ever added (see P1-4), rather than discovering it reactively.
- **Priority**: P1.

### P1-4: No real entry-candidate generation exists for THETA_HOLD_STRIKE or THETA_DEFINED_RISK anywhere in the live pipeline -- NEW finding this pass

- **Source**: `src/theta/theta-shadow-cycle.ts:791-859` (`optionTypes = hasPotentialCoveredStock ? ['put','call'] : ['put']` -- no multi-leg spread construction, no distinct short-DTE lattice)
- **Current behavior**: Their `RESEARCH_ONLY` registry status is enforced twice over: once by the registry, and independently by a total absence of any candidate producer. This is more severe than "registry blocks Paper" -- it means these branches cannot even be shadow-evaluated today.
- **Minimal fix**: Build real candidate-generation paths for these branches if/when they are meant to graduate beyond pure research.
- **Priority**: P1 (only matters once graduation is intended; does not block first Conventional Paper).

## P2_R8_REQUIRED

- Strategy router internals: `bots/theta/quant/models/strategy_router.py` was never opened this pass -- whether the Python router itself internally evaluates all 5 families (and the TS caller simply discards the rest) or is itself THETA_Q-centric remains unconfirmed.
- `thesis-invalidation.ts` internals: whether `assessThesisInvalidation` truly distinguishes all 8 directive-required loss-deterioration causes, or collapses some together, remains unconfirmed.
- `input.context.assignmentCapacity` real population: whether the real Production runtime ever supplies a live number here, vs. it always being UNKNOWN, remains unconfirmed.
- Optionomics `expected_move` field: `NOT_OBSERVED` this pass; needs a targeted follow-up search under alternate field names before concluding it's absent.
- `rv5`/`rv10`/`rv30`/`rv60` methodology verification against `price_history`'s substitute figure.
- Canonical exports for IV/spread, universe breadth, correlation, severe downside, management outcomes, cross-strategy outcomes -- see `THETA_CODEX_CANONICAL_EXPORT_REQUESTS.md` for exact specifications and priority ordering.
- `src/providers/capability-registry.ts` (discovered to exist this pass, not yet read) should be reconciled with this engagement's own `src/research/pre-vps-capability-registry.ts` rather than maintaining two independent inventories long-term.

## P3_FUTURE_ENHANCEMENT

- `management-cycle.ts` and its full orchestrator family remains real, tested, and quarantined with zero callers -- Codex should explicitly adopt (replacing, never running alongside) or formally retire it.
- `cross-symbol-economic-frontier.ts:157-158`'s `paretoEntry?.survivesFrontier ?? false` fallback should never actually trigger for a well-formed input; worth a defensive assertion/log.
- A prior-pass doc comment (`theta-shadow-once.ts:19`) claiming "the only /v2/orders reference in the whole provider layer is fetchOpenOrders" should be tightened -- it is true only of `alpaca-provider.ts`; a real, separate, gated order-submission capability exists in `src/execution/broker.ts`.

## Current known issues that must remain tracked (per directive, verbatim status)

| Issue | Status |
| --- | --- |
| Roll/CC candidate source missing in canonical Production path | OPEN -- P0-1 |
| `CONTRACT_NOT_EXECUTABLE` dominant real-session rejection | OPEN -- P0-2, refined this pass to a 10-condition gate |
| `stressIvShockDetected` producer | OPEN -- P1-1 |
| `stressSpreadWideningDetected` producer | OPEN -- P1-1 |
| Multi-position sector concentration | OPEN -- P1-2 |
| Multi-position correlation concentration | OPEN -- P1-2 |
| Cross-branch Production economics / alphabetical tie | OPEN -- P1-3, confirmed currently latent |
| Prospective earnings coverage | NOT INDEPENDENTLY RE-VERIFIED this pass |
| `eventNear` semantics | NOT INDEPENDENTLY RE-VERIFIED this pass |
| `prospectiveKnownAt` semantics | NOT INDEPENDENTLY RE-VERIFIED this pass |
| Corporate-action negative assurance | NOT INDEPENDENTLY RE-VERIFIED this pass (corporate-action evidence itself confirmed real and persisted) |
| Old running worker SHA vs. current main | Per the R7 forensic: pinned worker `853beb4f...` vs. canonical main `f5bb9d69...` at forensic time -- confirmed a real gap between deployed and canonical at that snapshot; current gap size not re-measured this pass |
| Aiven health / write state | Per the R7 forensic: `default_transaction_read_only=on`, degraded; Codex actively working recovery via recent DR commits on `main` |
| Literal canonical research exports | Most remain `AWAITING_CANONICAL_EXPORT` -- see `THETA_CODEX_CANONICAL_EXPORT_REQUESTS.md` |
