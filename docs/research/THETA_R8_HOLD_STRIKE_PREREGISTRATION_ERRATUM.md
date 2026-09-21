# Erratum: THETA_R8_HOLD_STRIKE_PREREGISTRATION.md

Status: append-only correction record. The original preregistration document is **not edited** — per its own frozen-before-outcome-inspection status, silently rewriting it after the fact would defeat the entire purpose of preregistration. This erratum documents the discovered inaccuracy, its consequence, and points to a versioned v2 correction that must be used for any future Hold-Strike empirical work instead of the original document.

## Original statement (unchanged, quoted verbatim from the frozen document)

> `THETA_HOLD_STRIKE` is structurally identical at entry to `THETA_CONVENTIONAL` (same `singleLegPutCandidate` shape: one short put, `action: 'OPEN_CSP'`, identical economics fields)

And, in the Pairing logic section:

> Compared against... the SAME underlying and SAME short-put strike/expiration... Hold-Strike must never be paired against a DIFFERENT strike/expiration chosen more favorably in hindsight.

## Actual canonical source truth

`src/theta/strategy-package.ts` (verified this session, corrected after an earlier brain-audit receipt in this thread itself mis-attributed these lattices):

| Branch | DTE range | optionType |
| --- | --- | --- |
| `THETA_CONVENTIONAL` | 25–60 | PUT |
| `THETA_HOLD_STRIKE` | **2–5** | PUT |

The two branches' configured DTE lattices **do not overlap at all** (25–60 vs. 2–5). This is not a minor entry-geometry difference -- it is a structural impossibility for the original pairing logic as written. "Compared... on the SAME strike/expiration" requires a single option contract whose DTE simultaneously falls in `[2,5]` AND `[25,60]`, which cannot happen. As written, the original document's eligible population (Hold-Strike/Conventional pairs sharing an identical contract) is **permanently empty by construction**, regardless of any real market data -- not merely rare or hard to find.

The `singleLegPutCandidate` SHAPE claim (one short put, `action: 'OPEN_CSP'`, identical economics fields) remains accurate -- that part of the original hypothesis is not wrong. Only the entry-GEOMETRY identity claim, and the pairing logic built on top of it, is wrong.

## Discovery

- **Date**: 2026-09-22
- **Source SHA at discovery**: canonical main `f5bb9d69174458e9c04b2347b4766885ab8c4903`, this branch at `5554265d06313d42d3c0c2fa287ff6504d3fc7ce`
- **Discovered by**: a forked sub-audit reading `strategy-package.ts` directly during the "SOVEREIGN BRAIN" adversarial audit, independent of any Hold-Strike outcome data
- **Hold-Strike outcome data inspected before this discovery?** **NO.** No Hold-Strike-specific empirical study, real or synthetic, has been run in this entire engagement as of this erratum. This was a pure entry-geometry read of registry configuration, with zero outcome inspection involved. The discovery therefore does not compromise the preregistration's core purpose (preventing outcome-informed hypothesis tuning) -- it is a genuine, outcome-blind correction of a factual entry-geometry error.

## Consequence for hypothesis/pairing design

1. **The original pairing logic cannot be used as written.** A v2 preregistration is required before any Hold-Strike empirical work proceeds -- see below.
2. **The underlying MANAGEMENT hypothesis (H1/H2) is not invalidated by this finding**, but its interpretation changes: if Hold-Strike only ever operates on very-short-DTE (2-5 day) contracts while Conventional operates on 25-60 day contracts, ANY observed economic difference between the two branches is now confounded by DTE itself, not isolated to "holding toward strike vs. early defensive management" the way the original document assumed. A v2 protocol must either (a) compare Hold-Strike against a Conventional-style policy evaluated on the SAME short-DTE contracts Hold-Strike actually trades (a different, apples-to-apples comparator, not literally "THETA_CONVENTIONAL" as configured today), or (b) explicitly reframe Hold-Strike as its own distinct short-DTE strategy studied on its own economics, without a paired-comparator claim at all, until a genuine matched comparator is defined.
3. **No amendment is made to the original document.** This erratum stands alongside it. Any future reference to "the Hold-Strike preregistration" for empirical purposes must cite the yet-to-be-written `THETA_R8_HOLD_STRIKE_PREREGISTRATION_v2.md` (not yet created as of this erratum -- creating a rigorous v2 pairing design is nontrivial and deserves its own dedicated pass, not a rushed same-session fix) or explicitly acknowledge this erratum's limitation if the v1 document is used for anything short of full empirical promotion (e.g. citing only its outcome-definition/censoring/cost-treatment sections, which remain valid regardless of the pairing defect).

## Status

`THETA_R8_HOLD_STRIKE_PREREGISTRATION.md` remains on record, unedited, but is **NOT VALID for its stated pairing/comparison purpose** until a v2 document resolves this erratum. No Hold-Strike promotion decision may cite the v1 pairing logic.
