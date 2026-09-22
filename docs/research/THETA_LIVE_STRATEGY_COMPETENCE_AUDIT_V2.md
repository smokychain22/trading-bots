# THETA Live Strategy-Competence Audit V2 — 2026-09-19

Branch `claude/theta-management-challenger`, rebased onto canonical main
`1b304c1aa3cac7225ed9e890c7979ace6fe8f104`. Pure research/read-only pass — no
Production code changed, no broker authority, no order submitted, Master Paper
champion left running. This supersedes V1's mistaken framing that
`cross-symbol-economic-frontier.ts` explains Production WAIT — per Codex's
correction, that module is `RESEARCH_ONLY`/unused by Production. Every claim
below was re-derived from the ACTUAL live path this pass, verified by direct
reading, never carried forward from V1 without re-checking.

## LIVE_STRATEGY_PATH

Traced directly, file by file, and confirmed live-wired (not inferred from a
doc):

```
runProductionShadowEvidenceScan (src/research/production-shadow-runtime.ts)
  -> discoverRealUniverse (universe-discovery.ts)
  -> runCrossSymbolShadowScan, per underlying, maxUnderlyings: 2   <-- see finding below
       -> runThetaShadowCycle (theta-shadow-cycle.ts)
            -> buildCanonicalStrategyFrontier (canonical-strategy-frontier.ts)   <-- THE live selection authority
  -> assembleMasterPaperEvidencePlan (execution/master-paper-plan-assembly.ts)  [only when
       MASTER_PAPER_EXECUTION_ENABLED && !PAPER_PAUSE_NEW_ORDERS && frontier != null && decisionId != null]
  -> (per master-paper-action-handoff.ts / paper-order-coordinator.ts, not re-read
       line-by-line this pass — the plan-assembly output is what those consume)
```

`buildCanonicalStrategyFrontier` (`src/theta/canonical-strategy-frontier.ts`) is
confirmed the real, live decision authority: `theta-shadow-cycle.ts` calls it to
produce `member.cycle.strategyFrontier`, which `production-shadow-runtime.ts`
persists and feeds directly into `assembleMasterPaperEvidencePlan`. Despite the
word "shadow" in `theta-shadow-cycle.ts`'s name, this IS the runtime that can
place a real bounded Master Paper order when `MASTER_PAPER_EXECUTION_ENABLED`
is set — "shadow" here names the module, not a guarantee of no broker effect.

**Confirmed: `expectedAfterCostEv` is always `null` and is never read by the
ranking function (`objectives()`/`dominates()`/`rankCandidates()`,
`canonical-strategy-frontier.ts:372-403`).** Ranking uses exactly five
dimensions — `grossPremium` (MAX), `collateral` (MIN), `spreadPct` (MIN),
`downsideCushion` (MAX), `retainedUpside` (MAX) — a genuine multi-dimensional
Pareto comparison, not a calibrated-EV gate. This directly confirms Codex's
correction: **current bounded Paper entry does not require calibrated EV.**

## THETA_CONVENTIONAL_APPLICABILITY

`buildBranch('THETA_CONVENTIONAL', input)` (`canonical-strategy-frontier.ts:406-457`):
- **Applicable** when `route?.eligible === true` from the strategy-router
  response (`input.routing`), which itself depends on ownership
  acceptability/event/cash-availability facts evaluated in
  `strategy_router.py` (not re-read line-by-line this pass; V1 already
  verified this module's routing logic is independent-per-family, not a
  consensus vote).
- **Candidate enumeration**: every `PUT` contract in `input.contracts` with
  `dte` inside `source.lattice.dteMin`/`dteMax` for this branch becomes a
  candidate via `singleLegPutCandidate` (line 423-424) — one candidate per
  contract, expiry × strike both vary freely within the DTE window; there is
  no separate delta filter at enumeration.
- **Underlying ranking**: happens upstream, in `universe-discovery.ts`/
  `universe-policy.ts` (V1 findings unchanged — staged, mostly-soft funnel);
  `rankEligibleUnderlyings` uses only `avgDollarVolume`, self-labeled a "v1
  placeholder ranking feature."

## HARD_GATE_MAP / SOFT_EVIDENCE_MAP / BASELINE_OR_PLACEHOLDER_MAP

