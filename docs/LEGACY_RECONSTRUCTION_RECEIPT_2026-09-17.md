# Maximum legacy reconstruction receipt

Date: 2026-09-17

Implementation SHA verified in Production: `760792212914274a7ef0e0ff8bc81903a9443209`

Manifest SHA-256: `b21b47e8246693bc1155c2394e997b014ac8c7879a3deffe370b79f882556ee8`

## Outcome

The bounded non-Neon reconstruction sweep is complete. Aiven remains the only Production runtime database. Neon remains preserved, read-only, and temporarily inaccessible because the provider transfer quota blocks row reads. The sweep did not bypass that control and did not fabricate missing parents, THETA decisions, outcome labels, fills, chains, or management reasons.

Production accepted the manifest once and replayed it without changing canonical rows. The immutable registry contains one reconstruction sweep, 147 source assessments, and 134 family assessments. All registry rows have `execution_authorized=false`.

## Source coverage

| Source | Inspected | Recoverable additional legacy rows |
| --- | ---: | ---: |
| Immutable research exports | 109 | 0 older-only stable rows |
| Research-output run directories | 24 | 0 real legacy rows |
| Research-output JSON files | 144 | 0 real legacy rows |
| Worker state and Paper-preflight locations | Yes | 0 |
| Codex, Claude, local workspace, and bounded user-data candidates | 46 candidate files | 0 |
| Local PostgreSQL dumps or backups | 0 found | 0 |
| Git tracked candidate paths and history | 26 paths | 0 |
| GitHub Actions artifacts | 314 inspected | 0 relevant row-bearing artifacts |
| Vercel deployment history | 20 recent deployment records inspected | 0 row-bearing artifacts |
| Alpaca Paper reconciliation | Account ACTIVE, 9 activity facts verified, 0 positions, 0 open orders | 0 new legacy rows |
| Optionomics qualified historical evidence | Current metadata inspected | 0 additional qualified legacy rows |

The export union found 230 conflicting strategy-frontier identities. The expanded
local forensic pass preserved all 460 exact payload variants with dataset lineage
in a separate immutable archive. It did not overwrite canonical runtime rows. No
export contained a stable identity absent from the latest promoted export.

## Recovery totals

| Receipt field | Result |
| --- | ---: |
| TOTAL_CANONICAL_DATA_FAMILIES | 134 |
| EXACT_ORIGINAL_ROWS_RECOVERED | 25,125 |
| AUTHORITATIVE_ROWS_RECONSTRUCTED | 0 new rows. Nine current Alpaca activity facts were verified and preserved. |
| DETERMINISTIC_ROWS_RECONSTRUCTED | 0 |
| PARTIAL_ROWS_RECOVERED | 25,125 exact rows across 8 partially recovered families. This is coverage classification, not an additional row count. |
| ADDITIONAL_ROWS_FOUND_IN_OLDER_EXPORTS | 0 |
| ADDITIONAL_ROWS_FOUND_IN_RESEARCH_OUTPUTS | 0 |
| ADDITIONAL_ROWS_FOUND_IN_WORKER_STATE | 0 |
| ADDITIONAL_ROWS_FOUND_IN_AGENT_WORKSPACES | 0 |
| ADDITIONAL_ROWS_FOUND_IN_GITHUB_HISTORY | 0 |
| ADDITIONAL_ROWS_RECONSTRUCTED_FROM_ALPACA | 0 |
| ADDITIONAL_ROWS_RECONSTRUCTED_FROM_OPTIONOMICS | 0 |
| MISSING_PARENT_RECORDS_RECOVERED | 0 |
| OUTCOME_LABELS_RECOMPUTED | 0 |
| WHOLE_CHAIN_HISTORY_RECONSTRUCTED | 0 |
| MANAGEMENT_EVENTS_RECONSTRUCTED | 0 |
| TOTAL_USEFUL_LEGACY_ROWS_NOW_IN_AIVEN | 25,126, comprising 25,125 research rows and 1 engineering manifest |
| DATA_FAMILIES_FULLY_RECOVERED | 0 |
| DATA_FAMILIES_PARTIALLY_RECOVERED | 8 |
| DATA_FAMILIES_RECONSTRUCTED | 12, comprising 11 current-state families and 1 schema-only family |
| DATA_FAMILIES_STILL_NEON_ONLY | 101 |

Thirteen additional families are `EMPTY_BY_DESIGN`, including order and fill families whose empty state is corroborated by Alpaca and Aiven. Empty is not counted as recovered history.

## Exact unresolved lineage

The original generic JSON walk reported 2,037 apparent parent references across
1,548 keys. A schema-aware audit proved that 995 were text strategy-frontier
candidate references, while the supposed parent column is UUID. Those text values
are not parent references. The corrected unresolved set is 827 occurrences across
553 unique keys:

