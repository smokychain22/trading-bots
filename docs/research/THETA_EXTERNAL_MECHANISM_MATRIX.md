# THETA External Mechanism Matrix

Status date: 2026-09-13

Every external idea must use this decision record. `DOCUMENTED FACT` must link to
an official source or a captured authenticated contract. `OUR INTERPRETATION`
must remain separate.

| Source | Documented fact | Our interpretation | THETA component | Decision | Evidence needed | Owner | Implementation | Empirical |
|---|---|---|---|---|---|---|---|---|
| Optionomics | Historical Lab exposes dated observations and warns that relationships may weaken | Use it to accelerate hypotheses, not simulate fills | R6 research | ADAPT | PIT fields and no-leakage audit | Joint | PARTIAL | INSUFFICIENT_DATA |
| Optionomics | Developer Console lists API, MCP, and webhook delivery logs by entitlement | Discover actual contracts and use webhooks for reevaluation | R7 provider | TEST | Authenticated operation schemas and failure tests | Codex | PARTIAL | NOT_APPLICABLE |
| QuantWheel | Roll tooling compares strike, expiry, premium, and time | Build a broader same-state management frontier | R8 management | ADAPT | Whole-chain outcomes and capital-days | Joint | CONTRACT PARTIAL | INSUFFICIENT_DATA |
| QuantWheel | GEX tools expose walls and flip concepts | Treat structure as versioned research features | R6 features | TEST | Formula provenance and ablation | Claude | NOT_STARTED | INSUFFICIENT_DATA |
| Alertsify | Copying starts from a leader broker fill and applies follower controls | Use broker-confirmed master events and independent follower plans | R4 copy | ADOPT | Tenant, restart, slippage, and lifecycle tests | Codex | PARTIAL | NOT_ACTIVATED |
| Alertsify | Performance is described as broker-derived | Broker events are necessary but whole-chain MTM is also required | Accounting and trust | ADAPT | Reconciliation and unresolved inventory tests | Codex | PARTIAL | NOT_ACTIVATED |

Allowed decisions are `ADOPT`, `ADAPT`, `TEST`, and `REJECT`. Every row also
needs an implementation status and an empirical status. Adding a provider or
changing a policy requires a separate architecture decision and, where it can
change returns, an ablation with all other variables held constant.
