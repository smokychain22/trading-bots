# THETA Adaptive Decision Brain Foundation

Date: 2026-09-21  
Status: `SHADOW_ONLY`  
Broker mutation authority: `NO`

## One sovereign authority

The existing `canonical-decision-authority` remains the only final selector. The adaptive work adds typed state, policy, diagnostics, and comparison receipts around it. No second orchestrator was introduced.

The canonical path is:

`CurrentDecisionState -> StrategyApplicability -> CandidateGeneration -> CandidateEconomics -> Portfolio/Risk -> CandidateFrontier -> AEGIS -> Sizing -> FinalAction -> Execution -> LifecycleManagement`

Strategies produce candidates. Research produces evidence. Neither may submit directly to the broker.

## Responsibility layers

| Layer | Owns | Explicitly does not own |
|---|---|---|
| State and risk kernel | Broker/account truth, positions, orders, market session, quotes, chains, events, portfolio state, reconciliation, freshness, versions | Learning alpha or selecting trades |
| Adaptive strategy orchestrator | Applicability, bounded candidate generation, structural economics, Pareto comparison, shadow decisions, explanations | Rewriting policy from recent outcomes or bypassing final authority |
| Empirical policy layer | Training, calibration, OOS validation, promotion, version lineage | Broker submission |

Every kernel value uses `KNOWN`, `UNKNOWN`, `NOT_APPLICABLE`, or `INVALID`. A non-known value must carry `null`, never numeric zero or false as a substitute.

## Strategy authority audit

| Branch | Registry maturity | Execution flag | Applicability | Current role | Missing proof |
|---|---|---:|---|---|---|
| THETA_CONVENTIONAL | SHADOW | false | Cash, CSP capability, assignment capacity | Principal structural new-risk candidate path. Runtime execution is governed separately by Paper authorization, quote, AEGIS, sizing, and first-canary controls. | Broker-verified whole-chain outcomes and promoted empirical EV |
| THETA_HOLD_STRIKE | RESEARCH_ONLY | false | Cash and short-DTE research context | Challenger only | Independent PIT/OOS and Paper whole-chain evidence |
| THETA_DEFINED_RISK | RESEARCH_ONLY | false | Multi-leg capability and known bounded structure | Challenger only | Multi-leg fills, costs, management, PIT/OOS and Paper evidence |
| THETA_RECOVERY | SHADOW | false | Broker-confirmed owned stock | Lifecycle candidate path | Resolved assignment and recovery cohorts |
| THETA_CC | SHADOW | false | Broker-confirmed covered shares | Lifecycle candidate path | Resolved recovery, call-away, and regret cohorts |
| THETA_R | Management route | false | Active CSP, recovery, or CC lifecycle | Cross-strategy management route, not a sixth product | Promoted management policy evidence |

The registry does not describe any branch as empirically profitable. Conventional is structurally reachable, but its registry remains SHADOW and non-executing. This is an intentional separation between candidate generation and the later governed Paper execution handoff.

## Evidence role audit

The typed policy roles are:

- `HARD_SAFETY`: broker freshness, reconciliation, executable BBO at execution, collateral, assignment capacity, portfolio limits, AEGIS, quantity, proven coverage.
- `STRATEGY_APPLICABILITY`: lifecycle state, covered inventory, defined-risk structure, and regime context when it changes structural suitability.
- `ECONOMIC_OBJECTIVE`: VRP, capital-days, execution cost, tail burden, and concentration.
- `UNCERTAINTY_MODIFIER`: GEX, flow, research confidence, and event context when PIT-safe.

The frontier audit confirms IV, delta, OI, volume, event state, GEX, and flow do not become automatic OPEN commands. Missing optional research evidence remains visible but does not become a hard strategy veto. Fresh executable quote remains a hard requirement at the execution handoff, separate from research enumeration.

## Adaptive lattice and frontier

Existing branch lattices remain bounded baseline search regions. DTE and delta are candidate coordinates, not universal optimum values. The canonical frontier already retains premium, collateral, break-even, DTE, delta, moneyness, spread, liquidity, assignment capacity, AEGIS, sizing, hard blockers, soft evidence, unknown evidence, and Pareto lineage.

No magic scalar utility was activated. The research contract records:

