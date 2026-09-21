# Claude `df88f3f` research-only review, 2026-09-21

Baseline reviewed: `f452299a8dea6b8e1de593fb55cb32ecc9f647bd`. Branch head reviewed: `df88f3f22f91a46a6c8bcd5eb6d0952d30d4b7fd`. No wholesale merge. No model or provider promotion.

| Commit | Files and accepted concept | Disposition | Production boundary |
|---|---|---|---|
| `3e381a8` | `event-pit-toolkit.ts` and tests distinguish event timing, coverage and ambiguity | RESEARCH_ONLY | Production event clocks need actual immutable first observation and authenticated coverage before runner inputs exist. |
| `ba16cd8` | `correlation-cluster-research.ts` and tests compare connected risk groups over time | RESEARCH_ONLY | No live AEGIS or sizing promotion from an unvalidated cluster. |
| `33550cc` | `historical-iv-spread-feasibility.ts` and tests retain missing/stale observations and effective coverage | REPAIR_AND_PORT_LATER | `HistoricalBboObservationRow` does not carry quote authority. Optionomics session bid/ask cannot be exported as executable broker BBO to satisfy this contract. |
| `1d3902c` | Continuous downside targets, cohort quantiles and logistic baseline with Python tests | RESEARCH_ONLY | Requires resolved economic labels and strict feature/label separation; no Paper decision authority. |
| `df88f3f` | Event, correlation, IV/spread and downside real-data runners plus envelope tests | DEFER | The envelope checks `sanitized: true` but lacks mandatory source window, provider, symbol count, canonical SHA, immutable evidence IDs and reproducible content hash. A trusted exporter must provide these before a real-data claim. |

The reviewed source and tests contain real research logic. The current Production source does not yet provide the corresponding contract-complete real exports. Export row count is therefore zero for each of these contracts. Do not manufacture rows or report a completed study. The next integration should add an authority-typed export envelope, then produce real PIT exports from the canonical Aiven history, with the Optionomics session-quote and Alpaca executable-BBO series kept separate.
