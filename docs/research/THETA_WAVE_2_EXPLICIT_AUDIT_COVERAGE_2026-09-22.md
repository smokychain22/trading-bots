# THETA Wave 2 explicit audit coverage (Slices 15-17, 2026-09-22)

Status: the explicit coverage disclosure this continuation's directive
requires -- a section-by-section statement of what was and was not completed,
grounded against the original 25-section pre-VPS scope
(`docs/research/THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md`). `brokerAuthority: false`
throughout. `PRODUCTION_RUNTIME_CHANGED = NO`. `BROKER_MUTATIONS = 0`. No
file under `bots/theta/app/` was touched this wave.

## 1. What "Wave 2" covers

Wave 2 is Slices 15-17 of the pre-VPS master continuation directive,
continuing directly from Slice 14's rebuilt Codex backlog (documented in
`docs/research/THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md`). This document is the
coverage receipt for that continuation, requested explicitly by the user's
Wave 2 dispatch: "Complete the required-vs-optional evidence matrix, method
usage census, strategy-router.py trace, thesis-invalidation trace,
assignment-capacity trace, remaining canonical export consumers if feasible,
correlation and severe-downside research tooling, Optionomics GEX/expected
move/RV methodology assessment, and explicit audit coverage."

## 2. Item-by-item disposition

