# THETA profit / loss / roll brain audit

Status: Slice 7 of the pre-VPS master continuation directive. Grounded in a
dedicated research fork's direct read of `paper-bootstrap-management-policy.ts`.

## Profit handling

`paper-bootstrap-management-policy.ts` computes real
`executableRemainingValueFraction`/`analyticalRemainingValueFraction` -- two
structurally DISTINCT fractions, deliberately kept separate per the code's
own comment ("a widening ask must never manufacture a false analytical loss
signal"). It also computes real DTE and real capital-days, and a real
thesis-invalidation read shared IDENTICALLY across every action (so
HOLD/CLOSE/ROLL never see a different thesis picture for the same chain).

Thresholds like `nearExhaustedExecutableFractionThreshold`/
`nearExhaustedDteThreshold` were confirmed in an earlier pass of this
engagement to be caller-supplied, optional, versioned parameters -- not
hidden magic numbers.

**Classification**:
- The fraction/DTE computation itself: **STRUCTURAL_ECONOMICS**
- The threshold defaults: **BOOTSTRAP_RULE** (explicit, versioned, overridable)
- No **EMPIRICALLY_LEARNED** component exists anywhere -- confirmed:
  `empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED'` is hardcoded
  elsewhere in the frontier, and no fitted model is referenced in this file.

Event risk, capital opportunity cost, and redeployment alternatives: not
independently re-verified as separate line items this pass (the fork focused
on remaining-value/DTE/close-cost/roll, which are directly confirmed).

## Loss handling

**The real code does NOT use a single universal "-100%/-200% stop."** Instead,
`thesisUtilityAdjustment(thesis, ...)` -- reused identically across
CLOSE_FULL/ROLL/SELL_STOCK/RECOVERY_WAIT -- is driven by
`assessThesisInvalidation(state)`, a real classification producing states
including `THESIS_FAILURE_SUSPECTED`/`THESIS_FAILURE_AND_PRICE_LOSS` (per
`THESIS_FAILURE_CLASSIFICATIONS`, `:355-357`). This is a genuinely different
mechanism from a raw P&L percentage: **the SAME -100% option P&L CAN produce
different candidate action utilities depending on whether thesis failure is
independently suspected** -- a real, structural distinction, not merely
theoretical.

**Not fully verified this pass**: exactly which real inputs feed
`assessThesisInvalidation` -- i.e. does it actually distinguish IV expansion
vs. underlying decline vs. event deterioration vs. ownership/portfolio/
liquidity/execution-cost deterioration as SEPARATE causes, or collapse some
of them into one binary flag? `thesis-invalidation.ts` itself was not opened
this pass. **This is the single most important follow-up for this audit** --
the mechanism for distinguishing loss causes clearly exists, but its actual
resolution (how many distinct causes it can really tell apart) is unconfirmed.

## Roll economics

`valueForSingleRollCandidate` (`:382-420+`) computes
`forwardContinuationCashFlow({closeCostDollars: currentMark, openCreditDollars})`
and explicitly comments: "Sunk (already-realized) economics are deliberately
NOT read anywhere in this block... so the old leg's realized P&L cannot be
silently re-added into this roll's forward comparison."

**This is real, correct honoring of the standing "roll = close-old +
open-new, old P&L immutable" rule** -- classified **STRUCTURAL_ECONOMICS**,
correctly implemented. It is currently unreachable only because of the P0
roll-candidate-source gap (`THETA_MANAGEMENT_END_TO_END_GRAPH.md`), not
because the formula itself is wrong.

New strike/expiry, incremental collateral, and capital-days for a roll: the
formula machinery to compute these is real (per the same file's roll
valuation functions), but was not independently walked field-by-field this
pass beyond confirming the close/open-credit/immutable-P&L structure above.

## Summary classification table

| Dimension | Classification |
| --- | --- |
| Remaining-value fraction computation | STRUCTURAL_ECONOMICS |
| Near-exhausted thresholds | BOOTSTRAP_RULE (versioned, overridable) |
| Thesis-driven loss differentiation | STRUCTURAL_ECONOMICS (mechanism real; exact cause-resolution not independently verified this pass) |
| Universal P&L%-based stop-loss | **CONFIRMED ABSENT** -- not used |
| Roll close-old/open-new immutability | STRUCTURAL_ECONOMICS, correctly implemented |
| Any empirically-learned profit/loss component | **CONFIRMED ABSENT** -- `EMPIRICAL_UNPROVEN` (`empiricalUtilityState`) |
