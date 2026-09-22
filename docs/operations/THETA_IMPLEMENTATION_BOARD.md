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
| Database operability | Portable local backup and test-restore parity previously verified; Aiven write failure remains open | Fresh provider storage receipt, supported remedy, rollback write and application write, then verified backup |
| Option contract executability | Candidate quote observations now persist; live `CONTRACT_NOT_EXECUTABLE` breakdown remains unproven | Bounded production evidence aggregation by exact normalized reason and authenticated contract/BBO comparison |
| Alpaca provider parsing | Strict numeric parsing now keeps blank/boolean/malformed account, contract and quote fields UNKNOWN. Missing contract/snapshot collections are classified malformed, while explicit empty collections remain valid. Fixture tests pass. | Authenticated provider observation and runtime release proof; no quote gate changed |
| Optionomics chain completeness | A malformed row in an otherwise valid options array now makes the response UNKNOWN after success instead of silently dropping that row while claiming a complete chain. Explicit empty arrays remain valid. Fixture tests pass. | Authenticated provider observation and persisted historical coverage proof; Optionomics remains research-only for quotes |
| Shadow strategy reachability | Source now requests a separate Alpaca 2-19 DTE research window, retains router-inapplicable counterfactuals, and passes mocked-provider tests. Research failures stay separately visible from primary contract quality | Observe authenticated open-session rows and confirm persisted H/D contracts and quotes |
| AEGIS stress | IV-shock and spread-widening inputs remain producerless in the production scan, and null is a hold | Real PIT baselines, governed applicability/threshold policy, provider and production replay proof |
| Event and corporate actions | Prospective earnings and bounded negative corporate-action coverage remain uncertain | Authenticated provider semantics, persisted first observation, complete query-window coverage or explicit provider limitation |
| Management candidates | Canonical bootstrap management provider lacks production roll/CC candidate injection. Its persisted decision snapshot precedes any prospective fresh target-quote fetch, so a later quote cannot be inserted into that older decision without invalid point-in-time lineage. | Acquire target and current-leg quotes first, anchor a new immutable management decision snapshot after receipt, persist enumerated alternatives/rejections, then evaluate the one canonical policy and prove no-submit HOLD/CLOSE/ROLL/CC lifecycle paths |
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