(Re-verified against the current, live-confirmed file — all V1 citations for
this specific file still hold; two are corrected/updated below.)

| Rule | File:line | Classification | Status |
|---|---|---|---|
| OCC identity unknown | `canonical-strategy-frontier.ts:231` | FEASIBILITY_HARD_GATE | unchanged |
| AEGIS `HOLD_ONLY`/`HARD_VETO`/`EMERGENCY_EXIT_ONLY` | `canonical-strategy-frontier.ts:238,347` | SAFETY_HARD_GATE | unchanged |
| AEGIS/event/IV/delta/OI/volume unknown | `canonical-strategy-frontier.ts:237-244` | SOFT_ECONOMIC_EVIDENCE (`unknownEvidence`, tie-break weight only) | unchanged — never a rejection |
| `NO_ASSIGNMENT_CAPACITY` | `canonical-strategy-frontier.ts:257` | FEASIBILITY_HARD_GATE | unchanged |
| DTE∈[lattice.dteMin,dteMax] at enumeration | `canonical-strategy-frontier.ts:423` | FEASIBILITY_HARD_GATE (per-branch, not universal — see DTE_GATE_FINDING) | re-verified, see below |
| Final cross-branch/candidate tie-break: `candidateId.localeCompare()` | `canonical-strategy-frontier.ts:403` | PLACEHOLDER | unchanged |
| `rankEligibleUnderlyings` by `avgDollarVolume` only | `universe-policy.ts:189-223` | BASELINE, self-labeled | unchanged |
| `sizedNewRisk` doesn't check branch `status` at the frontier layer | `canonical-strategy-frontier.ts:467-468` | **CORRECTED FINDING — see below** | downgraded from "open risk" to "caught downstream" |
| `selectedBranch.status !== 'SHADOW'` → `STRATEGY_BRANCH_NOT_PAPER_EVIDENCE_ELIGIBLE` | `master-paper-plan-assembly.ts:56` | SAFETY_HARD_GATE | **NEW this pass** |
| `frontier.primaryAction !== 'OPEN_CSP'` → `ACTION_NOT_YET_CONNECTED` | `master-paper-plan-assembly.ts:55` | FEASIBILITY_HARD_GATE (execution-layer, not strategy-layer) | **NEW, major finding — see below** |
| `optionomicsContext` is stored/passed through, never destructured for ranking | `canonical-strategy-frontier.ts:111,136,496` | UNUSED_AVAILABLE_FEATURE | **NEW this pass** |
| `contract.iv`/`delta`/`openInterest`/`volume` used only for `unknownEvidence`, never as ranking dimension | `canonical-strategy-frontier.ts:241-244`, `objectives()` at 373-381 | UNUSED_AVAILABLE_FEATURE | **NEW this pass** |

**Correction to V1's "UNREACHABLE_STRATEGY_PATHS" finding**: V1 flagged that
`sizedNewRisk` doesn't check branch `status`, so a `RESEARCH_ONLY`
(THETA_HOLD_STRIKE) candidate could become `frontier.selectedBranch`. This
pass traced it one layer further: `assembleMasterPaperEvidencePlan`
(`master-paper-plan-assembly.ts:56`) DOES check
`selectedBranch?.status !== 'SHADOW'` and blocks with
`STRATEGY_BRANCH_NOT_PAPER_EVIDENCE_ELIGIBLE` before any real Paper plan is
assembled. **The risk is real at the frontier-selection layer (an
economically-arbitrary label) but fully mitigated before any broker
consequence** — downgraded from an open concern to a confirmed-safe design,
though the frontier layer's own `selectedBranch` field remains a slightly
misleading "the pick" label for anything reading it before the plan-assembly
check runs.

