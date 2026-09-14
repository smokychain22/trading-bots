# THETA Production Research Export Contract

Canonical version: `theta-r6-dataset-v1`

This is the sole Production-to-research evidence interface for R6 and R8. The TypeScript exporter emits the camel-case wire contract consumed by `production_export_loader.py`. PostgreSQL column names and database-specific JSON column suffixes do not appear on the wire.

## Candidate identity and state

Every `rows.candidates[]` record contains stable top-level fields:

`candidateId`, `decisionId`, `fusionSnapshotId`, `decisionTime`, `branch`, `rankAtDecision`, `selected`, `hardStatus`, `softStatus`, `rejectionReason`, `contract`, `market`, `volatility`, `technical`, `event`, `flow`, `ownership`, `account`, `portfolio`, `aegis`, `execution`, `knownEconomics`, `unknownEconomics`, `hardBlockers`, `softEvidence`, `providerProvenance`, `lineage`, `contentHash`.

The three previously ambiguous feature families have these stable keys when the value was observed:

| Family | Stable key | Meaning |
|---|---|---|
| `contract` | `contractSymbol` | Exact OCC contract identity |
| `contract` | `strike` | Strike in USD per share |
| `contract` | `expiration` | ISO calendar date |
| `contract` | `optionType` | `PUT` or `CALL` |
| `contract` | `multiplier` | Broker/provider-confirmed contract multiplier |
| `contract` | `dte` | Calendar DTE at `decisionTime` |
| `contract` | `moneyness` | Provider-normalized simple moneyness, not forward log-moneyness |
| `market` | `bid`, `ask` | Observed two-sided quote in USD per share |
| `market` | `stockPrice` | Underlying reference price in USD per share |
| `market` | `dataQuality` | Explicit provider quality state |
| `volatility` | `iv` | Point-in-time contract implied volatility |

An unavailable key is omitted or explicitly `null`, according to the immutable source row. Research must never replace it with zero. `moneyness` must not be treated as `ln(K/F)`. Forward log-moneyness remains unavailable until a defensible point-in-time forward is persisted.

## Lineage and provenance

`lineage` always contains `strategyVersion`, `riskVersion`, `featureVersion`, `costModelVersion`, `regimeVersion`, and `executionModelVersion`.

Each `providerProvenance` item contains `source`, `operationAlias`, `providerTimestamp`, `ingestionTimestamp`, `asOf`, `version`, and `state`. Provider timestamps cannot occur after the point-in-time cutoff.

## Feature and label firewall

Candidate feature rows never contain eventual P&L, fills, assignment results, recovery duration, or other future labels. Resolved outcomes exist only in `wholeChainOutcomes` and lifecycle evidence. The exporter and Python loader both reject future-label keys found in feature payloads.

## Determinism

Rows are sorted by canonical JSON before hashing. Dataset identity includes schema version, source window, feature-set version, strategy-version set, row counts, and row content. Export time is provenance and is intentionally excluded from the dataset hash.
