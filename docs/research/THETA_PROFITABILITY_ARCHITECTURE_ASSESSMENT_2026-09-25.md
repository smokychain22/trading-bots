# THETA professional profitability architecture / 70-80% research-target assessment

**COMMAND 2** (research/design only, no Production changes). Written against
`origin/main` `e2d9fdc` and this branch's own R8 infrastructure. Not a
promotion decision -- an assessment of whether the architecture COULD
honestly validate the 70-80% Managed Episode WR research target if real
Paper data existed, and what's still missing.

## What the 70-80% figure actually is (per TRD authority, restated so this assessment doesn't drift from it)

Per `CLAUDE.md`/TRD §40, §50: a **Managed Episode WR research target for
named, validated high-confidence cohorts** -- never a guarantee, never a
tuning target, never reported as the headline number without Leg WR,
Whole-Chain WR, open mark-to-market P&L, AvgWin/AvgLoss, PF, and drawdown
alongside it. Per STAT-001: realized WR and calibrated model confidence
are different quantities -- 25-delta is not 75% win probability. This
assessment does not question the target's definition; it asks whether
THETA's current architecture can measure it without gaming it.

## What real infrastructure now exists to measure it honestly

From COMMAND 1's audit plus this branch's own modules:

- **Whole-chain outcome labeling**: `managed-episode-outcome-distribution.ts`
  (this branch) + main's whole-chain research episode joins (`0f0ba49`,
  `4ba2fe6`) -- the outcome unit is the full managed chain, not a
  single leg, satisfying OUT-002's requirement.
- **Purged/embargoed calibration**: main's `8b106bd`/`9cb48e1` ("purged
  calibration", "paired feature ablations... harden research comparison
  semantics") -- real infrastructure for the leakage controls TRD §2.2
  requires.
- **Model readiness gating**: `theta-entry-model-readiness.ts` (this
  branch) -- structurally prevents a model from claiming `TRAINED`/
  `OOS_SUPPORTED` without real effective-N and calibration bounds; never
  promotes on accuracy/AUC/win-rate alone.
- **Evidence-certification self-audit**: V7-V20 (main) -- confirms real
  source+test backing exists per claimed capability, a necessary but not
  sufficient precondition (proves the code exists and passes tests, not
  that its output is empirically correct).

## What's still missing for an honest 70-80% claim

1. **Real matured Paper episodes.** Per every receipt this session has
   read (including V20's own `actualTradeCount`/`orderSubmissions` =
   0-to-date), zero real trades have occurred. No cohort definition, no
   matter how careful, can be validated against zero outcomes. This is
   not an architecture gap -- it is the honest current state, and no
   research design can substitute for it.
2. **Cohort naming discipline.** TRD requires the 70-80% target apply
   only to "named, validated high-confidence cohorts" -- not the whole
   candidate population. This session found no committed cohort
   -definition schema (which features/thresholds define a "high-confidence
   cohort," versioned, pre-registered before looking at outcomes) in
   either this branch's modules or the main commits COMMAND 1 read. This
   is a real, concrete gap: without a pre-registered cohort definition,
   any later 70-80% figure computed post-hoc over a hand-picked subset
   would violate TRD §2.2's ban on manipulating the OOS split to force
   the number, even unintentionally.
3. **Independent effective-N methodology across strategy branches.**
   `theta-entry-model-readiness.ts`'s `effectiveIndependentN` field
   exists structurally, but this assessment found no committed
   methodology doc for how same-chain/same-underlying/same-regime
   dependence gets discounted into that number specifically for a
   Managed-Episode-WR cohort claim (distinct from the general dataset
   sufficiency gating already built).

## Recommendation (design only, not implemented this pass)

Before ANY real Paper data exists, the highest-value remaining
architecture piece is a **pre-registered cohort-definition contract** --
a versioned, hash-committed record of exactly which features/thresholds
define a "high-confidence cohort" BEFORE any outcome is observed, so a
later 70-80% figure (if one ever appears) can be checked against a
definition that predates the data, not fitted to it. This is squarely in
Claude's safe research scope (feature-ablation researcher, OOS/validation
specialist) and does not touch Production. Not built this pass -- flagged
as the concrete next research item, per COMMAND sequencing (COMMAND 3 is
next).

## Bottom line

The architecture to measure the 70-80% target honestly is substantially
real and improving (whole-chain labeling, purged calibration, gated model
readiness). The blocker is not architecture -- it is the absence of real
matured Paper episodes, which no research design can manufacture, plus
one concrete missing piece (pre-registered cohort definitions) that
should exist before those episodes start accumulating, not after.
