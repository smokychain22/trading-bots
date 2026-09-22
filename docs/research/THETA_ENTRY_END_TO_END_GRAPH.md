# THETA entry end-to-end graph

Status: Slice 5 of the pre-VPS master continuation directive. Grounded in a
dedicated research fork's direct reads of `new-risk-orchestrator.ts`,
`theta-shadow-cycle.ts`, `option-chain-ingestion.ts`, `alpaca-provider.ts`,
`canonical-strategy-frontier.ts`, `master-paper-plan-assembly.ts`, and the
real `docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md` live-
session forensic.

## Arrow-by-arrow classification

| Arrow | File:line | REAL | WIRED | PERSISTED | REACHABLE | TESTED | PROVIDER_PROVEN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| worker cycle -> market clock | `theta-shadow-cycle.ts` (not line-verified this pass) | REAL | WIRED | -- | REACHABLE | -- | Confirmed via the real R7 forensic (clock/session data was real in that session) |
| account state | Alpaca account fetch (Codex/Alpaca domain, not re-traced) | -- | -- | -- | -- | -- | Real per R7 forensic, but that session had an Aiven write failure downstream |
| universe -> liquidity ranking | `universe-discovery.ts`/`universe-policy.ts` (avgDollarVolume baseline confirmed real in an earlier Slice B pass of this engagement) | REAL | WIRED | Unclear | REACHABLE | Unclear | Real per R7 forensic (75 underlying evaluations occurred in that session) |
| optionability -> chain fetch | `option-chain-ingestion.ts`, `theta-shadow-cycle.ts:791-825` | REAL | WIRED | -- | REACHABLE | Unclear | REAL -- R7 forensic shows 1,696 distinct real contracts fetched in that session |
| executable BBO / multiplier gate | `option-chain-ingestion.ts:147-160`, `alpaca-provider.ts:337` | REAL (logic exists) | WIRED | -- | REACHABLE | Unclear | **CONFIRMED PROBLEMATIC IN PRACTICE** per the R7 forensic: 3,299/3,876 candidates rejected `CONTRACT_NOT_EXECUTABLE` -- see `THETA_CONTRACT_NOT_EXECUTABLE_INVESTIGATION.md` |
| strategy router | `new-risk-orchestrator.ts:344-363` | REAL | WIRED | Unclear | REACHABLE | Unclear | Real Python bridge call, but only `THETA_Q` eligibility is actually consumed downstream (see `THETA_STRATEGY_ROUTER_TRUTH_MATRIX.md`) |
| AEGIS | `new-risk-orchestrator.ts:9,344`, `bots/theta/quant/models/aegis.py` | REAL | WIRED, but only reached after Pareto survivors exist (an intentional design choice, documented in the file's own comment) | Unclear | CONDITIONALLY REACHABLE | Unclear | Real per R7 forensic (though most candidates that session never reached this stage) |
| sizing | `new-risk-orchestrator.ts:10` | REAL | WIRED | Unclear | CONDITIONALLY REACHABLE (same gate as AEGIS) | Unclear | Real |
| canonical decision / candidate frontier | `canonical-strategy-frontier.ts` | REAL (within-branch only) | WIRED | Unclear | REACHABLE | YES (`tests/canonical-strategy-frontier.test.ts`, confirmed via the `bf6d80e` commit) | Real |
| Paper plan | `master-paper-plan-assembly.ts:60` (SHADOW gate) | REAL | WIRED | Unclear | REACHABLE for THETA_CONVENTIONAL/RECOVERY/CC; STRUCTURALLY BLOCKED for HOLD_STRIKE/DEFINED_RISK (by registry design, not a defect) | Unclear | Real |
| broker mutation owner | `src/execution/broker.ts:274-282` (`assertBrokerMutationAuthorized`) | REAL, confirmed this pass via the provider capability matrix fork | WIRED (Codex-owned) | -- | -- | -- | Real |

## Missing/flagged arrows (Codex-ready)

1. **No real entry-candidate generation exists for THETA_HOLD_STRIKE or
   THETA_DEFINED_RISK anywhere in the live pipeline.** Confirmed:
   `theta-shadow-cycle.ts:791-859` only ever builds put/call CSP-and-CC-shaped
   candidates (`optionTypes = hasPotentialCoveredStock ? ['put','call'] : ['put']`).
   This is a genuine, confirmed gap distinct from the known roll/CC management
   gap: their `RESEARCH_ONLY` registry status is enforced TWICE over --
   once by the registry, and independently by a total absence of any
   candidate producer. If these branches are ever meant to reach even
   shadow evaluation, a real candidate-generation path must be built first.
2. **Cross-branch `dominates()` gap** (`canonical-strategy-frontier.ts:428,452`,
   unchanged across every pass of this engagement) is currently latent
   (only one branch's candidates ever coexist in the live pipeline today)
   but should be fixed proactively, before a second branch's candidate
   generation is ever added, rather than discovered reactively.
3. **`CONTRACT_NOT_EXECUTABLE`** remains the single largest confirmed gap
   between "real candidates evaluated" and "candidates reaching AEGIS/
   sizing/decision" -- see the dedicated investigation doc.

## What this graph confirms is NOT broken

- AEGIS and sizing being gated behind Pareto survival is an intentional
  design choice (documented in the orchestrator's own comment), not a
  defect -- the R7 forensic's large `aegis=null` count for that session
  reflects expected behavior given upstream rejection, not an AEGIS failure.
- Real broker order-submission/replace/cancel machinery exists and is
  correctly gated (`assertBrokerMutationAuthorized`), separate from the
  read-only data-provider layer -- this branch confirms its existence and
  ownership boundary without ever exercising it.
- The Paper-plan SHADOW gate correctly reflects registry design (3 of 5
  branches eligible today), not an accidental block.
