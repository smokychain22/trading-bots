# THETA quantified unknown audit (Wave 9 Batch 2)

> **CORRECTION (Wave 10, 2026-09-22)**: the "real finding" below about
> `ROLL_CC_CANDIDATE_SOURCE` being `DATA_EXISTS_BUT_NOT_WIRED` was a
> false positive, found on direct re-read of
> `PaperBootstrapManagementPolicyProvider.evaluate()`
> (`paper-bootstrap-management-policy.ts:1136-1159`). It reads
> `state.managementCandidateDiscovery` -- populated by the real
> `ProductionPaperManagementCandidateSource` -- independently of the
> constructor's `noCandidates` default, which only governs the SINGULAR
> `rollCandidate`/`ccCandidate` fallback. The P0-1 management-candidate
> gap is **fully closed**, not partially. See
> `THETA_CODEX_INTEGRATION_QUEUE.md`'s retracted Q-9 for the full
> correction and `THETA_AVOIDABLE_UNKNOWN_RECLASSIFICATION.md` for the
> corrected, more precise taxonomy this finding prompted (mixing real
> blockers, optional research, intentional quarantine, and normal
> pipeline behavior into one "avoidable unknown" count was itself
> imprecise -- corrected there, not rewritten here to preserve the
> original audit's real, still-valid parts).

## Methodology -- reuses the existing denominator, builds nothing new

Per this wave's explicit instruction, this audit does **not** build a
third denominator. It reuses the already-completed system-capability
registry (`src/research/pre-vps-capability-registry.ts`, 40 rows,
reconciled against the directive's own 27-domain universe in Wave 7
Batch 2) and classifies every row using its own real, already-populated
fields (`currentState`, `runtimeReachable`, `maturity`, `persistence`,
`empiricallyValidated`) -- never a fresh judgment independent of that
source data. The classifier is a committed, reproducible script:
`tools/theta-unknown-audit.mjs`.

While building this pass, two registry rows were found stale against
`main` commits merged earlier this pass (`ASSIGNMENT_CAPACITY`,
`ROLL_CC_CANDIDATE_SOURCE`/`ROLL_CC_CANDIDATE_VALUATION`) -- corrected in
the registry itself before running the classifier, detailed below rather
than silently absorbed into the counts.

## Real finding while correcting the registry: partial progress on the P0 management-candidate gap

Tracing `ROLL_CC_CANDIDATE_SOURCE` against the new
`production-paper-management-candidate-source.ts` (merged into main this
pass) found a precise, two-path situation, not a simple "closed" or
"still open":

- `ProductionPaperManagementCandidateSource` (`autonomous-runtime.ts:429`)
  is real and wired -- it discovers real candidates and feeds
  `managementStore.assembleAndPersistOpenChains()`, so persisted
  management input states now carry real candidate-discovery evidence.
- BUT `managementPolicyEvidenceProvider` (`autonomous-runtime.ts:353-354`)
  -- the SEPARATE thing that feeds `buildRuntimeManagementFrontiers()`,
  which produces the actual ROLL/SELL_CC action frontier -- still calls
  `createPaperBootstrapManagementPolicyProvider()` with zero arguments,
  still defaulting to `noCandidates`.

This is real `DATA_EXISTS_BUT_NOT_WIRED`, in the precise, narrow sense
this wave asked to distinguish: the data now exists and is persisted, but
one specific remaining wire (passing the discovery result, or an
equivalent real candidate source, into the policy-evidence provider) has
not been made. Registry updated; `ASSIGNMENT_CAPACITY` was independently
confirmed fully closed (main `b9cd49a`/`e64d554`/`6a359a0`/`52e6ea5`) and
moved to `REAL`/`EMPIRICALLY_UNPROVEN` (mechanically real, not yet
empirically validated against a live cycle).

## Category counts (real, from the committed script, 40-row denominator)

> Re-run after the Wave 10 Q-9 correction: `DATA_EXISTS_BUT_NOT_WIRED`
> dropped to 4 (was 5), `IMPLEMENTATION_DEFECT` dropped to 1 (was 2),
> `EMPIRICALLY_UNPROVEN` rose to 9 (was 7) -- both `ROLL_CC_*` rows moved
> there as `REAL` (mechanically correct, not yet empirically validated).
> Raw counts below are the original, pre-correction numbers kept for
> historical record; see the reclassification doc for the corrected,
> decision-relevant taxonomy.

```
DATA_EXISTS_AND_WIRED          = 1
DATA_EXISTS_BUT_NOT_CONSUMED   = 3
DATA_EXISTS_BUT_NOT_PERSISTED  = 8
DATA_EXISTS_BUT_NOT_WIRED      = 5
NO_PROVIDER_CAPABILITY         = 0
PROVIDER_ERROR                 = 0  (not a state this registry currently models -- see note below)
LEGITIMATE_RUNTIME_UNKNOWN     = 7
EMPIRICALLY_UNPROVEN           = 7
NOT_APPLICABLE                 = 7
IMPLEMENTATION_DEFECT          = 2
-------------------------------------
TOTAL                          = 40 (matches registry row count exactly)

AVOIDABLE_UNKNOWN_COUNT = DATA_EXISTS_BUT_NOT_WIRED + DATA_EXISTS_BUT_NOT_CONSUMED + IMPLEMENTATION_DEFECT = 5 + 3 + 2 = 10
DATA_EXISTS_BUT_NOT_WIRED_COUNT = 5
DATA_EXISTS_BUT_NOT_CONSUMED_COUNT = 3
PROVIDER_LIMITED_COUNT = 0 (see note)
LEGITIMATE_UNKNOWN_COUNT = LEGITIMATE_RUNTIME_UNKNOWN + NOT_APPLICABLE = 7 + 7 = 14
```

**Note on `PROVIDER_ERROR`/`PROVIDER_LIMITED` = 0**: the registry's
`CapabilityCurrentState` type has no dedicated provider-limitation state
today (`REAL`/`PARTIAL`/`STUB_DEFAULT`/`MISSING`/`QUARANTINED_NO_CALLERS`/
`NOT_INDEPENDENTLY_VERIFIED`). This is an honest gap in the registry's own
vocabulary, not a claim that zero capabilities are provider-limited --
this engagement's prior waves separately documented real provider
limitations (Vanna/Charm/walls quarantined as provider-limited in
Optionomics research, `stressIvShockDetected`/`stressSpreadWideningDetected`
null pending real baseline detectors). Those findings stand; they are
simply not yet expressed in this registry's `currentState` enum. Adding a
`PROVIDER_LIMITED` state to the registry type is a real, small follow-up
this pass did not make (would require touching every existing row's type
narrowing, not attempted here to avoid unnecessary churn on a stable,
tested file).

## The 10 avoidable unknowns, named (the owner's actual question)

> **See `THETA_AVOIDABLE_UNKNOWN_RECLASSIFICATION.md` for the corrected
> version of this section.** The count of 10 below mixed a genuine
> first-Paper safety gap, optional unused ranking intelligence, shadow/R8
> scope items, an intentionally quarantined architecture, and one item
> that was never actually unknown -- corrected there into a taxonomy that
> actually answers what can stop first Paper (answer: 1 item,
> `AEGIS_SYSTEM_LIQUIDITY_STRESS`, already Q-6). The item-by-item list
> below is kept for its real per-item detail/evidence, which is still
> accurate; only the single combined "avoidable=10" framing was
> imprecise.

Per-capability detail (id | classification | why), from the real registry:

1. `UNDERLYING_RANKING` -- `DATA_EXISTS_BUT_NOT_CONSUMED`: baseline is a
   placeholder (`avgDollarVolume`); real challenger rankers exist only as
   research, not Production-integrated.
2. `AEGIS_SECTOR_CORRELATION` -- `DATA_EXISTS_BUT_NOT_WIRED`: real only
   for exactly one held underlying; no multi-position sector/correlation
   producer exists.
3. `CROSS_STRATEGY_ECONOMIC_COMPARISON` -- `DATA_EXISTS_BUT_NOT_WIRED`:
   a hardened research comparator exists
   (`cross-strategy-common-horizon-contract.ts` v4) but is not
   Production-integrated; cross-branch ties fall through to alphabetical
   ordering instead.
4. `AEGIS_EVALUATION` -- `DATA_EXISTS_BUT_NOT_CONSUMED`: only reached
   after a candidate survives the upstream feasible/Pareto stage; per the
   real 2026-09-21 session, most candidates never reached AEGIS at all
   (`NOT_EVALUATED`, not evaluated-and-rejected).
5. `EVENT_RISK_STATE` -- `DATA_EXISTS_BUT_NOT_CONSUMED`: two real
   Production consumers exist, but whether they ever receive a real
   non-`UNKNOWN` determination (vs. always defaulting to `UNKNOWN`) was
   not independently re-derived.
6. `ASSIGNMENT_CAPACITY` -- moved out of this bucket this pass (now
   `EMPIRICALLY_UNPROVEN`, real producer confirmed).
7. `RECOVERY_LIFECYCLE` -- `DATA_EXISTS_BUT_NOT_WIRED`:
   `recovery_contract.py` exists but is never referenced by the TS Python
   bridge allowlist -- confirmed `QUARANTINED` disposition in Wave 7's
   Python contract research, so this is intentionally not being wired,
   which is a different conclusion than "should be fixed" -- flagged here
   for completeness of the count, not as an open action item (see
   `THETA_PYTHON_RUNTIME_CONTRACT_DISPOSITION_RESEARCH.md`).
8. `VOLATILITY_SURFACE` -- `DATA_EXISTS_BUT_NOT_WIRED`: RV5/RV10/RV30/
   RV60 methodology, expected-move derivation, and GEX PIT status remain
   unresolved (this wave's own Batch 9, not yet reached).
9. `ROLL_CC_CANDIDATE_SOURCE` -- `DATA_EXISTS_BUT_NOT_WIRED`: the precise
   remaining wire detailed above -- now a small, specific task, not an
   open-ended P0.
10. `AEGIS_SYSTEM_LIQUIDITY_STRESS` / `ROLL_CC_CANDIDATE_VALUATION` --
    `IMPLEMENTATION_DEFECT` (2 rows): the AEGIS stress-producer gap
    (already Q-6 in the Codex queue) and the roll/CC valuation module
    (real, tested, but unreachable until #9 above is wired -- the SAME
    underlying gap counted from its consumer side).

**Of these 10, 3 already have an open, specific Codex queue row** (Q-6
AEGIS stress producers; the ROLL_CC pair is not yet a queue row -- added
below as Q-9). The remaining 7 are either intentionally not wired
(`RECOVERY_LIFECYCLE`, confirmed `QUARANTINED` -- not a real gap) or need
their own scoped follow-up rather than blanket "fix everything" scope
creep (`UNDERLYING_RANKING`, `AEGIS_SECTOR_CORRELATION`,
`CROSS_STRATEGY_ECONOMIC_COMPARISON`, `AEGIS_EVALUATION`,
`EVENT_RISK_STATE`, `VOLATILITY_SURFACE`).

## New Codex queue entry

See `THETA_CODEX_INTEGRATION_QUEUE.md` Q-9: wire the real
`ProductionPaperManagementCandidateSource` discovery result (or an
equivalent) into `createPaperBootstrapManagementPolicyProvider(...)` at
`autonomous-runtime.ts:354` -- closes both `ROLL_CC_CANDIDATE_SOURCE` and
transitively `ROLL_CC_CANDIDATE_VALUATION`.
