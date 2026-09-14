# THETA Orchestration Reference Map

Reviewed 2026-09-14 from implementation files and tests at the pinned commits below. README files were used only for navigation. No external source code was copied into THETA.

| Reference | Pinned SHA | License | Files reviewed | Pattern | Existing THETA equivalent | Action | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QuantConnect/Lean | `6eb389012d73c364547d61546ff822fc8432dee2` | Apache-2.0 | `Common/Data/Market/QuoteBar.cs`, `Common/Data/Market/OpenInterest.cs`, `Common/Securities/SecurityHolding.cs`, `Common/Securities/Option/OptionHolding.cs`, `Common/Orders/OptionExercise/DefaultExerciseModel.cs`, `Engine/TransactionHandlers/BrokerageTransactionHandler.cs`, `Tests/Common/Orders/Fills/PartialMarketFillModelTests.cs` | Separate quote, trade, open-interest, holdings, exercise, order-event, and brokerage-reconciliation semantics | Typed Alpaca observations, execution evidence, broker facts, reconciliation worker, lifecycle classifier, atomic economic writer | `REFERENCE_ONLY`, with prior adaptations retained | THETA already has the required separation and broker-confirmed lifecycle path. Replacing it would duplicate tested infrastructure. |
| Hummingbot | `2bfaccc48dd49e71a5b6d9b3011808e127dd00cd` | Apache-2.0 | `hummingbot/strategy_v2/models/executor_actions.py`, `hummingbot/strategy_v2/executors/executor_orchestrator.py`, `hummingbot/strategy_v2/controllers/controller_base.py`, `test/hummingbot/strategy_v2/executors/test_executor_orchestrator.py` | Controllers emit typed create, stop, and store actions. A separate orchestrator owns executor lifecycle and persistence. Tests prove action dispatch. | Canonical strategy frontier, immutable decision, approved master action plan, action-plan store, `MasterPaperActionHandoff`, existing `MasterPaperExecutionOrchestrator` | `ADAPT_NOW` | The new typed handoff preserves strategy and broker separation while keeping THETA's stronger risk, quote, evidence, and options-lifecycle gates. |
| NautilusTrader | `32df15f37604420baf573be1f86aa1b409f164fc` | LGPL-3.0 | `crates/execution/src/engine/config.rs`, `crates/execution/src/reconciliation`, `crates/risk/src/engine/mod.rs`, `crates/trading/src/algorithm/core.rs`, execution and risk tests under the same crates | Commands pass through a central risk gateway. Execution state can be snapshotted, replayed, and reconciled. Queued dispatch avoids re-entrant event handling. | AEGIS, durable action-plan queue, immutable plan events, idempotent order intents, reconciliation-before-retry, worker lease and debounce | `ADAPT_NOW` | Durable claiming and immutable transitions make the strategy-to-execution seam restart-safe. THETA keeps its own PostgreSQL event model and does not import LGPL code. |
| Freqtrade | `eec4eb074bd919d405fb60be8eaee49d3a49b511` | GPL-3.0 | `freqtrade/freqtradebot.py`, `tests/freqtradebot/test_freqtradebot.py`, `tests/freqtradebot/test_worker.py`, `tests/optimize/test_lookahead_analysis.py` | Each cycle refreshes state, manages open orders, exits and adjusts existing positions, then evaluates entries. Cancel-and-replace refuses unsafe replacement after incomplete cancellation. | THETA scheduler order, broker reconciliation, management-first review, adaptive pricing, cancel/reprice state machine | `REFERENCE_ONLY` | THETA already follows management-first ordering and safe repricing. GPL source is not copied, and spot-crypto strategy assumptions do not govern options. |

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

