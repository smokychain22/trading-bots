# THETA hard-gate vs. soft-feature audit (Wave 8 Batch 3)

**Why this audit exists**: the owner's stated top concern is a bot with
real intelligence that still does nothing, because one missing/strict/
default field silently blocks every opportunity. This audit's job is to
find every place where a feature declared or intended as `SOFT_RANKING`
is actually implemented as a hard reject, using real source evidence, not
speculation.

## Correction (2026-09-22, per owner review)

The original version of this section recommended treating quote
freshness and spread width as if their hard-blocking behavior were
itself the defect. That was imprecise and is corrected here: **minimum
executable market quality is legitimately allowed to be a
`HARD_EXECUTION_REQUIREMENT`.** Pricing a real order against a quote that
is genuinely stale, or a spread that is genuinely too wide to fill
safely, is not false paralysis -- it is the gate working as intended. The
distinction that matters is:

- **`softFeatureFamilies` in `strategy-package.ts` labels these as
  `LIQUIDITY`/`EXECUTION_QUALITY` in the sense of "economics/ranking
  inputs for the candidate that survives"** -- i.e., once a contract is
  known executable, how liquid/tight it is can inform ranking or sizing.
- **That label does NOT mean "must never hard-block."** A separate,
  legitimate concept -- minimum executable market quality -- is
  correctly allowed to gate entry entirely. Conflating "feature family is
  soft for ranking economics" with "therefore this must never be a hard
  gate" was this audit's own error in its first version.

The real, still-open research questions are narrower and more useful than
"should this be soft":

1. **Is the 30-second threshold calibrated**, or just a plausible-sounding
   default? (Unchanged from the original finding -- still unproven either
   way.)
2. **Does the pipeline itself create staleness** -- i.e., is some of the
   3,299/3,876 rejection rate caused by how long THETA's own ingestion
   pipeline takes to fetch/process a quote before evaluating it, rather
   than genuine real-market quote staleness? If so, that is a latency
   defect, not a threshold-calibration question, and has a different fix
   (faster pipeline, not a looser gate).
3. **Does a finalist-refresh step recover real opportunities** -- i.e.,
   if a contract is rejected as stale, does anything re-fetch a fresh
   quote for a promising-but-stale candidate before finally discarding
   it, or is the first stale observation final? This pass found no
   evidence of a refresh/retry step in `new-risk-orchestrator.ts`'s
   executable/non-executable partition (`theta-shadow-cycle.ts:938` ->
   `new-risk-orchestrator.ts:413-432`) -- a candidate is evaluated once,
   against one quote snapshot, and permanently discarded if stale. This
   is the most concrete of the three questions and the one most likely to
   be real false paralysis if the answer is "no refresh exists."

**Q-8 in the Codex integration queue is corrected accordingly** (see
below): it now asks Codex to `CONFIGURE_AND_CALIBRATE_EXECUTION_GATE`,
not to demote quote freshness to a soft ranking feature.

## Headline finding, stated first because it is the most consequential

**Quote freshness and bid/ask spread width -- nominally `LIQUIDITY` /
`EXECUTION_QUALITY`, both listed as `softFeatureFamilies` in
`strategy-package.ts` for ranking purposes -- are legitimately allowed to
also be a `HARD_EXECUTION_REQUIREMENT` for entry, and correctly are one in
the live pipeline today.** The real, still-open question is whether the
specific threshold (30s, hardcoded) is calibrated, whether the pipeline's
own latency contributes to staleness, and whether a stale-but-promising
candidate ever gets a second, fresher look before being discarded.

**Exact code**: `src/theta/theta-shadow-cycle.ts:938` --
```ts
maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
```
This computes each contract's `executable: boolean` flag. `new-risk-orchestrator.ts:413-432`
then partitions every real candidate on that single boolean **before
anything else runs** -- a non-executable contract is recorded
`outcome: 'PASS', rejectionCategory: 'CONTRACT_NOT_EXECUTABLE'` and
`aegis: null, sizing: null, executionQuality: null` -- it never reaches
AEGIS, sizing, or economic ranking at all. This is a real, unconditional,
binary hard gate applied earliest in the pipeline, not a rank factor.