`U = EV_net - lambda_ES*ES - lambda_DD*DD - lambda_CD*CapitalDays - lambda_AB*AssignmentBurden - lambda_EX*ExecutionCost - lambda_CORR*Concentration - lambda_U*Uncertainty`

Every lambda remains unknown pending empirical governance.

## Shadow comparison

The adaptive receipt records `CURRENT_POLICY_DECISION` and `ADAPTIVE_SHADOW_DECISION`. Until an empirical utility policy is promoted, the adaptive result is a non-executing WAIT with quantity zero. It includes deterministic lineage and explicitly sets both `executionAuthorized=false` and `brokerMutationAllowed=false`.

This preserves the current Production champion while making future comparisons replayable.

## WAIT and overtrading diagnostics

WAIT diagnostics now expose contracts enumerated, hard-safety rejects, inapplicable strategies, soft-ranked candidates, unknown safety, optional unknowns, AEGIS holds, quantity-zero results, dominated candidates, best rejected candidate, near misses, final reason, and cause ratios.

Overtrading diagnostics expose candidate acceptance rate, new-risk frequency, capital utilization, simultaneous chains, correlated exposure, low-confidence trades, execution cost, and turnover. They are observational and carry no empirical action threshold.

## R8 experiment registry

Prepared, not activated:

1. Fixed DTE vs adaptive DTE
2. Fixed delta vs adaptive strike
3. Fixed take profit vs management frontier
4. Fixed size vs state-aware size
5. Conventional only vs strategy frontier
6. Static roll vs utility roll
7. Immediate covered call vs recovery frontier

Experiments must use the same PIT snapshots, alternative candidates, fill evidence, management path, and net whole-chain labels. Promotion requires canonical OOS governance.

## Current blockers

| Area | State |
|---|---|
| Severe drawdown policy | No universal policy supported. Family and time instability remain material. |
| Correlation policy | No threshold promoted. Conditional normal/stress study remains open. |
| Sector | No authoritative PIT source. |
| Event knownAt | Insufficient. Current event objects cannot serve as PIT authority. |
| IV baseline | Thousands of rows but roughly two calendar days. |
| Spread baseline | Thousands of rows but roughly two calendar days. |
| Master Paper orders | Zero at this task boundary. |
| Resolved whole chains | No broker-verified cohort adequate for policy promotion. |

## Receipt

- `SOVEREIGN_DECISION_AUTHORITY = canonical-decision-authority-v1`
- `STATE_RISK_KERNEL_STATUS = TYPED_FOUNDATION_COMPLETE`
- `STRATEGY_REGISTRY_STATUS = FIVE_BRANCHES_PLUS_THETA_R_MANAGEMENT_ROUTE`
- `HARD_SOFT_TAXONOMY_STATUS = EXPLICIT_FOUR_ROLE_CONTRACT`
- `WAIT_PARALYSIS_DIAGNOSTIC_STATUS = COMPLETE_OBSERVATIONAL`
- `OVERTRADING_DIAGNOSTIC_STATUS = COMPLETE_OBSERVATIONAL`
- `ADAPTIVE_CONTRACT_LATTICE_STATUS = EXISTING_BOUNDED_LATTICES_REUSED`
- `PARETO_STATUS = EXISTING_CANONICAL_FRONTIER_REUSED`
- `UTILITY_RESEARCH_CONTRACT_STATUS = DOCUMENTED_NOT_GOVERNED`
- `UNCERTAINTY_SIZING_RESEARCH_STATUS = CONTRACT_ONLY_NO_ARBITRARY_MULTIPLIERS`
- `ADAPTIVE_MANAGEMENT_SHADOW_STATUS = COMPARISON_RECEIPT_FOUNDATION_COMPLETE`
- `FIXED_VS_ADAPTIVE_EXPERIMENT_STATUS = REGISTERED_NOT_RUN`
- `DECISION_TRACE_STATUS = REPLAYABLE_TYPED_LINEAGE`
- `R8_SCHEMA_READINESS = FOUNDATION_READY_EVIDENCE_BLOCKED`
- `NO_POLICY_ACTIVATED = YES`

Final classification: `ADAPTIVE_BRAIN_FOUNDATION_COMPLETE_R8_READY` means the architecture is ready to collect and compare R8 evidence. It does not mean a strategy policy is empirically ready or profitable.
