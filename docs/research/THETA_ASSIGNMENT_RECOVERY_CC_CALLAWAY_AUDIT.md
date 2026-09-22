# THETA assignment / recovery / covered-call / call-away audit

Status: Slice 8 of the pre-VPS master continuation directive. Grounded in a
dedicated research fork's direct reads of `management-action-frontier.ts`,
`recovery-state.ts`, and `paper-bootstrap-management-policy.ts`.

## Classification table

| Capability | Classification | Evidence |
| --- | --- | --- |
| Broker assignment detection / structural moneyness gating | REAL_AND_REACHABLE | `management-action-frontier.ts:128-138`, real ITM/OTM-driven blockers |
| Assignment capacity check | REAL_AND_REACHABLE | `management-action-frontier.ts:134-135`, explicit `ASSIGNMENT_CAPACITY_UNKNOWN` blocker when unknown -- never assumed available |
| Acquisition / economic whole-chain basis | REAL_AND_REACHABLE | `recovery-state.ts:137-143`, real `computeEffectiveStockBasis`, canonical vs. reference distinction preserved throughout |
| Recovery capacity | STRUCTURAL_ONLY | Formula is real; `management-action-frontier.ts:134` references `input.context.assignmentCapacity`, but whether the real runtime ever populates that field with a real number was **not independently re-verified this pass** |
| SELL_STOCK candidate | REAL_AND_REACHABLE | `paper-bootstrap-management-policy.ts:912-960` |
| SELL_CC / ROLL / ROLL_CC candidates | **MISSING_CANDIDATE_SOURCE** | Confirmed the single largest, most consequential gap in this whole audit -- see `THETA_MANAGEMENT_END_TO_END_GRAPH.md` |
| CC strike selection, CC quote freshness | Cannot evaluate this pass | No real candidate ever reaches strike-selection logic, downstream of the gap above |
| Dividend / event evidence in CC decisions | Present as real fields (`state.economics.dividends`, referenced in whole-chain P&L calls) but unreachable for the same reason | -- |
| Call-away economics | REAL_AND_REACHABLE at the structural/informational level | Real whole-chain P&L computed and reported (`paper-bootstrap-management-policy.ts:862-899`); utility optimization deliberately deferred by design |
| Blind CC-sell-on-assignment | **CONFIRMED DOES NOT HAPPEN** | Real basis-floor rejection exists (`:1003-1009`) |

## Direct answer to the audit's specific question

> Does the code ever automatically sell a covered call merely because stock
> was assigned, without considering stock basis/current price/CC strike/
> premium/upside surrendered/DTE/execution cost/dividend/event state/
> volatility state?

**No, confirmed.** The real (currently unreachable) SELL_CC logic explicitly
rejects a CC strike below the known cost basis or recorded reference basis
before it would ever propose selling. The problem today is not that this
safety logic is missing -- it is that the logic is never reached at all,
because no real CC candidate is ever supplied to it (see the management E2E
graph's P0 finding).

## Summary

Assignment detection, capacity gating, and stock-basis accounting are real
and reachable. The entire downstream chain of "what to do with the stock
once assigned, if a covered call is the chosen path" is real in design and
correctly safety-gated, but **entirely unreachable in Production today**
because of the same roll/CC candidate-source gap that blocks ROLL and
ROLL_CC. This is one root cause producing three blocked actions
(ROLL, ROLL_CC, SELL_CC), not three independent defects.