**Major new finding, more consequential than anything in V1**:
`assembleMasterPaperEvidencePlan` only proceeds when
`frontier.primaryAction === 'OPEN_CSP'` (`master-paper-plan-assembly.ts:55`,
`ACTION_NOT_YET_CONNECTED:${frontier.primaryAction}` otherwise) AND
`selected.legs.length === 1` with a `SELL_TO_OPEN`/`PUT` leg
(lines 57-58, `SINGLE_LEG_CSP_REQUIRED`/`CSP_LEG_IDENTITY_INVALID`). This means
**only THETA_CONVENTIONAL's single-leg CSP action can currently ever produce a
real Master Paper order** — `OPEN_DEFINED_RISK` (THETA_DEFINED_RISK),
`SELL_CC` (THETA_CC), `RECOVERY_WAIT`/`SELL_STOCK` (THETA_RECOVERY) are all
structurally blocked at the EXECUTION layer regardless of their own
economics, independent of and in addition to THETA_HOLD_STRIKE/
THETA_DEFINED_RISK's `RESEARCH_ONLY` status. This is the accurate, current
answer to "which strategies can Master Paper actually execute today": exactly
one action shape, from exactly one branch.

## WHY_UNDERLYING_STATUS / WHY_STRATEGY_STATUS / WHY_EXPIRATION_STATUS / WHY_STRIKE_STATUS / WHY_NOW_STATUS / WHY_SIZE_STATUS

| Question | Current live answer | Strength |
|---|---|---|
| WHY this underlying? | `avgDollarVolume`-only ranking among ELIGIBLE underlyings (`universe-policy.ts`), further bounded to **2 underlyings per cycle** (`production-shadow-runtime.ts:133`, `maxUnderlyings: 2`) | WEAK — an honest, self-labeled placeholder, and a real breadth bottleneck: only 2 underlyings are even considered per scan regardless of how many pass the universe funnel |
| WHY this strategy? | `strategy_router.py`'s independent per-family eligibility (not a consensus vote); only THETA_CONVENTIONAL can currently reach a real order (see finding above) | MODERATE for eligibility, WEAK for "why this one over CC/defined-risk" since only one is execution-connected |
| WHY this expiration? | Falls out of the DTE window filter + whichever surviving contract Pareto-wins on the 5 named dimensions — no explicit expiration-quality reasoning beyond DTE bucket membership | WEAK |
| WHY this strike? | Same Pareto comparison (`grossPremium`/`collateral`/`spreadPct`/`downsideCushion`/`retainedUpside`) — a real multi-dimensional comparison, genuinely not "highest premium wins" | MODERATE — the strongest of the six questions |
| WHY now? | No entry-timing evidence is consumed in ranking at all (see VOL_ACCELERATION_STATUS below); event state is `softEvidence` only, IV/delta feed only `unknownEvidence` bookkeeping | WEAK |
| WHY this quantity? | `structuralSizing()` (`canonical-strategy-frontier.ts:166-215`) — a real, transparent multi-cap minimum (risk budget/collateral/concentration/assignment/tail/correlation/liquidity/broker-allowed/buying-power caps, AEGIS reduced-multiplier applied), correctly allows quantity=0 as a valid outcome, never `max(1,qty)` | STRONG — this is the most mature of the six |

**This is the strategy-competence gap map the directive asked for**: THETA
answers "how much" well, "which strike" moderately, and "why this underlying /
why now" weakly — not because of a missing brain, but because the ranking
function genuinely only consumes five dimensions and the universe stage is
capped at 2 symbols/cycle.

## DTE_GATE_FINDING

Re-verified directly against the live file (`canonical-strategy-frontier.ts:423`,
`source.lattice.dteMin`/`dteMax` sourced from `strategy-package.ts`).

- **Is it safety-critical?** No — nothing about a 24-DTE or 61-DTE contract is
  structurally unsafe to hold; the window is a strategy-design choice, not a
  broker/data-integrity constraint.
- **Is it merely a strategy baseline?** Yes for THETA_CONVENTIONAL specifically
  (per-branch, THETA_HOLD_STRIKE uses a different window) — but it is enforced
  as a **hard AND-gate at enumeration**, not as a labeled "baseline, softly
  preferred" ranking input.
- **Does it eliminate contracts before economic comparison?** Yes, definitively
  — `input.contracts.filter(...)` at line 423 runs before any candidate object
  (and therefore before any Pareto comparison) is even constructed for
  out-of-window contracts.
- **Can near-boundary contracts have their economics evaluated in shadow
  today?** No — there is currently no code path that evaluates a DTE 22-24 or
  DTE 61-65 contract's economics anywhere in the live pipeline; they are never
  constructed as candidates at all, so no record of what they would have
  scored exists to inspect even in shadow.

