# SOURCE_RUNTIME_TRUTH_MATRIX

Phase 1 Zero-Unknown Reclosure Pass 3, items 15-17. Counts below are
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
| Cross-branch structural selection | `buildCanonicalStrategyFrontier`'s `structuralSelection` | YES | YES (real, unconditional call path, Pass 2) | YES (`theta-shadow-cycle.test.ts` et al.) | YES (Sep24 `no-submit-7981e31e-...`, `source_sha 7373b482...`) | YES (worker `status.json`, live, today) | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `0613a4e09ac81665070d893e2e76276481b7b7aa` (this branch's tip as of this doc's own commit) | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Release-identity persistence into `trade.decision.receipt_json` | `PostgresThetaCycleStore.persistDecision` (this pass's item-2 fix) | YES (this pass) | YES (threaded end to end, handler -> autonomous-runtime -> production-shadow-runtime -> store) | YES (`tests/db/theta-cycle-persistence.test.ts`, DB-gated) | N/A (new field, no historical row carries it yet) | N/A (worker is schema-incompatible, has not run this code) | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `0613a4e09ac81665070d893e2e76276481b7b7aa` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |
| Schema compatibility gate | `inspectRuntimeSchemaCompatibility` | YES | YES (production caller in `autonomous-runtime-handler.ts`) | YES | N/A | YES -- currently reports `SCHEMA_INCOMPATIBLE` against this branch, live, today | `47bbf9905a27a7231a5f47cab7c777c48d29b632` | `af3d43d14d703c47ff52e833588130af60d61e48` | `0613a4e09ac81665070d893e2e76276481b7b7aa` | **FALSE** | `BLOCKED_DEPLOYMENT_CODEX` |

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
