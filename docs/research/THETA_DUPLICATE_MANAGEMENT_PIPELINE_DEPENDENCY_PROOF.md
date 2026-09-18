# THETA Duplicate Management Pipeline — Dependency Proof

**Status:** Completes the dependency proof requested for Pipeline B
(first flagged as a likely-dead management pipeline in an earlier audit
this engagement). No code changed. No modules removed. This document
exists so Codex can make the final integration/removal decision with a
verified, not guessed, dependency picture.

**Method:** Every edge below was verified by `grep` of actual `import`
statements in `src/**/*.ts` on `claude/theta-management-intelligence`,
traced outward from the two real runtime entrypoints
(`src/worker/resident-worker.ts` and `src/customer/api.ts`) rather than
inferred from file names or comments. One false lead was caught this way:
`management-orchestrator.ts`'s own comment says "exactly mirroring
new-risk-orchestrator.ts's own division of responsibility" — that is
prose, not an import, and does not create a dependency edge.

## The two live entrypoints

- `src/worker/resident-worker.ts` imports exactly one THETA module:
  `runAutonomousRuntimeCycle` from `theta/autonomous-runtime.ts`.
- `src/customer/api.ts` imports `theta-shadow-cycle.ts`/`theta-shadow-once.ts`
  (confirmed: zero references to `management-cycle`, `management-orchestrator`,
  or `management-opportunity-book` anywhere in `api.ts`).

## Module map