**Not loosened this pass, per instruction.** Shadow measurement designed
below (`DTE_EDGE_MISSED_OPPORTUNITY`), consuming only already-fetched data —
no change to the live gate.

### Shadow design: `DTE_EDGE_MISSED_OPPORTUNITY`

Since `input.contracts` (the full option-chain snapshot for a scanned
underlying) already contains every contract Alpaca/Optionomics returned for
that underlying regardless of DTE — the filter only discards them at
`buildBranch`, not earlier in the pipeline — a shadow measurement can be
added purely as an OBSERVATIONAL side-channel with zero effect on the live
gate:

1. In `production-shadow-runtime.ts` (or a new, separate research module — no
   change to `canonical-strategy-frontier.ts` itself), after
   `buildCanonicalStrategyFrontier` runs, separately compute
   `singleLegPutCandidate`-shaped economics (reusing the exact same pure
   function, imported, never reimplemented) for contracts with
   `dte ∈ [dteMin - 5, dteMin) ∪ (dteMax, dteMax + 5]` — a narrow, named
   "edge band," not the whole chain.
2. Record, per scan: `edgeBandCandidateCount`, and for each, the SAME five
   Pareto dimensions already computed for real candidates
   (`grossPremium`/`collateral`/`spreadPct`/`downsideCushion`/
   `retainedUpside`), plus whether it would have Pareto-dominated (or been
   dominated by) the cycle's actual `selectedCandidateId` using the SAME
   `dominates()` function (imported, not reimplemented).
3. Persist as `DTE_EDGE_MISSED_OPPORTUNITY` evidence rows — this never feeds
   back into the live gate; it answers, over time, "how often would a
   contract just outside the window have won the cycle's own Pareto
   comparison" — a real, falsifiable question, not a fixed conclusion.
4. **No broker authority, no lookahead** — this uses the SAME point-in-time
   contract data already fetched for the real scan, nothing forward-looking.

## EVENT_UNKNOWN_FINDING

Re-traced `new-risk-orchestrator.ts:624`'s
`regimeResult.data.eventState === null ? true : ...` coercion specifically
against the ACTUAL live path this pass (V1 found this via a sub-task; this
pass re-verifies its real effect rather than repeating the claim).

**Important scope correction**: `new-risk-orchestrator.ts` is a DIFFERENT
module from the confirmed-live `canonical-strategy-frontier.ts` path traced
above — it was not re-confirmed this pass whether `new-risk-orchestrator.ts`
itself sits on the live Master Paper path or is a separate (possibly
research/legacy) candidate-scoring module. This is flagged honestly as an
**open verification item**, not re-asserted as applying to the confirmed live
path without checking. `canonical-strategy-frontier.ts`'s OWN event handling
(the module confirmed live this pass) is different and was directly read:

```
if (input.eventState === null) unknownEvidence.push('EVENT_STATE_UNKNOWN');
else softEvidence.push(`EVENT_STATE:${input.eventState}`);
```
(`canonical-strategy-frontier.ts:239-240`)

**On the confirmed-live module, event-state UNKNOWN is correctly NOT coerced**
— it becomes `unknownEvidence` (a tie-break weight only, per `rankCandidates`),
never a hard rejection, never silently mapped to a worst-case boolean. This is
the opposite of the V1 finding's claimed mechanism, once traced on the actual
confirmed live selection authority rather than the (unverified-as-live)
`new-risk-orchestrator.ts`.

**Verdict**: the `new-risk-orchestrator.ts:624` coercion, if it is genuinely on
a path Production consumes, would be a real semantic defect (silently coercing
UNKNOWN to the most restrictive boolean rather than surfacing it) — but its
material effect on the CONFIRMED live entry decision (`canonical-strategy-
frontier.ts`) could not be established this pass, since that module handles
event UNKNOWN correctly and independently. Classified **CHALLENGER_FIX_CANDIDATE**,
not **PRODUCTION_DEFECT_CANDIDATE**, pending confirmation of whether
`new-risk-orchestrator.ts` is actually reachable from
`runProductionShadowEvidenceScan` — not confirmed either way this pass, and
not asserted as material harm without that proof, per the directive's own
instruction not to fix without proving material harm.

