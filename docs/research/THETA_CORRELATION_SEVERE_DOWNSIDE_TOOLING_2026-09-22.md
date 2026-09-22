# Correlation and severe-downside research tooling (pre-VPS Wave 2, Slice 17)

Status: closes the "correlation (20/60/120-session) and severe-downside
(continuous/vol-normalized MAE) research tooling -- still not built" item
from `docs/research/THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md`'s "Still explicitly
deferred" list. `brokerAuthority: false` throughout; both modules below are
research-only, RESEARCH_ONLY maturity, zero broker authority, zero Production
callers.

## 1. Severe-downside tooling: the deferred note was stale, not accurate

Direct code read this pass found `src/research/risk-policy-empirical-study.ts`
(347 lines, real, tested via `tests/risk-policy-empirical-study.test.ts`)
already implements exactly the described tooling as **generic, reusable**
functions, not a one-off script:

- `buildSevereDrawdownStudy(bars, universe = canonicalRiskResearchUniverse)`
  (`:177-185`) accepts arbitrary `HistoricalBar[]` and an arbitrary universe
  -- it is not hardcoded to the specific 2026-09-20 run.
- `summarizeCell` (internal) computes, per policy cell: `maeDistribution`
  (continuous MAE, not just a pass/fail threshold label) and
  `volatilityScaledMaeDistribution` (`:160-161`, MAE divided by
  `trailingAnnualizedVol * sqrt(horizonCalendarDays / 365)`) -- this is the
  vol-normalized MAE diagnostic the deferred item named.
- `classifySevereDrawdownFinding` and `publishSevereDrawdownSensitivityGrid`
  provide the honesty discipline (an inadequate sample cannot claim a policy
  was supported OR rejected) and the full sensitivity-grid publication path
  used in the real `THETA_SEVERE_DRAWDOWN_EMPIRICAL_POLICY_STUDY_2026-09-20.md`
  receipt (36,893 real Alpaca bars, seven-cell grid, family/year breakdowns).

**Conclusion:** severe-downside (continuous + vol-normalized MAE) research
tooling is `REAL`, not `MISSING`. The Slice 14 scope document's "still not
built" note appears to have been written before or without visibility into
this module's generality, or was referring narrowly to something this pass
did not find evidence of. This is corrected here rather than silently
repeated. No new severe-downside code was written this pass, since writing a
second, parallel MAE module would fragment an already-real, already-tested
capability rather than close a genuine gap.

## 2. Correlation tooling: the deferred note was accurate -- a real gap existed

`src/theta/correlation-evidence.ts` (`buildCorrelationEvidence`, Codex-owned,
real, tested) computes pairwise Pearson correlation over **exactly one
caller-supplied `lookbackBars` window per call**. `src/research/correlation-cluster-research.ts`
(Claude-owned, real, tested) consumes that single-window output to build
connected-component clusters against one `clusterThreshold`. Neither module
compares correlation **across** multiple lookback windows -- so a pair whose
correlation is high in a 20-session window but structurally different in a
120-session window (a regime-dependent relationship, not a stable one) was
indistinguishable, before this pass, from a pair with genuinely stable
correlation. This is a real, previously-undetected gap: single-window
correlation evidence cannot, by itself, support a concentration-risk judgment
that implicitly assumes stability across time.

### 2a. What was built this pass

`src/research/correlation-window-stability.ts` (new, RESEARCH_ONLY, zero
broker authority) -- `buildCorrelationWindowStabilityReport(bars, config)`:

- Calls the real, unmodified `buildCorrelationEvidence` once per requested
  window (default `[20, 60, 120]`, matching the deferred item's exact
  language) and never recomputes a correlation value itself -- it is a pure
  aggregation/classification layer over Codex's existing real computation,
  consistent with the ownership boundary `correlation-cluster-research.ts`
  already established (Claude does not own pairwise correlation computation
  itself).
- For each symbol pair, classifies stability into `STABLE`,
  `UNSTABLE_MAGNITUDE` (same sign across all KNOWN windows, but range >= 0.30),
  `SIGN_FLIP` (at least one KNOWN window positive and at least one negative),
  or `INSUFFICIENT_KNOWN_WINDOWS` (fewer than 2 windows produced a KNOWN
  value -- explicitly never defaulted to STABLE, per this repo's standing
  UNKNOWN-never-coerced-to-safe discipline).
- Preserves per-window UNKNOWN state exactly as `correlation-evidence.ts`
  already represents it (`missingReason` carried through unchanged) --
  a window with insufficient overlapping returns for a pair is never dropped
  silently or treated as "not correlated."
