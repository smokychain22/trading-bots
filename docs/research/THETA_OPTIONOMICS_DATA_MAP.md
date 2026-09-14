# THETA Optionomics Data Map

Status date: 2026-09-14

The file-level capability census and exact implementation receipt are in
`THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`. The professional methods
audit is in `THETA_PROFESSIONAL_REFERENCE_PACK_2026-09-14.md`.

Optionomics is THETA's primary options-intelligence provider. Alpaca remains the
broker and lifecycle authority. An Optionomics field is usable only when its
authenticated operation is present in the discovered API contract.

| Family | Required normalized fields | THETA use | Current confidence |
|---|---|---|---|
| Contract | OCC identity, underlying, type, strike, expiry, multiplier | Exact merge and research | Proven with limits |
| Quote | recorded price, bid, ask, sizes, provider time, DTE | Research, replay, and provider comparison only | Fields documented and normalized. Provider contract rejects execution use |
| Greeks | delta, gamma, theta, vega, provider time | Candidate and management state | Proven with limits |
| Volatility | IV, IV rank, IV percentile, realized volatility | Separate research features | Partial |
| Skew | definition, tenor, put/call points, units | Assignment and tail research | Proven with limits |
| Term | expiries, IV values, definition | Event and carry research | Proven with limits |
| Surface | strike, expiry, IV grid, interpolation status | Structure research | Derivable with limits |
| Exposure | GEX, DEX, Vanna, Charm, walls, flip | Structure research | Capability audit required |
| Activity | premium, OI, volume, UOA, sweeps, blocks | Liquidity and flow research | Partial |
| Crowd | current, 8h, 24h, 48h observations | Persistence and reversal research | Proven with limits, interpretation unvalidated |
| Events | earnings, event time, known-at, ex-dividend when available | Hard event safety and research | Partial |
| Historical | dated observations and availability window | PIT hypothesis acceleration | Proven with limits |
| Alerts | alert identity, event time, delivery time, payload version | Trigger reevaluation only | Documented product feature, integration not built |

## Required observation envelope

Every stored observation carries provider, operation alias, request time,
request-safe path and documented parameters, HTTP status, rate-limit metadata,
provider timestamp, ingestion timestamp, `as_of`, session date, symbol, contract
ID, units, schema version, quality state, one-way credential identity reference,
missing reason, and response-content hash.
Provider bodies and credentials are never written to logs.

## Missing-data and action rules

- `UNKNOWN` stays unknown and never becomes zero.
- Empty arrays are not healthy capability proof.
- Marketing pages do not define an API contract.
- Historical relationships do not become predictions without walk-forward and OOS evidence.
- Webhooks schedule an idempotent reevaluation. They never place an order directly.
- Optionomics never submits or reconciles a broker order.
- A two-sided recorded Optionomics observation never becomes an executable
  quote. The provider documents session-ingested data and excludes real-time
  quote and execution-feed use.

Official references: [plans](https://docs.optionomics.ai/getting-started/plans/),
[Historical Lab](https://docs.optionomics.ai/analytics/history/), and
[Developer Console](https://docs.optionomics.ai/features/developer-console/),
and [API reference](https://optionomics.ai/docs/api).
