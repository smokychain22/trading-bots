# THETA avoidable-unknown reclassification (Wave 10 Batch 1)

The prior audit's `AVOIDABLE_UNKNOWN_COUNT=10` mixed fundamentally
different things: a real first-Paper blocker, optional unused ranking
intelligence, a shadow-only/R8-scope item, an intentionally quarantined
architecture, and normal pipeline behavior that was never actually
"unknown." A single count across those categories cannot answer "what can
actually stop first Paper," which is the only question that matters here.
This reclassifies each item individually, using real source semantics,
not the label it happened to get in the prior pass.

## Q-9 recheck result (done first, as instructed)

**Q9_VERDICT: FALSE_POSITIVE.** Confirmed by direct re-read of
`src/theta/autonomous-runtime.ts`, `src/theta/management-input-state.ts`,
and `src/theta/paper-bootstrap-management-policy.ts` together:

- `ProductionPaperManagementCandidateSource.discover()` → `candidateDiscovery`
  → `assembleAndPersistOpenChains(..., candidateDiscovery)` →
  `ManagementInputState.managementCandidateDiscovery` (real, persisted).
- `PaperBootstrapManagementPolicyProvider.evaluate(state)` reads
  `state.managementCandidateDiscovery` directly (line 1139), and when
  `discovery.state === 'READY'` and quotes are PIT-timely
  (`targetQuotesTimely`, lines 1144-1152), uses
  `discovered.rollCandidates`/`ccCandidates`/`rollCcCandidates` --
  **independent of** `this.candidates` (the constructor argument that
  defaults to `noCandidates`).
- **ROLL_ARRAY_REACHABILITY**: REAL -- `valueForRollFromCandidates` is
  called whenever `state.rollCandidates !== undefined && state.rollCandidates.length > 0`
  (`paper-bootstrap-management-policy.ts:828-829`).
- **SELL_CC_ARRAY_REACHABILITY**: REAL -- `valueForSellCcFromCandidates`
  is called whenever `state.ccCandidates !== undefined && state.ccCandidates.length > 0`
  (`paper-bootstrap-management-policy.ts:951`).
- **ROLL_CC_ARRAY_REACHABILITY**: REAL -- same pattern at line 834-835
  for `valueForRollCcFromCandidates`.

The `noCandidates` default only affects `valueForSingleRollCandidate`
(lines 365-420) and the singular fallback at line 962-970 -- both of
which only run when the real array is empty/undefined, i.e. when
discovery genuinely found zero candidates or wasn't `READY`/PIT-timely.
**No exact remaining action requires the singular candidate as its only
source with no array alternative.** `ROLL_CC_CANDIDATE_SOURCE` and
`ROLL_CC_CANDIDATE_VALUATION` corrected to `REAL` in the capability
registry; Q-9 retracted from the Codex queue.

## Reclassification of the prior "10 avoidable unknowns"