- `trade.fusion_snapshot`: 302 unique keys, 0 present in Aiven
- `trade.decision`: 125 unique keys, 0 present in Aiven
- `trade.candidate_point_in_time_evidence`: 126 unique UUID keys

These parents were not fabricated. The complete list of 101 Neon-only data families, all 134 family statuses, origins, keys, parent counts, row counts, and research/runtime relevance is in [LEGACY_RECONSTRUCTION_MATRIX.md](./LEGACY_RECONSTRUCTION_MATRIX.md). Writer, source-event, derivation, timestamp, point-in-time, and reconstruction lineage is in [LEGACY_RECONSTRUCTION_PROVENANCE_GRAPH.md](./LEGACY_RECONSTRUCTION_PROVENANCE_GRAPH.md). The expanded search and false-parent correction are recorded in [LOCAL_FORENSIC_RECOVERY_RECEIPT_2026-09-17.md](./LOCAL_FORENSIC_RECOVERY_RECEIPT_2026-09-17.md).

The exact remaining Neon-only gaps are the original row sets and source identities for those 101 matrix entries, the 553 unique unresolved parent keys, all unobserved resolved outcome labels, and any original lifecycle, management, or whole-chain records not present in the promoted export. Current Aiven rows in similarly named runtime tables remain authoritative current state and are not claimed as recovered Neon history.

## Aiven validation

| Check | Result |
| --- | --- |
| Runtime authority | Aiven |
| Migration count | 52 |
| Migration head | `052_legacy_reconstruction_registry` |
| Database size | 136,033,983 bytes |
| Storage headroom | Unknown. The plan storage cap is not exposed by PostgreSQL metadata, so no value is inferred. |
| Client connections at probe | 2 of 20 |
| Invalid indexes | 0 |
| Unvalidated constraints | 0 |
| Registry sweeps | 1 |
| Registry sources | 147 |
| Registry family assessments | 134 |
| Promoted PIT research rows | 25,125 |
| Canonical rows changed by registry replay | 0 |

The replay defect found during Production verification was fixed by serializing imports with a transaction-scoped advisory lock and awaiting the receipt query before releasing the client and closing the pool. The same manifest now returns the existing receipt cleanly.

## Provider and broker truth

Alpaca Paper reconciliation returned an ACTIVE account, 0 positions, 0 open orders, 9 account activity facts, and no THETA-matched orders. Market clock and calendar were readable. The activity facts do not prove missing THETA decisions or economic chains, so none were inferred.

Optionomics current Aiven evidence contains provider observations and qualification metadata, but the sweep found no additional qualified historical payload that could establish legacy identity. No Optionomics row was invented or promoted from documentation claims.

## Verification

- Focused legacy and runtime tests: 6 passed
- Full CI Node suite: 923 passed, 10 skipped, 0 failed
- Python quant suite: 474 passed
- TypeScript: passed
- ESLint: passed in CI
- Production build: passed in CI and Vercel
- Security scan: 0 findings across 794 paths
- Browser suite: passed in CI
- PostgreSQL 18 migrations and invariants: passed in CI
- Real customer persistence test: passed in CI
- Production root: HTTP 200
- GitHub CI run: `35204020884`, passed

## Final states

```text
FULL_NEON_SOURCE_RECOVERY = NO
MAXIMUM_NON_NEON_RECONSTRUCTION_COMPLETE = YES
NORMAL_THETA_ROADMAP_RESUMED = YES

AIVEN_CURRENT_RUNTIME_AUTHORITY = YES
LEGACY_NEON_DATA_PRESERVED = YES
LEGACY_NEON_DATA_CURRENTLY_READABLE = NO
LEGACY_NEON_DATA_RUNTIME_REQUIRED = NO
LEGACY_NEON_EXPORT_REQUIRED_FOR_PROGRESS = NO
LEGACY_NEON_EXPORT_REQUIRED_FOR_EVENTUAL_COMPLETENESS = YES
LEGACY_NEON_RECOVERY_STATUS = PRESERVED_TEMPORARILY_INACCESSIBLE
NEON_LEGACY_BACKFILL = DEFERRED_NON_BLOCKING

EXECUTION_GATE = EXTERNAL_QUOTE_BLOCKER
FOLLOWER_EXECUTION = LOCKED
LIVE_MONEY_AUTHORIZED = NO
LIVE_ELIGIBLE = NO

MASTER_PAPER_ORDERS = 0
FOLLOWER_PAPER_ORDERS = 0
LIVE_ORDERS = 0
```

When Neon becomes readable, the prepared recovery runner must create and hash a full dump, restore it only into isolated staging, compare it to this registry, fill proven gaps, and upgrade confidence classes. It must never overwrite newer Aiven runtime truth.
