# Neon to Aiven migration method matrix

Status date: 2026-09-16

This matrix records bounded, legitimate recovery attempts. It contains no credentials or connection strings. Aiven is the current runtime authority. Neon remains an immutable historical source.

## Proven source condition

The preserved Neon main pooled and direct endpoints were each probed once through the PostgreSQL protocol. Both returned SQLSTATE `53000`, with Neon reporting that the project exceeded its data-transfer quota. The official `aiven-db-migrate` validator at reviewed commit `f87d3727600d0c9eba8973abc31d1892dfe2f005` independently reached the same provider quota response before `SHOW ALL` or schema discovery. This proves the failure occurs at the Neon source connection boundary, before a dump format, table selector, or target choice can change the result.

## Method matrix

| Method | Technically available | Source auth pass | Source read pass | Full data capable | Quota blocked | Privilege blocked | Attempted | Result | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aiven Console Import Database | Yes | Unknown | No | Yes | Yes at the common Neon source boundary | Aiven console session unavailable locally | Control plane inspected, source validation represented by official migrator | `BLOCKED_SOURCE_QUOTA` | Use only after Neon restores read access and only into an isolated target |
| `aiven-db-migrate` dump validation | Yes | Connection reached provider | No | Yes | Yes | No target privilege failure observed | Yes, official source at pinned SHA | `BLOCKED_SOURCE_QUOTA` before schema read | Re-run once after source access returns |
| `aiven-db-migrate` logical replication | Yes | Connection reached provider | No | Yes | Yes | Eligibility cannot be read | Capability query attempted separately | `BLOCKED_BEFORE_ELIGIBILITY` | Inspect `wal_level`, role, replica identity, and publications only after read access returns |
| Logical replication capability query | PostgreSQL supports it | Provider reached | No | Yes | Yes | Unknown | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Do not mutate source while blocked |
| `pg_dump` custom | Yes | Provider reached | No | Yes | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Recovery runner preserves a hashed dump when readable |
| `pg_dump` directory | Yes | Provider reached | No | Yes | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Use for parallel restore if source opens |
| `pg_dump` plain | Yes | Provider reached | No | Yes | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Keep as a fallback |
| `pg_dump` schema-only | Yes | Provider reached | No | Schema only | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Git migrations already reconstruct the schema, not the rows |
| `pg_dump` data-only | Yes | Provider reached | No | Data only | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Use only after a separately verified schema restore |
| Table-specific `pg_dump` | Yes | Provider reached | No | Per table | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Resume by stable table identity if full dump remains unavailable |
| SQL `COPY TO STDOUT` | Yes | Provider reached | No | Per query/table | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Use keyset chunks and checksums only when readable |
| `psql \copy` | Yes | Provider reached | No | Per query/table | Yes | No privilege decision reached | Yes on pooled and direct | `BLOCKED_SOURCE_QUOTA` | Same source gate as COPY |
| Main pooled endpoint | Yes | Provider reached | No | Yes | Yes | No | Yes | SQLSTATE `53000` | Stop retrying until provider state changes |
| Main direct endpoint | Yes | Provider reached | No | Yes | Yes | No | Yes | SQLSTATE `53000` | Stop retrying until provider state changes |
| Preview branch endpoints | Branches preserved | Control plane only | No | Yes | Project-wide quota | Exact preview credentials are not exported locally | SQL editor/control surfaces inspected once | `BLOCKED_PROJECT_QUOTA` | Do not create more branches |
| Neon Data API | Only if provisioned | Control plane available in prior inspection | No | Potentially | Project-wide quota | No separate active API surface proved | Inspected once | `UNAVAILABLE_OR_QUOTA_BLOCKED` | Do not invent an endpoint |
| SQL Editor | Yes | Console surface reached in prior inspection | No | Per query | Project-wide quota | No | Inspected once | `BLOCKED_PROJECT_QUOTA` | Do not manually copy rows |
| Time Travel Assist | Plan/history dependent | Console surface inspected | No | Read-only point in time | Project-wide quota | No readable historical endpoint exposed | Inspected once | `BLOCKED_PROJECT_QUOTA` | Recheck only after source state changes |
| Historical branch or endpoint | Neon supports PIT branches | Control-plane metadata only | No | Yes | Project-wide quota | No connection credential exposed | Inspected once | `BLOCKED_PROJECT_QUOTA` | Preserve history, do not restore over main |
| Read replica | Neon supports replicas | Not created | No | Yes | Same project transfer meter | Creating more compute is unjustified | Classified, not created | `REJECTED_REDUNDANT_UNDER_PROJECT_QUOTA` | No action |
| `postgres_fdw` | PostgreSQL extension method | Not separately connected | No | Yes | Same source proxy gate | Extension and source privileges not evaluated | Classified | `BLOCKED_BY_PROVEN_SOURCE_GATE` | One-time staging only if source opens |
| `dblink` | PostgreSQL extension method | Not separately connected | No | Yes | Same source proxy gate | Extension and source privileges not evaluated | Classified | `BLOCKED_BY_PROVEN_SOURCE_GATE` | Avoid permanent cross-database runtime |
| Physical/base backup download | No documented customer artifact for this project | N/A | N/A | Potentially | N/A | Provider product boundary | Official surfaces reviewed | `NOT_SUPPORTED_AS_CUSTOMER_EXPORT` | Ask Neon support for a provider-generated dump |
| Local backup | Yes if an artifact exists | N/A | N/A | Potentially | No | No | Workspace, OneDrive, client directories, temp, WSL, and Docker volumes searched | `NO_VALID_NEON_DUMP_FOUND` | Retain hashes only for plausible artifacts |
| CI/GitHub artifact | Yes if retained | N/A | N/A | Potentially | No | No | Prior artifact inventory inspected | `NO_DATABASE_DUMP_FOUND` | None |
| Application export | Yes | N/A | Yes | Partial only | No | No | Imported | `25,126_RECORDS_STAGED` | Validate and promote safe research or engineering history |
| Neon support export | Provider dependent | Not applicable | Pending | Yes | Support may provide a bounded exception | No authenticated support submission surface available | Request prepared | `PREPARED_NOT_SUBMITTED` | Request one read-only export window or generated dump |

