# THETA research execution board (Wave 6)

Anti-loop tracking per the Wave 6 directive (item 0). DONE tasks stay DONE
and are not re-read/re-audited unless main changes a dependency, a test
regression occurs, or new empirical evidence contradicts them. Statuses:
OPEN / BUILDING / TESTING / DONE / BLOCKED_EXTERNAL / SUPERSEDED.

Updated 2026-09-22 after commit `2b36102` (branch
`claude/theta-management-challenger`, pushed to origin; main merged to
`b710e2e`, which independently converged on the same "avoidable unknown /
implementation blocker" readiness composite this branch's own
reclassification research arrived at -- see
`src/theta/first-paper-blocker-budget.ts` and
`src/theta/option-executability-diagnostics.ts`, real, Codex's own work,
not touched this pass).

## Carried over from before Wave 6 (already DONE -- do not redo)

| Item | Status |
|---|---|
| Canonical evidence matrix reconciliation | DONE |
| Economic-authority deep trace | DONE (corrected note added this pass, finding still stands) |
| Hold-Strike shadow generator (initial build) | DONE (hardened this pass, see below) |
| Defined-Risk shadow generator (initial build) | DONE (hardened this pass, see below) |
| CONTRACT_NOT_EXECUTABLE cause classification | DONE |
| AEGIS deterministic null-supplier diagnosis | DONE |
| AEGIS baseline-maturity contract | DONE (Codex-hardened version harvested, merge commit `5054946`) |
| AEGIS first-Paper policy options | DONE |

## Wave 6 numbered items

| # | Item | Status | Notes |
|---|---|---|---|
| 0 | Anti-loop execution board | DONE | this file |
| -- | H/D generator correction (Codex review response) | DONE | commit `f346cc4`: contract-identity gate (H), `requireSynchronizedFreshQuotes` gate (D), 5 new tests, reconciliation doc, 5 downstream docs corrected |
| 1 | `shadow-strategy-orchestrator.ts` | DONE | commit `db3143d`: 6-family dispatcher, Q reference-only, H/D real generation, A/C/R lifecycle handoff, 10 tests |
| 2 | `THETA_METHOD_USAGE_CENSUS.md` completion | DONE | file-level TS census (243 files) + decision-relevant exported-symbol keyword census (407 symbols, 236 production-reachable) + real Python bridge-wiring census (9/14 runtime contracts wired, 5 unwired -- real Codex handoff, management-lifecycle family) + committed reusable generator `tools/theta-method-census.mjs`. Remaining named gaps (Python-internal import graph, exact DEAD/TEST_ONLY boundary noise) are disclosed limitations, not silently absorbed |
| 3 | Capability registry coverage percent | DONE | `THETA_CAPABILITY_COVERAGE_DENOMINATOR.md`: reconciled provider-scoped vs system-scoped registries (no 3rd created); found 7 real gaps against the directive's 27-domain universe (STRATEGY_ROUTING, EXECUTION_QUALITY, ASSIGNMENT_CAPACITY, RECOVERY_LIFECYCLE, COPY_ENGINE, VOLATILITY_SURFACE, EMPIRICAL_LEARNING_GOVERNANCE), added as real source-grounded rows to `pre-vps-capability-registry.ts` (33->40 rows); 100% of 27-domain universe now has >=1 row; existing 7 registry tests still pass unmodified |
| 4 | Quantified unknown audit coverage | OPEN | not started this pass |
| 5 | Loss-cause integration contract | DONE | `loss-cause-integration-contract.ts` + `THETA_LOSS_CAUSE_CODEX_WIRING.md`: Codex wiring instructions added -- READY for 5 causes with real evidence sources, BLOCKED_EXTERNAL (MISSING_PRODUCER) for IV_EXPANSION/OWNERSHIP_DETERIORATION until their own upstream producers exist |
| 6 | `assignmentCapacity` field resolution | DONE + CODEX_CLOSED | main `b9cd49a` built a real broker-backed producer (independent of the exact patch proposed, stronger -- adds explicit evidence state). No further action. |
| 7 | Correlation tooling completion | DONE | pre-existing from earlier waves; confirmed DONE per Wave 7 directive's own closed-work list, not re-touched |
| 8 | Severe-downside tooling review/close | DONE | pre-existing from earlier waves; confirmed DONE per Wave 7 directive's own closed-work list, not re-touched |
| 9 | Optionomics unresolved questions | OPEN | not started this pass |
| 10 | Six export consumers + shared validation lib | OPEN | not started this pass |
| 11 | Management outcome dataset (real code) | OPEN | not started this pass |
| 12 | WAIT regret dataset (real code) | OPEN | not started this pass |
| 13 | P1-P5 status doc | OPEN | not started this pass |
| 14 | R1-R9 status doc | OPEN | not started this pass |
| 15 | Brain matrix expansion beyond 19 rows | OPEN | not started this pass |
| 16 | Final brain readiness report | OPEN | not started this pass |
| 17 | Codex harvest check (main-change-gated) | DONE this pass | checked at start (merge to `2a50ad6`); recheck before final receipt of the full wave |

