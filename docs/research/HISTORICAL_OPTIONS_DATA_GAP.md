# Historical Options Data Capability Audit

Status: R6 capability audit, 2026-09-11. This is an evidence inventory, not a backtest result or a profitability claim.

## Decision

THETA does not yet have enough verified historical executable-price truth for a defensible, broad-history Wheel backtest. The repository now has an anti-leakage replay schema and a typed Optionomics point-in-time chain query, but empirical coverage, entitlements, timestamp granularity, corporate-action handling, and fill modeling still need validation before R6 can produce performance results.

No additional data provider is approved by this audit. Alpaca and Optionomics remain the two options-data sources. A new provider decision should occur only if the tests below prove that a required field is absent.

## Provider capability matrix

| Requirement | Alpaca | Optionomics | Repository state | R6 state |
|---|---|---|---|---|
| Historical underlying OHLCV | Documented and already wired | Documented price-history endpoint | `fetchStockBars` is paginated and adjustment-explicit | Available through Alpaca, coverage tests still required |
| Historical option contract identity | Historical options API documented from February 2024 | Session chain documents OCC symbol, expiration, type, strike and DTE | Optionomics exact-identity matching exists | Partially available |
| Historical option bid/ask | Historical options API supplies market data, feed and entitlement dependent | Session chain documents pricing and sizes | Alpaca historical option adapter is not implemented. Optionomics chain query is now date-aware | Not empirically verified |
| Intraday quote timestamp | Historical options API is the likely source from February 2024 | Public reference describes a session chain, not a streaming execution feed | No replay adapter persists intraday historical option BBO yet | Blocking for execution-grade fill replay |
| Greeks and IV | Snapshot API and historical option data are documented, feed dependent | Session chain documents Greeks and derived exposures | Current Optionomics normalizer preserves null and IV units | Available in contract, not verified across history |
| OI and volume | Provider and entitlement dependent | Session chain documents volume and open interest | Exact contract merge exists | Available in contract, empirical sparsity unknown |
| Skew, term, surface | Not the primary research source | Metrics endpoint documents IV rank, percentile, term structure, skew and surface-derived measures | Readiness probes documented metrics alias | Available in contract, history coverage unknown |
| Flow/UOA/events | Outside execution-price truth | Documented research endpoints | Capability registry probes only documented routes | Research input only |
| Assignment/exercise/expiration | Broker account activities for live Paper reconciliation | Not broker truth | Alpaca activity reconciliation exists | Historical counterfactual assignment model still needed |
| Corporate actions | Alpaca corporate-action endpoint | Research/event context | Capability probe exists | Point-in-time adjustment policy still needs replay tests |

Alpaca states that its historical options data begins in February 2024 and distinguishes the free indicative feed from subscribed OPRA. Indicative trades are delayed and indicative quotes are derived, so feed identity must be persisted with every replay row. See [Alpaca Historical Option Data](https://docs.alpaca.markets/us/docs/historical-option-data) and [Alpaca Option Snapshots](https://docs.alpaca.markets/us/reference/optionsnapshots).

Optionomics documents a date-aware full recorded chain with contract pricing, sizes, OI, volume, Greeks, and exposures. It also describes 15 years of options history. Its API is research and analytics data on an ingestion cadence, not streaming executable-price truth. See the [Optionomics API reference](https://optionomics.ai/docs/api) and [Optionomics historical-data description](https://optionomics.ai/features/historical-data).

## Repository changes from this audit

- `fetchOptionomicsOptionChain` accepts only the documented `date`, `expiration_date`, `limit`, `option_type`, `strike_min`, and `strike_max` filters. It does not guess a history route.
- `research.theta_replay_observation` stores immutable as-of features, provenance, policy/model versions, contract identity, and timestamps.
- `research.theta_replay_outcome_label` stores later outcomes separately. A database trigger rejects a label timestamp that precedes its observation.
- Provider timestamps after `as_of` and ingestion timestamps before `as_of` are rejected.

## Required empirical tests before R6

1. Authenticate to the documented Optionomics API with the production Vega entitlement and sample dates across 2011, 2020, 2024, 2025, and 2026.
2. Measure symbol, date, strike, expiration, OI, volume, IV, Greeks, bid, ask, and size coverage. Record nulls as null.
3. Verify whether each Optionomics price is session close, a named snapshot time, or another documented observation. Never infer an intraday timestamp from a session date.
4. Verify Alpaca historical option trades, quotes, and bars with the account's actual `opra` and `indicative` entitlements. Persist the returned feed identity.
5. Compare overlapping 2024+ contract/session observations by exact OCC identity. Report disagreement instead of averaging.
6. Test holidays, early closes, missing dates, delisted underlyings, adjusted and non-standard contracts, splits, mergers, and symbol changes.
7. Build fills from observed bid/ask and size with conservative participation and latency assumptions. Midpoint fills remain forbidden.
8. Model early assignment, expiration, exercise, dividends, and roll legs as separate economic events. A roll loss remains immutable.
9. Group every decision and leg in a managed episode by `chain_id`. Keep overlapping same-underlying chains together for effective-N calculations.
10. Run purged walk-forward and untouched OOS only after coverage gates pass. Preserve all skipped and unpriced observations.

## Current blocker classification

- `HISTORICAL_OPTION_CHAIN_CONTRACT`: implemented for documented Optionomics session-date queries.
- `REPLAY_FEATURE_LABEL_SEPARATION`: implemented structurally.
- `OPTIONOMICS_HISTORICAL_ENTITLEMENT_AND_COVERAGE`: unknown until a secure production capability run succeeds.
- `ALPACA_HISTORICAL_OPTION_ENTITLEMENT`: unknown until a secure production capability run succeeds.
- `INTRADAY_HISTORICAL_EXECUTABLE_BBO`: unavailable in the current repository.
- `ASSIGNMENT_AND_CORPORATE_ACTION_REPLAY`: not implemented.
- `R6_BACKTEST_RESULT`: blocked. No performance number may be published.
