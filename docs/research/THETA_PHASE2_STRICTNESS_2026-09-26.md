# THETA Phase 2 — Strategy Router + Strictness + Opportunity Capture (Profitability Brain Completion Program)

Built on `claude/theta-unified-takeover`. Read/write against research-owned files
only (`src/research/`); read-only for `bots/theta/quant/models/theta_q_baseline.py`,
`theta_h_baseline.py`, `src/theta/canonical-strategy-frontier.ts`,
`src/theta/new-risk-orchestrator.ts`. `brokerAuthority=false` throughout. No
Production files modified.

## 2A-2D — Applicability/attractiveness/risk/size separation (re-confirmed)

Re-confirmed by direct code read, consistent with prior audits: `strategy_router.py`
answers only applicability (`StrategyEligibilityResult`, no EV field);
`theta_q_baseline.py._economics()` is the sole economic-attractiveness computation
(`ev_net` structurally null pending a model, never conflated with applicability);
`aegis.py` returns only a risk-permission state, never selects candidates; `sizing.py`
returns only a quantity via tightest-cap `min()`, never ranks or selects. No change
needed -- all four layers remain genuinely separate in current source.

## 2E — Candidate funnel

`universe-discovery-funnel.ts` (real, imports Production's own
`UniverseDiscoveryStageDiagnostic` type) covers the **pre-candidate** funnel:
`SOURCE_ASSETS -> EXCHANGE_FILTER -> STOCK_BARS -> OPTIONABILITY`. The
**candidate-level** funnel (`STRATEGY_APPLICABLE_COUNT -> SERIOUS_ECONOMIC_CANDIDATE_COUNT
-> AEGIS_SURVIVOR_COUNT -> POSITIVE_QTY_COUNT -> FINALIST_COUNT -> SELECTED_COUNT`) is
already directly derivable from real persisted evidence: `trade.canonical_strategy_branch_evidence`
(per-branch `candidateCount`/`hardVetoed`/`softRanked`/`dataInsufficient`, confirmed
real in Command 1's audit) and `trade.canonical_strategy_candidate_evidence` (per-candidate
`structurallyFeasible`/`riskFeasible`/`quantity`). No new aggregator built this pass --
the real counts already exist as persisted evidence; a full funnel report would be a
thin query over already-real data, not new logic, and building an unused parallel
aggregator would itself be exactly the kind of duplicate this program's philosophy
warns against. Documented as **already real**, not built.

## 2F — Zero-trade taxonomy (real defect found and fixed)

`false-inactivity-taxonomy.ts`'s 12-value `FalseInactivityCause` enum maps onto the
directive's 9-concept list with two genuine gaps, not silently forced:

