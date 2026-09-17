# THETA Orchestration Reference Map

Reviewed 2026-09-14 from implementation files and tests at the pinned commits below. README files were used only for navigation. No external source code was copied into THETA.

| Reference | Pinned SHA | License | Files reviewed | Pattern | Existing THETA equivalent | Action | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QuantConnect/Lean | `6eb389012d73c364547d61546ff822fc8432dee2` | Apache-2.0 | `Common/Data/Market/QuoteBar.cs`, `Common/Data/Market/OpenInterest.cs`, `Common/Securities/SecurityHolding.cs`, `Common/Securities/Option/OptionHolding.cs`, `Common/Orders/OptionExercise/DefaultExerciseModel.cs`, `Engine/TransactionHandlers/BrokerageTransactionHandler.cs`, `Tests/Common/Orders/Fills/PartialMarketFillModelTests.cs` | Separate quote, trade, open-interest, holdings, exercise, order-event, and brokerage-reconciliation semantics | Typed Alpaca observations, execution evidence, broker facts, reconciliation worker, lifecycle classifier, atomic economic writer | `REFERENCE_ONLY`, with prior adaptations retained | THETA already has the required separation and broker-confirmed lifecycle path. Replacing it would duplicate tested infrastructure. |
| Hummingbot | `2bfaccc48dd49e71a5b6d9b3011808e127dd00cd` | Apache-2.0 | `hummingbot/strategy_v2/models/executor_actions.py`, `hummingbot/strategy_v2/executors/executor_orchestrator.py`, `hummingbot/strategy_v2/controllers/controller_base.py`, `test/hummingbot/strategy_v2/executors/test_executor_orchestrator.py` | Controllers emit typed create, stop, and store actions. A separate orchestrator owns executor lifecycle and persistence. Tests prove action dispatch. | Canonical strategy frontier, immutable decision, approved master action plan, action-plan store, `MasterPaperActionHandoff`, existing `MasterPaperExecutionOrchestrator` | `ADAPT_NOW` | The new typed handoff preserves strategy and broker separation while keeping THETA's stronger risk, quote, evidence, and options-lifecycle gates. |
| NautilusTrader | `32df15f37604420baf573be1f86aa1b409f164fc` | LGPL-3.0 | `crates/execution/src/engine/config.rs`, `crates/execution/src/reconciliation`, `crates/risk/src/engine/mod.rs`, `crates/trading/src/algorithm/core.rs`, execution and risk tests under the same crates | Commands pass through a central risk gateway. Execution state can be snapshotted, replayed, and reconciled. Queued dispatch avoids re-entrant event handling. | AEGIS, durable action-plan queue, immutable plan events, idempotent order intents, reconciliation-before-retry, worker lease and debounce | `ADAPT_NOW` | Durable claiming and immutable transitions make the strategy-to-execution seam restart-safe. THETA keeps its own PostgreSQL event model and does not import LGPL code. |
| Freqtrade | `eec4eb074bd919d405fb60be8eaee49d3a49b511` | GPL-3.0 | `freqtrade/freqtradebot.py`, `tests/freqtradebot/test_freqtradebot.py`, `tests/freqtradebot/test_worker.py`, `tests/optimize/test_lookahead_analysis.py` | Each cycle refreshes state, manages open orders, exits and adjusts existing positions, then evaluates entries. Cancel-and-replace refuses unsafe replacement after incomplete cancellation. | THETA scheduler order, broker reconciliation, management-first review, adaptive pricing, cancel/reprice state machine | `REFERENCE_ONLY` | THETA already follows management-first ordering and safe repricing. GPL source is not copied, and spot-crypto strategy assumptions do not govern options. |
| temporalio/sdk-typescript | `d69fa57164c7865e2598746e816bf1369ad5fd64` | MIT | `packages/worker/src/worker.ts`, `packages/worker/src/worker-options.ts`, `packages/common/src/retry-policy.ts`, worker tests | Graceful worker drain, activity heartbeats, bounded retry-policy compilation, and workflow execution identity | PostgreSQL worker lease, checkpoint recovery, bounded cycles, deterministic IDs, and supervisor heartbeat | `REFERENCE_ONLY` | A Temporal deployment would add a second workflow authority. The current PostgreSQL path already covers the first Paper canary. Reconsider only when measured multi-host durability needs exceed it. |
| temporalio/samples-typescript | `8907f2950c1d12936306667fca933c600a61cf7b` | MIT | `worker-versioning/src/workflows-base.ts`, `child-workflows/src/workflows.ts`, sample tests | Pinned versus auto-upgrading workflows, explicit patch points, signals, and child workflow boundaries | Worker build pin, strategy and policy versions, immutable decision lineage, restart checkpoints | `ADAPT_CONCEPT` | Preserve the pattern that an open position stays attributable to its original version while new cycles may adopt reviewed code. No Temporal dependency is required. |
| statelyai/xstate | `fbee62e7c1586315ed478c2fedf530d7e0ff5a3e` | MIT | `packages/core/src/StateNode.ts`, `packages/core/src/createActor.ts`, core tests | Explicit guarded transitions, snapshots, restoration, and actor lifecycle | `THETA_LIFECYCLE_TRANSITIONS`, order-intent transitions, scheduler transitions, persisted broker and lifecycle evidence | `NO_CHANGE_REQUIRED` | THETA already has explicit tested tables. Adding XState would create competing state-machine semantics without closing a current defect. |
| bitloops/ddd-hexagonal-cqrs-es-eda | `c05b2dee2ea5d74c8ad2e39d658317fd67aff988` | MIT | `backend/src/bounded-contexts/todo/todo/repository/todo-outbox.relay.ts`, `backend/src/bounded-contexts/todo/todo/repository/__tests__/todo-event-store.integration.test.ts`, `backend/src/lib/infra/nest-jetstream/buses/nats-streaming-domain-event-bus.ts` | Transactional event and outbox persistence, `FOR UPDATE SKIP LOCKED`, leases, bounded exponential delay, correlation propagation, stale-write test | Atomic decision and order-intent persistence, durable action-plan claim, deterministic client ID, reconcile-before-retry | `REFERENCE_ONLY` | The broker mutation boundary already persists before submission and reconciles ambiguity. Add a separate outbox only if a concrete cross-process publication gap is observed. |
| open-telemetry/opentelemetry-js | `bf28c1107e6ed1331d862a64a08b62e7a2874dad` | Apache-2.0 | `packages/opentelemetry-core/src/trace/W3CTraceContextPropagator.ts`, trace-context tests, SDK trace processor tests | Validated trace and parent IDs, context injection/extraction, remote-parent identity, batched span processing | Runtime correlation IDs and immutable decision, plan, order, lifecycle, and dataset identities | `ADAPT_LATER` | Full correlation propagation across HTTP, worker, decision, broker, and reconciliation remains useful. Avoid adding an SDK until the attribute contract and secret-redaction policy are defined. |
| testcontainers/testcontainers-node | `99ff0a2bf4becb17265d0e07ecabe8a564ea2c6c` | MIT | `packages/modules/postgresql/src/postgresql-container.ts`, `packages/modules/postgresql/src/postgresql-container.test.ts`, generic-container and wait-strategy tests | Disposable PostgreSQL with health and port waits, mapped connection identity, snapshots, and executable integration tests | SQL migration fixtures and environment-gated PostgreSQL tests | `ADAPT_NEXT` | This can remove current database-test skips in CI without changing Production architecture. Adoption belongs in a dedicated CI slice because it requires Docker availability. |
| dubzzz/fast-check | `6493aec8389cf19dd4233aab3ccd55bebb8266dc` | MIT | `packages/fast-check/src/check/model/ModelRunner.ts`, `packages/fast-check/src/check/runner/Runner.ts`, model and replay tests | Generated command sequences compare a model with the real implementation, including async schedules and reproducible seed/path replay | Table-driven transition tests, restart/idempotency tests, deterministic dataset hashing | `ADAPT_NEXT` | Narrow model-based tests for lifecycle and order-intent transitions can expose sequence bugs. Do not replace deterministic financial fixtures. |
| taskforcesh/bullmq | `2aa4c39b4f913007ff0ac69a5652105c18f3c70b` | MIT | `src/classes/worker.ts`, `src/classes/queue.ts`, `tests/deduplication.test.ts`, `tests/worker.test.ts` | Redis-backed worker locks, stalled-job recovery, deduplication keys, attempts, and rate limits | PostgreSQL scheduler, singleton lease, durable claims, debounce, deterministic idempotency keys | `DEFER` | BullMQ would add a second queue authority and Redis dependency to the trading path. It may suit isolated non-critical research jobs later. |
| connor4312/cockatiel | `80b5ed67966dfcc5410a912285fcb3eeb2dc5e5e` | MIT | `src/RetryPolicy.ts`, `src/CircuitBreakerPolicy.ts`, `src/TimeoutPolicy.ts`, associated tests | Bounded retry with explicit backoff, circuit states, half-open sampling, cancellation, and cooperative or aggressive timeout | Provider read retries, timeout handling, health states, and broker reconcile-before-retry | `ADAPT_CONCEPT` | Apply these concepts to idempotent provider reads. Never wrap broker mutation in a generic retry policy because an unknown submission must reconcile first. |

