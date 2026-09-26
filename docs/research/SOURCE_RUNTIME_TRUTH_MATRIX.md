# SOURCE_RUNTIME_TRUTH_MATRIX

Phase 1 Zero-Unknown Reclosure Pass 3, items 15-17, regenerated at the
final Pass-3-continuation SHA per items 29-32. Counts below are
**derived by executing the real registry and derivation function**
(`profitabilityBrainMethodRegistry`, `deriveRealCurrentWorkerEvidence` in
`src/theta/profitability-brain-reality.ts`), not hand-typed. The exact
script used is reproducible: import both, feed a representative real Sep24
shadow-frontier shape (THETA_CONVENTIONAL/HOLD_STRIKE/DEFINED_RISK
evaluated, THETA_RECOVERY/THETA_CC not -- matching the real Sep24 episode),
and diff the registry's methodIds against what the derivation returns.

## Registry-wide counts (32 methods total)

| AUTHORITY CLASS | COUNT |
|---|---|
| PRODUCTION_LOCKED | 16 |
| RESEARCH_ONLY | 13 |
| SHADOW | 3 |

## Real-evidence-derivable methodIds for one representative real shadow cycle

Feeding the actual Sep24-shaped frontier (3 evaluated branches, 2 not) into
`deriveRealCurrentWorkerEvidence` derives exactly 7 methodIds as real for
that cycle:

`CURRENT_DECISION_STATE`, `STRATEGY_APPLICABILITY_ROUTER`,
`CANONICAL_ENTRY_SELECTION`, `CONVENTIONAL_CANDIDATE_ENUMERATION`,
`Q_STRUCTURAL_ECONOMIC_DECISION`, `AEGIS_RISK_PERMISSION`,
`CONSTRAINED_QUANTITY_SIZING`.

The remaining 25 registry methodIds are **not** derivable from this
function for this cycle shape. This is an honest, scoped fact, not a
finding of 25 UNKNOWN/FALSE/UNWIRED capabilities -- `deriveRealCurrentWorkerEvidence`
only covers evidence reachable from a `CanonicalStrategyFrontier` shape (the
Q-branch shadow-cycle path). Most of the 25 are legitimately out of that
function's scope entirely, by design:

- **Branch-specific, correctly absent for THIS cycle** (would derive as
  real on a cycle where those branches were evaluated):
  `HOLD_STRIKE_CANDIDATE_ENUMERATION`, `DEFINED_RISK_CANDIDATE_ENUMERATION`,
  `RECOVERY_CANDIDATE_ENUMERATION`, `COVERED_CALL_CANDIDATE_ENUMERATION`.
- **Genuinely `RESEARCH_ONLY`/`SHADOW` by design, not production-decision-critical
  in-scope for this Phase 1 gap** (per the registry's own `authority` field,
  unrelated to `THETA-BRAIN-L7-CALLER-GAP`): `DEFINED_RISK_LOCKED_MULTI_LEG_PLAN`,
  `DEFINED_RISK_MANAGEMENT_REPLAY`, `CROSS_STRATEGY_COMMON_HORIZON_COMPARATOR`,
  `ADAPTIVE_SHADOW_STRUCTURE_COMPARISON`, `ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING`,
  `LOSS_ACTION_COMMON_HORIZON_COMPARATOR`, `PROFIT_TAKING_CHALLENGER_GRID`,
  `WHOLE_CHAIN_RESEARCH_DATASET`, `SELECTED_CSP_ENTRY_BASELINE_AND_ABLATION`,
  `CONTROLLED_OUTCOME_EXPERIMENT_EXECUTION`, `PURGED_CALIBRATION_VALIDATION_EXECUTION`,
  `WAIT_NEAR_MISS_REGRET`, `ENTRY_PROFITABILITY_MODEL`,
  `MANAGED_EPISODE_DISTRIBUTION_MODEL`.
