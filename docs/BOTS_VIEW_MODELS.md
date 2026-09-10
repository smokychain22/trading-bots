# Frontend-safe view models, v1

Canonical definitions: src/customer/models.ts. Mapping: src/customer/catalog.ts. The current catalog is a public product registry, not a projection of private broker tables.

| Model                                 | Responsibility                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| BotSummary                            | Identity, strategy, mode, availability, risk/capital uncertainty and discovery metrics |
| BotDetail                             | Composed public sections and tags                                                      |
| BotStatus                             | Mode, automation, AEGIS, freshness-related state and explicit capabilities             |
| PerformanceProvenance                 | Source, period, environment, evidence class and accounting inclusion flags             |
| BotPerformance                        | Economic metrics, optional advanced evidence, equity, monthly and attribution          |
| BotEquityPoint / BotDrawdownPoint     | Dated economic series, benchmark nullable                                              |
| BotPosition                           | Public position economics and lifecycle reference                                      |
| BotLifecycleChain / BotLifecycleEvent | Whole-chain economics and semantic timeline                                            |
| BotTrade                              | Semantic action, expected/fill/slippage, snapshot and chain context                    |
| BotRisk                               | Exposure, scenario coverage and unknown Greeks                                         |
| BotIntelligence / BotModelHealth      | Observed/research/model distinction and evidence gaps                                  |
| BotComparison                         | Comparable public summaries without allocation recommendation                          |
| BotActivity                           | Customer-readable event with technical drill-down                                      |

Evidence includes bot_id, strategy_version, environment, as_of, data_quality and provenance. Scalar metrics carry friendly and technical names, units, explanation, nullable value and missing-data reason. Published missing metrics remain null. Empty collections mean no published records, not a claim about zero broker exposure.

RESEARCH is an additional provenance state for an unvalidated roadmap entry. Calling those entries BACKTEST would imply nonexistent evidence. DEMO_DATA is separate from PAPER even though the configured bot environment is paper.

## Boundary and compatibility

No database row, broker account ID, raw provider payload, authorization header or secret belongs in these models. A later read-model publisher must validate data, establish tenant authorization and populate this boundary without changing the strategy engine. New optional fields can be additive within v1. Breaking meaning, units or null semantics requires a new contract version.

Current position and chain models are complete-record projections. A future incomplete source record must be withheld or mapped to a separately defined partial-record contract, never filled with zeros. There is no live publication adapter in this phase.

Metrics from model estimates must not be mixed with observed outcomes. All illustrative values are deterministic and identified as such. No production performance claim is inferred from the rendering fixtures.
