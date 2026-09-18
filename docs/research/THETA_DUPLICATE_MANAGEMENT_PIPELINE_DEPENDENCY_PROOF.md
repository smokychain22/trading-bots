# THETA Duplicate Management Pipeline — Dependency Proof

**Status:** Dependency proof accepted and Production authority resolved.
Pipeline B is quarantined as research/test-only and has no broker-reachable
authority. The canonical live path now uses the TypeScript
`PaperBootstrapManagementPolicyProvider` through
`autonomous-runtime.ts`. This is an authority classification, not a claim that
the bootstrap policy has empirical profitability evidence.

This document originally completed the dependency proof requested for Pipeline B
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
| `paper-bootstrap-management-policy.ts` (frozen C1 module, integration-adapted) | `management-action-frontier.ts` + its evidence modules | `autonomous-runtime.ts` defaults to this provider through the single `ManagementPolicyEvidenceProvider` slot | `paper-bootstrap-management-policy.test.ts`, `runtime-policy-authority.test.ts` | **CANONICAL_LIVE_BOOTSTRAP** (non-empirical, Paper-only) |
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

## Production resolution

The nine-module Pipeline B cluster remains in the repository only as
research/test reference material. It must not be imported by either live
entrypoint and cannot publish an executable order intent. Static authority
tests enforce those boundaries. Deletion is deferred because its research
contracts and tests still document prior work. Any future reuse must enter as a
shadow challenger or replace the canonical provider through a reviewed
architecture decision. It may not become a parallel broker-reachable path.
