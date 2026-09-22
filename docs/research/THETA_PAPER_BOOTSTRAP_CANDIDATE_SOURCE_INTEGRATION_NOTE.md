# Codex integration note: management candidate sourcing

Status: research-branch proposal only. No canonical interface is modified by this note or by `src/research/paper-bootstrap-candidate-source.ts`. `brokerAuthority: false`. Registered against canonical main `f5bb9d69174458e9c04b2347b4766885ab8c4903`, this branch at the commit that adds this note.

## The confirmed gap

`PaperBootstrapCandidateSource.candidatesFor()` (`src/theta/paper-bootstrap-management-policy.ts:1100-1105`) returns only one `rollCandidate` and one `ccCandidate`. The only real Production call site (`autonomous-runtime.ts:352-353`) never injects an alternative, so it always uses the `noCandidates` default (`{rollCandidate: null, ccCandidate: null}`). Meanwhile `PaperBootstrapPolicyInput` (same file, lines 93-197) **already accepts** `rollCandidates`, `ccCandidates`, and `rollCcCandidates` as optional arrays, and `PaperBootstrapManagementPolicyProvider.evaluate()` (lines 1121-1124) destructures only the two singular fields from the candidate source and never passes the plural ones through -- so the richer, already-tested multi-candidate comparison logic (`evaluateRollCandidates`, `evaluateCoveredCallCandidates`) is real, correct, and completely unreachable in the live default configuration.

## A second, likely higher-value option Codex should evaluate first

A parallel audit pass on this branch found a **second, independently-built management architecture** -- `management-cycle.ts::runThetaManagementCycle` and its five constituent orchestrators (`management-orchestrator.ts`, `assignment-orchestrator.ts`, `recovery-orchestrator.ts`, `covered-call-management-orchestrator.ts`, `covered-call-orchestrator.ts`) -- that is **already array-based** for covered calls (`CoveredCallOrchestrationRequest.candidates: readonly CoveredCallCandidateInput[]`) and already calls a real Python ranking bridge (`covered_call_ranker.py`). Grepping the entire repository found **exactly two references to `runThetaManagementCycle`**: its own definition and its own dedicated test file. No Production entrypoint calls it or any of its orchestrators. **Before building or wiring the candidate source proposed below, Codex should evaluate whether wiring `management-cycle.ts` into `autonomous-runtime.ts` solves the array-based-candidate problem "for free," without inventing a new interface at all.** This note's proposal remains useful either way (Architecture A -- `paper-bootstrap-management-policy.ts` -- may still be the nearer-term Paper-evidence path even if Architecture B is the eventual real answer), but the two should not be built in ignorance of each other.

## What this branch built

`src/research/paper-bootstrap-candidate-source.ts` -- a pure, tested candidate-DISCOVERY module (never a ranking/selection module; ranking stays entirely inside the existing, already-tested policy code). Given already-fetched, real Alpaca-executable quote observations (`CandidateQuoteObservation`: contract identity, bid/ask, quote timestamp, DTE, delta, underlying) and the current open leg, it enumerates every valid alternative contract (multiple expirations x multiple strikes, never pre-selecting one target) and classifies every rejected observation with an explicit reason (`SAME_CONTRACT_AS_CURRENT`, `DUPLICATE_CONTRACT_ID`, `STALE_QUOTE`, `MISSING_BID_OR_ASK`, `CROSSED_OR_INVERTED_QUOTE`, `WRONG_UNDERLYING`, `WRONG_OPTION_TYPE`, `MISMATCHED_MULTIPLIER`). 13 tests cover zero/one/many candidates, an invalid candidate, a duplicate contract, a stale quote, and missing bid/ask, per this directive's own required test matrix.

The module deliberately does **not** populate the legacy singular `rollCandidate`/`ccCandidate` fields (`PaperBootstrapCandidateSetV2.rollCandidate`/`ccCandidate` are typed as literal `null`) -- picking "the" candidate from a list is exactly the kind of incidental-ordering decision this session's broader audit flagged as a real defect elsewhere (the cross-branch entry Pareto tie-break falling to alphabetical `candidateId` ordering). A caller wiring this into the CURRENT narrow interface must make that choice explicitly and visibly, not have this module make it silently.

## Minimal safe migration (not applied to canonical Production by this branch)

1. Widen `PaperBootstrapCandidateSource.candidatesFor()`'s return type additively:
   ```ts
   candidatesFor(chainId: string): Promise<{
     readonly rollCandidate: RollCandidate | null;
     readonly ccCandidate: RollCandidate | null;
     readonly rollCandidates?: readonly RollCandidate[];
     readonly ccCandidates?: readonly RollCandidate[];
     readonly rollCcCandidates?: readonly RollCandidate[];
   }>;
   ```
   Fully backward compatible: `noCandidates`'s existing shape still satisfies this type unchanged (the three new fields are optional).
2. Widen `PaperBootstrapManagementPolicyProvider.evaluate()` (line 1121-1124) to destructure and pass through all five fields instead of only two:
   ```ts
   async evaluate(state: ManagementInputState): Promise<ManagementPolicyEvidence | null> {
     const { rollCandidate, ccCandidate, rollCandidates, ccCandidates, rollCcCandidates } =
       await this.candidates.candidatesFor(state.chainId);
     return evaluatePaperBootstrapManagementPolicy({ ...state, rollCandidate, ccCandidate, rollCandidates, ccCandidates, rollCcCandidates });
   }
   ```
   `PaperBootstrapPolicyInput` already accepts all five fields today -- this is a pure pass-through change, zero new validation/business logic in Production code.
3. Implement a real `PaperBootstrapCandidateSource` (Codex-owned, Production-side) that: (a) reads the current open leg from broker-confirmed lifecycle state, (b) fetches a real Alpaca options-chain snapshot for the same underlying/option-type, (c) maps each row to `CandidateQuoteObservation`, (d) calls `buildPaperBootstrapCandidateSet` (this branch's module, or an equivalent Codex reimplementation) to get the validated candidate arrays, (e) returns them from `candidatesFor()`.

Also applied on this branch (small, additive, backward-compatible, tests included): `paper-bootstrap-management-policy.ts`'s `nearExhausted` trigger's `0.10`/`5`-DTE literals are now `state.nearExhaustedExecutableFractionThreshold ?? 0.10` / `state.nearExhaustedDteThreshold ?? 5` -- genuinely caller-overridable, with the exact same default behavior as before for any caller that does not opt in. See the commit for this change specifically, labeled `PRODUCTION_FIX_CANDIDATE`.

## What Codex must decide, not this branch

- Whether to wire Architecture B (`management-cycle.ts`) instead of, or in addition to, extending Architecture A.
- Whether to adopt this branch's `paper-bootstrap-candidate-source.ts` as-is, reimplement it Production-side, or supersede it with Architecture B's existing covered-call candidate path.
- The real Alpaca options-chain fetch itself (step 3b above) -- entirely out of this research branch's authority and credentials.

No order submission, no Production deployment, no Aiven migration, no worker restart is proposed or performed by this note or the code it describes.
