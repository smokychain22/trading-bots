# THETA implementation board

Started from canonical source `133227cf7c08aca174ed761d162159fea4cd3130` on 2026-09-22. The table includes this implementation wave's source changes, and is not a claim that the running worker has been upgraded. Evidence levels must be kept separate: source, fixture test, authenticated provider, persisted production observation, running worker, broker result, and empirical outcome.

## Non-negotiable operating state

- Master Alpaca Paper only. No live-money authority and no follower submission.
- No forced order, no relaxation of AEGIS, event, corporate-action, quote, sizing, or broker-reconciliation gates to increase trade count.
- The running worker was last observed at `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a`, `MASTER_THETA_PAPER`, degraded and new-risk locked. Read this state afresh before any release decision.
- Aiven's last independently confirmed write state was provider-level read-only with a `No space left on device` failure. A code merge does not cure that. Preserve the verified local backups and require a supported capacity or migration remedy before worker cutover.
- Research branches can collect candidates, but only the bounded Conventional route may enter the master Paper entry assembler. Research outputs cannot self-promote.

## Active vertical slices

| Slice | Current evidence | Next closure proof |
| --- | --- | --- |
| Database operability | Fresh Aiven read-only capture `2026-09-22_100128-c600e016` passed an isolated PostgreSQL restore on 2026-09-22. Structure, all-table row counts and critical digests matched; the previous verified generation remains intact. Aiven write failure remains open. | Obtain provider storage/plan receipt and owner approval for a supported capacity remedy or larger writable restore. Then prove rollback write, application write and worker DB health before release. |
| Option contract executability | Candidate quote observations now persist; live `CONTRACT_NOT_EXECUTABLE` breakdown remains unproven | Bounded production evidence aggregation by exact normalized reason and authenticated contract/BBO comparison |
| Alpaca provider parsing | Strict numeric parsing now keeps blank/boolean/malformed account, contract and quote fields UNKNOWN. Missing contract/snapshot collections are classified malformed, while explicit empty collections remain valid. Fixture tests pass. | Authenticated provider observation and runtime release proof; no quote gate changed |
| Optionomics chain completeness | A malformed row in an otherwise valid options array now makes the response UNKNOWN after success instead of silently dropping that row while claiming a complete chain. Explicit empty arrays remain valid. Fixture tests pass. | Authenticated provider observation and persisted historical coverage proof; Optionomics remains research-only for quotes |
| Alpaca stock-bar integrity | Historical bars now validate page shape, prices, volume, optional counts and basic OHLC relationships before risk/volatility consumers can use them. A malformed page becomes a named provider error; a real zero-volume bar remains valid. Fixture tests pass. | Authenticated stock-bar observation and runtime release proof |
| Shadow strategy reachability | Source now requests a separate Alpaca 2-19 DTE research window, retains router-inapplicable counterfactuals, and passes mocked-provider tests. Research failures stay separately visible from primary contract quality | Observe authenticated open-session rows and confirm persisted H/D contracts and quotes |
| AEGIS stress | IV-shock and spread-widening inputs remain producerless in the production scan, and null is a hold | Real PIT baselines, governed applicability/threshold policy, provider and production replay proof |
| Event and corporate actions | Prospective earnings and bounded negative corporate-action coverage remain uncertain | Authenticated provider semantics, persisted first observation, complete query-window coverage or explicit provider limitation |
| Management candidates, WIRED_SOURCE | A Production-owned Alpaca Paper candidate source now enumerates roll, covered-call and covered-call-roll alternatives without ranking. It checks exact OCC identity, broker root/underlying/style, standard single-equity deliverables, actual multiplier/tradability, pagination, bid/ask, quote timestamp and freshness. Missing or adjusted deliverables are rejected explicitly; `show_deliverables=true` is requested. Batched quote observations enter the existing immutable ledger. The runtime fetches and persists candidates before freezing the management input, and the one bootstrap policy reads only timely persisted alternatives. Provider error, incomplete, stale, invalid and valid-empty remain distinct. Focused fixtures and read-only Aiven management-query syntax checks pass. No running worker has observed this path, and the candidate write SQL awaits disposable-PostgreSQL CI. | Pass disposable-PostgreSQL candidate-write test and full CI. After Aiven is writable, run real no-submit provider/management proof, measure latency/coverage, inspect persisted alternatives/rejections and prove each action-plan lifecycle before locked worker cutover. |
| Management assignment capacity, CLOSED_ENGINEERING | The missing `riskState.assignmentCapacity` dependency is removed from the canonical management input. The shared secured-lot calculation now adds only broker-confirmed collateral already reserved for the open short put to current free options buying power. It records account, reconciliation, option-position, strike and multiplier lineage. This avoids treating zero *new-order* buying power as zero capacity for an already-secured obligation. Focused positive, insufficient, stale, missing and non-applicable fixtures pass. The management SQL also passed read-only `EXPLAIN` against Aiven. Do not rediscover the missing-producer issue without contradictory evidence. | Verify persisted account/option-position lineage and ACCEPT_ASSIGNMENT frontier on a locked current-release worker after database recovery. This is a runtime release check, not an open calculation redesign. Broker-confirmed assignment reconciliation remains authoritative regardless of this prospective frontier. |
| Management decision timing, WIRED_SOURCE | The candidate producer now fetches and persists target and current-leg BBO before the management input query and `decisionAsOf` freeze. Input hash/JSON records candidate lineage and rejects future-observed evidence. The policy separately refuses target quotes stale at the frozen decision time. Focused PIT fixtures pass; no worker release has observed this path. | Verify persistence timestamps and action selection against real locked-runtime evidence after database recovery. |
| Strategy authority | Hold-Strike and Defined Risk remain research-only; source selection and Paper plan assembly explicitly reject them. WAIT diagnostics count Conventional candidates separately from research alternatives | Confirm the new immutable source in a locked worker and collect real H/D evidence without promotion |
| Research exports | Some canonical contracts exist; real contract coverage and row counts vary | Versioned immutable evidence IDs, source SHA, PIT cutoff, no synthetic rows |
| Worker release | Source and worker SHAs differ intentionally | Writable database, verified migration/CI, no-submit test, locked new-risk cutover, observed cycles, no duplicate worker |
| Empirical profitability | Insufficient real independent whole-chain outcomes | After-cost fill, lifecycle, capital-day and loss-tail evidence with walk-forward/OOS before promotion |

## Release sequence

1. Merge only tested source changes. Record branch-level provenance and CI.
2. Recover Aiven through a supported method. Do not prune evidence to make space.
3. Verify fresh local backup and database write health.
4. Reconcile Alpaca Paper account and orders without mutation.
5. Run real provider no-submit evaluation and verify all safety gates without a fabricated candidate.
6. Cut over one worker with new risk locked, then observe runtime SHA, DB writes and multiple natural cycles.
7. Consider controlled Paper entry only after a separate readiness receipt. Follower and live-money execution remain locked.

No item is complete merely because its type, config, fixture, or UI label exists. An `UNKNOWN` is closed only by a real producer plus valid authority, timing, persistence, consumer wiring and runtime evidence.
