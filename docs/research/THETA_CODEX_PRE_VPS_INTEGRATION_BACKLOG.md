# THETA Codex pre-VPS integration backlog

Status: Slice 1 of the pre-VPS directive (item 25). Every item below is a
real, source-grounded defect or open question discovered on the research
branch (`claude/theta-management-challenger`) this pass. Nothing here has
been applied to Production -- `PRODUCTION_RUNTIME_CHANGED = NO`,
`BROKER_MUTATIONS = 0` throughout. Codex decides integration; this is a
handoff, not a change.

## P0_FIRST_PAPER_BLOCKER

### P0-1: Roll/CC candidate source is never wired -- management brain cannot roll or sell a covered call in Production today

- **Defect ID**: P0-1
- **Exact source path**: `src/theta/autonomous-runtime.ts:353` (call site) and `src/theta/paper-bootstrap-management-policy.ts:1127-1158` (stub definition)
- **Exact behavior**: `createPaperBootstrapManagementPolicyProvider()` is called with zero arguments, so `candidates` defaults to `noCandidates`, which always resolves `{ rollCandidate: null, ccCandidate: null }`. Every real, tested roll/CC valuation function in the same file (`evaluateRollCandidates`, `RollIncrementalUtility`, `valueForRollFromCandidates`, `valueForRollCcFromCandidates`, `valueForSellCcFromCandidates`) is therefore structurally unreachable in Production -- it always receives `null` and can never propose a real roll or CC action.
- **Required producer/consumer**: Producer = a real `PaperBootstrapCandidateSource` implementation enumerating live roll/CC candidates from the current contract lattice for a given chain. Consumer = already exists and is already tested (`evaluatePaperBootstrapManagementPolicy` and its callees).
- **Minimal fix**: Implement a real `PaperBootstrapCandidateSource` (a research-only discovery module already exists at `src/research/paper-bootstrap-candidate-source.ts::enumerateCandidates`/`buildPaperBootstrapCandidateSet` as a starting reference, not a drop-in Production dependency) and pass it into `createPaperBootstrapManagementPolicyProvider(realCandidateSource)` at the `autonomous-runtime.ts:353` call site.
- **Tests required**: An integration test with a real open CSP chain and a real roll candidate present in the live lattice, proving the full path (`autonomous-runtime.ts` -> `PaperBootstrapManagementPolicyProvider.evaluate` -> `evaluatePaperBootstrapManagementPolicy`) produces a non-null `rollCandidate`/proposes ROLL when economically justified.
- **Priority**: P0 -- without this, THETA can open a CSP but can never roll it or sell a covered call against assigned stock through its real management authority. Management is, structurally, the majority of the Wheel strategy's value.

### P0-2: `CONTRACT_NOT_EXECUTABLE` was the dominant real-session rejection reason (3,299 of 3,876 candidates) -- root cause not yet verified against a live Alpaca response