## IV_RV_VRP_STATUS / SKEW_STATUS / TERM_STRUCTURE_STATUS / EXPECTED_MOVE_STATUS / GEX_FLOW_STATUS / VOL_ACCELERATION_STATUS

Traced via `NormalizedOptionContract`'s actual schema
(`option-contract.ts:29-136`) and the real Optionomics feature-destination/
capability contracts (`optionomics-feature-destinations.ts`,
`optionomics-intelligence-contract.ts`).

| Signal | Classification | Evidence |
|---|---|---|
| IV (raw, single value) | LIVE_CONSUMED, but only as `unknownEvidence` bookkeeping, never a ranking dimension | `contract.iv` exists on `NormalizedOptionContract`; `canonical-strategy-frontier.ts:241` only checks `=== null`, `objectives()` never reads it |
| IV rank / IV percentile | NOT_AVAILABLE on the contract schema at all | No field in `normalizedOptionContractSchema` (`option-contract.ts`) for IV rank/percentile |
| IV vs. RV / VRP | NOT_AVAILABLE on the contract schema; `bots/theta/quant/features/realized_volatility.py` (ported this session) computes RV baselines but has no live consumer yet | Confirmed no RV field anywhere in `NormalizedOptionContract` or `CanonicalFrontierCandidate` |
| Skew | LIVE_CONTEXT_ONLY | `optionomics-feature-destinations.ts:11`: THETA_CONVENTIONAL's destination list includes `SKEW`; real endpoints exist in `optionomics-intelligence-contract.ts`; flows into `frontier.optionomicsContext` (opaque `JsonValue`), never decomposed into a candidate field or ranking dimension |
| Term structure | LIVE_CONTEXT_ONLY | Same mechanism — `TERM` in the destination list, `iv_term_structure` a real registered Optionomics operation (`optionomics-intelligence-contract.ts:120`), same opaque-context-only fate |
| Event proximity | LIVE_CONSUMED as soft tie-break evidence | `canonical-strategy-frontier.ts:239-240`, confirmed above |
| Trend / price path | NOT_AVAILABLE on the live candidate object; `underlying-features.ts` computes trailing-window aggregates but was not confirmed wired into this specific path this pass | Not traced to a consumer in `canonical-strategy-frontier.ts` |
| Liquidity (volume/OI) | LIVE_CONSUMED, `unknownEvidence`-only, never a ranking dimension directly (though `spreadPct` — a liquidity proxy — IS a real ranking dimension) | `canonical-strategy-frontier.ts:243-244` (unknown-tracking), `:377` (`spreadPct` in `objectives()`) |
| Expected move | LIVE_CONTEXT_ONLY | `EXPECTED_MOVE` in the destination list for THETA_CONVENTIONAL; same opaque-context fate, no dedicated candidate field |
| GEX / Vanna / Charm | RESEARCH_ONLY / not confirmed wired to THETA_CONVENTIONAL specifically | `optionomics-capability-contract.ts` lists `GEX`/`VANNA`/`CHARM`/`GAMMA_FLIP` as possible capabilities, but THETA_CONVENTIONAL's own destination list (`optionomics-feature-destinations.ts:11`) does not name them explicitly (only `EXPOSURE`, ambiguous) — not confirmed either way, flagged rather than guessed |
| Flow / UOA | LIVE_CONTEXT_ONLY | `FLOW` in the destination list, real endpoints registered (`optionomics-intelligence-contract.ts:75-80`), same opaque-context fate |
| Realized-vol acceleration/deceleration | NOT_AVAILABLE anywhere in the live path | No rate-of-change feature exists on `NormalizedOptionContract`, `CanonicalFrontierCandidate`, or in `optionomicsContext`'s known destinations; confirmed absent, matching V1's finding, now re-verified against the correct live path |