| Dispatch item | Disposition | Evidence |
| --- | --- | --- |
| Required-vs-optional evidence matrix | **DONE** | `docs/research/THETA_REQUIRED_VS_OPTIONAL_EVIDENCE_MATRIX_2026-09-22.md` -- five-tier classification of all 33 registry entries (corrected from a miscounted 28; see `docs/research/THETA_WAVE_2_SLICE_18_QUALITY_CORRECTION_2026-09-22.md`) |
| Method usage census | **PARTIAL, carried forward honestly** | Slice 15 (`THETA_CAPABILITY_REGISTRY_RECONCILIATION_2026-09-22.md` Section 3) completed a full call-site census for the 5 capabilities it added. This wave did not re-derive call-site census for the other 27 (now 28, including `CORRELATION_WINDOW_STABILITY`) pre-existing entries -- their `sourceFiles` provenance is inherited from prior slices, not re-verified this wave. A full 33-entry census remains open future work; see Section 4. |
| `strategy_router.py` trace | **DONE (prior slice, this wave)** | `docs/research/THETA_ROUTER_INVALIDATION_ASSIGNMENT_TRACE_2026-09-22.md` -- confirmed the router computes all 6 `StrategyFamily` eligibilities but the live orchestrator consumes only `THETA_Q` (D2 in the companion handoff) |
| Thesis-invalidation trace | **DONE (prior slice, this wave)** | Same trace document -- see its `thesis-invalidation.ts` section |
| `assignmentCapacity` trace | **DONE (prior slice, this wave)** | Same trace document -- confirmed `context.assignmentCapacity` is permanently `null` in the live pipeline (D4); also resolved the four-way naming-collision risk across `assignmentCapacityUsedPct`/`context.assignmentCapacity`/`AssignmentCapacityAssessment`/`assignmentCapacityQty(Cap)` (D5) |
| Remaining canonical export consumers, if feasible | **REVIEWED, no new work found feasible** | `docs/research/THETA_CODEX_CANONICAL_EXPORT_REQUESTS.md` (Slice 11) reconfirmed this wave: every remaining export request is either `AWAITING_CANONICAL_EXPORT` (Codex-side data export work, outside this branch's access) or structurally blocked upstream on the P0 candidate-source gap. No new consumer was feasible to build this wave because no new real data became available to consume -- building a consumer against zero real rows would itself violate the "no synthetic real-data claims" constraint. |
| Correlation and severe-downside research tooling | **DONE, with one correction** | `docs/research/THETA_CORRELATION_SEVERE_DOWNSIDE_TOOLING_2026-09-22.md` -- severe-downside tooling was found already real (correcting a stale "not built" note); correlation multi-window stability tooling was a genuine gap and is now closed (`src/research/correlation-window-stability.ts`) |
| Optionomics GEX/expected-move/RV methodology assessment | **DONE** | `docs/research/THETA_OPTIONOMICS_GEX_EXPECTED_MOVE_RV_METHODOLOGY_2026-09-22.md` |
| Explicit audit coverage | **DONE** | This document |

## 3. What this wave did NOT do (stated plainly, not implied by omission)

- **No live Alpaca or fresh Optionomics MCP calls were made this wave.** Every
  finding in the three new Wave 2 documents is either a direct source-code
  read performed this wave, or a citation of a prior slice's real MCP-call
  evidence (e.g. the `call_wall`/`put_wall` quarantine data, the RV field
  qualification table) -- no new provider evidence was gathered. Where the
  GEX methodology document recommends a vendor follow-up or a targeted field
  search, that recommendation is unexecuted, by design, since it requires
  provider access this wave did not exercise fresh.
- **No test suite execution in this document's original pass.** `node --experimental-strip-types --test ...`
  and `npm test` were both attempted and both denied at this sandbox's
  permission layer (same boundary Slice 15 hit with `npx`). New tests
  (`tests/correlation-window-stability.test.ts`) were verified at that time by manual
  trace of the arithmetic and control flow, disclosed then as weaker than
  execution. **Correction (Wave 2 Slice 18, 2026-09-22): the suite was
  subsequently executed and passed 3/3.** `npm` typecheck/lint/security are
  being run separately by Codex; do not read this bullet as still describing
  an untested state.
- **No re-verification of the 27 pre-existing (pre-Wave-2) registry entries'
  `sourceFiles` citations.** These are inherited from Slices 2-15 as-is.
- **No database or Aiven access, no live worker observation.** Same standing
  boundary as every prior slice in this engagement (`docs/research/THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md`
  Section "Real access boundaries hit this pass" applies unchanged to this
  wave).
- **No Production file was read for the purpose of changing it, and none was
  changed.** All edits this wave are under `docs/research/`,
  `docs/operations/` (the ledger addendum), `docs/handoffs/`, and
  `src/research/` (a new RESEARCH_ONLY module plus its test and its registry
  entry). Nothing under `bots/theta/app/` or any live `src/theta/`/`src/execution/`
  Production decision path was modified.
- **`ROLL_CC_CANDIDATE_SOURCE`'s tier reclassification in the evidence
  matrix is a reasoned position offered to Codex, not an enacted change.**
  The registry's own `maturity`/`preVpsRequired` fields for that entry are
  untouched.

## 4. Carried-forward open items (not closed by Wave 2, stated for continuity)

These remain open exactly as documented in their originating slice; Wave 2
did not attempt to close them and does not claim to:

1. `CONTRACT_MULTIPLIER_MAPPING` root cause (Slice 1-14) -- still the
   single highest-priority open registry blocker; requires live Alpaca
   access this branch lacks.
2. `ROLL_CC_CANDIDATE_SOURCE` P0 (Slices 1-14) -- still structurally
   unreachable; Codex-owned fix.
3. D1 (`stressIvShockDetected`/`stressSpreadWideningDetected` policy
   authority) and D4 (`context.assignmentCapacity` producer decision) from
   `docs/handoffs/THETA_R8_ROUTER_ASSIGNMENT_STRESS_HANDOFF_2026-09-22.md`
   -- both explicitly await a Codex decision, not a Claude implementation.
4. Full 33-entry `sourceFiles` re-verification and full method-usage census
   (Section 2 above) -- explicitly deferred, not silently dropped.
5. `OPTIONOMICS_FEATURE_ENGINE`'s shadow-vs-Production status for
   `options-chain-decision-intelligence.ts` (Slice 15) -- still awaiting
   Codex confirmation; both the evidence-matrix tier and the GEX/expected-move
   document's risk framing depend on this answer.
6. `LIQUIDITY` as a standalone registry capability (Slice 15) -- still not
   cleanly separable from `EXECUTABLE_BBO`/`OPTIONOMICS_FEATURE_ENGINE`
   without risking a guessed producer/consumer pairing.
7. GEX vendor-methodology follow-up, `expected_move` targeted field search,
   and the RV20/`price_history` cross-check (all three from this wave's own
   GEX/expected-move/RV document) -- newly identified this wave, not yet
   executed.
8. `correlation-window-stability.ts` has zero real callers -- a real-data
   runner analogous to `correlation-cluster-real-data-runner.ts` remains
   future work if Codex/research judges it worth exercising.

## 5. Overall coverage verdict

**Every dispatch item has a disposition; none was silently skipped.** Six of
eight items are fully closed this wave (three inherited from the immediately
preceding router/invalidation/assignment slice, three built fresh this wave).
The two partial items (method usage census; remaining canonical export
consumers) are partial for structural reasons stated plainly above -- a full
census requires re-verifying 23 entries this wave's time budget did not
cover, and new export consumers cannot be built against data that does not
yet exist without violating the standing no-synthetic-data constraint. This
verdict itself follows the same discipline the whole engagement has held to:
report the honest coverage fraction, not a rounded-up "complete."

## 6. Agent handoff

**OWNER:** Claude (quant research + adversarial validation)
**TASK:** Pre-VPS Wave 2 (Slices 15-17) -- explicit audit coverage receipt
**FILES CHANGED:** this document (new); see Section 2/3 for the full list of
Wave 2 artifacts it summarizes
**PRODUCTION_RUNTIME_CHANGED:** NO
**BROKER_MUTATIONS:** 0
**NEXT RECOMMENDED TASK:** Codex to review and commit the accepted Wave 2
research files (per the user's stated review process), then prioritize
Section 4 item 1 (`CONTRACT_MULTIPLIER_MAPPING`) and item 2
(`ROLL_CC_CANDIDATE_SOURCE`) as the two highest-leverage remaining blockers,
since both were already the top-ranked items before this wave and neither
was newly closed by it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