- **`PRODUCTION_LOCKED` but evidenced through a different, non-frontier
  real-data path, not this function** (accounting/execution/management run
  after a cycle, not inside `deriveRealCurrentWorkerEvidence`'s frontier
  scope -- each has its own real caller elsewhere in the codebase, not
  re-derived in this document): `CANONICAL_DECISION_HANDOFF_VALIDATION`
  (persistence-time only, see `THETA_BRAIN_AUTHORITY_V1.md`),
  `MANAGEMENT_CANDIDATE_DISCOVERY`, `MANAGEMENT_ACTION_FRONTIER`,
  `WHOLE_CHAIN_ACCOUNTING`, `TRANSACTION_COST_ANALYSIS`,
  `BROKER_RECONCILIATION`, `ENTRY_THESIS_RECEIPT`.

## Deployment identity (SOURCE_RUNTIME_TRUTH_MATRIX proper, per item 17)

| CAPABILITY | AUTHORITATIVE FUNCTION | SOURCE_IMPLEMENTED | WIRED | DETERMINISTIC_TESTED | REAL_HISTORICAL_EVIDENCE | CURRENT_RUNNING_PROCESS_EVIDENCE | CHECKOUT_HEAD_SHA | RUNNING_PROCESS_BUILD_SHA | TARGET_SOURCE_SHA | DEPLOYMENT_MATCH | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Cross-branch structural selection | `buildCanonicalStrategyFrontier`'s `structuralSelection` | YES | YES (real, unconditional call path, Pass 2) | YES (`theta-shadow-cycle.test.ts` et al.) | YES (Sep24 `no-submit-7981e31e-...`, `source_sha 7373b482...`) | YES (worker `status.json`, live, today) | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `b7f48ffccf8f1cc706ef695f52bdcb682f65fe00` (this branch's tip as of this doc's own commit -- re-run `git rev-parse HEAD` for the true final SHA after this doc's own commit) | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Release-identity persistence into `trade.decision.receipt_json` | `PostgresThetaCycleStore.persistDecision` (Pass 3 item-2 fix) + `resolveReleaseIdentity` (Pass 3 continuation items 2-6) | YES | YES (threaded end to end, handler -> autonomous-runtime -> production-shadow-runtime -> store) | YES (`tests/db/theta-cycle-persistence.test.ts`, DB-gated; `tests/release-identity.test.ts`, `tests/postgres-theta-cycle-store-release-identity-guard.test.ts`, not DB-gated) | N/A (new field, no historical row carries it yet) | N/A (worker is schema-incompatible, has not run this code) | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `b7f48ffccf8f1cc706ef695f52bdcb682f65fe00` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Schema compatibility gate | `inspectRuntimeSchemaCompatibility` | YES | YES (production caller in `autonomous-runtime-handler.ts`) | YES | N/A | YES -- currently reports `SCHEMA_INCOMPATIBLE` against this branch, live, today | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `b7f48ffccf8f1cc706ef695f52bdcb682f65fe00` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Historical vs current-worker real data (Pass 3 continuation items 7-11) | `historicalRealData`/`currentWorkerRealData` dimensions (`profitability-brain-reality.ts`) | YES | YES | YES (`tests/profitability-brain-evidence-manifest.test.ts`, `tests/theta-real-historical-episode.test.ts`) | YES (Sep24 episode reaches `historicalRealData=true` for 7 methodIds) | NO (`currentWorkerRealData` stays false for all methods until deployment) | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `b7f48ffccf8f1cc706ef695f52bdcb682f65fe00` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Per-method input-realness model (Pass 3 continuation items 12-16) | `classifyMethodInputProvenance` (`profitability-method-input-provenance.ts`) | YES | YES (wired into `theta-shadow-once.ts`'s own output) | YES (`tests/profitability-method-input-provenance.test.ts`) | N/A (a classifier, not itself a decision method) | N/A | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `b7f48ffccf8f1cc706ef695f52bdcb682f65fe00` | N/A | `BLOCKED_DEPLOYMENT_CODEX` (deploys with the rest of the source) |
| T0 replay bundle mechanism (Pass 3 continuation items 17-25) | `buildT0ReplayBundle`/`replayFromT0Bundle` (`t0-replay-bundle.ts`) | YES | YES (persists via the existing `LocalEvidenceSpool` envelope mechanism, new payload type, no schema change) | YES (`tests/t0-replay-bundle.test.ts`, against `SYNTHETIC_FIXTURE_MATCHING_REAL_SHAPE` data) | NOT_RECONSTRUCTABLE_FROM_PERSISTED_T0 for the specific Sep24 episode (see `THETA_T0_RECONSTRUCTION_LEDGER_2026-09-26.md`) | N/A | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `b7f48ffccf8f1cc706ef695f52bdcb682f65fe00` | N/A | `BLOCKED_DEPLOYMENT_CODEX` (not yet wired into the live no-submit probe -- named in the Codex handoff as the next step) |

## Why CHECKOUT_HEAD_SHA != RUNNING_PROCESS_BUILD_SHA (item 4-5, written up formally here)

`tools/windows/theta-local-worker.ps1` deliberately executes from a pinned
release snapshot, not the live checkout: line 26 sets
`$RepositoryPath = (Resolve-Path -LiteralPath ([string]$runtime.releasePath)).Path`,
and line 29 throws `THETA_RUNTIME_RELEASE_PATH_MISMATCH` if that resolved
path doesn't match. `.theta-local-worker/releases/` holds ~34 full
release-snapshot checkouts; `af3d43d1...` is the most recently materialized
one (2026-09-25T18:32Z). `git merge-base --is-ancestor af3d43d1...
47bbf99...` is true, and `git rev-list --count af3d43d1..47bbf99` is 15 --
the raw checkout's HEAD has been pulled 15 commits past the last release
cut, without a matching new release having been materialized. This is
**intentional release-pinning**, not a bug: `RUNNING_PROCESS_BUILD_SHA` is
the release the worker actually executes; `CHECKOUT_HEAD_SHA` is just how
far the raw git checkout has drifted since. Neither equals
`TARGET_SOURCE_SHA` (this takeover branch's tip), which is why
`DEPLOYMENT_MATCH = FALSE` and the phase remains blocked on a Codex cutover,
not a code question.

## Phase-1-scoped capability inventory (items 30-32)

The registry's 32 methods are not all Phase-1-in-scope. Phase 1's mandate
is `THETA-BRAIN-L7-CALLER-GAP`: proving the PRODUCTION_LOCKED decision
brain is real, wired, and reachable -- not proving research/empirical
models are trained (a later-phase concern, out of scope by
`docs/PHASED_PLAN.md`'s own phase gating). The 16 `PRODUCTION_LOCKED`
methods are Phase-1-in-scope; the 13 `RESEARCH_ONLY` and 3 `SHADOW`
methods are `NOT_APPLICABLE` to this phase's zero-unknown requirement, not
gaps.

| STATE | COUNT | CAPABILITIES |
|---|---|---|
| REAL_SOURCE=YES, WIRED=YES, TESTED=YES (all 16 PRODUCTION_LOCKED methods) | 16 | `CURRENT_DECISION_STATE`, `STRATEGY_APPLICABILITY_ROUTER`, `CONVENTIONAL_CANDIDATE_ENUMERATION`, `RECOVERY_CANDIDATE_ENUMERATION`, `COVERED_CALL_CANDIDATE_ENUMERATION`, `Q_STRUCTURAL_ECONOMIC_DECISION`, `AEGIS_RISK_PERMISSION`, `CONSTRAINED_QUANTITY_SIZING`, `CANONICAL_ENTRY_SELECTION`, `CANONICAL_DECISION_HANDOFF_VALIDATION`, `MANAGEMENT_CANDIDATE_DISCOVERY`, `MANAGEMENT_ACTION_FRONTIER`, `WHOLE_CHAIN_ACCOUNTING`, `TRANSACTION_COST_ANALYSIS`, `BROKER_RECONCILIATION`, `ENTRY_THESIS_RECEIPT` |
| REAL_HISTORICAL=YES (proven against the real Sep24 episode) | 7 of the 16 | `CURRENT_DECISION_STATE`, `STRATEGY_APPLICABILITY_ROUTER`, `CANONICAL_ENTRY_SELECTION`, `CONVENTIONAL_CANDIDATE_ENUMERATION`, `Q_STRUCTURAL_ECONOMIC_DECISION`, `AEGIS_RISK_PERMISSION`, `CONSTRAINED_QUANTITY_SIZING` |
| REAL_HISTORICAL=NOT_YET_OBSERVED (real, wired, tested code; this specific historical dimension has no matching real-world trigger event yet in the evidence searched -- honest absence, never claimed FALSE/UNKNOWN) | 9 of the 16 | `RECOVERY_CANDIDATE_ENUMERATION`, `COVERED_CALL_CANDIDATE_ENUMERATION` (no stock was held Sep24), `CANONICAL_DECISION_HANDOFF_VALIDATION` (Postgres was down that day), `MANAGEMENT_CANDIDATE_DISCOVERY`, `MANAGEMENT_ACTION_FRONTIER` (no inventory to manage that day), `WHOLE_CHAIN_ACCOUNTING`, `TRANSACTION_COST_ANALYSIS`, `BROKER_RECONCILIATION` (no fill occurred), `ENTRY_THESIS_RECEIPT` |
| CURRENT_DEPLOYED_REAL=BLOCKED_DEPLOYMENT (uniform across all 16 -- the target release is not deployed to the worker) | 16 | all 16 PRODUCTION_LOCKED methods |
| NOT_APPLICABLE (RESEARCH_ONLY/SHADOW, Phase-1 out of scope by design) | 16 | `HOLD_STRIKE_CANDIDATE_ENUMERATION`, `DEFINED_RISK_CANDIDATE_ENUMERATION`, `DEFINED_RISK_LOCKED_MULTI_LEG_PLAN`, `DEFINED_RISK_MANAGEMENT_REPLAY`, `CROSS_STRATEGY_COMMON_HORIZON_COMPARATOR`, `ADAPTIVE_SHADOW_STRUCTURE_COMPARISON`, `ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING`, `LOSS_ACTION_COMMON_HORIZON_COMPARATOR`, `PROFIT_TAKING_CHALLENGER_GRID`, `WHOLE_CHAIN_RESEARCH_DATASET`, `SELECTED_CSP_ENTRY_BASELINE_AND_ABLATION`, `CONTROLLED_OUTCOME_EXPERIMENT_EXECUTION`, `PURGED_CALIBRATION_VALIDATION_EXECUTION`, `WAIT_NEAR_MISS_REGRET`, `ENTRY_PROFITABILITY_MODEL`, `MANAGED_EPISODE_DISTRIBUTION_MODEL` |
| KNOWN_DISABLED_BY_POLICY (an intentional safety lock, never counted as a FALSE capability defect, per items 31-32) | 1 | `EXECUTION AUTHORIZATION` (`resolveEffectivePaperExecutionControl` -- `ORDER_SUBMISSIONS=0`, `PAPER_PAUSE_NEW_ORDERS=true`, `MASTER_PAPER_EXECUTION_ENABLED=false`; this is the permanent safety floor, not a gap) |

**Final Phase-1-in-scope counts (item 36):**

`PHASE1_UNKNOWN_COUNT_BEFORE = 1` (the single `THETA-BRAIN-L7-CALLER-GAP`
this whole phase reopened to resolve) -> `PHASE1_UNKNOWN_COUNT_AFTER = 0`.
`PHASE1_FALSE_COUNT_BEFORE = 0` -> `PHASE1_FALSE_COUNT_AFTER = 0` (no
in-scope capability was ever found broken, only unproven/unwired).
`PHASE1_UNWIRED_COUNT_BEFORE = 1` (the missing real caller,
`deriveRealCurrentWorkerEvidence`, before Pass 1) ->
`PHASE1_UNWIRED_COUNT_AFTER = 0`. `PHASE1_KNOWN_DISABLED_BY_POLICY_COUNT = 1`.
`PHASE1_NOT_APPLICABLE_COUNT = 16`. `PHASE1_BLOCKED_DEPLOYMENT_COUNT = 16`
(every PRODUCTION_LOCKED method's `CURRENT_DEPLOYED_REAL` dimension, all
blocked on the identical Codex cutover, not 16 independent problems).