- **Defect ID**: P0-2
- **Exact source path**: `src/theta/option-chain-ingestion.ts:147-160` (forces `executable: false` when `contract.multiplier === null`); root field read at `src/theta/alpaca-provider.ts:337` (`multiplier: asNumberOrNull(c.size)`)
- **Exact behavior**: Per the real forensic (`docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md`), 3,299 of 3,876 persisted candidate rows in a real session window were rejected as `CONTRACT_NOT_EXECUTABLE` -- far larger than any other rejection category. This research branch has no live Alpaca access to independently confirm whether Alpaca's real `/v2/options/contracts` response reliably supplies the `size` field (and this mapping is correct) for genuinely liquid, tradeable contracts, or whether the 3,299 figure is explained by the SAME session's confirmed Aiven/broker degradation (`HTTP_503`/`RUNTIME_BROKER_CYCLE` errors, per the same forensic).
- **Required producer/consumer**: N/A -- this is a verification task, not a known-missing producer.
- **Minimal fix**: Not yet determined -- depends on what a live Alpaca sample shows. Do NOT change `alpaca-provider.ts:337` speculatively without first confirming the real field behavior.
- **Tests required**: A real (sandboxed, read-only) Alpaca contract-fetch check on a healthy (non-degraded) session confirming `size` is present/correctly typed for known-liquid contracts.
- **Priority**: P0 -- this is the single largest gap between "real candidates evaluated" (3,876) and "candidates selected with positive quantity" (0) in the only real live-session forensic available. Resolving it (either as a mapping fix or as confirmation it's session-transient) is the highest-leverage next step toward first Paper.

## P1_PRE_VPS_BLOCKER

### P1-1: AEGIS SYSTEM-family stress signals have no real producer anywhere in the repository

- **Exact source path**: `src/theta/account-exposure.ts` (real Production path, supplies `null`), `src/theta/aegis-derivation.ts:24-27` (doc comment confirming the gap), `bots/theta/quant/models/aegis.py` (consumer, requires 3 non-`None` SYSTEM signals; only `stressGapDetected` is real)
- **Exact behavior**: `stressIvShockDetected`/`stressSpreadWideningDetected` are always `null` -- honestly represented (not false-defaulted), but with zero real producer, so the SYSTEM risk family can structurally never reach a real evaluated state.
- **Required producer/consumer**: A real IV-shock detector (Optionomics IV history) and a real spread-widening detector (Alpaca BBO history), each against a rolling baseline.
- **Minimal fix**: Build both detectors; OR make an explicit, committed governance decision (not a silent omission) on whether SYSTEM-family non-evaluation is acceptable for first Paper.
- **Tests required**: A test proving the SYSTEM family reaches a real, non-perpetually-`None` state once the governed signal threshold is real.
- **Priority**: P1 -- see `docs/research/THETA_AEGIS_FIRST_PAPER_POLICY_GAP.md` (this engagement, earlier pass) for the full governance framing; this ledger does not resolve that open governance question, only re-confirms the underlying producer gap is still open.

### P1-2: Multi-position sector/correlation concentration has no real producer beyond the single-underlying case

- **Exact source path**: `src/theta/account-exposure.ts` (`soleRiskGroup` proxy, real only for exactly one held underlying)
- **Exact behavior**: AEGIS SECTOR/CORRELATION families cannot evaluate real concentration once THETA holds 2+ concurrent positions.
- **Required producer/consumer**: Real multi-position sector classification + correlation-cluster computation across all currently-held positions.
- **Minimal fix**: Build the real multi-position producer; this session's deferred Slice D correlation-research prep (20/60/120-session cohort tooling) is a natural research precursor, not yet built.
- **Priority**: P1 -- only bites once THETA holds more than one position, but should be closed or explicitly governed before VPS if multi-position operation is in scope for the graduation window.

### P1-3: `canonical-strategy-frontier.ts`'s `dominates()` never compares across branch/action -- cross-branch tie-break is alphabetical `candidateId`, not economic

- **Exact source path**: `src/theta/canonical-strategy-frontier.ts:428` (branch/action equality gate), `:452` (`a.candidateId.localeCompare(b.candidateId)` tie-break)
- **Exact behavior**: When multiple branches (e.g. THETA_CONVENTIONAL and a hypothetically-graduated THETA_DEFINED_RISK) each produce a top-ranked candidate with equal `paretoRank`/`unknownEvidence.length`, the choice between them is decided by alphabetical candidate-ID ordering -- not economics.
- **Required producer/consumer**: A real cross-branch economic comparator, OR an explicit, documented decision that branch selection happens entirely upstream (in the router) and the frontier is only ever expected to rank within one already-selected branch (in which case this is not a defect, merely something that should be documented, not silently left ambiguous).
- **Minimal fix**: Either wire a real cross-branch comparator (this research branch's `cross-strategy-common-horizon-contract.ts` v4, hardened this engagement, is a candidate reference design -- NOT a drop-in replacement, since it would need Codex-owned integration as the ONE canonical authority if adopted, never a second parallel comparator) or document the upstream-routing assumption explicitly.
- **Priority**: P1 -- currently only matters once more than one branch is simultaneously execution-eligible, which is not yet the case (only THETA_CONVENTIONAL is realistically live-eligible today), but should be resolved or explicitly documented before more branches graduate.

## P2_R8_REQUIRED

- Full `strategy-timing-router.ts` trace to give a definitive `STRATEGY_SWITCHING_ECONOMIC` vs. `STRATEGY_SWITCHING_STRUCTURAL_ONLY` verdict (see `THETA_CANONICAL_AUTHORITY_MAP.md`'s open question) -- research-side trace, Claude-owned, not yet done.
- Real Optionomics field qualification pass for `iv_rank`/`iv_percentile`/`rv*`/skew/term-structure/expected-move/max-pain against multiple completed historical sessions -- deferred from the prior Slice C/D directive, not yet done.
- Canonical export consumers (severe downside, correlation, IV/spread, management outcomes, cross-strategy outcomes) -- most remain `AWAITING_CANONICAL_EXPORT` since Codex has not yet produced the corresponding exports.

## P3_FUTURE_ENHANCEMENT

- `management-cycle.ts` and its full orchestrator family (`management-orchestrator.ts`, `assignment-orchestrator.ts`, `recovery-orchestrator.ts`, `covered-call-management-orchestrator.ts`, `covered-call-orchestrator.ts`, `covered_call_ranker.py`) is real, tested, sophisticated code with zero real callers -- Codex should make an explicit decision to either adopt it as a replacement management architecture (never as a second simultaneous authority alongside `PaperBootstrapManagementPolicyProvider`) or formally retire/document it as quarantined so future audits stop re-discovering it as an open question.
- `cross-symbol-economic-frontier.ts:157-158`'s `paretoEntry?.survivesFrontier ?? false` fallback should, per the false-safe scan, never actually be hit for a well-formed input set -- worth a defensive assertion/log so a future silent hit would be caught rather than fail-closed invisibly.
