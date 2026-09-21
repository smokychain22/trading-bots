# R7 live-session forensic, 2026-09-21

This receipt is based on read-only Aiven queries, the existing Windows worker status, and the deployed production release. It does not authorize a Paper order or a worker cutover.

## Release and runtime boundary

- Canonical and deployed main at inspection: `f5bb9d69174458e9c04b2347b4766885ab8c4903`.
- Running Windows worker release: `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a`, mode `MASTER_THETA_PAPER`. It was left running.
- Production control row: `pause_new_orders=true`, `follower_execution_enabled=false`. New risk remains locked, follower execution remains locked, and live trading remains unauthorized.
- The worker's local status reported repeated `HTTP_503` for `RUNTIME_BROKER_CYCLE`. Its most recent persisted Aiven worker cycle started at 2026-09-21 15:26:25 UTC. The latest persisted shadow scan finished at 15:18:22 UTC. Later local retries do not establish fresh decision or broker evidence.
- A protected server-side read operation succeeded, while a provider readiness operation failed with `POSTGRES_25006`. An independent Aiven connection showed `default_transaction_read_only=on` with source `configuration file`, and `pg_is_in_recovery()=false`. Thus Production persistence is unavailable. The exact Aiven service-level cause was not independently verified. Aiven documents that critical disk pressure can cause precisely this setting. Do not bypass the setting or delete evidence without a separate capacity and recovery plan.

## Observed decision funnel

The bounded query window was 2026-09-21 13:30 to 20:00 UTC. Persisted evidence ended before the window closed.

| Evidence | Observed |
| --- | ---: |
| Shadow scans | 25, of which 21 complete and 4 partial |
| Underlying evaluations | 75 attempted and completed across scans |
| Point-in-time candidate rows | 3,876 |
| Distinct exact option contracts | 1,696 |
| Distinct expirations | 4 |
| Structurally and risk-feasible canonical candidate rows | 3,720 |
| Candidates selected with positive quantity | 0 |
| Runtime diagnostics | 25, with 69 near misses in aggregate |
| Persisted decisions | 71 `GLOBAL_WAIT`, 6 `SYSTEM_HOLD` |
| Master action-plan, order-intent, broker-order, fill, and management-decision rows in the window | 0 |

All 3,876 canonical candidate evidence rows reported sizing constraint `AEGIS_UNKNOWN` and quantity zero. A candidate is not operationally ready on these facts. The diagnostic rows report 3,605 feasible/soft-ranked candidates, but every one is also marked data-insufficient with zero quantity. This is an evidence and readiness gap, not proof that the strategy was healthily selective or that a profitable trade was missed.

A second read-only inspection of the actual persisted orchestration receipt clarifies the stage boundary. Of 77 decisions, 71 have `NO_QUALIFYING_CANDIDATE` and six have `RUNTIME_STAGE_DEFERRED:PROVIDER_STATE`. The `runNewRiskOrchestration` source invokes candidate-specific Python AEGIS only after the THETA-Q feasible set and Pareto survivors exist. It returns with `aegis=null` when no candidates reach that stage. Thus the 3,876 `AEGIS_UNKNOWN` frontier labels are predominantly a downstream representation of AEGIS not being reached, not proof that Python AEGIS evaluated and rejected 3,876 candidates for sector, correlation, liquidity, system, or provider risk. The exact family blocker counts are not recoverable from this session because those evaluations did not occur. They must be reported as `NOT_EVALUATED`, never zero. The upstream `NO_QUALIFYING_CANDIDATE` and provider-state reasons are the observed primary decision causes before the database outage.

The most frequent candidate rejection reasons were `CONTRACT_NOT_EXECUTABLE` (3,299), `DELTA_OUTSIDE_ALL_BANDS` (416), `OPEN_INTEREST_BELOW_FLOOR` (53), `OWNERSHIP_ACCEPTABILITY_UNKNOWN` (48), `UNKNOWN_DELTA` (39), and `VOLUME_BELOW_FLOOR` (20). These are counts of candidate reasons, not mutually exclusive trade outcomes. The quote gate was not weakened. Conventional CSP was the only applicable entry branch in the flat-account evidence. Hold-Strike and Defined Risk remained research-only; Recovery and Covered Call did not apply without broker-confirmed inventory.

## Source defect and bounded correction

The canonical strategy frontier had labeled `GLOBAL_WAIT` as earned when a risk-feasible candidate had zero quantity solely because AEGIS or another required sizing input was unknown. That made an incomplete evaluation appear to be an economic decision. The source correction makes such a cycle `SYSTEM_HOLD` with an explicit `CANDIDATE_SIZING_EVIDENCE_UNKNOWN` reason. A separate correction preserves an explicit candidate-specific null AEGIS result rather than inheriting a permissive global result. These changes do not loosen AEGIS, sizing, the quote gate, or execution authorization. They are not active in the pinned worker until a separately verified release.

## Classification and next proof

Current classification: `PROVIDER_DEGRADED` with additional unresolved AEGIS, quote, and entry-event evidence. There is not a meaningful uninterrupted open-session sample from the pinned worker after 15:26 UTC. Aiven write availability is the first operational recovery requirement. Confirm service disk metrics and capacity, preserve/verify a backup, then restore writes through a supported Aiven capacity remedy. Only after durable writes and worker health are verified should the new source release be evaluated for a controlled cutover. Do not force a candidate or Paper order.

The local database tables show no master action plans, broker orders, or fills in this window. These are not direct Alpaca history counts. A fresh Alpaca read is still required before claiming current broker order, position, or open-order totals.
