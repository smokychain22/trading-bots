# THETA hard-gate vs. soft-feature audit (Wave 8 Batch 3)

**Why this audit exists**: the owner's stated top concern is a bot with
real intelligence that still does nothing, because one missing/strict/
default field silently blocks every opportunity. This audit's job is to
find every place where a feature declared or intended as `SOFT_RANKING`
is actually implemented as a hard reject, using real source evidence, not
speculation.

## Headline finding, stated first because it is the most consequential

**Quote freshness and bid/ask spread width -- nominally `LIQUIDITY` /
`EXECUTION_QUALITY`, both listed as `softFeatureFamilies` in
`strategy-package.ts` -- are in fact the dominant real-world HARD reject
gate in the live pipeline today**, and one of the two thresholds is a
hardcoded constant, not even a tunable config value.

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
| Quote freshness (30s) | `theta-shadow-cycle.ts` (hardcoded) | `EXECUTION_QUALITY` (soft, per `strategy-package.ts`) | **HARD** -- unconditional pre-AEGIS exclusion, dominant real rejection cause (3,299/3,876) | Some staleness threshold should block (a genuinely stale quote is unsafe to price against) -- but 30s specifically is unvalidated | Make configurable; R8-test the threshold (Batch 4 tooling below) |
| Bid/ask spread width | `theta-shadow-cycle.ts` (`config.maxAcceptableSpreadPct`) | `LIQUIDITY`/`EXECUTION_QUALITY` (soft) | **HARD** -- same unconditional gate as above | Same as above -- some spread cap is real execution-quality safety, but current threshold's calibration is unproven | Already configurable; still needs R8 validation, not a code fix |
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

## Summary: soft-declared features currently acting as hard gates

**Confirmed** (real code evidence, not speculation): quote freshness
(30s) and bid/ask spread width, both declared `LIQUIDITY`/
`EXECUTION_QUALITY` (soft families) in `strategy-package.ts`, function as
an unconditional, pre-economics, pre-AEGIS binary exclusion in the real
live pipeline -- and are the dominant real rejection cause in the one
real session this engagement has full forensic data for.

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
