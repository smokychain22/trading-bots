# Local and agent forensic recovery receipt

Date: 2026-09-17

## Result

The recovery assumption was expanded from "read Neon or stop" to "exhaust every
local, agent, export, Git, temporary, and retained-origin copy before calling a
record Neon-only." A reproducible sweep now catalogs each inspected source by a
sanitized locator, byte length, timestamp, SHA-256, evidence class, and exact-key
match count. Secret-bearing paths are excluded.

The sweep inspected:

- 109 immutable THETA research exports containing 244,566 row occurrences
- 144 research-output JSON files containing 1,704 parsed objects
- Codex attachment storage
- Claude state and paste/session storage
- Downloads and temporary storage
- the old standalone repository and current worktrees
- Cursor history
- locally available OneDrive files, excluding 149 offline placeholders
- Ubuntu WSL home and temporary storage
- 134 unreachable Git objects, including 50 blobs
- retained GitHub Actions artifact metadata and the checked-in workflow paths

Docker Desktop's engine was unavailable during the sweep. This is recorded as an
unavailable search surface, not as proof that no Docker volume exists.

## Parent-reference correction

The previous generic JSON walker reported 1,548 missing parent keys. That number
included every field named `candidateId`, even though two different contracts use
that name:

- `trade.candidate_point_in_time_evidence.candidate_id` is a PostgreSQL `uuid`.
- canonical strategy-frontier candidate references are typed text values such as
  `THETA_CONVENTIONAL:<OCC contract>` and `WAIT:<hash>`.

The 995 text strategy references cannot reference the UUID parent table. They are
valid frontier references, not missing database parents. The corrected foreign-key
analysis accepts only UUID-shaped `candidateId` values for that parent family.

The exact unresolved parent set is therefore 553:

| Parent family | Unique keys | Complete parent records found | State |
| --- | ---: | ---: | --- |
| `trade.fusion_snapshot` | 302 | 0 | reference only |
| `trade.decision` | 125 | 0 | reference only |
| `trade.candidate_point_in_time_evidence` | 126 | 0 | reference only |

All 553 keys were found in their child evidence. No independent complete parent row
was found in agent state, old workspaces, temp files, downloads, editor history,
unreachable Git objects, research outputs, or the immutable exports. A child
reference is never promoted as a recovered parent.

## Historical export variants

The 109 exports contain 230 stable record identities whose payload changed across
exports. They account for 11,588 row occurrences and 460 unique payload variants.
There are no stable record identities present only in an older export.

All 460 exact payload variants are preserved with:

- family and stable identity
- payload SHA-256
- exact JSON payload
- first and last dataset hashes
- first and last export timestamps
- occurrence count
- current versus historical variant classification
- point-in-time eligibility

These variants are historical evidence. They do not overwrite current Aiven
runtime rows and cannot authorize execution.

## Durable controls

Migration `053_local_forensic_recovery` adds immutable Aiven tables for the sweep,
bounded import chunks, sanitized source catalog, exact export variants, and
key-level search receipts. Every table enforces `execution_authorized=false`.
Imports are hash-bound, replay-safe, serialized with a PostgreSQL advisory lock,
and restricted to the authenticated local-worker operation.

Generated local artifacts stay ignored under:

```text
.theta-local-worker/forensic-recovery/
```

The tracked code can regenerate them from the retained sources.

## Authority and safety

```text
AIVEN_CURRENT_RUNTIME_AUTHORITY = YES
LEGACY_NEON_DATA_PRESERVED = YES
LEGACY_NEON_DATA_RUNTIME_REQUIRED = NO
LEGACY_NEON_EXPORT_REQUIRED_FOR_PROGRESS = NO
LEGACY_NEON_EXPORT_REQUIRED_FOR_EVENTUAL_COMPLETENESS = YES

EXECUTION_GATE = EXTERNAL_QUOTE_BLOCKER
FOLLOWER_EXECUTION = LOCKED
LIVE_MONEY_AUTHORIZED = NO

MASTER_PAPER_ORDERS = 0
FOLLOWER_PAPER_ORDERS = 0
LIVE_ORDERS = 0
```

Neon remains the only known source that may contain the 553 complete parent rows.
That statement can change only if a later forensic sweep finds a full record with
valid provenance, or Neon becomes readable and the row is recovered directly.
