# THETA AEGIS stress-baseline maturity contract

Status: Wave 4 item 4. Companion to `src/research/aegis-stress-baseline-maturity.ts`
(10/10 tests passing). Research-only, `brokerAuthority: false`.

## Problem this contract solves

A live risk detector (`stressIvShockDetected`/`stressSpreadWideningDetected`)
cannot honestly require a historical baseline that does not yet exist and
then permanently freeze the bot without an explicit policy. Equally,
`null -> false` is forbidden by this engagement's standing rule. This
contract gives both signals a real maturity state machine so a future real
detector can honestly report which of these is true at any moment, rather
than collapsing everything into one perpetual `null`.

## States

- `BASELINE_NOT_STARTED` -- zero raw observations collected.
- `BASELINE_ACCUMULATING` -- some real evidence exists, but below the
  governed policy's minimum on at least one dimension (raw N, session N,
  distinct underlying N, or temporal span).
- `BASELINE_SUFFICIENT` -- every policy minimum is met; no live observation
  was supplied this cycle to combine with it.
- `CURRENT_OBSERVATION_STALE` -- the baseline is sufficient, but this
  cycle's live observation is older than the policy's max age (or is a
  future-dated observation -- a PIT violation, never treated as fresh).
- `CURRENT_OBSERVATION_INVALID` -- the baseline is sufficient, but this
  cycle's live observation failed its own validity check (e.g. crossed BBO).
- `DETECTOR_READY` -- baseline sufficient AND live observation fresh and
  valid. This is the ONLY state in which this contract considers a real
  boolean trustworthy.
- `DETECTOR_PROVIDER_LIMITED` -- the provider itself cannot supply this
  signal at all, independent of data volume. Takes precedence over every
  other state.

## Required evidence (no invented universal threshold)

Every sufficiency threshold (`minimumRawN`, `minimumSessionN`,
`minimumDistinctUnderlyingN`, `minimumTemporalSpanDays`,
`maxCurrentObservationAgeSeconds`) is a REQUIRED field on a versioned
`BaselineSufficiencyPolicy` the caller must supply explicitly -- this module
never substitutes a default. This is deliberate: choosing the real numbers
is a governance decision for whoever owns AEGIS policy, not a number this
research contract should invent.

## Applying this to the real current evidence

Per `docs/operations/THETA_PRODUCTION_CLOSURE_WAVE1_2026-09-22.md`:
Aiven's `market.option_quote_snapshot` has zero rows, but candidate
point-in-time evidence has real observations: 3,876 rows / 1,696 distinct
contracts (2026-09-21), 4,590 rows / 607 distinct contracts (2026-09-18),
139 rows / 59 distinct contracts (2026-09-16).

Feeding this into `assessBaselineMaturity` with ANY plausible real policy
(e.g. requiring evidence spanning more than one session, per the "single
session isn't enough" adversarial test in the companion test file) would
correctly return `BASELINE_ACCUMULATING`, not `BASELINE_SUFFICIENT` --
real data exists, but a rolling baseline spanning only 3 known session-dates
with no confirmed temporal continuity between them has not yet been proven
sufficient by any governed standard. This directly implements Codex's own
stated position in the closure receipt: "A detector must check observation
counts and temporal alignment before it can produce either boolean."

## What this contract does NOT do

- It does not decide what the real policy thresholds should be -- that is
  a Codex/owner governance decision.
- It does not build the real IV-shock or spread-widening detectors
  themselves -- it only gives whichever detector is eventually built a
  real, honest maturity vocabulary to report through.
- It does not change AEGIS, Production sizing, or any runtime behavior.
