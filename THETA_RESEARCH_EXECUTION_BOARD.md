# THETA research execution board (Wave 6)

Anti-loop tracking per the Wave 6 directive (item 0). DONE tasks stay DONE
and are not re-read/re-audited unless main changes a dependency, a test
regression occurs, or new empirical evidence contradicts them. Statuses:
OPEN / BUILDING / TESTING / DONE / BLOCKED_EXTERNAL / SUPERSEDED.

Updated 2026-09-22 after commit `23890ef` (branch
`claude/theta-management-challenger`, pushed to origin; main merged to
`c009b7a` -- see H/D reconciliation update note).

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
| 2 | `THETA_METHOD_USAGE_CENSUS.md` completion | PARTIAL | file-level static-import BFS census done for all 243 TS files across src/theta, src/research, src/execution, src/providers, src/customer (124 PRODUCTION_REACHABLE / 54 RESEARCH_OR_SHADOW_REACHABLE / 65 TEST_ONLY_OR_UNREACHED); function-level census and bots/theta/quant Python census explicitly NOT done -- see doc's "What's not done" |
| 3 | Capability registry coverage percent | OPEN | not started this pass |
| 4 | Quantified unknown audit coverage | OPEN | not started this pass |
| 5 | Loss-cause integration contract | DONE | `loss-cause-integration-contract.ts` + `THETA_LOSS_CAUSE_CODEX_WIRING.md`: Codex wiring instructions added -- READY for 5 causes with real evidence sources, BLOCKED_EXTERNAL (MISSING_PRODUCER) for IV_EXPANSION/OWNERSHIP_DETERIORATION until their own upstream producers exist |
| 6 | `assignmentCapacity` field resolution | DONE | `THETA_ASSIGNMENT_CAPACITY_RESOLUTION.md`: 3 distinct fields traced; concept 3 is BUILD_PRODUCER; doc now also has unit/freshness/tests/expected-transition-change sections -- Codex handoff status READY |
| 7 | Correlation tooling completion | OPEN | not started this pass |
| 8 | Severe-downside tooling review/close | OPEN | not started this pass |
| 9 | Optionomics unresolved questions | OPEN | not started this pass |
| 10 | Six export consumers + shared validation lib | OPEN | not started this pass |
| 11 | Management outcome dataset (real code) | OPEN | not started this pass |
| 12 | WAIT regret dataset (real code) | OPEN | not started this pass |
| 13 | P1-P5 status doc | OPEN | not started this pass |
| 14 | R1-R9 status doc | OPEN | not started this pass |
| 15 | Brain matrix expansion beyond 19 rows | OPEN | not started this pass |
| 16 | Final brain readiness report | OPEN | not started this pass |
| 17 | Codex harvest check (main-change-gated) | DONE this pass | checked at start (merge to `2a50ad6`); recheck before final receipt of the full wave |

## Rule for future passes

Before touching any item above, check this table first. An item marked
DONE is not reopened unless: (a) `git fetch origin` shows main changed a
file that item depends on, (b) a test in this repo regresses, or (c) new
evidence (a Codex review note, a real runtime observation) contradicts the
finding. Record the trigger when reopening.
