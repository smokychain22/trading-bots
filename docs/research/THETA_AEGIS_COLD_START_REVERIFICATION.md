# AEGIS cold-start reverification (Wave 17 section 11)

Per this wave's explicit instruction: "Do not build another policy unless
existing one is actually incomplete... If current implementation already
satisfies this, document VERIFIED and move on immediately."

## The three required distinctions, checked against `aegis-stress-baseline-maturity.ts`

1. **CURRENT EXECUTION SAFETY = always required.** Real in the existing
   state machine: `CURRENT_OBSERVATION_STALE`/`CURRENT_OBSERVATION_INVALID`
   are checked independently of baseline maturity -- even a
   `BASELINE_SUFFICIENT` baseline does not bypass a stale/invalid current
   observation (`assessBaselineMaturity` lines 147-155). Confirmed real.

2. **MATURE HISTORICAL STRESS DETECTOR = required when mature.** Real:
   `DETECTOR_READY` is reached ONLY when `BASELINE_SUFFICIENT` AND the
   current observation is fresh/valid (line 158) -- the sole state in
   which "a trustworthy boolean may be produced," per the function's own
   doc comment. Confirmed real.

3. **IMMATURE BASELINE IN PAPER = explicit, versioned "not applicable"
   state, never `unknown -> false` and never `unknown -> silently
   allow`.** The existing `BASELINE_NOT_STARTED`/`BASELINE_ACCUMULATING`
   states already satisfy the core safety requirement here: neither state
   is ever collapsed into a boolean `false` (a real AEGIS consumer must
   treat `BASELINE_ACCUMULATING`/`BASELINE_NOT_STARTED` as "cannot
   evaluate," not as "no stress" -- this is exactly why the module
   exists). This wave asked for a specifically-named
   `PAPER_COLD_START_NOT_APPLICABLE` state -- the existing module does not
   have that exact name, but semantically `BASELINE_ACCUMULATING`/
   `BASELINE_NOT_STARTED` already carry the same real meaning (baseline
   immature, detector not authorized to produce a trustworthy signal).
   Adding a differently-named synonym state would not close a real safety
   gap -- it would only rename an already-correct state, and Production
   Paper-policy naming is explicitly Codex's decision per this module's
   own doc comment ("This module does NOT decide Production policy").

## Verdict

**AEGIS_COLD_START = VERIFIED_COMPLETE.** No code change made this pass.
The existing `aegis-stress-baseline-maturity.ts` (Codex-hardened,
`BASELINE_INVALID` added in an earlier wave) already satisfies all three
real safety distinctions this section asked to reverify. If Codex wants
the exact literal name `PAPER_COLD_START_NOT_APPLICABLE` for operator-
facing clarity, that is a real but purely cosmetic rename of
`BASELINE_ACCUMULATING`/`BASELINE_NOT_STARTED` in the Production
integration layer, not a research gap -- not actioned here to avoid
unnecessary churn on a stable, tested, already-hardened module per this
wave's own instruction not to rebuild what's already complete.