## Wave 7 items (2026-09-22)

| # | Item | Status | Notes |
|---|---|---|---|
| W7-1 | `THETA_CODEX_INTEGRATION_QUEUE.md` | DONE | 7 open rows (Q-1..Q-7), consolidates prior handoffs; closed items removed not marked; Q-7 (Python contracts) resolved to NO_WIRE_NEEDED via W7-2 |
| W7-2 | Python runtime contract disposition | DONE | `THETA_PYTHON_RUNTIME_CONTRACT_DISPOSITION_RESEARCH.md`: assignment_contract.py=SUPERSEDED_BY_TS_AUTHORITY, covered_call/management/recovery_contract.py=QUARANTINED (traced to same already-rejected Pipeline B TS cluster), har_rv_contract.py=RESEARCH_ONLY (self-declared, confirmed). No Codex wire recommended for any of the 5. |
| W7-3 | Quantified unknown audit | OPEN | not started this pass |
| W7-4 | Managed-episode outcome distribution contract | OPEN | not started this pass |
| W7-5 | Entry/why-now research framework | OPEN | not started this pass |
| W7-6 | Profit-taking experiment system | OPEN | not started this pass |
| W7-7 | Optionomics RV5/10/30/60 + expected move + GEX PIT | OPEN | not started this pass |
| W7-8 | Expert/trader prior registry | OPEN | not started this pass |
| W7-9 | Six remaining export consumers | OPEN | not started this pass |
| W7-10 | Management outcome dataset (real code) | OPEN | not started this pass |
| W7-11 | WAIT/opportunity regret dataset | OPEN | not started this pass |
| W7-12 | R8 governance reconciliation | OPEN | not started this pass |
| W7-13 | Brain matrix expansion to 27-domain universe | OPEN | not started this pass |
| W7-14 | Final brain readiness report | OPEN | not started this pass |

## Wave 8 items (2026-09-22) -- "find false paralysis" wave

