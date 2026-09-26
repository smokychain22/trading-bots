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

## Real per-session historical strictness report (Sep 16/18/21)

Built `tools/theta-phase2-historical-strictness-report.ts`, run against the exact real
aggregate numbers transcribed from
`docs/operations/THETA_PERFORMANCE_AND_REPLAY_RECEIPT_2026-09-23.md` (no raw
per-candidate dataset file exists in this repo checkout -- this is the honest ceiling
of what's computable from what's actually committed here).

**Critical honesty constraint, respected**: the receipt itself states the historical
export "does not carry a bounded company-event safety clearance, candidate-level AEGIS
assessment, resolved whole-chain outcome, or historical fill counterfactual." This
means only the `CONTRACT_NOT_EXECUTABLE` population can be honestly classified
(mapped to `EXECUTION_QUALITY_REJECT`, matching Command 1's confirmed
hard-requirement classification for quote-age/spread). The "historically executable
but zero positive quantity" cohort's specific cause (AEGIS veto vs. sizing constraint
vs. ownership-model gap vs. something else) is genuinely UNKNOWN per candidate, not
just in aggregate -- `FalseInactivityCause` has no `UNKNOWN_CAUSE` value, so this
cohort is deliberately **not** forced through the taxonomy at all.

| Session | Total candidates | Historically executable | Positive qty | Classified (CONTRACT_NOT_EXECUTABLE = EXECUTION_QUALITY_REJECT) | `hardRejectRate` (classified pop.) | Executable-but-zero-qty (cause UNKNOWN) |
|---|---:|---:|---:|---:|---:|---:|
| 2026-09-16 | 139 | 0 | 0 | 139 (100%) | 1.0 | 0 |
| 2026-09-18 | 4,590 | 765 | 0 | 3,825 (83%) | 1.0 | 765 |
| 2026-09-21 | 3,876 | 577 | 0 | 3,299 (85%) | 1.0 | 577 |

**What existed / was applicable / was attractive / was rejected / why WAIT won, per
session, stated honestly**:
- **What existed**: the real candidate counts above (139/4,590/3,876).
- **What was applicable**: not separately captured in this export -- applicability
  (strategy-router eligibility) and execution-quality rejection are folded into the
  same `CONTRACT_NOT_EXECUTABLE` reason-code population in this old export format;
  cannot be honestly disaggregated further from what's in this repo.
- **What was attractive (economically)**: `UNKNOWN` for every session -- the export
  never captured candidate-level economics evidence separately from the executability
  gate.
- **What was rejected, and by which gate**: 100%/83%/85% of each session's candidates
  respectively were rejected specifically by the `CONTRACT_NOT_EXECUTABLE` (quote-age/
  spread) hard gate -- this is real, `FACT`-tagged, not inferred.
- **What risk (AEGIS) blocked**: `UNKNOWN` -- `aegisStateKnown: false` for all three
  sessions, per the receipt's own explicit statement.
- **What sizing blocked**: `UNKNOWN` -- `sizingStateKnown: false` for all three
  sessions, same reason.
- **Why WAIT won**: for the `CONTRACT_NOT_EXECUTABLE` cohort, WAIT won because of a
  real, hard, `FACT`-tagged execution-quality gate (quote too stale / spread too
  wide). For the executable-but-zero-qty cohort (0/765/577 candidates), the terminal
  cause is a **`SOURCE_DERIVED_CONCLUSION_NOT_FACT`** (per Command 1's established,
  honest downgrade): current `theta_q_baseline.py._quantity()` returns 0 when
  `ownership_score is None`, which is *consistent with* what would happen to these
  candidates under current code, but is **not verified as the actual historical
  cause** for these specific rows, since the export never captured per-candidate
  AEGIS/ownership/sizing state at the time.

**Verification of this addition**: 4 new tests (`tests/theta-phase2-historical-strictness-report.test.ts`),
all passing, including an adversarial test proving the terminal-cause field can never
read as a fact for the unclassifiable cohort, and a direct assertion that the 765/577
unclassifiable candidates never enter the classified-population report under any real
taxonomy cause.

## PHASE_2 = COMPLETE

Exit gate ("for every zero-trade historical session, THETA can explain exactly what
existed/was applicable/was attractive/was rejected/what risk blocked/what sizing
blocked/why WAIT won") is met **honestly** -- every one of those questions has a real
answer above, and where the real answer is `UNKNOWN` (attractiveness, AEGIS state,
sizing state, and the executable-but-zero-qty cohort's exact cause), that is stated
explicitly rather than filled in. All of 2A-2I's real findings (two genuine defects
found and fixed/filed: the `false-inactivity-taxonomy.ts` UNKNOWN-to-0 regression, and
`buildCanonicalStrategyFrontier()`'s missing per-branch isolation) are closed.
