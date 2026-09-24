# THETA brain and orchestration, current-source proof

Source audited through `adf75457d1aa34cdb4bffaeac3b1f7e905ce251e`. This is a source and locked-runtime boundary receipt, not a profitability or Paper-entry authorization. The running worker was last observed on `a96b321577996b15cfd33646890afc3230d0eb96`, `MASTER_THETA_PAPER`, new-risk `LOCKED`, with one active lease. Source and worker remain separate until a safe cutover.

## Actual decision graph

`resident-worker` invokes `autonomous-runtime.ts`, which reconciles broker/account state, runs the bounded `theta-shadow-cycle.ts` new-risk scan and delegates existing-position management to the canonical `PaperBootstrapManagementPolicyProvider`. The new-risk cycle fetches Alpaca contracts and BBO, builds normalized candidates and a FusionSnapshot, calls `new-risk-orchestrator.ts`, then persists the orchestration receipt and canonical strategy frontier. The orchestrator calls the Python router, Q lattice, AEGIS, economics, sizing and execution-quality paths. `decision-assembly.ts` produces the after-cost `NewRiskDecisionReceipt`. The frontier enumerates all five candidate branches but now binds its Paper-facing Conventional selection to the exact Q receipt, snapshot, timestamp, underlying, contract and positive quantity. `master-paper-plan-assembly.ts` can consume only a selected, Paper-eligible Conventional candidate and remains subject to a separate current quote and locked execution controls. The paper-order coordinator is the sole broker mutation owner.

| Branch | Current source path | Authority and proof limit |
| --- | --- | --- |
| Conventional/Q | Python router and Q lattice, canonical frontier, after-cost decision receipt, Paper plan | Bounded Paper-capable in source, currently new-risk locked. The economic receipt, not candidate ID order, now controls OPEN/WAIT and selected contract. No real positive-quantity open-session proof in this release. |
| Hold-Strike/H | 2-5 DTE research fetch and frontier candidate enumeration | Shadow only. It can be enumerated and persisted, but its missing or immature evidence cannot block Q Paper WAIT. No independent OOS promotion. |
| Defined Risk/D | Two-leg frontier construction using short and longer-DTE contracts | Research/shadow only. No common-horizon empirical authority or broker permission. |
| Management/R | Canonical bootstrap policy and management-action frontier | One Production management authority. Roll and covered-call alternatives come from `ProductionPaperManagementCandidateSource`. The former Pipeline B cluster remains quarantined. No held-position runtime proof with this worker. |
| Recovery/A | Broker-confirmed stock lifecycle and canonical management path | Applicable only after actual inventory or assignment. With zero current positions, runtime action reachability is forward-state-dependent. |
| Covered Call/C | Covered-share lifecycle and management candidate discovery | Applicable only with confirmed owned shares. No naked call path is authorized. |

The Python router returns six eligibility records, not an economic ranking. `new-risk-orchestrator.ts` reads Q eligibility for the bounded new-entry authority. The canonical frontier retains H/D alternatives for research without selecting them for Paper. This is intentional scope, not evidence that H/D are profitable or Paper-ready. Older research documents that say H/D construction or Production roll/CC candidate source is absent are superseded at source level. A source function and a fixture test still do not prove natural runtime selection.

## False-paralysis and false-safe findings closed in this wave

1. A Q candidate with `actionFeasible=false` or missing Q lattice evidence can no longer win the Paper-facing frontier. Missing evidence stays `SYSTEM_HOLD`.
2. A structural Pareto or lexical first candidate can no longer override the economic Q receipt. Q WAIT/PASS remains non-OPEN. An OPEN requires matching immutable decision identity and its positive quantity is capped by canonical sizing.
3. Missing H/D research candidates and research sizing uncertainty no longer relabel a complete Q WAIT as a system fault. Branch-level missing evidence is retained. Top-level Paper near-miss and best-rejected references are scoped to Conventional candidates.
4. The Python Q lattice may validly exclude contracts before its response, or return no lattice when all quotes fail freshness. Those contracts are recorded as lattice exclusions, and a null lattice provides no per-contract action map. The immutable Q receipt still forces WAIT or PASS, so neither false OPEN nor false missing-evidence HOLD follows from that filtered result.

These changes have deterministic regression tests, full local Node/Python/typecheck/lint/build/security verification and CI on the exact source SHA. They do not loosen AEGIS, quote freshness, event policy, sizing, execution locks or broker controls.

## Remaining truth boundaries

- An authenticated Optionomics Vega qualification on September 24 returned `AUTH_VALID`, 13 real payloads and a persisted receipt. Several analytics families qualified for research, while chain identity/units and flow temporal semantics remain partial. Optionomics session quotes are not Alpaca executable BBO.
- Aiven read-only was `off` and a rollback write probe passed. One sample used 19 of 20 connections and a later sample used 17 of 20. Connection headroom and intermittent provider errors still need natural-cycle observation before calling the database continuously healthy.
- The latest read-only runtime receipt showed one locked worker, good broker reconciliation, zero positions, zero open orders and no observed order submission. Recent completed historical scans recorded Q candidates but zero positive size because AEGIS evidence was unknown. The September 24 current-day lineage seed was zero at the time of the read, before a supported U.S. options session. Independent real-session IV/spread baseline maturity and current observation remain `FORWARD_DATA_REQUIRED`.
- Roll, assignment, recovery, covered-call, call-away, TCA and whole-chain realized-profit performance require genuine broker-confirmed lifecycle states and outcomes. Synthetic tests establish source reachability, not empirical quality. Win rate, after-cost expected value, severe-loss behavior and continuation-value calibration remain `EMPIRICALLY_UNPROVEN`.
- Do not equate `theta:audit:unknowns` reporting zero avoidable UNKNOWNs with Paper readiness. That audit is a registry check. A natural open-session no-submit scan, current-worker release observation and all independent first-Paper controls still govern.

Broker mutations and order submissions in this wave: zero. Followers locked. Live money unauthorized.
