# THETA current defect and gap ledger

Ledger version: `theta-current-defect-gap-ledger-v1`
Baseline canonical main: `1b304c1aa3cac7225ed9e890c7979ace6fe8f104`
Scope: the twenty findings A through T in the consolidated defect-closure directive.
Rule: a closed item may reopen only when new runtime evidence contradicts this receipt, a regression occurs, or a dependency changes.

This ledger separates deterministic production defects from strategy-quality hypotheses. Shadow challengers have no broker authority. `UNKNOWN` remains distinct from present, absent, and zero.

| ID | Source | Component | Live reachable | Classification | Root cause or current fact | Fix type | Test or evidence | Deploy | Status |
|---|---|---|---|---|---|---|---|---|---|
| THETA-A | CLAUDE_AUDIT | Universe breadth | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | `maxUnderlyings=2` came from the first bounded R6 shadow runtime commit. It is a bootstrap/provider-cost bound, not an empirically validated economic rule. | SHADOW_CHALLENGER | A rotating 5/10-width plan adds at most one full shadow symbol per scan and never enters the broker-authority symbol set. Provider optionability checks are capped at two concurrent calls. | YES | SHADOW_TESTING |
| THETA-B | CLAUDE_AUDIT | Conventional DTE enumeration | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | The active 25-60 DTE range is a versioned baseline and hard enumeration boundary, not proven optimal. | SHADOW_CHALLENGER | The fetched observation interval is 20-65 DTE while live selection remains 25-60. `DTE_EDGE_MISSED_OPPORTUNITY`-equivalent evidence records economic-only edge candidates with no broker authority. | YES | SHADOW_TESTING |
| THETA-C | CLAUDE_AUDIT | Underlying selection | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | V1 ranking is dominated by average dollar volume and explicitly documented as a placeholder. | SHADOW_CHALLENGER | The bounded universe challenger records symbols outside the two-symbol champion. Contextual ownership, trend, event, volatility and option-liquidity evidence must be compared without giant AND gates before promotion. | YES | SHADOW_TESTING |
| THETA-D | CLAUDE_AUDIT | Optionomics decision evidence | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | Optionomics is already fetched, normalized, provenance-tagged and persisted. Most feature families remain context rather than live ranking objectives. | SHADOW_CHALLENGER | Per-scan diagnostics expose typed states for IV, IV rank/percentile, skew, term, surface, expected move, GEX, Vanna, Charm, flow and events. No feature was promoted. | YES | SHADOW_TESTING |
| THETA-E | CLAUDE_AUDIT | Capital-day efficiency | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | `capitalDayYield` is computed but is not a canonical Pareto objective. | SHADOW_CHALLENGER | Each scan records whether a capital-day-only challenger would change the selected candidate. The live frontier remains unchanged. | YES | SHADOW_TESTING |
| THETA-F | CLAUDE_AUDIT | Expiration choice | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | Current expiration choice emerges from the baseline DTE range and the existing structural Pareto objectives. | SHADOW_CHALLENGER | DTE-edge and capital-day evidence measure neighboring expirations before any rule change. | YES | SHADOW_TESTING |
| THETA-G | CLAUDE_AUDIT | Entry timing | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | No calibrated `WHY_NOW` model has been promoted. Optionomics families are retained as separate, UNKNOWN-safe evidence. | SHADOW_CHALLENGER | Typed decision-time availability is now persisted for relevant families. No composite timing score was invented. | YES | SHADOW_TESTING |
| THETA-H | CLAUDE_AUDIT | Volatility acceleration | NO, research side channel | P3_STRATEGY_QUALITY_HYPOTHESIS | Daily/weekly/monthly realized-volatility acceleration was absent from the canonical decision. | SHADOW_CHALLENGER | A PIT-safe 5/21/63-day RV acceleration contract was added. It has explicit `brokerAuthority=false` and no threshold or trade signal. | NO | SHADOW_TESTING |
| THETA-I | CLAUDE_AUDIT | GEX and flow | YES as context | P3_STRATEGY_QUALITY_HYPOTHESIS | Provider observations exist, but incremental predictive value is unproven. | SHADOW_CHALLENGER | Availability and missingness are recorded independently. GEX and flow remain contextual and cannot issue a trade command. | YES | SHADOW_TESTING |
| THETA-J | CLAUDE_AUDIT | Event UNKNOWN semantics | NO material live selection effect | P4_RESEARCH_ONLY | The canonical frontier records event UNKNOWN as unknown evidence. A separate subordinate opportunity-frontier request used `UNKNOWN -> eventNear=true`, but that result is not the canonical broker selection authority. | NO_ACTION | The production authority path was traced once. Reopen only if a consumer begins using that subordinate result as mutation authority. | NO | CLOSED_NO_ACTION |
| THETA-K | CLAUDE_AUDIT | Pareto deterministic tie | YES | P3_STRATEGY_QUALITY_HYPOTHESIS | Alphabetical candidate ID is the final deterministic tie-break after rank and missingness. Its economic materiality was unknown. | SHADOW_CHALLENGER | Diagnostics now count alphabetical tie-breaks and distinguish economically different ties. No tie-break changed. | YES | SHADOW_TESTING |
| THETA-L | CLAUDE_AUDIT | Strategy `executionEnabled` field | YES as registry metadata | P6_NOT_A_BUG | Strategy records intentionally have no direct broker authority. Effective mutation authority is the persisted execution control plus action plan, handoff and coordinator gates. | NO_ACTION | Reference trace confirms the registry field cannot independently authorize a broker mutation. | NO | CLOSED_NO_ACTION |
| THETA-M | CLAUDE_AUDIT | Hold-Strike branch | NO broker authority | P4_RESEARCH_ONLY | The branch is independently evaluated but remains `RESEARCH_ONLY`. | NO_ACTION | Downstream plan assembly rejects non-SHADOW branches. No automatic fallback from Conventional exists. | NO | CLOSED_NO_ACTION |
| THETA-N | CLAUDE_AUDIT | Defined-risk branch | NO broker authority | P4_RESEARCH_ONLY | The branch lacks independent empirical and Paper promotion evidence. | NO_ACTION | It remains `RESEARCH_ONLY`, and the CSP-only new-entry plan contract rejects the action. | NO | CLOSED_NO_ACTION |
| THETA-O | CLAUDE_AUDIT | Recovery and covered-call dispatch | YES | P1_PRODUCTION_CORRECTNESS_DEFECT | Stock exits and option closes were connected, but bootstrap-selected CC and roll opening legs were forced into `EMPIRICALLY_PROMOTED_PAPER`, making first-episode Paper management impossible while empirical EV remained honestly unknown. | IMMEDIATE_PRODUCTION_FIX | Structurally positive bootstrap management opens now use capped `PAPER_EVIDENCE`. Empirically ready legs use the promoted tier and must carry positive EV. Share coverage, AEGIS, quote, quantity, idempotency and reconciliation remain mandatory. | YES | FIXED |
| THETA-P | CLAUDE_AUDIT | Legacy wait diagnostics | NO | P5_SUPERSEDED | No `wait_diagnostics_research.py` exists on current main. The persisted runtime-behavior diagnostic is the canonical funnel. | NO_ACTION | Repository inventory completed. No second funnel was created. | NO | CLOSED_NO_ACTION |
| THETA-Q | CODEX_RUNTIME | Local database diagnostic | NO live worker impact | P6_NOT_A_BUG | SQLSTATE 53000 came from a redacted local Vercel environment selecting the legacy Neon URL. It did not establish an Aiven quota failure. The live Aiven worker continues durable successful cycles. | DOCUMENT_ONLY | Provider target and worker persistence evidence were separated. Raw credentials are not required or exposed. | NO | CLOSED_NO_ACTION |
| THETA-R | PAPER_RUNTIME | Historical HTTP 503 | NO current recurrence | P5_SUPERSEDED | The transient incident already received safe operation/timing attribution and has not recurred as a persistent defect. | NO_ACTION | Reopen only on a new captured occurrence. | NO | CLOSED_NO_ACTION |
| THETA-S | CODEX_RUNTIME | Windows resident worker | YES operationally | P2_PRODUCTION_OBSERVABILITY_DEFECT | Scheduled start, restart, mutex, SHA pinning and reconciliation-first recovery exist. Sleep, shutdown, internet loss and Windows maintenance can still stop a local host. | OBSERVABILITY_ONLY | Worker status exposes task state, last cycle, SHA, evidence hashes and runtime mode. Always-on hosting remains a later operations decision and cannot alter economics. | NO | DEFERRED |
| THETA-T | OPERATOR_UI | Browser automation rule | NO trading authority | P6_NOT_A_BUG | Playwright is the browser verification tool. Reticle is prohibited. | NO_ACTION | Backend truth remains API/SQL/broker sourced. Browser automation cannot bypass authentication or become trading authority. | NO | CLOSED_NO_ACTION |
| THETA-Q2 | CODEX_RUNTIME | Production database invariant validation | YES operationally | P2_PRODUCTION_OBSERVABILITY_DEFECT | Post-deploy validation rejected the authorized active-canary state because invariant 008 still required `pause_new_orders=true` unconditionally. This contradicted the later immutable authorization model. | IMMEDIATE_PRODUCTION_FIX | The invariant now accepts either fail-closed management-only state or an active master state backed by a valid immutable PAPER authorization event. Migrations 059-061 reassert restart recovery, PAPER-only execution-account storage, and restored control-state normalization. Production validation passes with zero invalid indexes and zero unvalidated constraints. | YES | FIXED |

## Current closure counts

- `TOTAL_ISSUES_REVIEWED = 21`
- `P0_FIXED = 0`
- `P1_FIXED = 1`
- `P2_FIXED = 1`
- `P3_SHADOW_TESTING = 10`
- `P4_RESEARCH_ONLY = 3`
- `P5_SUPERSEDED = 2`
- `P6_NOT_A_BUG = 3`
- `P2_DEFERRED_OPERATIONAL = 1`

## Invariants retained

- Canonical live entry authority remains `canonical-strategy-frontier`.
- Live THETA_CONVENTIONAL DTE remains 25-60. Only observation collection reaches 20-65.
- The two-symbol champion set remains the only new-entry broker-authority set. One rotating wider-universe symbol may be evaluated in shadow.
- Shadow diagnostics cannot change `selectedCandidateId`, quantity, AEGIS, or action-plan eligibility.
- `FOLLOWER_EXECUTION = LOCKED`.
- `LIVE_MONEY_AUTHORIZED = NO`.
- The first natural Paper canary remains THETA-selected and automatically relocks new risk after submission.
