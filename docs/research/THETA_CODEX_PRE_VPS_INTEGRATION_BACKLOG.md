# THETA Codex pre-VPS integration backlog (rebuilt, Slice 14)

Status: Rebuilt after Slice 1 + the full Slice 2-13 pass of the pre-VPS
master continuation directive. Supersedes the Slice-1-only version of this
document (kept in git history, not deleted). Every item is real,
source-grounded, discovered on the research branch
(`claude/theta-management-challenger`). Nothing here has been applied to
Production -- `PRODUCTION_RUNTIME_CHANGED = NO`, `BROKER_MUTATIONS = 0`
throughout. Codex decides integration; this is a handoff, not a change.

## P0_FIRST_PAPER_BLOCKER

### P0-0: AEGIS unconditionally returns HOLD_ONLY for ALL new-risk actions today -- PROMOTED from P1, this is now the single most severe P0 in this backlog

- **Defect ID**: P0-0
- **Source**: `bots/theta/quant/models/aegis.py:129-135` (`_liquidity()`), `:155-166` (`_system()`), `:172-193` (`assess_aegis()`'s worst-family-wins fold), `:203-209` (`_NEW_RISK_ACTIONS_BY_STATE`); `src/theta/account-exposure.ts` (real Production supplier of the two always-null inputs)
- **Current behavior**: Verified via a direct, line-by-line Python read this pass (not a fork summary): `_liquidity()` returns `HOLD_ONLY` whenever `stress_spread_widening_detected is None`; `_system()` returns `HOLD_ONLY` whenever ANY of its 3 stress inputs is `None`. Both `stress_iv_shock_detected` and `stress_spread_widening_detected` are confirmed always `None` in the real Production path. `assess_aegis()` folds every family through `_worse()` (strictest state wins), so `new_risk_state` is **provably `HOLD_ONLY` or worse on every real evaluation today**. `_NEW_RISK_ACTIONS_BY_STATE[RiskState.HOLD_ONLY] = frozenset()` -- confirmed by direct read of the literal dict: an empty set. **This means AEGIS permits ZERO new-risk-opening actions (OPEN_CSP, SELL_CC, ROLL, OPEN_DEFINED_RISK_SPREAD) unconditionally, on every cycle, regardless of every other family's real state, and entirely independent of P0-2 (`CONTRACT_NOT_EXECUTABLE`).** Even if P0-1 and P0-2 are both fixed, THETA would still open zero new positions until this closes. Exit supremacy (CLOSE/CANCEL/RECONCILE/BUY_TO_CLOSE/REDUCE_POSITION/SAFETY_EXIT) is real and completely unaffected by this gap.
- **Expected behavior**: Real IV-shock and spread-widening detectors feeding `stress_iv_shock_detected`/`stress_spread_widening_detected`, OR an explicit, committed governance decision (not a silent omission) on an acceptable interim policy for first Paper.
- **Producer/consumer**: Producer missing entirely for both fields; consumer (`_liquidity()`/`_system()`/`assess_aegis()`) is real, correct, and fail-closed by design -- this is not a masking defect, it is an honestly-represented missing-producer gap with an unusually severe blast radius.
- **Minimal fix**: Build the two real detectors (Optionomics IV history for IV-shock; Alpaca BBO history for spread-widening); OR Codex commits an explicit different first-Paper applicability policy (per this directive's own instruction: "unless Codex commits a different first-Paper applicability policy").
- **Tests required**: A test proving `assess_aegis()` reaches a real, non-permanently-`HOLD_ONLY` state once the governed inputs are real; a regression test asserting exit-supremacy actions remain unaffected throughout.
- **Acceptance proof**: `THETA_PRE_VPS_ACCEPTANCE.md`'s `AEGIS_NO_AVOIDABLE_UNKNOWN` gate reads MET.
- **Priority**: P0 -- do not leave this at P1; it mathematically forces `HOLD_ONLY` for all new risk, unconditionally, today.

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

(AEGIS SYSTEM/LIQUIDITY stress signals were previously listed here as P1-1 --
**promoted to P0-0 above** this pass, since they mathematically force
`HOLD_ONLY` for all new risk unconditionally, not merely leave one family
unevaluated. Do not re-list it here at P1.)

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

**Resolved this pass (Wave 3), no longer open**: strategy router internals
(`THETA_STRATEGY_ROUTER_DEEP_TRACE.md` -- the Python router IS multi-family
capable, TS control flow only acts on THETA_Q); `thesis-invalidation.ts`
internals (`THETA_LOSS_CAUSE_RESOLUTION_MATRIX.md` -- 4 of 8 directive-named
causes drive the real classification, with exact per-cause evidence); the
AEGIS-consumed `assignmentCapacityUsedPct` real population
(`THETA_ASSIGNMENT_CAPACITY_TRACE.md` -- confirmed real and computed; a
SEPARATE opaque `ManagementInputState.context.assignmentCapacity` field's
producer remains unconfirmed, see below).

**Still open**:
- `IV_EXPANSION`/`LIQUIDITY_DETERIORATION`/`EXECUTION_DETERIORATION` loss causes are computed as real `LossStateVector` data but not yet read by `assessThesisInvalidation`'s classification logic at all -- a real, scoped wiring gap (not a producer-missing gap), see `THETA_LOSS_CAUSE_RESOLUTION_MATRIX.md`.
- The `riskState` object supplying `ManagementInputState.context.assignmentCapacity` (the opaque passthrough field, distinct from the real `assignmentCapacityUsedPct`) was not located this pass.
- `policy.theta_d_gate_satisfied`'s real supplied value at the Python bridge invocation site was not traced.
- Whether `opportunity_frontier.py`/`management_action_value.py` ever perform a cross-branch economic comparison (the router itself explicitly does not) was not independently verified.
- Optionomics `expected_move` field: `NOT_OBSERVED` this pass; needs a targeted follow-up search under alternate field names before concluding it's absent.
- `rv5`/`rv10`/`rv30`/`rv60` methodology verification against `price_history`'s substitute figure.
- Canonical exports for IV/spread, universe breadth, correlation, severe downside, management outcomes, cross-strategy outcomes -- see `THETA_CODEX_CANONICAL_EXPORT_REQUESTS.md` for exact specifications and priority ordering. Consumer implementations for these remain unbuilt (Wave 3 directive items 12-13 not completed this pass -- see the scope/plan doc).
- `src/providers/capability-registry.ts` (discovered to exist in an earlier pass, still not read) should be reconciled with this engagement's own `src/research/pre-vps-capability-registry.ts` rather than maintaining two independent inventories long-term.
- Correlation (20/60/120-session) and severe-downside (continuous/vol-normalized MAE) research tooling remain unbuilt (Wave 3 directive items 11-12).
- A standalone required-vs-optional evidence matrix, a full method/config usage census, and full capability-registry/unknown-ledger exhaustiveness (Wave 3 directive items 2-5) remain unbuilt at full scope -- see `THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md` for the honest reasoning on why a genuinely exhaustive pass was not attempted in one turn.

## P3_FUTURE_ENHANCEMENT

- `management-cycle.ts` and its full orchestrator family remains real, tested, and quarantined with zero callers -- Codex should explicitly adopt (replacing, never running alongside) or formally retire it.
- `cross-symbol-economic-frontier.ts:157-158`'s `paretoEntry?.survivesFrontier ?? false` fallback should never actually trigger for a well-formed input; worth a defensive assertion/log.
- A prior-pass doc comment (`theta-shadow-once.ts:19`) claiming "the only /v2/orders reference in the whole provider layer is fetchOpenOrders" should be tightened -- it is true only of `alpaca-provider.ts`; a real, separate, gated order-submission capability exists in `src/execution/broker.ts`.

## Current known issues that must remain tracked (per directive, verbatim status)

| Issue | Status |
| --- | --- |
| Roll/CC candidate source missing in canonical Production path | OPEN -- P0-1 |
| `CONTRACT_NOT_EXECUTABLE` dominant real-session rejection | OPEN -- P0-2, refined this pass to a 10-condition gate |
| `stressIvShockDetected` producer | OPEN -- **P0-0, promoted this pass**: confirmed to unconditionally force `new_risk_state = HOLD_ONLY` |
| `stressSpreadWideningDetected` producer | OPEN -- **P0-0, promoted this pass**: same, and independently forces the LIQUIDITY family to `HOLD_ONLY` on its own |
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
