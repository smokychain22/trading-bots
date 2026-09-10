# THETA Licensing Registry

Durability artifact. Persists the licensing-classification taxonomy the Phase 4 method
study used to govern what may ever be adapted into this proprietary codebase.
**No specific third-party repository is classified here** (see
`GITHUB_METHOD_CORPUS.md`'s provenance note — the original 20-repo corpus with its
per-repository license findings was never committed and is not reconstructed from
memory). This file registers the classification scheme itself, so it is available and
enforceable the next time a real repository is actually reviewed.

## Classification scheme

| Classification | Meaning | Action permitted |
|---|---|---|
| SAFE_TO_REFERENCE | Permissively licensed (e.g. MIT/BSD/Apache-2.0-style) or the license explicitly allows reading for research purposes without copying obligations | Read and describe the method in this repo's own words; do not copy source verbatim even under a permissive license unless attribution/compliance requirements are actually satisfied |
| SAFE_TO_ADAPT | Permissive license, terms confirmed compatible with this proprietary codebase, attribution requirements (if any) satisfiable | Reimplement the *pattern* in this repo's own code; do not paste the original source |
| ATTRIBUTION_REQUIRED | Permissive but conditioned on attribution (e.g. some BSD variants, MIT with notice retention) | Same as SAFE_TO_ADAPT, plus a recorded attribution note wherever the pattern is used |
| NONCOMMERCIAL_ONLY | Licensed for noncommercial use only (e.g. certain CC-BY-NC-style terms sometimes seen on research code) | Do not adapt into this commercial product at all — reference only for understanding, never for reuse |
| UNKNOWN_LICENSE | No license file/declaration found, or found but ambiguous | Treat as fully restricted by default — do not copy or adapt; describing the general method conceptually (not the specific implementation) is the only safe use |
| DO_NOT_COPY | Explicitly restrictive (proprietary, "all rights reserved", or a license this project cannot comply with) | No use beyond noting the pattern's existence in the abstract, if even that is warranted |

## AGPL-specific refinement (correction already made in this engagement's history)

A blanket "AGPL = DO_NOT_COPY" treatment was previously corrected to a more precise
three-way distinction, per an earlier "Phase 3/4 canonical correction pass" in this
engagement:

| AGPL sub-classification | Meaning | Action permitted |
|---|---|---|
| STRONG_COPYLEFT | AGPL-3.0 (or equivalent strong copyleft) confirmed, no dual-licensing or exception found | Reference/understand only |
| LEGAL_REVIEW_REQUIRED | AGPL terms present but the specific reuse scenario (e.g. network-service triggering vs. pure algorithmic-idea extraction) is genuinely unclear | Do not act until reviewed — do not default to either permissive or restrictive interpretation without that review |
| DO_NOT_COPY_INTO_PROPRIETARY_CODE | The specific, unambiguous conclusion for source-level reuse into this proprietary product, regardless of how permissively an idea extracted from it might otherwise be treated | No source reuse, ever, under this classification |

**The nuance this refinement preserves:** AGPL restricts copying/adapting *source
code* and *network-triggered derivative works*; it does not, on its own, prohibit
independently reimplementing a *method or architectural idea* described by that source
in this repo's own original code, provided the reimplementation is not itself a
derivative of the licensed source (i.e. not a close paraphrase or transliteration).
This is exactly the "extract methods, not code" central rule in
`GITHUB_METHOD_CORPUS.md` — the licensing classification governs the source, the
central-rule discipline governs what's actually done with any idea drawn from it.

## Status

Classification scheme only, with no specific repository classified against it in this
durabilization pass (see `GITHUB_METHOD_CORPUS.md` for why). Ready for use the next
time an actual repository review is conducted.