| # | Item | Status | Notes |
|---|---|---|---|
| W8-1 | Codex queue update after main merge | DONE | verified all 4 open rows still genuinely open against main `52e6ea5`; SHA-stamped; then main advanced again to `1ca3e27` closing the long-tracked P0-1 management-candidate-source gap (`production-paper-management-candidate-source.ts`, wired into `paper-bootstrap-management-policy.ts`) -- merged, verified (1822 pass), recorded in queue's closed section |
| W8-2 / W9-2 | Quantified unknown audit | DONE | `THETA_QUANTIFIED_UNKNOWN_AUDIT.md` + committed `tools/theta-unknown-audit.mjs`, reuses the 40-row capability registry as denominator (no new one built). AVOIDABLE_UNKNOWN_COUNT=10, DATA_EXISTS_BUT_NOT_WIRED=5, DATA_EXISTS_BUT_NOT_CONSUMED=3, LEGITIMATE_UNKNOWN=14. Found + corrected 2 stale registry rows (ASSIGNMENT_CAPACITY now closed per main; ROLL_CC_CANDIDATE_SOURCE partially closed -- real discovery/persistence landed, one narrow wire remains). Added Q-9 to Codex queue. |
| W9-1 | Quote-freshness/spread-width classification correction | DONE | corrected per owner review: minimum executable market quality is a legitimate HARD_EXECUTION_REQUIREMENT, not a defect to soften; Q-8 renamed CONFIGURE_AND_CALIBRATE_EXECUTION_GATE |
| W10-0 | Q-9 recheck | DONE, FALSE_POSITIVE | direct re-read of paper-bootstrap-management-policy.ts confirmed the array-based roll/CC candidates ARE reachable via state.managementCandidateDiscovery, independent of the noCandidates constructor default. ROLL_CC_CANDIDATE_SOURCE/VALUATION corrected to REAL in registry; Q-9 retracted from Codex queue; misleading test renamed |
| W10-1 | Avoidable-unknown reclassification | DONE | `THETA_AVOIDABLE_UNKNOWN_RECLASSIFICATION.md`: split the old mixed count of 10 into FIRST_PAPER_HARD_SAFETY=1 (AEGIS stress, already Q-6), OPTIONAL_UNUSED_INTELLIGENCE=2, SHADOW_R8_GAP=3, INTENTIONALLY_QUARANTINED=1, NORMAL_PIPELINE_NOT_EVALUATED=1, CLOSED=3, NOT_FULLY_RESOLVED=1 (EVENT_RISK_STATE, honestly flagged not guessed) |
| W11-1 | Optionomics actionability matrix | DONE | `THETA_OPTIONOMICS_ACTIONABILITY_MATRIX.md`: adds decision-role (HARD_SAFETY/SOFT_RANKER/STRUCTURE_MODIFIER/SHADOW_ONLY/DO_NOT_USE/RESEARCH_ONLY) on top of already-thorough prior-wave provenance/PIT/methodology research (`THETA_OPTIONOMICS_GEX_EXPECTED_MOVE_RV_METHODOLOGY_2026-09-22.md`, not re-derived). Found: RV20/ATM-IV/VRP20 are PROVIDER_QUALIFIED but CAN_REPRESENT-only (not wired into the real entry ranker) -- the one concrete, low-risk next integration this matrix identifies. RV5/10/30/60 methodology, expected-move, GEX PIT status were ALREADY closed in Wave 2 Slice 17 -- confirmed still valid, not redone. |
| W11-2 | RV/expected-move/GEX methodology | ALREADY DONE (confirmed, Wave 2 Slice 17) | verified `THETA_OPTIONOMICS_GEX_EXPECTED_MOVE_RV_METHODOLOGY_2026-09-22.md` still accurate against current source -- RV20 QUALIFIED, RV5/10/30/60 PROVIDER_LIMITED, expected-move-native NOT_OBSERVED, expected-move-derived REAL with 2 disclosed methodology choices, GEX METHODOLOGY_UNVERIFIED, walls QUARANTINED (unchanged, not reopened) |
| W12-3 | Historical false-reject analyzer | DONE | `src/research/historical-false-reject-analyzer.ts`, 7 tests: reuses Codex's canonical `OptionExecutabilityCause`/blocker-budget vocabulary; never estimates a fill/quote/outcome; `counterfactualIdentifiability` (OBSERVED/ESTIMABLE/NOT_IDENTIFIABLE) is honest about evidence completeness |
| W12-4 | Sep-16/18/21 replay | TOOLING_READY, DATA_ACCESS_PENDING | `THETA_HISTORICAL_FALSE_REJECT_REPLAY.md`: analyzer built and tested but NOT run against real data -- this research worktree has no DB connection to the real persisted evidence. Honestly reported as blocked on data access (Q-10), not fabricated. |
| W13-1 | Optionomics authenticated receipt harvest | DONE | `THETA_OPTIONOMICS_AUTHENTICATED_RECEIPT_HARVEST.md`: MACRO_FED_EVENT_PIT=REAL (6 Aiven-verified rows), PROSPECTIVE_COMPANY_EARNINGS=PARTIAL (real numeric values, not yet promotable to hard gate), CORPORATE_ACTION_NEGATIVE_ASSURANCE=OPEN (unchanged) |
| W13-2 | `ThetaQualifiedSoftFeatureEvidence` | DONE | `src/research/qualified-soft-feature-evidence.ts`, 7 tests -- typed evidence for ATM_IV/RV20/VRP20, all fixed at `decisionRole: SOFT_RANKER`, `empiricalStatus` only escalates via explicit caller input |
| W13-3 | Shadow feature-contribution framework | DONE | `src/research/shadow-feature-contribution.ts`, 4 tests -- `bootstrapContribution` always `BOOTSTRAP_NON_EMPIRICAL`, never overwrites `currentProductionRank` |
| W13-4 | False-inactivity taxonomy | DONE | `src/research/false-inactivity-taxonomy.ts`, 6 tests -- 12 causes mapped to Codex's real `FirstPaperBlockerClass`; rates reported separately, never combined into one number |
| W13-5 | Historical replay import adapter | DONE | `src/research/historical-replay-import.ts`, 7 tests -- real Zod schema + validator (duplicate detection, PIT-future rejection, evidence-completeness flagging, `ABSENT_IN_HISTORICAL_SCHEMA` distinct from `null`), ready the moment Q-10 data lands |
| W14-1 | Q-8/Q-10 recheck against new main | DONE | Q-8 downgraded HIGH->MEDIUM: `candidateQuoteAgeSeconds()` now real, versioned, validated config (main `26af86f`) -- calibration/latency/refresh remain open, narrower scope. Q-10 rechecked: Aiven writes restored but no new export tool found on main; still OPEN, not resolved by write-restoration alone |
| W14-5 | Managed-episode outcome distribution | DONE | `src/research/managed-episode-outcome-distribution.ts`, 10 tests -- `Estimate<T>` never substitutes 0; CENSORED/OUT_OF_DOMAIN/INSUFFICIENT_DATA gate every field before EMPIRICALLY_UNPROVEN; KNOWN only from explicit caller-supplied real values, never inferred (no future-outcome leakage) |
| W15-13 | Historical broker-fact classifier | DONE | `src/research/historical-broker-fact-classifier.ts`, 7 tests -- 5 real classifications, requires POSITIVE explicit evidence (never infers harmlessness from age alone), defaults to UNKNOWN_CURRENT_IMPACT when evidence missing |
| W15-12 | Universe discovery funnel diagnostic | DONE | `src/research/universe-discovery-funnel.ts`, 7 tests -- identifies the exact first-empty pipeline stage from real per-stage records, never guesses from a zero-candidate count alone; reports missing stage coverage explicitly rather than guessing |
| W15-obs | Possible residual DATA_INSUFFICIENT/NO_OPPORTUNITY conflation | FLAGGED, Q-11 | `runtime-behavior-diagnostic.ts:137` folds completeness=DATA_INSUFFICIENT into the same NO_OPPORTUNITY wait classification as a genuine healthy empty scan -- unconfirmed, added as a LOW-priority question for Codex, not asserted as a defect |
| W17-2 | Canonical entry/why-now outcome dataset | DONE | `src/research/theta-entry-outcome-dataset.ts`, 14 tests -- `SourcedFeature<T>` envelope on every feature; rejects future feature timestamps, labelAvailableAt<decisionAt, KNOWN-with-null-value; signed/absolute delta and calendarDte/tradingSessionHorizon kept distinct; censored episodes structurally cannot carry a resolved outcome; earnings coverage cannot become CLEAR (no such value exists in the type) |
| W17-3 | Entry model readiness framework | DONE | `src/research/theta-entry-model-readiness.ts`, 11 tests -- gates DATASET_NOT_READY/INSUFFICIENT_EFFECTIVE_N/TRAINING_READY/TRAINED/CALIBRATION_FAILED/OOS_SUPPORTED from real sufficiency inputs; promotionEligible=true only after real calibration AND confirmed OOS; EvaluationMetrics has no accuracy/AUC/winRate field at all |
| W17-8 | WAIT/reject regret dataset | DONE | `src/research/wait-regret-dataset.ts`, 10 tests -- hardVsSoft is single-sourced from the real cause taxonomy, never caller-independent; a HARD_SAFETY_REJECT structurally cannot contribute to gateRegretRate/decisionRegretRate even with a favorable observed futureOutcome; falseAcceptRate always 0 by construction (not modeled by WAIT-only data, not estimated) |
| W17-7 | Management outcome dataset | DONE | `src/research/management-outcome-dataset.ts`, 10 tests -- atomic row (`ManagementOutcomeRow`) and cohort aggregate (`ManagementCohortAggregate`) are structurally distinct types, never mixed; censored (PnL=null) episodes excluded from resolved-N, never treated as loss/zero; ROLL action requires a real `lossCauseEvidenceRef` |
| W17-11 | AEGIS cold-start reverification | VERIFIED_COMPLETE, no rebuild | `THETA_AEGIS_COLD_START_REVERIFICATION.md`: all 3 required distinctions (current-safety-always-required, mature-detector-required, immature-baseline-never-unknown-to-false-or-silent-allow) confirmed already real in `aegis-stress-baseline-maturity.ts` -- no code change, per this wave's own "don't rebuild what's complete" instruction |
| W8-3 | `THETA_HARD_VS_SOFT_DECISION_AUDIT.md` | DONE | headline finding: quote-freshness (30s hardcoded) + spread-width, declared soft `EXECUTION_QUALITY`/`LIQUIDITY`, are the dominant real hard-reject cause (3,299/3,876 candidates, real R7 forensic evidence); RV/VRP/skew/term/GEX/flow/trend confirmed CAN_REPRESENT-only, not wired as gate or ranker anywhere in the real entry path; Q-8 added to Codex queue, HIGH priority |
| W8-4 | Historical false-reject analysis tooling | OPEN | not started this pass |
| W8-5 | Managed-episode outcome contract (tested code) | OPEN | not started this pass |
| W8-6 | Entry/why-now model framework | OPEN | not started this pass |
| W8-7 | Profit-taking experiment contracts | OPEN | not started this pass |
| W8-8 | Loss/recovery/CC downstream research | OPEN | not started this pass |
| W8-9 | Optionomics RV5/10/30/60 + expected move + GEX PIT | OPEN | not started this pass |
| W8-10 | Expert/trader prior registry | OPEN | not started this pass |
| W8-11 | Six remaining export consumers | OPEN | not started this pass |
| W8-12 | Management outcome dataset | OPEN | not started this pass |
| W8-13 | WAIT regret dataset | OPEN | not started this pass |
| W8-14 | Brain matrix (reachability columns) | OPEN | not started this pass |
| W8-15 | Final brain readiness (cause-separated NO/PARTIAL) | OPEN | not started this pass |

## Rule for future passes

Before touching any item above, check this table first. An item marked
DONE is not reopened unless: (a) `git fetch origin` shows main changed a
file that item depends on, (b) a test in this repo regresses, or (c) new
evidence (a Codex review note, a real runtime observation) contradicts the
finding. Record the trigger when reopening.
