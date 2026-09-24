# THETA database-resilient observation runtime

## Authority boundary

This runtime preserves read-only market observations when canonical PostgreSQL
is temporarily unavailable. It never grants execution authority.

- Alpaca remains broker, account, lifecycle, and executable Paper quote truth.
- Optionomics remains qualified research and analytics context.
- PostgreSQL remains canonical THETA decision and plan persistence.
- The local SQLite WAL is a durable outbox, not canonical trade state.
- A locally spooled envelope cannot authorize an order. Broker mutation still
  requires canonical PostgreSQL evidence and the separate execution gate.

## Local evidence layout

The default outbox is outside Git at:

`.theta-local-worker/evidence-spool/theta-evidence.sqlite`

SQLite uses WAL mode, `synchronous=FULL`, a hash chain per decision cycle, a
stable envelope UUID, a source SHA, snapshot identity, provider observation
times, received/computed times, payload hash, and prior-envelope hash. Payloads
containing credential-shaped keys or values are rejected.

Persistence states are explicit:

- `PERSISTED_POSTGRES`
- `SPOOLED_LOCAL_PENDING_DB`
- `BACKFILLED_POSTGRES`
- `REJECTED_IDENTITY_CONFLICT`
- `CORRUPT`

Database circuit states are `HEALTHY`, `DEGRADED_READABLE`, `SPOOL_MODE`, and
`RECOVERING`. Two successful probes are required before the supervisor leaves
database recovery mode.

## Observation sequence

The database-independent provider path uses the same real universe discovery,
canonical THETA Q cycle, AEGIS/sizing computation, and exact selected-contract
Alpaca GET refresh. It records:

1. `ACCOUNT_READY`
2. `CONTRACTS_READY`
3. `QUOTES_READY`
4. `Q_READY`
5. `AEGIS_READY`
6. `SIZING_READY`
7. `DECISION_READY`
8. `PLAN_READY`

`PLAN_READY` during a database outage means
`BLOCKED_CANONICAL_POSTGRES_REQUIRED`. It is not an approved or queued Paper
plan. Missing IV/spread history stays unknown. Optional H/D research failure
does not poison Q, while required Q, quote, AEGIS, or sizing evidence remains
fail-closed.

## Recovery and backfill

Migration `066_local_observation_evidence` adds the immutable canonical outbox
archive. After two healthy database probes, the Windows supervisor runs:

```powershell
npm run theta:evidence:backfill
```

Backfill verifies the local hash chain, source SHA, envelope identity, and the
canonical row after each insert. Existing matching rows are idempotent. An
identity/hash conflict is rejected. An ambiguous write is accepted only when a
fresh canonical read proves the exact envelope. The local generation remains
available after backfill.

## Failure behavior

| Failure | Observation behavior | Mutation behavior |
| --- | --- | --- |
| PostgreSQL unavailable before or during scan | Continue GET-only provider/Q observation and spool | Blocked |
| Optional shadow stage fails | Preserve Q and record optional failure | Blocked unless every required canonical stage independently passes |
| Snapshot identity changes within a cycle | Stop at `EVIDENCE_IDENTITY_MISMATCH` | Blocked |
| Local hash chain fails | Mark corrupt and refuse backfill | Blocked |
| Backfill identity differs from canonical row | Reject conflict | Blocked |
| PostgreSQL recovers | Require two probes, then idempotent backfill | Still subject to the separate execution gate |

## Verification

The focused suites cover restart durability, hash-chain validation, secret
rejection, idempotent/ambiguous backfill, every required database-failure
boundary, optional research isolation, mixed-snapshot rejection, GET-only exact
contract refresh, and Windows supervisor recovery wiring. Full repository tests,
typecheck, lint, build, and security scan remain required for release.