| Item | Prior label | Corrected classification | Why |
|---|---|---|---|
| `UNDERLYING_RANKING` | `DATA_EXISTS_BUT_NOT_CONSUMED` | `CLOSED` (baseline) + `OPTIONAL_UNUSED_INTELLIGENCE` (challengers) | `avgDollarVolume` is a real, deterministic, functioning ranking metric -- a `REAL_BASELINE`, not a `PLACEHOLDER_DEFECT` (it is simple, not fake). It is wired and consumed today. Improved research rankers exist but are optional, not a first-Paper blocker. |
| `AEGIS_SECTOR_CORRELATION` | `DATA_EXISTS_BUT_NOT_WIRED` | `SHADOW_R8_GAP` (multi-position case) | Real for exactly one held underlying (the common early-Paper case: THETA holds few positions at a time). A true multi-position sector/correlation producer matters at portfolio scale, which is beyond first-Paper's initial scope -- not confirmed a hard blocker for the first cycles, deferred rather than asserted either way without a deeper trace this pass didn't do. |
| `CROSS_STRATEGY_ECONOMIC_COMPARISON` | `DATA_EXISTS_BUT_NOT_WIRED` | `SHADOW_R8_GAP` | Only matters when multiple branches (Q/H/D) are simultaneously live candidates. H/D remain research-only/shadow (`docs/operations/THETA_IMPLEMENTATION_BOARD.md`'s "Strategy authority" row) -- with only THETA_Q live, there is no cross-branch tie to resolve yet. This is real, correctly-scoped R8/shadow research, not a first-Paper blocker. |
| `AEGIS_EVALUATION` | `DATA_EXISTS_BUT_NOT_CONSUMED` | `NORMAL_PIPELINE_NOT_EVALUATED` | A candidate that never survives the upstream feasible/Pareto stage correctly never reaches AEGIS -- `NOT_EVALUATED` is the right outcome, not an implementation unknown. This was miscounted as "avoidable" in the prior pass; it is not. |
| `EVENT_RISK_STATE` | `DATA_EXISTS_BUT_NOT_CONSUMED` | **NOT FULLY RESOLVED** -- flagged, not guessed | This may remain a genuine first-Paper integration concern (per this wave's own instruction to trace it precisely). This pass did not complete that precise trace (whether the two real Production consumers ever receive a real non-`UNKNOWN` determination vs. always defaulting to `UNKNOWN`) -- left open, honestly, rather than assigned a confident label without the evidence to back it. |
| `RECOVERY_LIFECYCLE` | `DATA_EXISTS_BUT_NOT_WIRED` | `INTENTIONALLY_QUARANTINED` (Python contract) + `SHADOW_R8_GAP` (TS canonical branch) | `recovery_contract.py`'s `QUARANTINED` disposition (Wave 7) stands -- it belongs to the already-rejected Pipeline B, correctly not wired. The REAL recovery authority is the canonical TS `THETA_RECOVERY` branch (`strategy-package.ts`, `status: 'SHADOW'`) -- real, structurally complete, not yet Paper-authorized. That is a shadow/R8-maturity question, not an avoidable Production unknown caused by the quarantined Python contract. |
| `VOLATILITY_SURFACE` | `DATA_EXISTS_BUT_NOT_WIRED` | Split: `FIRST_PAPER_IMPLEMENTATION_BLOCKER` (IV-stress evidence, folds into the AEGIS stress gap below) + `OPTIONAL_UNUSED_INTELLIGENCE` (RV/VRP/skew/term/GEX/flow ranking) | The AEGIS-feeding IV-stress evidence is the SAME underlying gap as `AEGIS_SYSTEM_LIQUIDITY_STRESS` below -- not double-counted. The broader ranking-intelligence half (RV5/10/30/60, VRP, skew, term, GEX, flow as candidate rankers) is real, useful, and NOT required to open a first Paper trade -- it is a soft-ranking enhancement, correctly `OPTIONAL_UNUSED_INTELLIGENCE`. |
| `ROLL_CC_CANDIDATE_SOURCE` / `ROLL_CC_CANDIDATE_VALUATION` | `DATA_EXISTS_BUT_NOT_WIRED` / `IMPLEMENTATION_DEFECT` | `CLOSED` | Q-9 correction above -- both real and reachable. |
| `AEGIS_SYSTEM_LIQUIDITY_STRESS` | `IMPLEMENTATION_DEFECT` | `FIRST_PAPER_HARD_SAFETY` (genuine blocker, correctly hard) | Confirmed by this wave's own instruction: "Genuine first-Paper blocker until producers exist." `_system()` requires 3 non-None stress signals; 2 of 3 (`stressIvShockDetected`/`stressSpreadWideningDetected`) are always `None`, forcing `new_risk_state` to `HOLD_ONLY` or worse on every real evaluation. This correctly fails safe (never silently permissive) -- it is real safety behavior, not a bug, but it IS the reason the SYSTEM AEGIS family can never fully evaluate today. Already Q-6 in the Codex queue. |
| `ASSIGNMENT_CAPACITY` | (moved out already in Wave 9) | `CLOSED` | Confirmed real, Codex-closed (main `b9cd49a`/`e64d554`/`6a359a0`/`52e6ea5`). |

## Final counts (per this wave's requested taxonomy)

```
FIRST_PAPER_IMPLEMENTATION_BLOCKER_COUNT = 0 (the one candidate, AEGIS stress, is more precisely FIRST_PAPER_HARD_SAFETY -- see below; no item this pass found is a pure "unfinished wiring" blocker)
FIRST_PAPER_HARD_SAFETY_COUNT = 1 (AEGIS_SYSTEM_LIQUIDITY_STRESS -- correctly fails safe, still blocks full SYSTEM-family evaluation until real detectors exist)
OPTIONAL_UNUSED_INTELLIGENCE_COUNT = 2 (UNDERLYING_RANKING challengers, VOLATILITY_SURFACE ranking half)
SHADOW_R8_GAP_COUNT = 3 (CROSS_STRATEGY_ECONOMIC_COMPARISON, RECOVERY_LIFECYCLE's TS canonical branch, AEGIS_SECTOR_CORRELATION multi-position case)
INTENTIONALLY_QUARANTINED_COUNT = 1 (recovery_contract.py, and by the same Wave 7 disposition research, covered_call_contract.py/management_contract.py -- not re-counted individually here, already closed with no action in the queue)
NORMAL_PIPELINE_NOT_EVALUATED_COUNT = 1 (AEGIS_EVALUATION -- was never actually unknown)
CLOSED_COUNT = 3 (ROLL_CC_CANDIDATE_SOURCE, ROLL_CC_CANDIDATE_VALUATION, ASSIGNMENT_CAPACITY)
NOT_FULLY_RESOLVED_COUNT = 1 (EVENT_RISK_STATE -- honestly flagged, not guessed)

Total items reclassified = 9 (the original 10 minus the ROLL_CC pair now
counted together as CLOSED, per the Q-9 correction)
```

**The one real number that answers "what can actually stop first Paper"
from this reclassification: 1** (`AEGIS_SYSTEM_LIQUIDITY_STRESS`, and it
is a correct fail-safe, not a defect -- the fix is building real
detectors, already tracked as Q-6). Everything else in the original
"avoidable 10" was either already closed, intentionally out of first-
Paper scope (shadow/R8), intentionally quarantined, or never actually
unknown in the first place.