**Overall pattern, stated plainly**: THETA_CONVENTIONAL's live candidate
comparison genuinely uses five economic dimensions well
(premium/collateral/spread/cushion/retained-upside), and correctly treats
missing Greeks/liquidity/event data as soft evidence, never a silent zero or
false. But essentially every "why now" / volatility-richness / positioning
signal (IV rank, VRP, skew, term structure, expected move, GEX, flow) is
fetched and versioned by Optionomics (real, live API calls exist) yet arrives
at the ranking stage as an opaque, unconsumed `JsonValue` blob — **the data
pipeline exists; the ranking function simply doesn't read it.** This is a
data-to-decision wiring gap, not a data-availability gap, and per the
directive's §8 instruction, closing it should mean adding a FEW well-chosen
dimensions to `objectives()` (e.g., VRP or IV-rank as one additional Pareto
axis, UNKNOWN-safe like the existing five), never turning every fetched
signal into a mandatory gate.

## CONTRACT_LATTICE_QUALITY

Confirmed on re-read (`canonical-strategy-frontier.ts:395-403,422-424`):
THETA_CONVENTIONAL genuinely compares MULTIPLE expirations and strikes
simultaneously — every PUT contract within the DTE window becomes an
independent candidate, and all of them are Pareto-ranked together (no
per-expiration or per-strike pre-filter narrows the set before ranking). This
is NOT an early-enumeration bottleneck at the strike/expiration level — the
DTE window is the only narrowing before comparison (see DTE_GATE_FINDING).

Dimensions actually used in final comparison: premium (`grossPremium`),
capital requirement (`collateral`), spread/execution quality (`spreadPct`),
downside cushion, retained upside. **Missing from final comparison** (present
elsewhere in the codebase or fetched but not wired here): capital-days
(`capitalDayYield` is COMPUTED on every candidate at line 268 but never added
to `objectives()` — a genuine, easy-to-close gap since the field already
exists), tail exposure, assignment implications beyond the binary capacity
gate, IV/skew/events (see table above), uncertainty/uncertainty-count (tracked
as `unknownEvidence.length` only for tie-breaking, not as its own weighted
dimension).

## WAIT_PARALYSIS_RISKS_ON_LIVE_PATH_ONLY

1. **`maxUnderlyings: 2`** (`production-shadow-runtime.ts:133`) — the single
   largest, most concrete breadth-limiting finding in this whole audit: no
   matter how large the eligible universe from `universe-discovery.ts` is,
   only 2 underlyings are actually scanned for candidates per cycle. This is
   a real, structural cause of "why doesn't THETA find more opportunities,"
   independent of any gate-tuning question.
2. **Only THETA_CONVENTIONAL's single-leg OPEN_CSP can currently execute**
   (see the `ACTION_NOT_YET_CONNECTED` finding above) — THETA_CC/
   THETA_DEFINED_RISK/THETA_RECOVERY candidates can be genuinely attractive by
   their own economics and still never produce an order, for a reason
   unrelated to their economics.
3. `capitalDayYield` computed but unused in ranking — an easy, low-risk
   dimension to add without inventing new evidence.
4. VRP/IV-rank/skew/term/flow all fetched, versioned, and unused in ranking —
   see the table above; the fix is wiring existing data, not building a new
   provider or brain.
5. `rankEligibleUnderlyings`'s single-dimension placeholder — unchanged from
   V1, still self-labeled honestly.
6. The `new-risk-orchestrator.ts:624` event-UNKNOWN coercion — real if that
   module is live-reachable, unconfirmed either way this pass (see above);
   **not** found on the confirmed-live `canonical-strategy-frontier.ts` path.

## SHADOW_METRICS_FOR_CODEX_FUNNEL

Codex has already deployed a comprehensive per-cycle wait-classification
engine — `src/theta/runtime-behavior-diagnostic.ts`
(`runtimeBehaviorDiagnosticVersion: 'theta-runtime-behavior-diagnostic-v2'`),
persisted to `research.theta_runtime_behavior_diagnostic`. It already computes
`WaitClassification` (`ACTION_READY`/`HEALTHY_WAIT`/`NO_OPPORTUNITY`/
`RISK_WAIT`/`QUOTE_WAIT`/`DATA_WAIT`/`OVERSTRICT_POLICY_WAIT`/
`POSSIBLE_LOGIC_PARALYSIS`), `OvertradingState`, `consecutiveWaitCycles`,
`DOMINANT_HARD_GATE_OBSERVED`/`SHADOW_STRATEGY_UNREACHABLE` findings
(`deriveAntiParalysisFindings`), and near-miss/best-rejected-candidate
tracking. **No new funnel is proposed — every metric below extends this
existing one:**

