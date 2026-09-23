# THETA performance and historical replay receipt, 2026-09-23

This is a read-only research and operations receipt. It has no broker authority and does not promote a strategy, change an execution threshold, or establish profitability.

## Source and runtime boundary

- The tested 19-commit R7 branch was fast-forwarded to canonical main at `37ad9d2d442e149f32bd9298eb35a50da28852f0`. Main CI [35825448574](https://github.com/smokychain22/trading-bots/actions/runs/35825448574) passed.
- The Windows worker still runs release `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a` in `MASTER_THETA_PAPER` with new-risk `LOCKED`. Source and worker evidence must not be conflated.
- Migration head observed on Aiven was `064_alpaca_corporate_action_observation`. Migration 065 was not applied.

## Real Sep 16, 18 and 21 replay

The canonical read-only export contains 8,605 persisted candidate rows, 39 symbols, and 17,588 immutable evidence references. The new analyzer validates the export hash, source commit, source sessions, row counts, schema, evidence IDs and PIT quote timing before producing an ignored local summary artifact.

| Session | Candidates | Historically executable | Positive quantity | Candidate AEGIS captured | Provider quote age p50 | Provider quote age p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sep 16 | 139 | 0 | 0 | 0 | 129.261 s | 2,932.764 s |
| Sep 18 | 4,590 | 765 | 0 | 0 | 29.902 s | 372.954 s |
| Sep 21 | 3,876 | 577 | 0 | 0 | 100.899 s | 3,904.271 s |

`CONTRACT_NOT_EXECUTABLE` was recorded on 139, 3,825 and 3,299 rows respectively. Reason codes can overlap. The old export does not carry a bounded company-event safety clearance, candidate-level AEGIS assessment, resolved whole-chain outcome, or historical fill counterfactual. `FALSE_REJECT_RATE`, `WAIT_REGRET` and profitability therefore remain `null`, not zero. A later favorable underlying move cannot establish that a blocked option order was safe or would have filled.

The research false-reject analyzer now requires complete re-evaluation of execution, structure, ownership, event, AEGIS and sizing before claiming present-code eligibility. A claimed code or policy cause additionally needs explicit release and policy provenance. Its old automatic “code fix” attribution from a passing re-evaluation was removed.

The WAIT dataset now returns `null` when no identifiable outcome denominator exists. It also keeps rejected-candidate presence separate from actual opportunity conversion, and does not report an accepted-trade false-accept rate from WAIT-only records.

## Bounded current performance read

A read-only, one-connection receipt sampled the latest 100 persisted worker cycles and at most 500 provider rows per source. One DNS lookup failed with `EAI_AGAIN`, and the next bounded read succeeded. The successful receipt reported:

- Aiven database size: 1,631,639,231 bytes. Active connections: 3 of 20. Both default and ordinary transaction read-only settings were `off` before the receipt began its own read-only transaction.
- Worker cycles: 99 `SUCCEEDED`, 1 still `RUNNING`, with 314 attempted and 314 completed jobs in the bounded sample. Completed-cycle duration p50 was 16,160 ms and p95 was 26,163 ms. These are cycle durations, not individual provider or scan-stage latencies.
- Largest table by total relation size: `trade.candidate_point_in_time_evidence`, 629,424,128 bytes in the first sample. `pg_class.reltuples` in this receipt is an estimate, not an exact row count. No evidence was deleted or pruned.
- `core.provider_request` had no bounded samples from configured connections. This table currently cannot support an Alpaca endpoint latency or failure-rate claim.
- `market.optionomics_raw_observation` supplied 500 recent persisted rows spanning seven operations. Within that successful-persistence sample, option chains had 96 observations with request-to-ingestion p95 493 ms, symbol metrics had 96 with p95 141 ms, and events had 293 with p95 96 ms. Request-to-ingestion includes local processing and persistence timing. Failure and timeout rates cannot be inferred from a table of successfully persisted observations.

Detailed pipeline-stage, connection-acquisition, query, worker CPU/RSS, finalist-refresh and pre-submit-quote-age distributions were unavailable in the persisted sample. The machine-readable receipt preserves those as unavailable fields. Future current-worker observation must add those distributions before performance thresholds or execution-policy changes are considered.

## Release implications

The historical source data demonstrates old quote age and execution rejection, but cannot identify a missed profitable order. The new finalist refresh is source-tested and has not run on the pinned worker. Real open-session no-submit evidence, governed migration 065, complete first-Paper safety treatment and a locked current-worker cutover are still required before controlled Paper readiness can be reconsidered. Follower execution remains locked and live money is not authorized.