## Canonical THETA control path

```text
provider observations
  -> normalized point-in-time state
  -> structural candidate frontier
  -> canonical selection and AEGIS
  -> immutable decision
  -> approved master action plan
  -> durable claim
  -> current execution-quote qualification
  -> adaptive limit pricing
  -> existing Paper order coordinator
  -> Alpaca broker evidence
  -> reconciliation and lifecycle classification
  -> atomic economic writer
```

The action plan is not a second strategy engine. It is the typed, durable message between the existing decision authority and the existing execution coordinator. A plan cannot be queued unless its persisted decision, selected candidate, quantity, AEGIS result, and ready `MASTER_API_KEY` execution account agree.

The current strategy package remains non-executable. Research or indicative market data may support candidate evidence, but it does not satisfy the current-quote gate. New risk also requires empirically ready positive after-cost economics. Missing evidence remains `UNKNOWN` and blocks execution without erasing the candidate from research.

## Duplicate architecture avoided

- No second order state machine was added.
- No second broker adapter was added.
- No second reconciliation engine was added.
- No external executor framework was imported.
- No strategy thresholds or profit claims were adopted from the references.
- No Optionomics field was promoted to execution truth without passing the provider-neutral quote qualification contract.
- No second workflow engine, Redis trading queue, lifecycle machine, retry authority, or management brain was added.

