# THETA Codex integration queue

One list of everything this research branch has ready for Codex to
integrate, so Codex does not need to read every research doc to find
open handoffs. Updated after every research closure that produces a new
handoff, per this wave's own rule (item 15) -- not only at wave end.

**Closed items are removed, not marked closed and left here.** A closure
record stays in its own source doc (e.g.
`THETA_ASSIGNMENT_CAPACITY_RESOLUTION.md`'s "CLOSED" banner); this file
only ever lists what is still open.

**Verified-against-main stamp**: every row below was checked against real
main `52e6ea5` (merged into this branch as of this update) -- so a stale
handoff cannot be accidentally re-implemented against an already-closed
gap. If a future pass finds main has moved past this SHA, re-verify each
row against the new SHA before treating any of them as still open.

---

## Q-1: Loss-cause evidence -- consumer wiring

- **Priority**: MEDIUM
- **Claude source commit**: `7e37843` (contract), `2bbead2` (wiring doc)
- **Source artifact**: `src/research/loss-cause-integration-contract.ts`, `docs/research/THETA_LOSS_CAUSE_CODEX_WIRING.md`
- **Production subsystem**: management decision path (`management-action-frontier.ts`)
- **Exact source insertion point**: `management-action-frontier.ts`'s action-computation call site -- `assessLossCauses()` is designed to be called alongside it (additional evidence input, not a replacement).
- **Current defect**: no defect -- this is new capability, not a fix. `management-action-frontier.ts` currently has no per-cause evidence input at all.
- **Accepted architectural constraint**: `assessLossCauses()` is a pure function; Codex owns assembling real `LossCauseEvidence` rows from real signals already in scope (see wiring doc for the per-cause source mapping).
- **Expected change**: `management-action-frontier.ts` (or its caller) gains an optional loss-cause evidence input that can influence ranking/filtering of candidate management actions.
- **Producer**: real evidence sources named per-cause in the wiring doc (5 of 8 causes have a real source today: `LIQUIDITY_DETERIORATION`, `PORTFOLIO_STRESS`, `EVENT_DETERIORATION`, `UNDERLYING_DECLINE`, `EXECUTION_DETERIORATION`).
- **Consumer**: `management-action-frontier.ts`.
- **Persistence requirement**: not yet specified -- Codex's call.
- **Test requirement**: contract's own 10 tests already pass; Codex needs integration tests at the `management-action-frontier.ts` call site.
- **Runtime proof requirement**: a real cycle where two positions with the same P&L but different loss causes produce different feasible-action sets.
- **State**: BLOCKED_PARTIAL -- 5/8 causes wirable today; `IV_EXPANSION` and `OWNERSHIP_DETERIORATION` blocked on their own upstream producers (see Q-4, Q-5 below).

## Q-2: H/D shadow orchestration -- not wired to Production candidate flow

- **Priority**: LOW (research infrastructure, correctly gated -- not urgent)
- **Claude source commit**: `db3143d`
- **Source artifact**: `src/research/shadow-strategy-orchestrator.ts`
- **Production subsystem**: entry-candidate generation (`new-risk-orchestrator.ts`, `canonical-strategy-frontier.ts`)
- **Exact source insertion point**: none intended yet -- this module is deliberately research-only (`brokerAuthority: false`). No integration action is being requested; listed here only so this queue is the complete picture of Claude-side H/D work Codex should be aware exists, per this item's exact directive language ("Include at minimum ... H/D shadow orchestration").
- **Current defect**: none.
- **Accepted architectural constraint**: THETA_HOLD_STRIKE and THETA_DEFINED_RISK remain research-only per `docs/operations/THETA_IMPLEMENTATION_BOARD.md`'s "Strategy authority" row -- "source selection and Paper plan assembly explicitly reject them." This queue item does not ask Codex to change that.
- **Expected change**: none required. Re-evaluate only if/when H/D graduate past research-only per a real Codex decision.
- **State**: NO_ACTION_REQUIRED (informational).

## Q-3: `src/providers/*` entry-point ambiguity (method census finding)

- **Priority**: LOW
- **Claude source commit**: `8a088fc`
- **Source artifact**: `docs/research/THETA_METHOD_USAGE_CENSUS.md`
- **Production subsystem**: `src/providers/` (capability-registry.ts, optionomics-mcp-qualification.ts, optionomics-qualification.ts, provider-family-health.ts, provider-readiness.ts, readiness-handler.ts, readiness.ts)
- **Exact source insertion point**: N/A -- this is a question, not a patch.
- **Current defect**: static-import census shows 0 of these 7 files on the real worker entry's path; they are imported only by `src/theta/autonomous-runtime-handler.ts`, itself not reached from `src/worker/index.ts`'s static chain.
- **Accepted architectural constraint**: none known -- this may be a real, separate ops/admin entry point (dynamic import, HTTP route, CLI) this pass's static-analysis method cannot see, or it may be genuinely unwired.
- **Expected change**: Codex confirms (a) what invokes `autonomous-runtime-handler.ts` in the real running system, or (b) that these 7 files are not currently exercised.
- **Producer/consumer/persistence/test/runtime-proof**: N/A until (a) or (b) above is answered.
- **State**: NEEDS_CODEX_CONFIRMATION.

## Q-4: `IV_EXPANSION` loss cause -- missing entry-IV baseline producer

- **Priority**: MEDIUM
- **Claude source commit**: `2bbead2` (`THETA_LOSS_CAUSE_CODEX_WIRING.md`)
- **Source artifact**: `docs/research/THETA_LOSS_CAUSE_CODEX_WIRING.md`
- **Production subsystem**: `management-input-state.ts` / whatever persists entry-time contract snapshots
- **Exact source insertion point**: wherever the entry-time option contract snapshot is first persisted (candidate acceptance path) -- entry IV is not currently persisted for later comparison against `snapshotContract.iv` at management time.
- **Current defect**: no real producer for "IV at entry" exists, so `IV_EXPANSION`'s real evidence source (entry-IV vs. current-IV delta) cannot be computed today.
- **Accepted architectural constraint**: this is a genuinely new producer, not a rewire -- a prior-wave finding, not new scope invented this pass.
- **Expected change**: persist entry-time IV alongside the other entry snapshot fields already captured.
- **State**: OPEN, not yet scoped in detail (prior-wave finding, restated here so it is not lost).

## Q-5: `OWNERSHIP_DETERIORATION` loss cause -- `expertPriorState` hardcoded null

- **Priority**: MEDIUM
- **Claude source commit**: `2bbead2`
- **Source artifact**: `docs/research/THETA_LOSS_CAUSE_CODEX_WIRING.md`
- **Production subsystem**: `theta-shadow-cycle.ts`
- **Exact source insertion point**: `theta-shadow-cycle.ts:383` -- `expertPriorState: null`, hardcoded unconditionally (same pattern class as the `riskState: null` gap Codex already closed differently for assignment capacity).
- **Current defect**: no real ownership-quality producer feeds this field on any real cycle.
- **Accepted architectural constraint**: none known.
- **Expected change**: a real ownership-quality signal, or an explicit decision that this stays `NOT_INDEPENDENTLY_VERIFIED`/`UNKNOWN` by design.
- **State**: OPEN, not yet scoped in detail (prior-wave finding, restated here so it is not lost).

## Q-6: AEGIS stress producers (`stressIvShockDetected`, `stressSpreadWideningDetected`) still null

- **Priority**: HIGH (real AEGIS risk-family input, not a research nice-to-have)
- **Claude source commit**: prior wave (AEGIS null-supplier diagnosis, DONE per execution board) + `5054946` (baseline-maturity contract, Codex-hardened)
- **Source artifact**: `src/research/aegis-stress-baseline-maturity.ts`, `docs/research/THETA_AEGIS_FIRST_PAPER_POLICY_OPTIONS_V2.md`
- **Production subsystem**: `bots/theta/quant/models/aegis.py` (`_system()`), fed via `aegis_contract.py`
- **Exact source insertion point**: wherever `stressIvShockDetected`/`stressSpreadWideningDetected` are currently always passed as `null` into the AEGIS contract call.
- **Current defect**: `_system()` (the SYSTEM risk family) requires 3 non-None stress signals; 2 of 3 are always `None` today (`stressGapDetected` is the only real one), so the SYSTEM family can never reach its full evaluation.
- **Accepted architectural constraint**: per `docs/operations/THETA_RESOLVED_AND_ACTIVE_WORK.md`'s `AEGIS_NULL_SEMANTICS = UNDERSTOOD` -- null stress inputs correctly hold new risk (fail-safe), this is not a false-positive bug; it is a missing-producer gap.
- **Expected change**: real IV-shock and spread-widening baseline detectors, using `aegis-stress-baseline-maturity.ts`'s state machine (`BASELINE_ACCUMULATING`/`BASELINE_SUFFICIENT`/`DETECTOR_READY`/`BASELINE_INVALID`) to honestly report readiness rather than silently staying null forever.
- **Producer**: TBD (Codex's real PIT baseline work, per `docs/operations/THETA_IMPLEMENTATION_BOARD.md`'s "AEGIS stress" row).
- **State**: OPEN, EXTERNALLY_TRACKED (already on Codex's own implementation board as active work -- listed here for completeness, not as new scope).

## Q-7: Python runtime contract wiring (5 unwired contracts) -- RESOLVED, NO WIRE NEEDED

- **Priority**: N/A
- **Source artifact**: `docs/research/THETA_PYTHON_RUNTIME_CONTRACT_DISPOSITION_RESEARCH.md`
- **Disposition**: `assignment_contract.py` -> `SUPERSEDED_BY_TS_AUTHORITY` (Codex's `b9cd49a` already built a simpler, real TS-native alternative). `covered_call_contract.py`, `management_contract.py`, `recovery_contract.py` -> `QUARANTINED` (all three trace to the same already-rejected "Pipeline B" TS orchestrator cluster, only reachable via `autonomous-runtime-handler.ts`, itself not on the real worker entry's path -- confirms, does not contradict, the existing quarantine). `har_rv_contract.py` -> `RESEARCH_ONLY` (self-declared in its own docstring, confirmed).
- **State**: CLOSED -- no Codex action required. One open question recorded for whoever eventually builds a real management-candidate source: whether the pure models (`covered_call_ranker`, `management_action_value`, `recovery_decision`) are reusable computation independent of their current quarantined orchestrator wrappers. Not actioned by this pass.

## Q-8: `CALIBRATE_EXECUTION_GATE` -- config wired, calibration/latency/refresh still open

- **Priority**: MEDIUM (downgraded from HIGH this pass -- the configurability half is closed)
- **Claude source commit**: this wave's Batch 3 (`THETA_HARD_VS_SOFT_DECISION_AUDIT.md`)
- **PARTIALLY CLOSED (2026-09-22, verified against main `26af86f` "Version candidate quote age and retain safe runtime error headers")**: `theta-shadow-cycle.ts:206-215`'s real `candidateQuoteAgeSeconds(config, asOf)` now reads a versioned `candidateQuoteAgePolicy` (`policyVersion`/`effectiveAt`/`maxAgeSeconds`), validated (throws `CANDIDATE_QUOTE_AGE_POLICY_INVALID` on a malformed policy or a policy not yet effective at `asOf`) -- the "bare hardcoded literal" defect this queue row originally described is closed. Default remains 30s per Codex's own board notes; no threshold was loosened.
- **Still open** (unchanged from the original finding): (1) whether 30s is empirically calibrated -- now testable via a real policy-version change once R8 tooling has data; (2) whether THETA's own ingestion pipeline latency contributes to observed staleness (still no stage-level provider-receive vs. THETA-processing timestamps found this pass); (3) whether a stale-but-promising candidate gets a second, fresher-quote look before being discarded -- still no refresh/retry step found in the executable/non-executable partition (`new-risk-orchestrator.ts:413-432`), though a separate, narrower exact-contract pre-submit refresh now exists at the execution layer (`alpaca-execution-quote-source.ts`, main `1bcf854`) -- distinct from a candidate-funnel refresh, not yet confirmed to resolve this.
- **Expected change**: (1) instrument ingestion-latency stage timestamps; (2) research/decide whether a bounded shortlist refresh upstream of AEGIS is worth adding (this wave's item 17D -- full-chain refresh vs. bounded shortlist tradeoff, no empirical shortlist size to be invented without evidence); (3) use the historical false-reject tooling (already built) to test calibration once Q-10 data lands.
- **Producer**: `theta-shadow-cycle.ts`'s `candidateQuoteAgeSeconds` (real, done).
- **Consumer**: `new-risk-orchestrator.ts`'s executable/non-executable partition.
- **State**: OPEN, MEDIUM priority (narrower scope than before).

## Q-9: RETRACTED -- was a false positive, corrected on direct re-read

The original Q-9 ("wire real management-candidate discovery into the
policy-evidence provider") claimed `createPaperBootstrapManagementPolicyProvider()`
being called with zero arguments at `autonomous-runtime.ts:353-354` blocks
the real roll/CC candidate arrays from reaching valuation. **This was
wrong**, found on direct re-read of
`PaperBootstrapManagementPolicyProvider.evaluate()`
(`paper-bootstrap-management-policy.ts:1136-1159`):

```ts
const discovered = discovery?.state === 'READY' && state.evidenceBundle.timingState !== 'FUTURE_EVIDENCE'
  && targetQuotesTimely ? discovery : null;
return evaluatePaperBootstrapManagementPolicy({ ...state, rollCandidate, ccCandidate,
  rollCandidates: discovered?.rollCandidates ?? rollCandidates,
  ccCandidates: discovered?.ccCandidates ?? ccCandidates,
  rollCcCandidates: discovered?.rollCcCandidates ?? rollCcCandidates });
```

`discovery` comes from `state.managementCandidateDiscovery`, populated by
the real `ProductionPaperManagementCandidateSource` via
`assembleAndPersistOpenChains()` -- a path entirely independent of the
constructor's `noCandidates` default. That default only governs the
SINGULAR `rollCandidate`/`ccCandidate` fallback fields, used only when
the array is empty/undefined or discovery isn't `READY`/PIT-timely.
Confirmed further: `valueForRollFromCandidates`/`valueForRollCcFromCandidates`/
`valueForSellCcFromCandidates` are each called in preference to the
single-candidate fallback exactly when `state.rollCandidates`/
`rollCcCandidates`/`ccCandidates` is non-empty
(`paper-bootstrap-management-policy.ts:828-834, 951`). **No Codex action
required.** `ROLL_CC_CANDIDATE_SOURCE` and `ROLL_CC_CANDIDATE_VALUATION`
corrected to `REAL` in the capability registry.

## Q-10: Data access for historical false-reject replay (Sep 16/18/21)

- **Priority**: MEDIUM -- unblocks real measurement of the false-paralysis question this whole engagement centers on, but is a research request, not a Production defect
- **Claude source commit**: this wave's Batch 3-4 (`historical-false-reject-analyzer.ts`, `THETA_HISTORICAL_FALSE_REJECT_REPLAY.md`)
- **Source artifact**: `src/research/historical-false-reject-analyzer.ts` (real, tested, 7 tests passing), `docs/research/THETA_HISTORICAL_FALSE_REJECT_REPLAY.md`
- **Current defect**: not a defect -- this research branch (a git worktree with no configured database connection) cannot reach the real Aiven-persisted candidate/quote/AEGIS rows for Sep 16/18/21 needed to run the analyzer for real.
- **Expected change**: either (a) grant this research environment read-only access to the relevant persisted evidence tables, or (b) Codex exports the Sep-16/Sep-18/Sep-21 `contractCandidates`/quote/AEGIS-assessment rows to a file this branch can read. `src/research/historical-replay-import.ts` (built this pass) now defines the exact real, tested import contract Codex should target -- every required field named, `ABSENT_IN_HISTORICAL_SCHEMA` for anything the historical schema never captured.
- **RECHECKED (2026-09-22, against main `26af86f`)**: Aiven writes are now restored (per `THETA_IMPLEMENTATION_BOARD.md`), but this pass found no NEW export/replay tool on main since the last check -- `tools/theta-research-export.ts`/`PostgresDatasetExporter` is a real, pre-existing exporter, but it requires the same live DB connection this research worktree still does not have configured; it is not a sanitized point-in-time historical replay export and was not built for this purpose. **Q-10 remains open**, not resolved by Aiven's write restoration alone (write access ≠ this research environment's read access).
- **Producer**: the already-persisted real evidence from those 3 sessions (exists today, per the Sep-21 forensic doc already cited repeatedly).
- **Consumer**: `historical-false-reject-analyzer.ts`'s `assessFalseReject`/`aggregateFalseRejectDay`, fed via `historical-replay-import.ts`'s validator.
- **Persistence requirement**: none new -- read-only.
- **Test requirement**: N/A (analyzer + importer already have 14 passing tests against synthetic fixtures).
- **Runtime proof requirement**: N/A -- this is offline research analysis, not a runtime change.
- **State**: OPEN, MEDIUM priority.

## Q-11: Possible residual `DATA_INSUFFICIENT`/`NO_OPPORTUNITY` naming conflation in `runtime-behavior-diagnostic.ts`

- **Priority**: LOW -- an observation for Codex to confirm or dismiss, not a confirmed defect
- **Claude source commit**: this wave (universe discovery funnel research)
- **Production subsystem**: `src/theta/runtime-behavior-diagnostic.ts:137`
- **Exact source insertion point**: `else if (input.completeness === 'DATA_INSUFFICIENT' || input.candidateCount === 0) waitClassification = 'NO_OPPORTUNITY';`
- **Current defect (unconfirmed)**: main `49c912a` correctly fixed `production-shadow-runtime.ts` to set `completeness: 'DATA_INSUFFICIENT'` (not `'COMPLETE'`) when `discovery.candidates.length === 0` -- the real fix this wave describes. But this SEPARATE diagnostic file's `waitClassification` logic still folds `completeness === 'DATA_INSUFFICIENT'` into the SAME `'NO_OPPORTUNITY'` label as a genuinely complete, healthy zero-candidate scan. If `'NO_OPPORTUNITY'` is read downstream (by an operator or a future R8 consumer) as "the system worked and found nothing," an empty-universe scan could still present that way at this layer, even though the underlying `completeness` field is now honestly `DATA_INSUFFICIENT`.
- **Accepted architectural constraint**: this may be intentional -- `WaitClassification` could be a coarser, operator-facing bucket where the finer `completeness` distinction is preserved elsewhere (e.g. in the same diagnostic's `reasonCodes` or the underlying scan record) and this is not a real gap. This pass did not trace far enough to confirm either way -- flagged as a question, not asserted as a defect.
- **Expected change**: Codex confirms whether `WaitClassification: 'NO_OPPORTUNITY'` is ever presented without the underlying `completeness: 'DATA_INSUFFICIENT'` distinction still being visible/queryable nearby. If it is genuinely lost at this layer, consider a distinct `DATA_INSUFFICIENT_NO_OPPORTUNITY` (or similar) classification rather than folding it into `NO_OPPORTUNITY`.
- **State**: OPEN, LOW priority, observational.

---

## Closed this engagement (for Codex's awareness, not action)

- **Management candidate source (the P0-1 gap this engagement has
  tracked since early waves)** -- main `98b7204`/`bc85ba8`/`bbdfd54`/
  `1ca3e27` ("Wire broker-qualified management candidates before decision
  freeze" + CI proof + fixture alignment + persisted executability
  evidence, all merged this pass) built `src/theta/production-paper-
  management-candidate-source.ts` and wired it into
  `paper-bootstrap-management-policy.ts`, closing the long-standing gap
  where `createPaperBootstrapManagementPolicyProvider()` was called with
  zero args and both singular/array roll/CC candidate fields were
  unpopulated. Verified via merge + full suite (1822 pass, 13 skipped --
  2 new DB-env-gated tests) + tsc/lint/security-scan clean. **Wave 9
  correction**: this engagement's own Wave 9 Batch 2 audit initially
  claimed this closure was only partial (real discovery/persistence
  landed, but the array-based candidates supposedly still couldn't reach
  valuation) -- a direct re-read of
  `PaperBootstrapManagementPolicyProvider.evaluate()` found that claim
  was a false positive (see the retracted Q-9 above). The P0-1 gap is
  now confirmed **fully closed**, not partially.

- Assignment-capacity producer -- **Codex closed this independently and then marked it formally closed** across 3 more real commits this pass (`e64d554` "Verify already-secured put capacity for assignment management", `6a359a0` "Mark assignment capacity engineering defect closed", `52e6ea5` "Record verified R7 assignment and Aiven recovery checkpoint" -- see the new `docs/operations/THETA_R7_ASSIGNMENT_AND_DR_RECEIPT_2026-09-22.md`). Confirmed via merge + full suite (1812 pass). No open row for this in the queue above, and none should be re-added unless a NEW regression is found.
- AEGIS baseline-maturity contract -- Codex reviewed and hardened it (`BASELINE_INVALID` state added), harvested into main.
- H/D generator contract-identity and quote-sync defects Codex found in review -- fixed by Claude, verified, no further action.

## Verification note (this update)

Re-checked Q-1, Q-4, Q-5, Q-6 against the 3 new main commits above (all
touch `management-action-frontier.ts` / `management-input-state.ts` /
`secured-contract-capacity.ts`, all assignment-capacity-scoped): none of
the 3 commits reference loss-cause evidence, entry-IV persistence,
`expertPriorState`, or the AEGIS stress producers. **All 4 rows remain
genuinely open** -- not stale, not accidentally closed by this merge.
