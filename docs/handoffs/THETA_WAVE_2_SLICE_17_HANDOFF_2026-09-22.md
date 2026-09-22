OWNER: Claude (quant research + adversarial validation)

TASK: Research Completion Wave 2, Slice 17 -- required-vs-optional evidence
matrix, Optionomics GEX/expected-move/RV methodology assessment, correlation
window-stability tooling (new), severe-downside tooling status correction,
remaining canonical export consumers review, and explicit audit coverage.
Continues directly from Slice 16's router/invalidation/assignment-capacity
trace (`docs/handoffs/THETA_R8_ROUTER_ASSIGNMENT_STRESS_HANDOFF_2026-09-22.md`),
which already closed the strategy-router.py trace, thesis-invalidation trace,
and assignment-capacity trace items from this wave's dispatch.
`PRODUCTION_RUNTIME_CHANGED = NO`, `BROKER_MUTATIONS = 0`, `brokerAuthority: false`
throughout.

FILES CHANGED:
- `docs/research/THETA_REQUIRED_VS_OPTIONAL_EVIDENCE_MATRIX_2026-09-22.md` (new)
- `docs/research/THETA_OPTIONOMICS_GEX_EXPECTED_MOVE_RV_METHODOLOGY_2026-09-22.md` (new)
- `docs/research/THETA_CORRELATION_SEVERE_DOWNSIDE_TOOLING_2026-09-22.md` (new)
- `docs/research/THETA_WAVE_2_EXPLICIT_AUDIT_COVERAGE_2026-09-22.md` (new)
- `src/research/correlation-window-stability.ts` (new -- real, RESEARCH_ONLY module)
- `tests/correlation-window-stability.test.ts` (new -- 3 tests, not executed this pass, see below)
- `src/research/pre-vps-capability-registry.ts` (amended -- added `CORRELATION_WINDOW_STABILITY`, registry now 33 entries [corrected -- see the Wave 2 Slice 18 quality-correction note below; this file originally miscounted the total as 28]; no existing entry's fields were altered)
- `docs/operations/THETA_CURRENT_DEFECT_GAP_LEDGER.md` (amended -- added a "Wave 2 Slice 17 addendum" section only; all prior rows/content preserved verbatim, no closure counts changed)
- `docs/handoffs/THETA_WAVE_2_SLICE_17_HANDOFF_2026-09-22.md` (this file)

WHAT WAS IMPLEMENTED:
- A standalone required-vs-optional evidence matrix, classifying all 33
  registry entries (corrected from a miscounted 28) into a five-tier taxonomy (HARD_REQUIRED_SAFETY /
  REQUIRED_WHEN_APPLICABLE / ECONOMIC_RANKING_FEATURE /
  OPTIONAL_RESEARCH_MODIFIER / EMPIRICAL_FEATURE), including one reasoned
  (not enacted) tier-reclassification suggestion for Codex to accept or
  reject on `ROLL_CC_CANDIDATE_SOURCE`.
- A methodology assessment tying the existing GEX-definition research (4
  mutually inconsistent public methodologies, from a prior slice) directly
  to how `optionomics-feature-engine.ts` actually consumes Optionomics's
  `gamma_exposure`/`call_wall`/`put_wall` fields today; flags two previously
  undocumented methodology choices in the locally-derived expected-move
  approximation (per-contract IV, calendar-day scaling); reconfirms RV20 is
  the only qualified realized-vol horizon.
- A new real research module, `correlation-window-stability.ts`, closing a
  genuine gap (no tool previously compared correlation across the 20/60/120
  -session windows the dispatch named) -- and a correction to a stale "not
  built" note on severe-downside tooling, which was found to already be real
  and generic (`risk-policy-empirical-study.ts`).
- Confirmed the remaining canonical export consumers list
  (`THETA_CODEX_CANONICAL_EXPORT_REQUESTS.md`) is unchanged and no new
  consumer was feasible this wave (no new real data exists to consume).
- An explicit, item-by-item coverage disclosure against this wave's own
  dispatch, naming exactly what was and was not completed and why.

TESTS RUN: Not executed in this pass's original sandbox session -- `node
--experimental-strip-types --test ...` and `npm test` were both attempted
and both denied at this sandbox's permission layer (consistent with Slice
15's `npx` denial), so the three new tests in
`tests/correlation-window-stability.test.ts` were verified only by manual
trace at the time this handoff was written. **Correction (Wave 2 Slice 18,
2026-09-22): the suite was subsequently executed and the three
`correlation-window-stability.test.ts` tests passed 3/3.** `npm` typecheck/
lint/security are being run separately by Codex. Do not read this handoff as
still describing an untested state.

TEST RESULTS: `tests/correlation-window-stability.test.ts` -- 3/3 passed (see
correction above).

KNOWN LIMITATIONS: See `docs/research/THETA_WAVE_2_EXPLICIT_AUDIT_COVERAGE_2026-09-22.md`
Section 3 for the full disclosure. Summary: no fresh provider (Alpaca/Optionomics)
calls were made this wave; method usage census remains partial (6 of 33
entries have a full call-site census, the other 27 inherit unverified
provenance from prior slices); `correlation-window-stability.ts` has zero real
callers as of introduction.

RISKS: None introduced. All new code is under `src/research/` (RESEARCH_ONLY,
zero broker authority, zero Production callers). No file under `bots/theta/app/`
or any live Production decision path (`src/theta/`, `src/execution/`) was
modified. The ledger amendment is additive only.

NEXT RECOMMENDED TASK: Per `THETA_WAVE_2_EXPLICIT_AUDIT_COVERAGE_2026-09-22.md`
Section 6 -- Codex to review and commit the accepted Wave 2 files, run
`npm ci && npm test` to confirm the new tests actually pass (not just trace
correctly), and then prioritize the two still-open, highest-leverage
blockers unchanged by this wave: `CONTRACT_MULTIPLIER_MAPPING`'s root cause
and the `ROLL_CC_CANDIDATE_SOURCE` P0. Separately, D1 and D4 from Slice 16's
handoff (`docs/handoffs/THETA_R8_ROUTER_ASSIGNMENT_STRESS_HANDOFF_2026-09-22.md`)
still await an explicit Codex policy decision and were not touched by this
wave.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
