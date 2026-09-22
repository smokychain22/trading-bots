# THETA management end-to-end graph

Status: Slice 6 of the pre-VPS master continuation directive. Grounded in a
dedicated research fork's direct reads of `paper-bootstrap-management-policy.ts`,
`management-cycle.ts` and its orchestrator family, `recovery-state.ts`,
`management-action-frontier.ts`, and function-level call-graph tracing (not
just file-level greps).

## Two architectures, one real

- **`management-cycle.ts` + `assignment-orchestrator.ts`/`recovery-orchestrator.ts`/
  `covered-call-orchestrator.ts`/`covered-call-management-orchestrator.ts`/
  `management-orchestrator.ts`**: **QUARANTINED, confirmed via function-level
  call-graph tracing this pass** (`grep -rln "runAssignmentOrchestration|runRecoveryOrchestration|runCoveredCallOrchestration|runCoveredCallManagementOrchestration|runManagementOrchestration"`)
  -- every one of these functions is called only by `management-cycle.ts` or
  by each other. Zero real Production callers anywhere
  (`autonomous-runtime.ts`, `theta-shadow-cycle.ts`, `new-risk-orchestrator.ts`,
  `src/execution/*` never reference any of them).
- **`paper-bootstrap-management-policy.ts::evaluatePaperBootstrapManagementPolicy`**
  (via `PaperBootstrapManagementPolicyProvider`, called from
  `autonomous-runtime.ts:353`): **REAL, RUNTIME_REACHABLE** -- this is the one
  true management authority.

## Per-action trace

| Action | Real producer (file:line) | Real candidate source? | Runtime reachable | Paper-plan capable | Accounting capable |
| --- | --- | --- | --- | --- | --- |
| HOLD / HOLD_CC | `paper-bootstrap-management-policy.ts:681-724` | N/A (no candidate needed) | YES | YES | YES |
| CLOSE_FULL / CLOSE_CC | `paper-bootstrap-management-policy.ts` (`case 'CLOSE_FULL'` region) | N/A -- uses real current mark/DTE | YES | YES | YES |
| **ROLL** | `:850-855`, delegates to `valueForSingleRollCandidate` (`:382`) when the array-based `state.rollCandidates` is empty | **NO** -- `state.rollCandidate` is always `null` in Production. **Refined finding this pass: the ARRAY-based fields (`rollCandidates`/`ccCandidates`/`rollCcCandidates`) are ALSO never populated anywhere in the real codebase outside the policy file's own type definitions** -- this is not just the singular-field stub previously documented, it is two entirely separate unpopulated mechanisms. Real result when blocked: `UNKNOWN_VALUE` with reason `NO_IDENTIFIED_ROLL_TARGET` (`:391`) -- honestly UNKNOWN, never fabricated. | **BLOCKED (P0)** | Blocked by the same gap | N/A |
| **ROLL_CC** | Same mechanism (`:856-860`) | **NO** -- same gap | **BLOCKED (P0)** | Blocked | N/A |
| RECOVERY_WAIT | `:726-771` | N/A | YES -- real, self-contained, uses `buildRecoveryState` (`recovery-state.ts:132`, backed by real `computeEffectiveStockBasis`) | YES | YES |
| ACCEPT_ASSIGNMENT / LET_EXPIRE | Deferred to `atStructuralExpirationCutoff` (`:332-335`) + real broker-truth moneyness gating (`management-action-frontier.ts:128-134`) | N/A (structural, not economic) | YES -- real, moneyness-driven, feasibility-gated, but utility is a deliberate flat 0 (`DEFERRED_TO_STRUCTURAL_EXPIRATION_HANDLING`) -- **STRUCTURAL_ONLY, not economically optimized, by design** | YES for the structural decision | YES |
| ALLOW_CALL_AWAY | Same structural mechanism (`management-action-frontier.ts:138`), plus real whole-chain call-away P&L computed as an informational reason (`:862-899`, reuses `computeWholeChainPnl`) | N/A | YES, same caveat as above | YES | YES -- real whole-chain P&L reused, not reinvented |
| SELL_STOCK | `:912-960` | N/A -- explicitly does NOT require basis to be known (deliberate documented fix: "must not refuse to sell bad stock merely because accounting history is incomplete") | YES, real and reachable | YES | YES -- separates canonical vs. reference-basis P&L honestly |
| **SELL_CC** | `:973-1041` | **NO** -- same array/singular candidate gap as ROLL. Real result when blocked: `UNKNOWN_VALUE`/`NO_IDENTIFIED_CC_CANDIDATE` (`:987`) | **BLOCKED (P0)** | Blocked | N/A |
| REDEPLOY | `:1041+` (not fully read this pass) | Not fully verified | Not fully verified | -- | -- |

## Refined P0 finding (sharper than any prior pass)

The roll/CC candidate-source gap is **worse than previously documented**: TWO
separate unpopulated mechanisms exist (the array-based
`rollCandidates`/`ccCandidates`/`rollCcCandidates` fields AND the singular
`rollCandidate`/`ccCandidate` fields), and **neither is ever populated
anywhere in the real codebase outside the policy file's own type
definitions**. This blocks ROLL, ROLL_CC, **and** SELL_CC -- not just one
action as earlier passes framed it. The UNKNOWN reporting itself remains
correctly honest throughout (never fabricates a target) -- this is purely a
wiring gap, not a masking defect.

## Confirmed positive findings (do not let the P0 above obscure these)

- **SELL_CC's real logic (when reachable) already refuses to write a covered
  call below cost basis** (`CC_STRIKE_BELOW_KNOWN_COST_BASIS_REJECTED` /
  `CC_STRIKE_BELOW_RECORDED_REFERENCE_REJECTED`, `:1003-1009`) -- it does
  **NOT** blindly sell a CC merely because stock was assigned. This directly
  answers the audit's specific question: the safety logic is real, only
  currently unreachable.
- **`valueForSingleRollCandidate` correctly honors "roll = close-old +
  open-new, old P&L immutable"** -- the code explicitly comments that sunk
  (already-realized) economics are deliberately NOT read in this block, so
  the old leg's realized P&L cannot be silently re-added into the roll's
  forward comparison. Real, correct, currently unreachable only because of
  the candidate-source gap, not because the formula is wrong.

## Not verified this pass (flagged for follow-up)

- Whether `state.wholeChainComponents`/`input.context.assignmentCapacity` are
  actually populated with real data by the real Production call path into
  `PaperBootstrapPolicyInput`/`ManagementInputState` -- the formulas that
  consume them are real, but this pass did not trace their construction back
  to the real `autonomous-runtime.ts` cycle.
- `thesis-invalidation.ts` internals -- referenced by the profit/loss audit,
  not opened directly this pass.
