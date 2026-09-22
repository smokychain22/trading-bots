# THETA pre-VPS audit -- scope and phased plan

The pre-VPS directive asks for 25 major sections: a machine-readable
capability registry, a rebuilt unknown ledger, a provider capability matrix,
a required-vs-optional evidence matrix, a strategy-router truth audit, full
entry and management end-to-end graphs, complete profit/loss/assignment/
recovery/CC/call-away audits, a canonical authority map, a static false-safe
scan, Optionomics field re-qualification, canonical export consumers,
correlation/severe-downside tooling, a metric catalog, data-sufficiency and
model-governance documents, a brain capability matrix, a pre-VPS acceptance
contract, and a Codex integration backlog -- each requiring genuine,
source-grounded tracing across a two-agent, multi-hundred-file codebase.

Attempting all 25 in a single pass would force a choice between (a) fabricating
or extrapolating findings to look complete, or (b) producing real findings for
a fraction of the surface while silently implying full coverage. Both violate
the directive's own governing principle: **"DO NOT MAKE THETA LOOK READY. MAKE
THETA ACTUALLY READY."** A false `ZERO_AVOIDABLE_UNKNOWN_READY = YES` or
`BOT_BRAIN_READY_FOR_FIRST_PAPER = YES` would be exactly the kind of "looks
ready" outcome the owner is explicitly guarding against.

This pass (Slice 1) therefore completed the highest-leverage, most
mechanically groundable pieces -- the ones that (a) can be verified against
real source and a real live-session forensic rather than speculation, and (b)
feed directly into most of the remaining sections:

## Completed this pass

- Merged current `origin/main` (`b1186f0`), verified clean (tsc/tests green), preserved all existing research commits.
- `THETA_PRE_VPS_UNKNOWN_LEDGER.md` -- 4 concrete, source-grounded unknown-register entries (3 confirmed avoidable, 1 high-priority undetermined) plus a companion false-safe/false-risk static scan of `src/theta/`/`src/execution/` (Production-critical paths).
- `THETA_CANONICAL_AUTHORITY_MAP.md` -- confirms exactly one real, reachable management authority; confirms the second array-based management architecture remains quarantined (zero real callers); confirms the cross-branch Pareto gap in `canonical-strategy-frontier.ts` is unchanged.
- `THETA_CODEX_PRE_VPS_INTEGRATION_BACKLOG.md` -- 2 P0 items, 3 P1 items, with exact file:line, required fix, and required tests.
- Grounded every finding in either a direct source read this pass or the real `docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md` live-session forensic (a genuine Aiven/Alpaca-derived document, not a simulation) -- notably, that forensic already answers a large share of directive items 21/22/24's spirit (what does "ready" actually mean, does THETA reach a real decision end to end) more authoritatively than a fresh code-only trace could, since it reflects an actual attempted live cycle.

## Completed in the master continuation pass (Slices 2-13)

Following the "continue through 2-14, stop only for a real access/provider/
tool boundary" instruction, this pass additionally completed:

