# Claude management branch review, 2026-09-18

Reviewed branch: `origin/claude/theta-management-intelligence` through `bdb3f1c`.

Canonical baseline: `origin/main` at `d17b4c1f77ba257ae906e72dd980c5d12d3bdc74`.

## Integration result

The branch is not integration-ready and was not merged. Its aggregate diff would remove migrations 055 and 056 and reverse newer quote and runtime-gate semantics. Each quantitative commit was reviewed independently.

| Commit | Classification | Reason |
| --- | --- | --- |
| `067a323` | RESEARCH_ONLY | Deterministic bootstrap economics are useful for explanation, but complete arithmetic cannot substitute for empirical forward economics. |
| `56d52cc` | REPAIR_AND_PORT | Common-horizon types and promotion-ladder concepts are useful. Runtime use must preserve the current explicit promotion contract and cannot treat net credit as expected utility. |
| `336b4cf` | RESEARCH_ONLY | Loss-state and invalidation vectors retain unknowns well. Caller-supplied utility inputs and unvalidated thresholds cannot become Production policy. |
| `0a5e0b1` | REJECT_RUNTIME_WIRING | Wiring would let research-only utility influence the bootstrap selection path before empirical validation. |
| `5bb2811` | REPAIR_AND_PORT | Assignment, recovery, and whole-chain decomposition are valuable concepts, but current formulas have material defects described below. |
| `869bb18` | REJECT_RUNTIME_WIRING | It wires incomplete research modules directly into the bootstrap provider. |
| `082029d` | REPAIR_AND_PORT | Multi-factor covered-call comparison is stronger than max-premium selection, but current execution economics and weights are not safe for Production. |
| `ce0c8df` | ADAPT_DOCUMENTATION | Source research is useful. Its claim that THETA lacks an explicit lifecycle table is incorrect on current main. The canonical architecture document corrects the record. |
| `bdb3f1c` | REPAIR_AND_PORT_AFTER_REMAINING_GATES | Correctly nets assigned-stock acquisition cost from sale/call-away proceeds, adds cash-flow identity tests, and replaces covered-call opening midpoint economics with a conservative bid-side reference. The commit explicitly leaves roll/roll-CC midpoint treatment unresolved and does not close the assignment, recovery, Pareto, or policy-provenance gates. |

## Blocking defects

`bdb3f1c` closes the previously identified gross-proceeds accounting defect and covered-call opening midpoint defect. The remaining blockers are:

1. Roll and roll-CC new-leg credits still use midpoint economics, acknowledged in the commit itself.
2. Covered-call utility weights remain caller-supplied and are not tied to a validated, immutable policy artifact. They can silently manufacture a preferred strike.
3. `assignment-utility.ts` assigns incomplete deterministic values to `LET_EXPIRE` and `ACCEPT_ASSIGNMENT` while omitting resulting stock downside, capital duration, and recovery economics. Incomplete actions must not be numerically ranked as fully known.
4. The assignment roll comparison treats deterministic net credit as utility. A positive credit does not establish positive forward value.
5. `recovery-state.ts` still conflates event-data presence with event risk.
6. The branch has not yet proved the directive's full recovery action frontier, `SELL_STOCK` winning scenario, true CC Pareto stage, `ROLL_CC`, `ALLOW_CALL_AWAY`, or duplicate management path audit.
7. The branch still predates current main's migrations 055 and 056, scoped Alpaca Paper indicative semantics, current execution-control semantics, and storage-authority fixes. Wholesale merge remains unsafe.

## Safe path to one provider

Keep `paper-bootstrap-management-policy.ts` on canonical main as the single Production provider. Port only corrected, independently tested pure functions. They must return UNKNOWN when the required forward economics are missing, use conservative executable quote sides, preserve assigned-stock cost, and receive weights only from an immutable reviewed policy artifact.

After those repairs, run the challenger behind the current `ManagementPolicyEvidenceProvider` interface in shadow. Promote it only through the existing explicit promotion contract. At promotion, replace the bootstrap provider. Do not run both as competing action selectors.