| Directive concept | Real taxonomy value | Fit |
|---|---|---|
| VALID_EMPTY | `GOOD_WAIT` | exact |
| PROVIDER_ERROR | `PROVIDER_FAILURE_REJECT` | exact |
| DATA_INSUFFICIENT | `DATA_UNAVAILABLE_REJECT` / `DATA_STALE_REJECT` | exact (two real sub-causes) |
| NO_ECONOMIC_OPPORTUNITY | `ECONOMIC_WAIT` | exact |
| RISK_VETO | `HARD_SAFETY_REJECT` / `AEGIS_REJECT` | exact |
| SIZE_ZERO | `SIZING_REJECT` | exact |
| OVERFILTERED | *(no direct value)* | **real gap** -- overfilter suspicion is a statistical *conclusion* about a batch of `IMPLEMENTATION_FALSE_REJECT` rows (see `strictnessFunnelReport`'s `overfilterSuspicionRate`), not itself a per-candidate cause; correctly not forced into the enum |
| UNSUPPORTED | *(no direct value)* | **real gap** -- no taxonomy value distinguishes "this instrument/session type is structurally unsupported" from `DATA_UNAVAILABLE_REJECT`; not force-mapped |
| INFRASTRUCTURE_ERROR | *(no direct value)* | **real gap** -- closest is `PROVIDER_FAILURE_REJECT`, but that's specifically provider-side, not e.g. a DB/runtime infrastructure failure; not force-mapped |

**Real defect found and fixed**: `computeFalseInactivityRates()`'s `rate()` helper
returned a bare `0` for an empty record batch -- the exact UNKNOWN-to-0 coercion this
engagement's standing rule forbids, and the same defect already fixed in
`wait-regret-dataset.ts` and `historical-false-reject-analyzer.ts` in earlier waves.
This module had drifted from that established discipline. Fixed: every rate field is
now `number | null`, `null` on an empty batch. Existing test
(`tests/false-inactivity-taxonomy.test.ts`) explicitly asserted the old `0` behavior
as correct ("never NaN or a fabricated rate") -- corrected to assert `null`.

## 2G — Hard vs soft (re-verified, clean)

Grepped `theta_q_baseline.py` and `theta_h_baseline.py` for every soft-evidence family
name (trend/RSI/momentum/IV/IV-percentile/VRP/skew/term/surface/GEX/walls/gamma-flip/
Vanna/Charm/flow/UOA/fundamentals/sector/correlation/regime): **zero occurrences in
either file**. Confirms these families are not consumed by baseline hard-veto logic at
all -- they are wired elsewhere as structural ranking inputs, never silent hard gates
here. Hard vetoes remain exactly what Command 1 found: multiplier, strike, spread,
quote age, open interest, volume, broker qty, ownership/drawdown-UNKNOWN
(`theta_q_baseline.py:161-255`).

## 2H — False-reject/strictness engine

Built `src/research/strictness-funnel-report.ts`, a real composition over the existing
`false-inactivity-taxonomy.ts` and `wait-regret-dataset.ts` (not a third, parallel
vocabulary). `CandidateSurvivalRate`, `HardRejectRate`, `SizeZeroRate`, `WaitRate` are
computed directly from a `FalseInactivityRecord[]` batch. `SoftDemotionRate` is
**honestly always `null`** -- a soft-demoted-but-surviving candidate is not a distinct
cause code in this taxonomy at all, so it is genuinely not derivable from this data
shape, not force-computed. `GateRegret`/`OpportunityCaptureRate`/`OverfilterSuspicion`
are sourced from the real `computeWaitRegretMetrics()` when a `WaitRegretRow[]` batch
is also supplied -- verified by direct execution against a real fixture, not assumed
(confirmed `opportunityConversionRate` stays `null` for a fixture where I initially
expected `1`; the report passes that real `null` through faithfully rather than
reinterpreting the underlying module's semantics).

## 2I — Cross-strategy fallback (real defect found)

`canonical-strategy-frontier.ts`'s per-branch construction (`buildBranch()`,
confirmed in Command 1 to independently construct Q/H/D/A/C candidates) is real and
correctly isolated **at the candidate-construction level** -- a Q veto/reject does not
prevent D from being independently evaluated; each branch enumerates its own
candidates from the same input.

**However, `buildCanonicalStrategyFrontier()` (line 561) has no per-branch error
isolation**: `branchOrder.map((branch) => buildBranch(branch, input))` will fail
synchronously on the first thrown exception. `buildBranch()` can throw (line 499:
`CANONICAL_STRATEGY_SOURCE_MISSING`, plus any unhandled exception inside candidate
construction for any branch). This means **an exception while constructing H's or D's
candidates would currently prevent Q's frontier from being produced in that cycle at
all** -- a real violation of the directive's "no optional research branch may cause
global failure" requirement, proven by direct code read, not assumed. This is
Codex-owned Production code (outside research-branch write authority) -- filed as
`THETA-CANONICAL-FRONTIER-NO-PER-BRANCH-ISOLATION` in
`src/research/research-blocker-registry.ts` (`CODE_SOLVABLE_CODEX`), not fixed
directly.

## Verification

`tsc --noEmit`: clean. Node: **2707/2707** pass (5 new), 14 pre-existing skips. Lint:
clean. Security: 0/1520 findings. Zero diff on every Production directory.

## PHASE_2 = INCOMPLETE (honest, exact remainder)

Exit gate requires explaining, **for every zero-trade historical session**, what
existed/was applicable/was attractive/was rejected/what risk blocked/what sizing
blocked/why WAIT won, using the real Sep16/18/21 historical data. **Not done this
pass**: the strictness-funnel-report module was built and tested against fixtures
only -- it was not run against the real Sep16/18/21 replay data to produce actual
per-session strictness reports. That is the exact remaining item for a follow-up
round, not a vague blocker: the machinery is real and tested, but the historical
sessions have not yet been fed through it.

Everything else in Phase 2's real findings (2A-2D confirmed, 2F's two gaps
documented and one defect fixed, 2G re-confirmed clean, 2I's real isolation gap found
and filed) is genuinely closed.