- **Slice 2**: `THETA_PRE_VPS_CAPABILITY_REGISTRY.md` + `src/research/pre-vps-capability-registry.ts` (24 grounded entries, 7 tests, all passing).
- **Slice 3**: Expanded `THETA_PRE_VPS_UNKNOWN_LEDGER.md` beyond the 4-entry seed -- new findings in `src/providers/`, `src/customer/`, `src/database/`, and a refined AEGIS SYSTEM-family severity finding (forces continuous `HOLD_ONLY`, not merely "unevaluated").
- **Slice 4**: `THETA_STRATEGY_ROUTER_TRUTH_MATRIX.md` -- corrected a false assumption (`strategy-timing-router.ts` is NOT the real router; it's a diagnostic path), traced the real Python-bridge router, and found the live orchestrator only ever checks `THETA_Q` eligibility.
- **Slice 5**: `THETA_ENTRY_END_TO_END_GRAPH.md` -- arrow-by-arrow trace from worker cycle to broker mutation, cross-referenced against the real R7 forensic.
- **Slice 6**: `THETA_MANAGEMENT_END_TO_END_GRAPH.md` -- refined the known P0 gap: BOTH the array-based and singular roll/CC candidate mechanisms are unpopulated, blocking ROLL, ROLL_CC, **and** SELL_CC (not just ROLL as previously documented).
- **Slice 7**: `THETA_PROFIT_LOSS_ROLL_BRAIN_AUDIT.md` -- confirmed no universal P&L%-based stop-loss exists; confirmed real roll-immutability honoring; flagged `thesis-invalidation.ts` internals as an open follow-up.
- **Slice 8**: `THETA_ASSIGNMENT_RECOVERY_CC_CALLAWAY_AUDIT.md` -- confirmed THETA does NOT blindly sell a CC on assignment (a real basis-floor safety rule already exists, just unreachable).
- **Slice 9**: `THETA_PROVIDER_CAPABILITY_MATRIX.md` -- real Alpaca source-read coverage plus **real Optionomics MCP calls this session**; corrected a prior claim about order-submission code existing nowhere (it exists, in `src/execution/broker.ts`, correctly gated).
- **Slice 10**: `THETA_OPTIONOMICS_FIELD_QUALIFICATION_2026-09-22.md` -- real qualification of 13 fields via real MCP calls across real sessions/symbols; confirmed Vanna/Charm genuinely absent from the provider; confirmed the `call_wall`/`put_wall` quarantine stands.
- **Slice 11**: `THETA_CODEX_CANONICAL_EXPORT_REQUESTS.md`.
- **Slice 12**: `THETA_R8_METRIC_CATALOG.md`, `THETA_R8_DATA_SUFFICIENCY.md`, `THETA_R8_MODEL_GOVERNANCE.md`, `THETA_BRAIN_CAPABILITY_MATRIX.md`.
- **Slice 13**: `THETA_PRE_VPS_ACCEPTANCE.md`.
- **Slice 14**: `THETA_CODEX_PRE_VPS_INTEGRATION_BACKLOG.md` rebuilt.
- **Special investigation**: `THETA_CONTRACT_NOT_EXECUTABLE_INVESTIGATION.md` -- found the real executability gate has 10 independent conditions (not just multiplier); found the granular per-candidate rejection reason is already persisted, so Codex can resolve this WITHOUT a fresh live Alpaca pull as the first step.

## Wave 3 ("Master Research Completion Wave 3") pass -- what was completed and why the rest was not

Wave 3 asked for 20 further sections, several individually large enough to be
their own multi-day undertaking (a full method/config usage census across
the whole repo; expanding the capability registry from 24 to genuinely
exhaustive coverage; a genuinely exhaustive unknown ledger with a stated
`PRODUCTION_FILES_SCANNED`/`COVERAGE_PERCENT`; real correlation and
severe-downside research tooling built from scratch; finished, tested
canonical export consumers for 6 different domains). Attempting all 20 in
one pass at the same fabrication-risk standard this whole audit has held to
would mean either superficial coverage presented as complete, or genuinely
new code/tooling built without the review depth the rest of this engagement
applies. Neither is acceptable.

This pass instead prioritized the items that were (a) most concrete and
directly actionable via source reads rather than large tooling builds, and
(b) most likely to change the audit's own conclusions if wrong -- and one of
them did:

- **Reconciled DB status against current `main`** (item 1): `DATABASE_PORTABLE_BACKUP_VERIFIED`, `DATABASE_TEST_RESTORE_VERIFIED`, `STRUCTURE_PARITY`, and `DATA_PARITY` now read PASS with exact evidence from `main@0aa1aef`. `DATABASE_WRITABLE` correctly remains NOT YET PASS -- restore passing is never treated as proof Aiven is writable, per the directive's own instruction.
- **AEGIS SYSTEM/LIQUIDITY gap promoted to P0-0** (item 6) -- and, critically, **corrected and sharpened via a direct line-by-line read of `bots/theta/quant/models/aegis.py`** rather than accepted from the directive's own framing or a prior fork summary. The real finding is more severe than "SYSTEM family forces HOLD_ONLY": `_liquidity()` ALSO independently forces `HOLD_ONLY` from the same missing `stressSpreadWideningDetected` input, and worst-family-wins means `new_risk_state` is provably `HOLD_ONLY` or worse on every real Production AEGIS evaluation today, permitting ZERO new-risk-opening actions unconditionally -- independent of `CONTRACT_NOT_EXECUTABLE`. This is now the single most severe finding of the entire pre-VPS audit and has been propagated into every downstream document (acceptance contract, Codex backlog, capability registry, brain capability matrix).
- **Strategy router deep trace** (item 7): a complete, full read of `strategy_router.py` (259 lines) resolved a question the prior pass left open -- the Python router genuinely evaluates all 6 families every cycle and can represent multiple simultaneously-eligible entry branches (THETA_Q/THETA_H/THETA_D); the gap is entirely downstream, in what the TypeScript control flow chooses to act on.
- **Loss cause resolution matrix** (item 9) and **assignment capacity trace** (item 10): both fully resolved via complete direct reads of the relevant files (`thesis-invalidation.ts`, `loss-state-vector.ts`, `account-exposure.ts`), each under 170 lines and read in full rather than sampled.

## Wave 3 items NOT attempted this pass (explicitly deferred, not silently dropped)

- Full capability registry expansion beyond 24 entries to genuinely exhaustive coverage (item 2), and reconciliation with `src/providers/capability-registry.ts` (discovered but not yet read).
- A full method/config usage census (item 3).
- Genuine unknown-ledger exhaustiveness with a stated file-coverage percentage (item 4).
- A standalone required-vs-optional evidence matrix document (item 5).
- Pre-VPS strategy maturity target definition with precise Hold-Strike/Defined-Risk shadow candidate-generation integration steps (item 8) -- partially answered by the strategy router deep trace and the entry E2E graph's existing findings, but not written as its own dedicated deliverable.
- Correlation research tooling (item 11) and severe-downside tooling (item 12) -- both real, non-trivial builds, not attempted.
- Finished, tested canonical export consumers for the 6 pending domains (item 13) -- the request document exists; the consumers themselves do not.
- Optionomics RV-horizon/expected-move-derivation/GEX-PIT-status deep investigation (item 14) -- would require additional real MCP calls beyond this pass's scope.
- Vanna/Charm/GEX/flow authority audit as its own document (item 15) -- substantially answered already in the provider capability matrix and Optionomics field qualification docs from the prior pass.
- Full brain-capability-matrix expansion to every listed decision stage (item 16) -- the existing 19-row matrix was corrected for AEGIS this pass but not expanded to the directive's larger row list.
- `THETA_PRE_VPS_BRAIN_READINESS_REPORT.md` (item 17) -- not written as a separate document; its core questions are already answered across the existing acceptance contract, brain capability matrix, and this scope doc.

## Real access boundaries hit this pass (per the directive's own stop condition)

- **No live Alpaca API/MCP access** in this research environment -- `CONTRACT_NOT_EXECUTABLE`'s live-verification step and several `NOT_INDEPENDENTLY_VERIFIED` provider-matrix rows are genuinely blocked here; Codex has the access this branch lacks.
- **No Aiven/Production database read access** -- `WIDER_UNIVERSE_REAL_ROWS`, `BROKER_RECONCILIATION_HEALTHY` internals, and `DATABASE_WRITABLE` could not be independently re-verified.
- An org-level usage/rate limit was hit once mid-pass (a duplicate research fork failed with HTTP 429); it did not block completion since the fork's useful output had already landed before the limit hit, and the limit reset before the remainder of this pass.

## Still explicitly deferred

- **Required-vs-optional evidence matrix** (directive item 5) as its own dedicated document -- partially covered by the brain capability matrix and per-action audits, but not built as a standalone HARD_REQUIRED_SAFETY/REQUIRED_WHEN_APPLICABLE/ECONOMIC_RANKING_FEATURE/OPTIONAL_RESEARCH_MODIFIER/EMPIRICAL_FEATURE matrix.
- Correlation (20/60/120-session) and severe-downside (continuous/vol-normalized MAE) research tooling -- still not built; remains real, scoped future work (see the Codex export-requests doc's priority ordering, which gates on other P0/P1 items anyway).
- `bots/theta/quant/models/strategy_router.py` internals, `thesis-invalidation.ts` internals, and real population verification of `input.context.assignmentCapacity` -- all flagged as concrete, scoped follow-ups in the rebuilt Codex backlog, not silently dropped.
