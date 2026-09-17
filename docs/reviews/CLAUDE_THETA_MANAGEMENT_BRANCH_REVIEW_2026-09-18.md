# Claude management branch review, 2026-09-18

Reviewed branch: `origin/claude/theta-management-intelligence` through `ce0c8df`.

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

## Blocking defects

1. `whole-chain-economics.ts` adds gross stock sale or call-away proceeds to premiums and costs without subtracting the assigned-stock acquisition cost. That can overstate whole-chain P&L by the full stock notional.
2. `covered-call-lattice.ts` values seller premium at midpoint. THETA forbids assuming midpoint fills. Structural seller economics must use a conservative executable side or remain unknown.
3. Covered-call utility weights are caller-supplied and not tied to a validated, versioned policy artifact. They can silently manufacture a preferred strike.
4. `assignment-utility.ts` assigns zero utility to `LET_EXPIRE` and `ACCEPT_ASSIGNMENT` while omitting resulting stock downside, capital duration, and recovery economics. It then ranks known values, which can make incomplete actions appear comparable.
5. The assignment roll comparison treats deterministic net credit as utility. A positive credit does not establish positive forward value.
6. `recovery-state.ts` labels event risk present whenever event-state data exists. Data presence and risk state are different facts.
7. The branch predates the current scoped Alpaca Paper indicative semantics, migration head, control-state semantics, and local worker fixes.

## Safe path to one provider

Keep `paper-bootstrap-management-policy.ts` on canonical main as the single Production provider. Port only corrected, independently tested pure functions. They must return UNKNOWN when the required forward economics are missing, use conservative executable quote sides, preserve assigned-stock cost, and receive weights only from an immutable reviewed policy artifact.

After those repairs, run the challenger behind the current `ManagementPolicyEvidenceProvider` interface in shadow. Promote it only through the existing explicit promotion contract. At promotion, replace the bootstrap provider. Do not run both as competing action selectors.
