# Legacy Neon recovery and Aiven promotion receipt

Date: 2026-09-16  
Canonical runtime database: Aiven PostgreSQL 18.6  
Canonical code: `b06d110476c06c8a69a27b52c1c6d7b36591833a`

## Result

The recoverable application exports previously staged in Aiven are now validated, classified, and exposed through immutable history views. Current Aiven runtime rows were not overwritten. Neon remains preserved as a read-only legacy source for the full-source recovery that is still blocked by Neon's project transfer quota.

| Check | Result |
| --- | --- |
| Aiven connectivity | PASS |
| TLS | PASS |
| Transaction write/rollback probe | PASS |
| Migration head | `051_legacy_neon_promotion` |
| Staged records | 25,126 |
| Classified records | 25,126 |
| Promoted PIT research records | 25,125 |
| Promoted engineering records | 1 |
| Rejected records | 0 |
| Quarantined conflicts | 0 |
| Canonical runtime rows changed | 0 |
| Execution authorized | false |

The research history consists of:

- 7,550 candidate point-in-time records
- 302 candidate-set records
- 8,731 execution-evidence records
- 2 option-chain decision records
- 112 outcome-resolution receipts
- 274 outcome subjects
- 7,852 shadow-candidate records
- 302 strategy-frontier records

The single engineering record is the sanitized Neon control-plane manifest.

## Integrity

The R6 import batch has ordered staging fingerprint:

`0a6ac9345b894345635b5dbeef1379171b7d59556d0e253d93d4ace890a23ef3`

The control-plane manifest batch has ordered staging fingerprint:

`bd42e8e94adba8372b1cef73f61ad9006d2edb5558c59bb6817603ee14296b03`

Each promoted record retains its import batch, immutable staged artifact identity, source family, source key, source checksum, original timestamps, classification, PIT eligibility, validation disposition, and promotion timestamp. Research reads use `research.legacy_neon_recovered_evidence`. Engineering-history reads use `ops.legacy_neon_recovered_engineering_history`.

## Production validation

- Migrations: 51, head `051_legacy_neon_promotion`
- Schemas: 12
- Tables: 141
- Views: 2
- Functions: 46
- Triggers: 192
- Indexes: 357
- Invalid indexes: 0
- Unvalidated constraints: 0
- Promotion batches: 2
- Promotion records: 25,126
- Client connections at invariant probe: 3 of 20, 1 non-idle
- Master execution enabled: false
- Follower execution enabled: false
- New orders paused: true
- Broker order rows: 0
- Fill rows: 0

## Full-source recovery status

Full Neon extraction is still unavailable. Main pooled, main direct, schema-only, data-only, per-table dump, custom dump, directory dump, plain dump, `COPY`, `psql \copy`, logical-replication inspection, `aiven-db-migrate`, preview branches, Data API, Time Travel, snapshots, and operation history all reach the same Neon project transfer-quota boundary or lack an authenticated provider control-plane surface. No validated full Neon dump was found in local workspaces, backup folders, WSL, Docker volumes, or prior artifacts.

The old source is `PRESERVED_TEMPORARILY_INACCESSIBLE`. It has no runtime authority and must not be deleted or mutated. When Neon read access returns, recovery resumes with an immutable dump, checksum, isolated staging restore, inventory, deduplication, provenance validation, and controlled historical backfill. Current Alpaca broker truth and current Aiven runtime state keep precedence.

## Safety state

`AIVEN_CURRENT_RUNTIME_AUTHORITY = YES`  
`LEGACY_NEON_DATA_PRESERVED = YES`  
`LEGACY_NEON_DATA_CURRENTLY_READABLE = NO`  
`LEGACY_NEON_DATA_RUNTIME_REQUIRED = NO`  
`LEGACY_NEON_EXPORT_REQUIRED_FOR_PROGRESS = NO`  
`LEGACY_NEON_EXPORT_REQUIRED_FOR_EVENTUAL_COMPLETENESS = YES`  
`NEON_LEGACY_BACKFILL = DEFERRED_NON_BLOCKING`  
`EXECUTION_GATE = EXTERNAL_QUOTE_BLOCKER`  
`FOLLOWER_EXECUTION = LOCKED`  
`LIVE_MONEY_AUTHORIZED = NO`  
`MASTER_PAPER_ORDERS = 0`  
`FOLLOWER_PAPER_ORDERS = 0`  
`LIVE_ORDERS = 0`

