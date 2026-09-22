# AEGIS first-Paper policy gap

Status: research/governance proposal only. No AEGIS Production behavior is modified by this document. Registered against canonical main `f5bb9d69174458e9c04b2347b4766885ab8c4903`. This corrects an earlier same-thread audit pass that overstated the number of permanently-blocked AEGIS families -- verified this session by tracing the real end-to-end data flow (`theta-shadow-cycle.ts` -> `account-exposure.ts` -> `aegis-derivation.ts` -> `bots/theta/quant/models/aegis.py`), not just the initial input object.

## Corrected finding

Only **two** AEGIS input fields are unconditionally, permanently `None` with zero real producer anywhere in the traced pipeline: `stressIvShockDetected` and `stressSpreadWideningDetected`. Both are absent from `theta-shadow-cycle.ts`'s `effectiveAegisInputs` override block (confirmed by direct comparison against the fields that ARE present there: `stressGapDetected`, `liquidityAcceptable`, `executionQualityAcceptable`, `providerState`, all real-derived). `aegis.py`'s SYSTEM family (`_system`, lines ~155-164) requires all three stress signals non-`None`; since two never are, SYSTEM is permanently `HOLD_ONLY`, and AEGIS's worst-family-wins design (`_worse()`) means the whole assessment is at least `HOLD_ONLY` whenever SYSTEM is evaluated.

`sectorConcentrationPct` and `correlationClusterExposurePct` are **NOT permanently null** -- `account-exposure.ts`'s `deriveCandidateInclusiveAegisInputs` derives a real value (`soleRiskGroup = proposedUnderlyingExposure / equity`) specifically in the single-underlying-held case, reverting to `null` only once a second distinct underlying is held. This is a real, if narrow, proxy -- not a real sector classifier or a real correlation computation, but it is genuinely non-null in exactly the bootstrap/first-Paper-trade scenario this project's near-term objective targets.

## Current behavior

| Field | Current producer | Behavior on `None`/`null` |
| --- | --- | --- |
| `stressIvShockDetected` | **none** | `SYSTEM` family forced `HOLD_ONLY` (`aegis.py`, `any(state is None for state in stress_states)`) |
| `stressSpreadWideningDetected` | **none** | Same |
| `sectorConcentrationPct` | `account-exposure.ts::deriveCandidateInclusiveAegisInputs`, real ONLY when exactly one underlying is held | `HOLD_ONLY` for that family when a second underlying is held (the case where a real classifier would matter most) |
| `correlationClusterExposurePct` | Same function, same narrow condition | Same |

## Missing producer

A real IV-shock detector and a real spread-widening-stress detector, comparable in spirit to the real `deriveStressGapDetected` that already exists (a versioned threshold over an observed one-day return) but for implied volatility and bid-ask spread history respectively. Per this session's earlier field-level Optionomics qualification work, the raw historical IV/spread data needed for such a detector is itself only partially PIT-qualified today (`docs/research/THETA_OPTIONOMICS_FIELD_PIT_QUALIFICATION.md`) -- building a real detector is gated on that qualification work maturing, not merely on writing the detector function.

A real sector/correlation classifier beyond the single-underlying proxy: PIT-safe sector/industry classification data source (not yet identified), and the correlation-cluster research already built this session (`src/research/correlation-cluster-research.ts`, `AWAITING_CANONICAL_EXPORT` for real multi-underlying data).

## Why UNKNOWN becomes HOLD_ONLY

`aegis.py`'s design principle, confirmed by reading the module: any family's assessment threshold function treats a `None` required input as the WORST possible state for that family, and `assess_aegis` takes the worst across all families (`_worse()`). This is a defensible general fail-closed pattern for a safety system -- the question this document raises is narrower: whether EVERY field currently wired into a hard-required family actually deserves hard-required status, or whether some (like the two stress-detection fields, which have no producer at all rather than an occasionally-narrow one) should be `RESEARCH_ONLY`/deferred until a producer exists, given that leaving them hard-required with zero producer makes the affected family permanently, structurally unblockable rather than genuinely risk-aware.

## Evidence the fields were intended as mandatory hard safety requirements

**None found.** No committed design document, TRD/spec reference, or code comment anywhere in `aegis-derivation.ts`, `aegis.py`, or `theta-shadow-cycle.ts` asserts that SECTOR/CORRELATION/IV-shock/spread-widening were *deliberately chosen* as mandatory first-Paper safety requirements. Every comment found explains *why no producer exists yet* -- a data-availability statement, not a stated policy rationale. Per this document's own instruction not to invent a tier absent explicit project evidence: **classify the two permanently-null stress fields as `POLICY_AUTHORITY_UNRESOLVED`**, not as a settled hard-required tier. SECTOR/CORRELATION do not need this classification in the same way, since they are not permanently null -- their behavior (real value when single-underlying, UNKNOWN otherwise) may or may not be the intended policy; that too is unresolved, but the field is not "missing a producer entirely" the way the stress fields are.

## Alternative policy options (no recommendation made)

1. **Leave as-is.** SYSTEM stays permanently `HOLD_ONLY` until real IV-shock/spread-widening detectors exist. Safest, but means AEGIS alone (independent of the separately-confirmed event-evidence gate) already prevents any new-risk Paper action regardless of economics, for as long as this persists.
2. **Redesign SYSTEM to be assessable on `stressGapDetected` alone** (the one real signal) when the other two are `None`, with a distinct, visible `PARTIAL_SYSTEM_ASSESSMENT` state rather than an undifferentiated `HOLD_ONLY` -- lets the one real signal do real work without waiting for the other two.
3. **Formally tier stress-detection fields as `RESEARCH_ONLY`/deferred** (not evaluated for hard blocking at all) until their producers exist, explicitly documented as a deliberate, versioned policy decision rather than an accidental side effect of "the field happens to always be null."

## Risks of relaxing

Losing a real safety signal the moment a real producer for it exists but before it's re-wired into a hard gate; creating a precedent that "no producer yet" is treated the same as "verified safe," which contradicts this entire engagement's UNKNOWN-never-silently-relaxed discipline; option 2's `PARTIAL_SYSTEM_ASSESSMENT` state could itself be exploited if not carefully bounded (e.g. if a caller learns to game which stress signals it supplies).

## Risks of leaving mandatory

Structural, indefinite paralysis of the SYSTEM family (and therefore all new-risk entry, given `_worse()`) with no path forward until two detectors that don't currently exist are built -- which, given the current PIT-qualification state of the underlying historical IV/spread data, is not a near-term certainty. This compounds with (does not single-handedly cause, but adds to) the separately-confirmed event-evidence gate as an independent reason no new-risk Paper action can occur today.

No threshold, weight, or specific redesign is recommended by this document. This is Codex's/the owner's decision, requiring explicit review because it changes account-risk authority.