1. **`DTE_EDGE_MISSED_OPPORTUNITY`** (designed above) as a new evidence table,
   cross-referenced against `runtime_behavior_diagnostic.scan_id` so a
   near-boundary missed opportunity can be correlated with that cycle's own
   `waitClassification`.
2. **`OVERSTRICT_POLICY_WAIT`/`POSSIBLE_LOGIC_PARALYSIS` frequency by
   underlying**, cross-tabulated against `maxUnderlyings: 2`'s actual symbol
   selection — does the 2-underlying cap correlate with these classifications
   more than a wider universe would, once/if that cap is ever changed
   (measurement only, no change proposed here).
3. **Per-branch "would have executed" counterfactual**: for each cycle where
   `frontier.primaryAction !== 'OPEN_CSP'` was blocked purely by
   `ACTION_NOT_YET_CONNECTED` (never by economics), record the candidate's own
   Pareto rank and economics — this directly measures the cost of the
   OPEN_CSP-only execution connection, using data the frontier already
   computes.
4. **`capitalDayYield`-would-have-changed-selection rate**: replay
   `rankCandidates` with `capitalDayYield` added as a sixth objective (in a
   side channel only, never live) and record how often the winner changes —
   answers whether wiring this already-computed field is worth doing before
   actually doing it.
5. **`WAIT_OUTCOME`/`ACTION_REGRET` labels** (per V1's finding —
   `resolved-outcome-engine.ts` already defines this taxonomy) joined against
   `runtime_behavior_diagnostic` rows once real fills exist, to test whether
   `HEALTHY_WAIT`-classified cycles were actually correct in hindsight.

## TOP_5_HIGHEST_VALUE_CHALLENGER_HYPOTHESES

Ranked by expected information value × engineering complexity × risk of
overfitting × economic benefit, per the directive's own ranking instruction:

1. **Widen `maxUnderlyings` beyond 2, measured via shadow first.** Highest
   expected information value, lowest complexity (one config constant), but
   NOT recommended as an unmeasured production change — first measure via
   `runProductionShadowEvidenceScan`-shaped shadow runs at higher
   `maxUnderlyings` values (no live order authority) to see whether more
   symbols actually surface better Pareto-ranked candidates before touching
   the live cap.
2. **Add `capitalDayYield` as a sixth Pareto dimension in `objectives()`.**
   Very low complexity (data already computed, UNKNOWN-safe pattern already
   established by the other five dimensions), directly closes the "capital
   efficiency" gap named in directive §7's economic-thesis framing, low
   overfitting risk since it's a real, already-audited formula
   (`grossPremium / (collateral * dte)`), not a new invented metric.
3. **Decompose `optionomicsContext` into 1-2 named, UNKNOWN-safe ranking
   dimensions (e.g. a VRP or IV-rank axis) rather than leaving it opaque.**
   Moderate complexity (requires defining the exact extraction + UNKNOWN
   semantics), highest potential economic benefit of the five since it's the
   only item that actually adds a NEW information source to ranking rather
   than just wiring what's already computed, but should go through the
   ablation discipline (`docs/quant/phase2/BENCHMARK_AND_EXPERIMENT_REGISTRY.md`)
   before promotion, not be added directly to the live gate.
4. **Connect `OPEN_DEFINED_RISK`/`SELL_CC`/`RECOVERY_WAIT`/`SELL_STOCK` to
   plan-assembly**, starting with whichever already has the most complete
   downstream lifecycle-management code (per the earlier C1 audit, THETA_CC's
   management path is the most mature). Highest engineering complexity of the
   five (new plan-assembly branches, new execution-handoff shapes), but
   directly answers "why can only one strategy family ever trade" — this is
   Codex's execution-layer domain, not something to build unilaterally here,
   but worth prioritizing in a joint plan.
5. **`DTE_EDGE_MISSED_OPPORTUNITY` shadow measurement** (designed above) —
   lowest engineering complexity of the five (pure observation, reuses
   existing pure functions), answers a concrete, previously-unmeasured
   question (is the DTE window actually costing real opportunities) before
   any decision to loosen it.

## Receipt

See the conversation's final receipt for structured status fields; not
repeated here.