| Module | Imports (real, verified) | Live consumers (traced from the 2 entrypoints above) | Test consumers | Classification |
|---|---|---|---|---|
| `management-action-frontier.ts` | (pure, no THETA imports) | `autonomous-runtime.ts` → `resident-worker.ts` | `management-action-frontier.test.ts` | **CANONICAL_LIVE** |
| `autonomous-runtime.ts` (`buildRuntimeManagementFrontiers`) | `management-action-frontier.ts`, `management-input-state.ts`, execution/broker adapters, `shadow-management-policy.ts`, `p2e-evidence-store.ts`, `operator-control.ts` | `resident-worker.ts` (direct) | `autonomous-runtime-handler.test.ts` | **CANONICAL_LIVE** |
| `paper-bootstrap-management-policy.ts` (Claude's module) | `management-action-frontier.ts` + this branch's own evidence modules | not yet wired into `autonomous-runtime.ts`'s `dependencies.managementPolicyEvidenceProvider` slot (per prior receipts) | `paper-bootstrap-management-policy.test.ts` | **SUPPORTING** (candidate provider, ready but not activated) |
| `new-risk-orchestrator.ts` | `option-chain-ingestion.ts`, `universe-policy.ts`, `python-bridge.ts`, `fusion-snapshot.ts`, etc. | `theta-shadow-cycle.ts` → `resident-worker.ts` **and** `src/customer/api.ts` | `new-risk-orchestrator.test.ts` | **CANONICAL_LIVE** (entry-side decision path -- a SEPARATE domain from management, correctly live) |
| `theta-shadow-cycle.ts` / `theta-shadow-once.ts` | `new-risk-orchestrator.ts`, `decision-assembly.ts`, `canonical-strategy-frontier.ts`, etc. | `resident-worker.ts`, `src/customer/api.ts` (direct) | (covered via new-risk-orchestrator/decision-assembly tests) | **CANONICAL_LIVE** |
| `management-orchestrator.ts` (`runManagementOrchestration`) | `python-bridge.ts`, `management-contract.ts`, `management-assembly.ts`, `aegis-contract.ts` (type), `execution-quality-contract.ts` (type) | `management-cycle.ts` **only** -- not reachable from either live entrypoint | `management-orchestrator.test.ts` | **DEAD_CODE_CANDIDATE** |
| `management-cycle.ts` | `management-orchestrator.ts`, `assignment-orchestrator.ts`, `covered-call-management-orchestrator.ts`, `recovery-orchestrator.ts` | `management-opportunity-book.ts` **only** -- not reachable from either live entrypoint | `management-cycle.test.ts` | **DEAD_CODE_CANDIDATE** |
| `assignment-orchestrator.ts` | `new-risk-orchestrator.ts`, `python-bridge.ts` | `management-cycle.ts` **only** | `assignment-orchestrator.test.ts` | **DEAD_CODE_CANDIDATE** |
| `covered-call-management-orchestrator.ts` | `management-orchestrator.ts`, `management-assembly.ts`, `python-bridge.ts` | `management-cycle.ts` **only** | `covered-call-management-orchestrator.test.ts` | **DEAD_CODE_CANDIDATE** |
| `recovery-orchestrator.ts` | `covered-call-orchestrator.ts`, `python-bridge.ts` | `management-cycle.ts` **only** | `recovery-orchestrator.test.ts` | **DEAD_CODE_CANDIDATE** |
| `covered-call-orchestrator.ts` (the non-`-management-` one) | `python-bridge.ts` | `recovery-orchestrator.ts` **only** | `covered-call-orchestrator.test.ts` | **DEAD_CODE_CANDIDATE** |
| `management-assembly.ts` | `management-contract.ts`, `python-bridge.ts` | `management-orchestrator.ts`, `covered-call-management-orchestrator.ts`, `management-cycle.ts` -- none reachable | `management-assembly.test.ts` | **DEAD_CODE_CANDIDATE** |
| `management-contract.ts` | (pure) | `management-orchestrator.ts`, `management-assembly.ts` -- none reachable | `management-contract.test.ts` | **DEAD_CODE_CANDIDATE** |
| `management-opportunity-book.ts` | `management-cycle.ts` (type-only: `ManagementCycleResult`) | `persistence-repositories.ts`, `persistence-repositories-memory.ts` (storage/type layer, not a decision path) | `management-opportunity-book.test.ts` | **DEAD_CODE_CANDIDATE** |
| `cross-symbol-economic-frontier.ts` | `new-risk-orchestrator.ts`, `python-bridge.ts` | `strategy-route-receipt.ts` -- itself not traced to either live entrypoint this pass | `cross-symbol-economic-frontier.test.ts` | **LEGACY_REFERENCED** (not proven live; not proven dead either -- `strategy-route-receipt.ts`'s own consumers were not traced this pass, so this entry is intentionally left at a lower confidence tier rather than guessed) |
| `python-bridge.ts` | (generic Python-subprocess helper, no THETA-specific imports) | Used by BOTH the dead cluster above AND `research/production-shadow-runtime.ts` (which IS imported by `autonomous-runtime.ts`, hence live) | (covered indirectly) | **SUPPORTING** (a shared low-level utility, not itself a decision engine -- its liveness comes from a different, live caller, so it is not evidence that the dead cluster is live) |

## What this proves

Every module in the `management-orchestrator.ts` / `management-cycle.ts`
cluster (9 modules total: `management-orchestrator.ts`,
`management-cycle.ts`, `assignment-orchestrator.ts`,
`covered-call-management-orchestrator.ts`, `recovery-orchestrator.ts`,
`covered-call-orchestrator.ts`, `management-assembly.ts`,
`management-contract.ts`, `management-opportunity-book.ts`) forms one
connected, self-contained subgraph whose only entry point
(`management-cycle.ts`) has exactly one consumer
(`management-opportunity-book.ts`), which itself is consumed only by the
storage/type layer, never by `resident-worker.ts` or `src/customer/api.ts`.
This is a genuinely different finding from the entry-side orchestrator
(`new-risk-orchestrator.ts`), which shares some of the same low-level
building blocks (`python-bridge.ts`) but IS reachable from both live
entrypoints via `theta-shadow-cycle.ts` — so "calls into Python" is not
itself evidence of liveness; the actual import chain to a real entrypoint
is.

## What this does NOT prove

- It does not prove the cluster has zero value as reference material —
  `management-orchestrator.ts`'s Python-subprocess design (calling
  `bots/theta/quant/runtime/management_contract.py`) may represent
  intentional prior work Codex still wants, e.g. if the Python
  quant-model side has logic not yet ported to the TypeScript-native
  `management-action-frontier.ts` path.
- It does not check for CLI scripts, cron jobs, or ad hoc `npx tsx`
  invocations outside `src/**/*.ts`'s own import graph (e.g. a developer
  running `management-cycle.ts` directly from a terminal for manual
  testing). That kind of usage leaves no import-graph trace and was not
  checked this pass.
- `cross-symbol-economic-frontier.ts` is left at LEGACY_REFERENCED rather
  than DEAD_CODE_CANDIDATE specifically because I did not trace
  `strategy-route-receipt.ts`'s own consumers to a definitive answer —
  reporting it as dead without that final link would be a guess, not a
  proof.

## Recommendation

Per the standing "do not remove blindly" rule, no deletion is proposed
here. If Codex confirms (via their own knowledge of the Python
quant-model roadmap, or a repeat of this same import-graph trace on
current `main`, which may have diverged from this branch's base) that
the 9-module cluster has no remaining plan, it is a safe, low-risk
removal — every module in it is provably unreachable from both real
entrypoints, not merely "looks unused." If any part of it is still
wanted, the safest path is to explicitly wire it as a `SHADOW_ONLY`
challenger behind `theta-shadow-cycle.ts`'s existing shadow-evaluation
mechanism (which already has a live, proven pattern: `new-risk-orchestrator.ts`
being evaluated there without broker authority) rather than leaving it as
an orphaned, untested-in-production alternate path.