- `tests/correlation-window-stability.test.ts` (new, 3 tests): rejects fewer
  than two distinct windows; confirms a constructed regime-change scenario
  (negative correlation in an early period, positive in a later period)
  produces a short window that sees only the recent regime and a long window
  that differs materially from it, with a non-`STABLE` classification;
  confirms a pair unknown in every window classifies as
  `INSUFFICIENT_KNOWN_WINDOWS`, never `STABLE` by default.

### 2b. What this does NOT do

- It does **not** compute or propose a cluster exposure cap, a concentration
  limit, or any Production AEGIS policy value -- same boundary
  `correlation-cluster-research.ts` already draws for itself.
- It does **not** replace or modify `AEGIS_SECTOR_CORRELATION` (the real
  Production single-position sector proxy) or `CORRELATION_EVIDENCE` (the
  existing research pairwise module, which it depends on and does not
  duplicate).
- It has **zero real callers** as of this pass -- it is a new tool, not yet
  wired into any research runner or study. That is an honest, deliberate
  disclosure: this pass built the tool the deferred item asked for; it did
  not run it against real multi-symbol bar history, since doing so would
  require a real correlation research runner analogous to
  `correlation-cluster-real-data-runner.ts` (which this pass did not build,
  to avoid overclaiming scope beyond what was actually verified this pass).

## 3. Test execution disclosure

**Original pass: could not execute.** This sandbox denied `node --experimental-strip-types
--test ...` and `npm test` invocations outright at the permission layer
(same boundary the Slice 15 reconciliation pass hit with `npx`) -- confirmed
that pass with a direct retry, not assumed from the prior slice's note alone.
`tests/correlation-window-stability.test.ts`'s three assertions were verified
at that time by manual trace against `buildCorrelationWindowStabilityReport`'s
and `buildCorrelationEvidence`'s actual logic (window slicing arithmetic, Pearson
computation, classification thresholds) rather than by running the suite --
disclosed then as explicitly weaker than execution.

**Correction (Wave 2 Slice 18, 2026-09-22): the suite was subsequently executed
and `tests/correlation-window-stability.test.ts` passed 3/3.** This section's
original "could not execute" framing describes that earlier session only and
must not be read as still true. `npm` typecheck/lint/security are being run
separately by Codex as part of this same review pass.

## 4. Agent handoff

**OWNER:** Claude (quant research + adversarial validation)
**TASK:** Pre-VPS Wave 2, Slice 17 -- correlation and severe-downside research
tooling
**FILES CHANGED:**
- `src/research/correlation-window-stability.ts` (new)
- `tests/correlation-window-stability.test.ts` (new, 3 tests, not executed
  this pass -- see Section 3)
- this document (new)

**WHAT WAS IMPLEMENTED:** A new, real, RESEARCH_ONLY multi-window (20/60/120
default) correlation stability classifier, composing the existing real
`buildCorrelationEvidence` without modifying or duplicating it. Confirmed
severe-downside continuous/vol-normalized MAE tooling already exists and is
real (`risk-policy-empirical-study.ts`) -- the prior "not built" note was
corrected, not repeated.

**KNOWN LIMITATIONS:** New module has zero real callers as of this pass (not
yet wired into a runner against real multi-year bar history); test suite was
verified by manual trace at the time this document was originally written
and subsequently executed (3/3 passing, see Section 3 correction);
`STABLE_RANGE_THRESHOLD = 0.30` is a research default chosen by this pass's
author, not a validated or TRD-specified value -- Codex/future research
should treat it as adjustable, not authoritative.

**RISKS:** None introduced -- new file has zero callers, zero broker
authority, and does not modify any existing module's behavior.

**NEXT RECOMMENDED TASK:** (1) Run the test suite in an environment where
`npm test` is permitted and confirm the three new tests pass as traced.
(2) If Codex/research decides this tool is worth exercising against real
data, build a `correlation-window-stability-real-data-runner.ts` analogous to
the existing `correlation-cluster-real-data-runner.ts`, using real multi-year
Alpaca bars for the canonical research universe already defined in
`risk-policy-empirical-study.ts`'s `canonicalRiskResearchUniverse`.
(3) Done this pass: `CORRELATION_WINDOW_STABILITY` was added to
`src/research/pre-vps-capability-registry.ts` immediately (RESEARCH_ONLY,
zero Production consumer, `currentState: REAL`) rather than left to
accumulate as another unregistered gap of the exact kind Slice 15 found and
fixed five instances of -- the registry now holds 33 entries (corrected from
a miscounted 28; see `docs/research/THETA_WAVE_2_SLICE_18_QUALITY_CORRECTION_2026-09-22.md`).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
