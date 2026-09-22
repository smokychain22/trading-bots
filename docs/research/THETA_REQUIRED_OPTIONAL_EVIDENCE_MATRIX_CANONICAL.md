# THETA required-vs-optional evidence matrix -- CANONICAL

Status: Wave 5 item 2. This is now THE single canonical anti-paralysis
reference. It supersedes both prior parallel documents as the document a
reader should consult first:

- `THETA_REQUIRED_OPTIONAL_EVIDENCE_MATRIX.md` (this session, Wave 4) --
  **FIELD-scoped**: individual decision INPUTS (e.g. `eventNear`, IV/RV/skew
  sub-fields, ticker/sector concentration percentages).
- `THETA_REQUIRED_VS_OPTIONAL_EVIDENCE_MATRIX_2026-09-22.md` (a concurrent
  parallel research session, Wave 2 Slice 17) -- **CAPABILITY-scoped**: whole
  registry entries (`capabilityId`s from `pre-vps-capability-registry.ts`),
  each with a "what breaks if wrong/missing" statement.

**Neither prior document is wrong or duplicative in the sense of
contradicting the other -- they operate at genuinely different
granularities and are BOTH kept, not deleted, as the detailed backing
material this canonical document draws on.** This document does three
things neither source document does alone: (1) states the two-axis
relationship explicitly so a reader is never confused about which one to
trust, (2) resolves the one real classification tension found between them,
and (3) is the single file any future Wave should update going forward --
**no third "canonical" matrix should ever be created; extend this one.**

## The two-axis relationship

A CAPABILITY (e.g. `AEGIS_SYSTEM_LIQUIDITY_STRESS`) is a whole subsystem:
producer + consumer + runtime path. A FIELD (e.g.
`stressSpreadWideningDetected`) is one input that capability's producer is
supposed to supply. **A capability can be entirely missing (no producer
exists at all) while the FIELD it would supply is still correctly, honestly
`null`** -- this is exactly today's AEGIS stress situation: the
`AEGIS_SYSTEM_LIQUIDITY_STRESS` capability is `STUB_DEFAULT` (no real
detector exists), and the fields it would supply
(`stressIvShockDetected`/`stressSpreadWideningDetected`) are correctly
`null` rather than false-defaulted. Both documents agree on this fact; they
just describe two different layers of the same real gap.

## The one real classification tension, resolved

The capability-scoped matrix reclassifies `ROLL_CC_CANDIDATE_SOURCE` from
the more intuitive `ECONOMIC_RANKING_FEATURE` to `HARD_REQUIRED_SAFETY`,
reasoning that a Wheel bot structurally unable to roll or sell a covered
call cannot execute its own lifecycle safety valve. The field-scoped
matrix's five-tier taxonomy does not have a row for "candidate source
capability entirely absent" at all -- it only classifies EVIDENCE FIELDS
that can independently be `UNKNOWN`, and a missing candidate-source
capability is not a field going unknown, it is an entire capability that
was never built.

**Resolution**: both are correct, describing different things, and the
apparent tension dissolves once the axis distinction above is applied.
`ROLL_CC_CANDIDATE_SOURCE` is not a FIELD -- it is a CAPABILITY, and the
capability-scoped matrix's own five-tier taxonomy is the right one to
classify it under. Its `HARD_REQUIRED_SAFETY` classification is ADOPTED as
canonical for this capability, with the reasoning preserved from the
source document (a Wheel bot unable to manage risk on an open position via
roll/CC is safety-adjacent, not merely a quality-of-decision gap). This is
the one classification change this canonical document makes -- everywhere
else, both source documents already agreed.

## Canonical field-level matrix (inherits from the Wave 4 field-scoped document, unchanged)

See `THETA_REQUIRED_OPTIONAL_EVIDENCE_MATRIX.md` for the full table -- not
reproduced here to avoid a third copy drifting out of sync. Every row there
remains canonical as written.

## Canonical capability-level matrix (inherits from the Wave 2 Slice 17 document, with the one correction above)

See `THETA_REQUIRED_VS_OPTIONAL_EVIDENCE_MATRIX_2026-09-22.md` for the full
33-row table -- not reproduced here for the same reason. Its `ROLL_CC_CANDIDATE_SOURCE`
row's `HARD_REQUIRED_SAFETY` classification (already present in that
document) is confirmed canonical by this reconciliation, not merely
"flagged for Codex review" as that document's own Section 3 originally
framed it -- Codex's own closure receipt this engagement has already
reviewed (`docs/operations/THETA_PRODUCTION_CLOSURE_WAVE1_2026-09-22.md`)
independently treats the roll/CC candidate-source gap as a real,
first-order closure blocker, consistent with this classification.

## Going forward

Any NEW field discovered should be added to the field-scoped document. Any
NEW capability discovered should be added to the capability-scoped document
AND to `src/research/pre-vps-capability-registry.ts`. This canonical
document should be updated only when: (a) a genuine new tension between the
two is found and resolved, or (b) the two-axis framing itself needs
revision. It should never become a third place the same rows are copy-pasted
into, since that is exactly the drift mechanism that produced the original
count-error incident this reconciliation had to account for (see
`THETA_WAVE_2_SLICE_18_QUALITY_CORRECTION_2026-09-22.md`).