## Official method references

- Aiven documents Console migration with continuous logical replication and one-time `pg_dump`: <https://aiven.io/docs/products/postgresql/howto/migrate-db-to-aiven-via-console>
- Aiven recommends `aiven-db-migrate`, which uses logical replication and falls back to dump/restore: <https://aiven.io/docs/products/postgresql/concepts/aiven-db-migrate>
- Aiven documents standard directory-format dump and restore: <https://aiven.io/docs/products/postgresql/howto/migrate-pg-dump-restore>
- Neon documents that pooled, direct, primary, and replica traffic count toward the same project transfer allowance: <https://neon.com/docs/introduction/network-transfer>
- Neon documents that clients need a compute endpoint for every branch: <https://neon.com/docs/manage/endpoints/>
- Neon documents point-in-time restore and Time Travel Assist: <https://neon.com/docs/changelog/2024-02-23>

## Current exit result

- `FULL_NEON_SOURCE_RECOVERY = NO`
- `EVERY_LEGITIMATE_METHOD = TESTED_OR_CLASSIFIED`
- `ONLY_REMAINING_FULL_SOURCE_BLOCKER = NEON_PROJECT_TRANSFER_QUOTA`
- `NORMAL_THETA_ROADMAP_RESUMED = YES`

The unavailable Aiven console session is not a data-recovery dependency. Once Neon permits a PostgreSQL source read, the existing local recovery runner can create a complete hashed dump without Aiven control-plane access. Aiven Console import remains an additional path, not the only path.
