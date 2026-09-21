# THETA pre-VPS R7 closure audit, 2026-09-21

Source baseline: `9f03fb960c50ab21b1d6c81297d9654ec81def8d`. The Windows worker was checked as running on immutable release `9c6b95ae5456f7e9d107a69e14c22d8621ce7cf1`, in `MASTER_THETA_PAPER` mode with `ACTIVE` execution gate. This audit does not restart it. Source edits in this audit are not evidence that the pinned worker executes them.

Generate the machine-readable 49-component source inventory with `npm run theta:audit:wiring`. Version 3 scans only `src`, `bots`, and `api`, excludes generated releases and dependency caches, and calls matches `textualReferences`. Its classification and declared effects are hypotheses for verification. `runtimeReachability: UNVERIFIED_STATIC_SCAN` means a text reference cannot establish an executed path. The previous scan reported generated worker releases and Vercel cache files as consumers, which inflated the apparent wiring. The static inventory never grants broker authority.

## Authority and current evidence

| Layer | Current authority | Evidence and limit |
| --- | --- | --- |
| Strategy maturity | `src/theta/strategy-package.ts` | Conventional, Recovery, and CC have SHADOW contracts; Hold-Strike and Defined Risk remain RESEARCH_ONLY. Registry `executionEnabled` is false. Maturity alone cannot submit an order. |
| Decision selection | `src/theta/canonical-strategy-frontier.ts` and the new-risk orchestration path | Candidate/branch frontier is the single declared selector. The static audit cannot prove that every branch is dynamically reached. |
| Paper eligibility | `src/execution/paper-execution-authorization.ts`, `src/execution/master-paper-plan-assembly.ts`, `src/theta/autonomous-runtime.ts` | Separate bounded master Paper evidence tier, account role, AEGIS, quote, reconciliation, and new-risk controls. A SHADOW Conventional candidate may be eligible only through this separate Paper path. No strategy registry flag overrides these gates. |
| Broker mutation | `src/execution/paper-order-coordinator.ts` | The declared broker-mutation owner. Runtime imports and a running worker are visible, but exact current broker order/fill counts require fresh Alpaca reconciliation. |
| Management | `src/theta/paper-bootstrap-management-policy.ts`, `src/theta/management-action-frontier.ts`, `src/execution/management-paper-plan-assembly.ts` | Bounded bootstrap management is distinct from an empirically promoted provider. Paper capability is not a profitability claim. |
| Adaptive shadow | `src/theta/adaptive-decision-brain.ts` | With no promoted empirical utility model it now records `NO_COMPARISON`, not an invented WAIT or false agreement with the current policy. No broker authority. |
| Canary acceptance | `src/execution/first-canary-acceptance.ts` | Only a fully reconciled filled canary can be accepted. Rejected, canceled, and expired orders are terminal failed canaries, while their broker evidence remains available for operational diagnosis. |

## Reality matrix

`DEFINED` means code exists, `TESTED` means a local deterministic test covers it, `WIRED` means an inspected source path reaches it, and `REACHABLE` requires a real runtime trace. These states are independent of authorization and empirical validation.