**Real-world empirical impact** (from this engagement's own prior R7 live-
session forensic, `docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md`,
and Codex's own `THETA_PRODUCTION_CLOSURE_WAVE1_2026-09-22.md`): of 3,876
real candidate rows observed, 3,299 were rejected as
`CONTRACT_NOT_EXECUTABLE` (2,014 stale-quote+wide-spread, 787 wide-spread-
only, 498 stale-quote-only), and the session recorded **0 positive-
quantity selections**. This is not a hypothetical risk -- it is this
engagement's own already-collected evidence of the exact failure mode the
owner described.

**The specific defect**: `maxQuoteAgeSecondsForExecutable: 30` is a bare
literal in `theta-shadow-cycle.ts`, not sourced from `config` the way
`maxSpreadPctForExecutable` is. There is no evidence in this codebase
that 30 seconds was empirically derived (vs. picked as a plausible-
sounding default) -- and no distinction between a contract that is
30-seconds-stale during a genuinely fast-moving market (where staleness
is a real risk) versus one that is 30-seconds-stale during a quiet,
wide-open-interest, thin-flow name (where a slightly older quote may
still be executable and the "reject" is pure false paralysis).

**Recommendation**: this is a real Codex integration task, not resolved
by this pass (added to the queue below). At minimum: (a) make
`maxQuoteAgeSecondsForExecutable` a real config value, not a hardcoded
literal, so it can be tuned without a code change; (b) build the R8
tooling (this wave's Batch 4, historical false-reject analysis) needed to
test empirically whether 30s is too strict, correctly calibrated, or too
loose, before touching the live threshold.

## Per-feature classification

For every feature the directive named, real classification from direct
source evidence (`canonical-strategy-frontier.ts`'s `commonEvidence`/
`singleLegPutCandidate`/`definedRiskCandidate`/`stockActionCandidate`/
`coveredCallCandidate` functions, `strategy-package.ts`'s declared
`hardRules`/`softFeatureFamilies`, `new-risk-orchestrator.ts`'s real
control flow, and `aegis.py`'s family logic already traced in prior
waves):

| Feature | Current producer | Declared role | Actual runtime effect | Should it block? | Recommendation |
|---|---|---|---|---|---|
| Quote freshness (30s) | `theta-shadow-cycle.ts` (hardcoded) | `EXECUTION_QUALITY` for ranking (soft); `HARD_EXECUTION_REQUIREMENT` for entry (legitimate, separate concept) | **HARD**, correctly -- unconditional pre-AEGIS exclusion, dominant real rejection cause (3,299/3,876) | **Yes, it should block** -- pricing against a stale quote is a real execution-safety concern, not false paralysis. Open question is calibration/pipeline-latency/refresh, not whether to block at all. | Make the threshold configurable; investigate pipeline-induced staleness and whether a refresh/retry step exists (none found this pass); R8-test calibration (Batch 4 tooling below) |
| Bid/ask spread width | `theta-shadow-cycle.ts` (`config.maxAcceptableSpreadPct`) | `LIQUIDITY`/`EXECUTION_QUALITY` for ranking (soft); `HARD_EXECUTION_REQUIREMENT` for entry (legitimate) | **HARD**, correctly -- same unconditional gate as above | **Yes, it should block** -- same reasoning as quote freshness | Already configurable; still needs R8 validation of the specific threshold, not a code fix |
| AEGIS family (`HOLD_ONLY`/`HARD_VETO`/`EMERGENCY_EXIT_ONLY`) | `aegis.py` via `aegis_contract.py` | Hard (per this engagement's own prior finding) | **HARD**, correctly so -- `canonical-strategy-frontier.ts:264` | Yes -- this is genuine safety, not false paralysis | No change; this is the gate working as intended |
| Assignment capacity (qty) | `canonical-strategy-frontier.ts:281-284` (real fallback derivation) | Hard when known-negative, soft/unknown otherwise | **HARD** only when `assignmentCapacityQty <= 0` (a real, known zero); **soft** (`unknownEvidence`, non-blocking) when unknown | Correct as-is -- blocking on a real known-zero is not false paralysis; not blocking on unknown avoids it | No change |
| Event state (`NEAR`/`CLEAR`/`UNKNOWN`) | `canonical-strategy-frontier.ts:265-266` | `EVENT_CONTEXT` (soft) | **Soft**, correctly -- pushed to `softEvidence`, never `hardBlockers`, in the real Production diagnostic path | Consistent with its declared role | No change in `canonical-strategy-frontier.ts` -- **but** note this engagement's own Hold-Strike/Defined-Risk *research* shadow generators (`hold-strike-shadow-candidate-generator.ts`) DO hard-reject on `EVENT_NEAR`/`EVENT_STATE_UNKNOWN`. That is a deliberate, disclosed research-generator design choice (documented in that file), not a Production defect -- flagged here only so the distinction is not lost. |
| IV | `canonical-strategy-frontier.ts:267` | `IV` (soft, per softFeatureFamilies) | **Soft/unknown-only** -- `unknownEvidence.push('IV_UNKNOWN')`, never a hard block | Consistent with declared role | No change -- but see "CAN_REPRESENT but not consumed as a ranker" note below |
| Delta | `canonical-strategy-frontier.ts:268` | soft | **Soft/unknown-only** | Consistent | No change |
| Open interest | `canonical-strategy-frontier.ts:269` | `VOLUME_OPEN_INTEREST` (soft) | **Soft/unknown-only** | Consistent | No change |
| Volume | `canonical-strategy-frontier.ts:270` | soft | **Soft/unknown-only** | Consistent | No change |
| Ownership | not referenced at all in `canonical-strategy-frontier.ts` | `OWNERSHIP` (soft, per softFeatureFamilies) | **Not wired as a gate OR a ranker in this module at all** -- distinct from "soft but present"; ownership is a real, separate capability (`OWNERSHIP_CONTRACT` in the capability registry) consumed elsewhere (assignment/recovery eligibility), not by this frontier's entry candidates | N/A for entry; real question is whether it *should* rank entry candidates and currently doesn't | Recorded as a real gap, not resolved this pass |
| RV, VRP, skew, term, GEX, flow, trend | not referenced in `canonical-strategy-frontier.ts` | soft, per `softFeatureFamilies` | **`CAN_REPRESENT` only** -- these are declared as soft feature families the branch registry knows about, but this pass found no code in the real entry-candidate path that reads them as either a gate or a ranking input. `optionomics-feature-engine.ts` computes some of them (real data exists), but this audit found no consumer wiring them into `canonical-strategy-frontier.ts` or `opportunity_frontier.py`'s real ranking. | They should be `SOFT_RANKING` inputs once wired -- today they are neither blocking nor ranking, they are simply unused | **This is a second, distinct false-paralysis-adjacent finding**: real data may exist (Optionomics) that is not wired into ranking at all -- not a hard-block false paralysis, but an unused-intelligence gap in the same family the owner is worried about. Needs its own trace (Batch 2, quantified unknown audit, `DATA_EXISTS_BUT_NOT_WIRED` category) to confirm scope precisely -- not fully re-derived here to avoid duplicating that batch's work. |
| Concentration | `management-input-state.ts` (`context.concentration`, required field) | portfolio-level, presumably soft-to-medium | Required at management-input-assembly time (`unknownFields.push` if missing) -- a missing value makes the WHOLE management input state report gaps, but this pass did not trace whether a specific downstream consumer hard-blocks on it vs. only reports it as an unknown field | Unclear from this pass alone | Not fully resolved -- flagged for a future pass, not guessed at |

## Summary: minimum executable market quality vs. unused ranking intelligence

**Quote freshness and spread width correctly hard-block** -- this is not
the false-paralysis category this audit was built to find. The real
open items are calibration (is 30s right), pipeline latency (does
THETA's own processing time contribute to staleness), and refresh (does
a stale-but-promising candidate ever get a second look). All three are
real research questions, tracked as Q-8, none of them "should this
block."

**Not confirmed as over-blocking, but flagged as unused rather than
ranked**: RV, VRP, skew, term, GEX, flow, trend -- declared soft, real
data exists for at least some of them (Optionomics), but no consumer in
the real entry-candidate path was found wiring them into either a gate or
a rank score. This is a different failure mode from "false paralysis"
(nothing is being wrongly rejected because of these), but it is the same
family of concern the owner raised: intelligence that exists but doesn't
actually influence the decision.

## Codex handoff (added to `THETA_CODEX_INTEGRATION_QUEUE.md`)

See queue row Q-8, added alongside this doc.
