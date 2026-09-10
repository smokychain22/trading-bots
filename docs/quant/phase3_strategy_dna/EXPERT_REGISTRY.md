# THETA Expert Registry — Narrative Index

Durability artifact. The previously conversational "Parallel Phase 3" deliverable
referenced a larger set of named traders/platforms than this repository has ever
persisted structured evidence for. **This file does not fabricate that missing data.**
The only structured, committed expert-evidence source in this repository is
`bots/theta/quant/expert_priors/data/expert_sources.json` (11 experts, all
`evidence_class: D_EXPERT_DNA` per TRD §0.1 — priors/hypothesis-generation only, never
level A/B/C proof). This file narrates that registry; it does not extend it with new
names, platforms, or performance figures that are not already there.

**Explicit non-fabrication note (Part D/G of this durabilization instruction):** if a
past conversational session referenced additional named traders (e.g. Alertsify/
Collective2/QuantWheel accounts) beyond these 11, that content was never committed to
this repository and is not reproduced here. Regenerating it would require either
re-supplying the original source material or re-doing independent verification (as was
done once before, via WebSearch, per this engagement's history) — that is new
evidence-gathering work, out of scope for a durabilization pass, and is not attempted
here. See `PHASE2_4_CORRECTION_AUDIT.md` for this finding recorded as a correction-pass
item.

## The 11 registered experts (verbatim from `expert_sources.json`)

| `expert_source_id` | Evidence state | Is failure DNA | Is failure study | Borrowed prior |
|---|---|---|---|---|
| `orange_cat` | OBSERVED | No | No | Patience, CSP→stock→CC full-cycle economics, acceptable ownership. |
| `iwm_hold_the_strike` | RECONSTRUCTED | No | No | 2-5 DTE ATM short-put challenger, intentional assignment, recovery wait before CC. |
| `hendo_67` | OBSERVED | No | No | Active CSP/CC/Wheel management, close/roll/assignment behavior. |
| `alex` | RECONSTRUCTED | No | No | Rolling/adjustment evolution and assignment lifecycle. |
| `ivan_orehovec` | OBSERVED | No | No | Portfolio/structure routing and meaningful premium-capture management. |
| `ivan_small_account` | INFERRED | No | No | Defined-risk/small-account structure hints (THETA-D only — see gating). |
| `wheeling_to_freedom` | RECONSTRUCTED | No | No | Active inventory management (BUY_CLOSE behavior). |
| `david_romic` | INFERRED | No | No | Conservative income process. |
| `lick_neeson` | INFERRED | No | No | Structure-routing hypothesis across CSP/CC/spreads/IC. |
| `sqqq_hold_the_strike` | OBSERVED | **Yes** | Yes | Failure DNA: closed-trade WR can hide inventory drawdown. |
| `fearless_value` | INFERRED | No | Yes | High-WR/value orientation with drawdown caution. |

Every `platform` field in the source registry is `null` with an explicit
`platform_note: "Not specified in the supplied corpus; do not invent a platform
label."` — preserved here rather than filled in speculatively.

## Evidence-class discipline (restated, not new)

`evidence_class_enum: [A_LIVE_OOS, B_INSTITUTIONAL, C_UNTOUCHED_OOS, D_EXPERT_DNA,
E_ENGINEERING, F_MARKETING]`. All 11 entries above are `D_EXPERT_DNA` — the lowest
evidentiary tier that still generates hypotheses (as opposed to `E_ENGINEERING`, code
quality mistaken for strategy evidence, or `F_MARKETING`, a claim with no evidentiary
weight at all). No expert entry in this repository has ever been, or should ever be,
promoted to a higher evidence class without genuinely new primary-source verification.

## What each expert is and is not licensed to do

- **Licensed:** generate hypotheses in `research/data/hypotheses.json`
  (`source_experts` field), inform the reliability-weighted expert-prior calculation
  (`expert_priors/weighting.py`), suggest DNA components to catalog
  (`COMPONENT_LIBRARY.md`).
- **Not licensed:** override a negative OOS EV finding, override an AEGIS hard veto,
  stand in for a fitted probability, or be cited as evidence of profitability on its
  own. This is enforced structurally by `expert_priors/weighting.py::expert_prior`
  returning `None`/UNKNOWN rather than a numeric default when no usable evidence
  exists, and by the shrinkage formula's own design (below).

## Reliability-weighting formula (already implemented, restated for visibility)

```
RawExpertWeight_e = DataQuality_e x SampleConfidence_e x RegimeFit_e
                     x Recency_e x Independence_e x Transferability_e
ShrunkWeight_e = RawExpertWeight_e x N_e / (N_e + k_shrink)
ExpertPrior(a|X) = sum(ShrunkWeight_e * P_e(a|X)) / sum(ShrunkWeight_e)
```

Implemented in `expert_priors/weighting.py` — `k_shrink` is a required argument with no
hardcoded default (so a caller cannot silently under-shrink a thin-evidence expert), and
`expert_prior` returns `None` rather than `0` when no expert has usable evidence for a
given action/state, consistent with `UNKNOWN != zero` everywhere else in this repo.

## Status

IMPLEMENTED as data + code (`expert_sources.json`, `weighting.py`, `loader.py`) —
unchanged by this durabilization pass. This file adds narrative visibility only.