| Capability | Engineering state | Runtime reachability | Empirical state | Next proof |
| --- | --- | --- | --- | --- |
| Conventional CSP candidate and AEGIS path | DEFINED, TESTED, WIRED | Master Paper source path inspected, natural candidate trace still required | No resolved real chain | Capture naturally selected candidate identity, sizing, quote, persisted plan, and broker result. No forced order. |
| Hold-Strike and Defined Risk | DEFINED, TESTED shadow/research contracts | Dynamic open-session branch trace not established by this audit | No eligible OOS promotion | Same-snapshot candidate sets, realistic two-leg fill and whole-chain labels, independent OOS. Broker reachability must stay NO. |
| Recovery and covered calls | DEFINED management and broker-lifecycle paths | No real assigned THETA inventory to exercise end-to-end | No resolved real chain | Broker-confirmed assignment, basis, shares, coverage, management action and call-away reconciliation. |
| Rolls and whole-chain accounting | DEFINED, TESTED lifecycle and economics paths | Real roll/assignment/call-away trace absent | No real resolved episode | Confirm old-close/new-open broker events, immutable realized loss, linked stock and CC, capital-day intervals. |
| TCA and execution quality | DEFINED, TESTED contract | No master fill observed in this audit | Real slippage distribution unavailable | Compare broker fill to timestamped executable BBO with quote semantics and multiplier. |
| Optionomics intelligence | Typed provider and provenance contracts exist | Production auth and capability were previously recorded; current session not requalified here | Incremental feature value unproven | Keep session/intelligence data separate from execution-price authority and test paired ablations. |
| Sector and event known-at | Partial contracts and research | Sector PIT source unresolved; event known-at unusable per prior receipt | Cannot promote affected features | Supply PIT source with timestamp semantics, then coverage and conflict tests. Never backfill unknown as zero. |
| Correlation, severe downside, IV and spread history | Research/study paths exist | Collection exists, policy not promoted | Correlation and severe-downside policy unsupported; IV/spread temporal baseline short | Extend genuine time coverage and rerun embargoed OOS tests. |
| Adaptive decision and fixed-versus-adaptive | Shadow receipt and eight experiment IDs | Shadow receipt can persist; no empirical action model | `NO_COMPARISON`, all eight are preregistered designs only | Freeze feature/cost/fill versions and minimum-N method before outcomes, then compare with natural real labels. |
| WAIT regret and management counterfactuals | PIT/replay contracts exist | No claim of executable counterfactual fills | BLOCKED_ON_DATA | Preserve full alternatives and subsequent quotes; label `NO_FILL` when appropriate. |
| R6 dataset, walk-forward, OOS, DSR/PBO | Export and research utilities exist | Export availability is not sample sufficiency | No proof of economic edge | Audit real-vs-synthetic lineage, independent N, untouched OOS and multiple-testing correction. |
| Copy/follower | Master-fill-first planning, isolation and reconciliation contracts exist | Follower broker submission is LOCKED | No follower Paper execution evidence | Separate follower beta after master lifecycle proof and authorization. Never inherit master return as follower return. |
| Aiven, Neon archive, local receipts | Aiven is current runtime authority, Neon is legacy archive | Worker DB persistence must be checked from current cycle evidence | Legacy import eligibility varies by lineage | Keep Neon out of runtime, inspect migration/row lineage and local durable receipts without mixing synthetic data. |
| Windows worker and Vercel control plane | Worker running on pinned tested release; web/control plane deployed separately | Worker status checked, dynamic component-by-component trace incomplete | Operational continuity alone proves no edge | Preserve running worker, compare process and release SHA, reconcile broker before any mutation. |

The source scan found one fail-open-looking placeholder in live universe narrowing: `rankEligibleUnderlyings` converted a missing eligible underlying's point-in-time liquidity input to numeric zero. Its `ELIGIBLE` contract should make that impossible during normal operation, but a mismatched decision/input snapshot would have produced a fabricated rank. The function now fails closed on missing, null, invalid, or negative liquidity evidence, with a regression test. The volume ranking itself remains a declared universe-narrowing baseline, not a validated economic selector. Research placeholder freshness thresholds and the separate shadow CLI's stress-gap threshold were left unchanged and are not presented as learned policy.

## Fixed versus adaptive and no-submit boundary

The eight experiments and their before-outcome method are in `docs/research/THETA_R8_FIXED_VS_ADAPTIVE_PREREGISTRATION.md`. The added eighth comparison is current underlying cap versus a wider-universe challenger. No result can be promoted from synthetic, short-history, midpoint-as-filled, or winner-only evidence.

The canary acceptance tests are synthetic input tests. They make no HTTP order call and are not a claim that a natural Paper canary occurred. A real first canary still requires an open supported session, genuinely selected candidate, exact-contract quote, account and AEGIS checks, deterministic order ID, durable intent, reconciliation, relock, and later broker evidence. This audit leaves follower execution locked and live money unauthorized.

## Closure classification

`BUILDABLE_R7_GAPS_REMAIN`. This classification reflects dynamic branch/management trace gaps and unavailable real lifecycle evidence, plus known PIT sector/event and empirical policy gaps. Source presence, static text references, local synthetic tests, or a live worker alone do not close them. No threshold, DTE, delta, sizing, AEGIS, quote qualification, execution gate, or strategy promotion is changed here.
