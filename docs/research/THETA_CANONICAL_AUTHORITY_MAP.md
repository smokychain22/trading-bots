# THETA canonical authority map

Status: Slice 1 of the pre-VPS directive (item 12: "verify one sovereign
brain"). Grounded in direct source reads this pass and prior passes of this
engagement, re-verified against current `main` (`b1186f0`).

Purpose: for every mutation/decision boundary, confirm there is exactly ONE
real, reachable canonical authority -- and name every competing/duplicate
architecture explicitly as `QUARANTINED`, never "working," if it has no real
caller.

## Entry-side decision authority

| Boundary | Canonical authority | File | Status |
| --- | --- | --- | --- |
| Cross-candidate structural/Pareto ranking within one branch+action | `rankCandidates`/`dominates` | `src/theta/canonical-strategy-frontier.ts:444-452` | REAL, RUNTIME_REACHABLE |
| Cross-BRANCH/action ranking | **NONE -- confirmed gap, unchanged since first discovered this engagement.** `dominates()` line 428: `if (left.branch !== right.branch \|\| left.action !== right.action) return false;` -- never compares across branches. When `paretoRank` and `unknownEvidence.length` tie across branches, the final tie-break is `a.candidateId.localeCompare(b.candidateId)` (line 452) -- alphabetical candidate-ID ordering, not an economic decision. | `src/theta/canonical-strategy-frontier.ts:428,452` | **STRUCTURAL_NOT_ECONOMIC** -- see the strategy-router truth question below |
| AEGIS risk evaluation | `bots/theta/quant/models/aegis.py` (Python bridge) | `bots/theta/quant/models/aegis.py`, invoked via `new-risk-orchestrator.ts` | REAL, RUNTIME_REACHABLE, but only reached AFTER a candidate survives the THETA-Q feasible/Pareto stage (per the real forensic: most 2026-09-21 candidates never reached AEGIS at all -- `aegis=null` is "not evaluated," not "evaluated and passed/failed") |
| Sizing | Sizing policy inside `new-risk-orchestrator.ts` / canonical frontier sizing fields | `src/theta/canonical-strategy-frontier.ts` (`selectedQuantity`, `sizingEvidenceUnknown`) | REAL, RUNTIME_REACHABLE |
| Paper-evidence eligibility gate | `master-paper-plan-assembly.ts:60` (`selectedBranch?.status !== 'SHADOW'`) | `src/execution/master-paper-plan-assembly.ts` | REAL, RUNTIME_REACHABLE -- distinct from registry `executionEnabled`; currently makes THETA_CONVENTIONAL/THETA_RECOVERY/THETA_CC eligible (`status: 'SHADOW'`) and blocks THETA_HOLD_STRIKE/THETA_DEFINED_RISK (`status: 'RESEARCH_ONLY'`) |
| Broker mutation | Codex-owned execution/broker-mutation layer (Alpaca order submission) | `src/execution/` (exact file not re-audited this pass) | Owned exclusively by Codex; `brokerAuthority: false` on every module this research branch produces |

## Management-side decision authority

| Boundary | Canonical authority | File | Status |
| --- | --- | --- | --- |
| Roll/CC valuation math (once a candidate exists) | `evaluatePaperBootstrapManagementPolicy` + `evaluateRollCandidates`/`RollIncrementalUtility`/`valueForRollFromCandidates`/`valueForRollCcFromCandidates`/`valueForSellCcFromCandidates` | `src/theta/paper-bootstrap-management-policy.ts` | REAL, TESTED, but **structurally unreachable in Production** -- see the Unknown Ledger item 1: the real call site (`autonomous-runtime.ts:353`) supplies zero roll/CC candidates, so this real machinery never receives non-null input |
| Roll/CC candidate DISCOVERY (finding what to feed the valuator above) | **NONE wired in Production.** A real research-only discovery module exists (`src/research/paper-bootstrap-candidate-source.ts`) but has never been adopted as the real `PaperBootstrapCandidateSource` | `src/theta/paper-bootstrap-management-policy.ts:1127-1158` (interface + stub) | **MISSING_RUNTIME_WIRING**, confirmed unchanged this pass |
| A SECOND, parallel, array-based management architecture (orchestrators + a real Python covered-call ranker) | `runThetaManagementCycle` + `management-orchestrator.ts`/`assignment-orchestrator.ts`/`recovery-orchestrator.ts`/`covered-call-management-orchestrator.ts`/`covered-call-orchestrator.ts` + `covered_call_ranker.py` | `src/theta/management-cycle.ts` and siblings | **QUARANTINED** -- confirmed again this pass via `grep -rln "runThetaManagementCycle" src/` and a direct grep for real (non-test, non-self) callers: **zero** exist anywhere in the codebase. This is real, tested, sophisticated code with a real Python bridge, and it has never been called by anything except its own definition and its own test file. It must never be described as "the bot's real management brain" -- it is inert. |

## The single most important open question this map raises

**Is there one sovereign management brain, or two competing ones, only one of
which happens to run?**

The answer, confirmed by direct source reading (not by trusting either
architecture's own internal sophistication): there is exactly one REAL,
RUNTIME-REACHABLE management authority path
(`PaperBootstrapManagementPolicyProvider` via `autonomous-runtime.ts`), and it
is currently crippled by the missing candidate-source wiring (Unknown Ledger
item 1) rather than by any architectural ambiguity. The second architecture
(`management-cycle.ts` and its orchestrators) is not a competing live
authority -- it is dead code with zero real callers, and should be explicitly
labeled `QUARANTINED` in the brain capability matrix, never counted as
evidence that "management is handled."

## Strategy-router truth question (directive item 6 preview)

Given the confirmed cross-branch Pareto gap above, the honest current answer
to "is THETA actually changing strategies, or just changing branch labels?"
is: **within a single branch+action, real economic Pareto ranking occurs.
Across branches (e.g. choosing THETA_CONVENTIONAL vs. THETA_DEFINED_RISK for
the same decision), no real cross-branch economic comparison exists in
Production today** -- the router selects a branch upstream (via
`strategy-timing-router.ts`/`routerFamilyToBranch`, not audited line-by-line
this pass) and the frontier only ranks within whatever branch already
survived that upstream routing. This means: THETA's cross-strategy economic
comparison is real WITHIN this research branch's hardened
`cross-strategy-common-horizon-contract.ts` (a research artifact, not wired
into Production decision authority -- and must never be treated as a second
competing comparator if it ever were wired in; it would need to become the
one Codex-integrated authority, not an additional one), but **not yet real in
Production's actual branch-selection path**. This requires a full,
dedicated trace of `strategy-timing-router.ts` before a definitive
`STRATEGY_SWITCHING_ECONOMIC` vs. `STRATEGY_SWITCHING_STRUCTURAL_ONLY`
verdict can be given -- **deferred to a follow-up slice**, not answered
definitively by this map.

## What this map does NOT cover yet (explicitly deferred)

- A line-by-line trace of `strategy-timing-router.ts` (upstream of the
  frontier) to determine whether branch SELECTION itself (not just
  within-branch ranking) is economically real.
- The full entry E2E graph (directive item 7) and management E2E graph
  (directive item 8) -- this map answers "who has authority," not "does the
  full wire path actually carry real data end to end."
- A verified answer on whether `runThetaShadowCycle`/`processDueExecutionObservations`
  and the rest of the shadow-evidence runtime constitute a THIRD authority
  surface or are simply the observation/instrumentation layer around the one
  real authority above (structural read suggests the latter, not
  independently re-verified this pass).