## Verification receipt

All nine added references were fetched from their canonical GitHub repositories on 2026-09-18. Each pinned SHA contained substantive source and tests. The review used the files listed above, not README performance claims. No external source was copied into THETA. The immediate conclusions are one documentation correction, one local durability improvement, and two bounded future test improvements. No current Production runtime dependency was justified.

Latest reviewed commit metadata:

- `temporalio/sdk-typescript`: 2026-09-17, source yes, tests yes.
- `temporalio/samples-typescript`: 2026-09-16, source yes, tests yes.
- `statelyai/xstate`: 2026-09-15, source yes, tests yes.
- `bitloops/ddd-hexagonal-cqrs-es-eda`: 2026-08-02, source yes, PostgreSQL integration tests yes.
- `open-telemetry/opentelemetry-js`: 2026-09-17, source yes, propagation and SDK tests yes.
- `testcontainers/testcontainers-node`: 2026-08-09, source yes, PostgreSQL and wait-strategy tests yes.
- `dubzzz/fast-check`: 2026-09-17, source yes, model, replay, and property tests yes.
- `taskforcesh/bullmq`: 2026-09-16, source yes, deduplication and worker tests yes.
- `connor4312/cockatiel`: 2026-09-06, source yes, retry, circuit-breaker, timeout, and bulkhead tests yes.
