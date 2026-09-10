# THETA GitHub Method Corpus

Durability artifact. **Explicit non-fabrication note, read first:** the original
conversational "Parallel Phase 4" deliverable referenced a specific list of 20 GitHub
repositories with individual findings per repository. That specific list (names, URLs,
per-repo notes) was never committed to this repository and does not exist anywhere in
this repo's git history (confirmed during the integration-recovery pass that preceded
this durabilization task). It is **not reconstructed from memory here** — doing so
would risk fabricating repository names, licensing claims, or attributed findings that
cannot be verified, which this engagement's standing rules prohibit categorically for
performance numbers and, by the same logic, for unverifiable provenance claims about
specific third-party code.

## What this package durabilizes instead

The user's current durabilization instruction itself specifies two lists — methods to
preserve and patterns to reject — that describe *architectural patterns and failure
modes*, not any specific repository. Those lists are legitimate content: they were
supplied directly, not reconstructed from an uncertain memory of a prior session. This
package (`METHOD_EXTRACTION_REGISTRY.md`, `LICENSING_REGISTRY.md`,
`UNSAFE_PATTERN_REGISTRY.md`, `ARCHITECTURE_TRANSFER_MAP.md`, `BOT_RELEVANCE_MAP.md`)
registers those patterns as a durable, reviewable method taxonomy, generalized rather
than tied to unverifiable per-repository attribution.

## Central rule (restated, governs every file in this package)

**We extract methods, architectural patterns, failure modes, validation techniques, and
research ideas — never blindly copy repository code.** Every entry in
`METHOD_EXTRACTION_REGISTRY.md` is a pattern description, not a code excerpt, and no
file in this package contains copied source from any third-party repository.

## If the original 20-repository corpus is needed again

That would require either (a) the user re-supplying the original repository list, or
(b) a fresh GitHub research pass conducted and verified in a future session (as this
engagement has done before for trader-corpus verification, using `gh api`/WebSearch
against real public pages rather than accepting names at face value). Neither is
attempted in this durabilization pass, which is explicitly scoped to persisting
already-completed work, not producing new research. See
`../PHASE2_4_CORRECTION_AUDIT.md` for this gap recorded as a correction-pass finding.

## Status

This file is a scope/provenance note. The substantive method taxonomy is in the
sibling files listed above.
