# SOURCE_RUNTIME_TRUTH_MATRIX

Phase 1 Zero-Unknown Reclosure Pass 3, items 15-17, regenerated at the
source-final state (Pass 3 continuation items 29-32, then Pass 3
source-final items 16 and 19). Counts below are
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

**Item 16's explicit separation, stated once here rather than repeated per
cell**: `CURRENT_RUNNING_PROCESS_EVIDENCE` below means ONLY "what the OLD,
currently-deployed worker (pinned at `af3d43d1...`, predating this entire
Pass 3 effort) has reported about itself" -- e.g. its own live
`status.json` schema-incompatible state. It never means "the old worker is
executing this session's new target-source instrumentation" -- it cannot
be, since none of this session's source has been deployed. For every
capability BUILT this session (release identity resolver, historical/
current separation, per-method provenance, T0 replay bundle),
`CURRENT_RUNNING_PROCESS_EVIDENCE` is explicitly `N/A -- TARGET_SOURCE_NOT_DEPLOYED`,
distinct from `SOURCE_IMPLEMENTED`/`WIRED`/`DETERMINISTIC_TESTED` (which
describe this branch's source readiness, independent of deployment).

| CAPABILITY | AUTHORITATIVE FUNCTION | SOURCE_IMPLEMENTED | WIRED | DETERMINISTIC_TESTED | REAL_HISTORICAL_EVIDENCE | CURRENT_RUNNING_PROCESS_EVIDENCE (OLD deployed worker ONLY) | CHECKOUT_HEAD_SHA | RUNNING_PROCESS_BUILD_SHA | TARGET_SOURCE_SHA | DEPLOYMENT_MATCH | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Cross-branch structural selection | `buildCanonicalStrategyFrontier`'s `structuralSelection` | YES | YES (real, unconditional call path, Pass 2) | YES (`theta-shadow-cycle.test.ts` et al.) | YES (Sep24 `no-submit-7981e31e-...`, `source_sha 7373b482...`) | OLD-WORKER-ONLY: worker `status.json` reports live, today -- but running the PRE-Pass-3 code at `af3d43d1...`, not this session's source | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | re-run `git rev-parse HEAD` (see Codex handoff -- this doc avoids a stale self-referential value) | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Release-identity persistence into `trade.decision.receipt_json` | `PostgresThetaCycleStore.persistDecision` + `resolveReleaseIdentity` (Pass 3 continuation items 2-6) | YES | YES (threaded end to end, handler -> autonomous-runtime -> production-shadow-runtime -> store) | YES (`tests/db/theta-cycle-persistence.test.ts`, DB-gated; `tests/release-identity.test.ts`, `tests/postgres-theta-cycle-store-release-identity-guard.test.ts`, not DB-gated) | N/A (new field, no historical row carries it yet) | N/A -- TARGET_SOURCE_NOT_DEPLOYED (the old worker predates this field entirely; it cannot report on code it has never run) | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | re-run `git rev-parse HEAD` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Schema compatibility gate | `inspectRuntimeSchemaCompatibility` | YES | YES (production caller in `autonomous-runtime-handler.ts`) | YES | N/A | OLD-WORKER-ONLY: currently reports `SCHEMA_INCOMPATIBLE` against this branch, live, today | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | re-run `git rev-parse HEAD` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Historical vs current-worker real data (Pass 3 continuation items 7-11) | `historicalRealData`/`currentWorkerRealData` dimensions (`profitability-brain-reality.ts`) | YES | YES | YES (`tests/profitability-brain-evidence-manifest.test.ts`, `tests/theta-real-historical-episode.test.ts`) | YES (Sep24 episode reaches `historicalRealData=true` for 7 methodIds) | N/A -- TARGET_SOURCE_NOT_DEPLOYED (`currentWorkerRealData` is a source-side capability that stays false for every method until this exact source runs on the deployed worker; the old worker cannot produce this evidence at all, not merely "reports false") | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | re-run `git rev-parse HEAD` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Per-method input-realness model (Pass 3 source-final items 8-13) | `classifyMethodInputProvenance`/`filterToRealInputEvidence` (`profitability-method-input-provenance.ts`), wired into `runThetaShadowCycle` itself | YES | YES (every real caller: `theta-shadow-once.ts`, database-independent fallback, normal Postgres path) | YES (`tests/profitability-method-input-provenance.test.ts`, `tests/method-l7-realness-authority.test.ts`) | N/A (a classifier, not itself a decision method) | N/A -- TARGET_SOURCE_NOT_DEPLOYED | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | re-run `git rev-parse HEAD` | N/A | `BLOCKED_DEPLOYMENT_CODEX` (deploys with the rest of the source, mechanically -- no Codex source coding required, item 8) |
| T0 replay bundle mechanism (Pass 3 source-final items 1-7) | `buildT0ReplayBundle`/`replayFromT0Bundle` (`t0-replay-bundle.ts`), wired into `tools/theta-no-submit-probe.ts`'s real per-symbol loop AND the normal Postgres evidence archive | YES | YES (persists via the existing `LocalEvidenceSpool` envelope mechanism -- no-submit path -- and the existing compressed evidence archive -- Postgres path; no schema change either way) | YES (`tests/t0-replay-bundle.test.ts`, `tests/t0-replay-bundle-writer-integration.test.ts` -- proves actual writer integration, not just the builder in isolation) | NOT_RECONSTRUCTABLE_FROM_PERSISTED_T0 for the specific Sep24 episode (see `THETA_T0_RECONSTRUCTION_LEDGER_2026-09-26.md`) | N/A -- TARGET_SOURCE_NOT_DEPLOYED | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | re-run `git rev-parse HEAD` | N/A | `BLOCKED_DEPLOYMENT_CODEX` (fully wired in source this pass -- no remaining source TODO for Codex) |

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

**Re-derived after Pass 3 source-final (item 19)**: the source-side fixes
this pass added (T0 replay bundle writer wiring, per-method provenance
wired into `runThetaShadowCycle`, L7 requiring per-method REAL input
realness) do not change these counts -- they close source-solvable gaps
that existed ALONGSIDE the 16 in-scope methods, not gaps IN them. All
counts above stand unchanged: `UNKNOWN=0`, `FALSE=0`, `UNWIRED=0`.
