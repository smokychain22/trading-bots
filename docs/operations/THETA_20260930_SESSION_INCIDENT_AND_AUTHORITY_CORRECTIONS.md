# September 30 session incident and authority corrections

## Observed release and scope

Production and the single immutable Windows supervisor were observed on
`6e74280293f25b3569b2dd026dc1e9c3552b933a`. Its exact CI run
`36720753562` passed. This review did not deploy, restart the worker, change
strategy thresholds, migrate, back up Production, or submit broker requests
that mutate state. Phase 1 foundation/replay closure remains intact.

## Runtime evidence

The earlier local session probe failed with `POSTGRES_CONNECTION_TERMINATED`.
One bounded recovery observation measured DNS, TCP, TLS and PostgreSQL startup.
The fresh connection completed in 2003.965 ms. A rollback-only temporary-table
write passed. The postmaster start timestamp was unchanged. Runtime truth then
found schema 067, one current-release lease and GOOD persisted reconciliation.

Exactly one fresh manual no-submit probe followed. Alpaca confirmed the market
open at 14:09:24.970 UTC, then the probe again failed with
`POSTGRES_CONNECTION_TERMINATED`. Manual probe retries stopped. The original
code replaced its failure-stage variable before reporting fallback results, so
the exact original SQL operation cannot be recovered from that receipt.

Root cause remains unresolved. Successful recovery samples do not prove that
the original failure was network-side, nor do they prove a client leak. The
Aiven browser inspection timed out and supplied no additional evidence.

The independent resident worker persisted recent candidate and AEGIS evidence.
That evidence must not be substituted for the failed manual cycle. The failed
probe proves a clock read, not canonical reconciliation, Q economics, AEGIS,
sizing, finalist selection or a final trading decision. Its outcome is
`INFRASTRUCTURE_DEFERRED`, never strategy WAIT.

## Source corrections

1. The no-submit authority classifier separates provisional calculations from
   complete persisted decisions. Database failure clears canonical action,
   preserves provisional action and returns a failing exit status. Incomplete
   enumeration cannot certify GLOBAL_WAIT.
2. The probe records the failed stage and pool counters before fallback. It
   labels fallback decisions provisional in both spool and console receipts.
3. The local-evidence authority helper always denies broker mutation, including
   after PostgreSQL backfill. This was a latent API defect, not evidence of a
   real unauthorized order. No Production consumer of that helper was found.
4. Frontier exception logs use bounded error identities instead of raw provider
   exception text. Receipt sanitization alone did not protect the old log path.
5. The probe uses the existing schema compatibility authority and observed
   migration head. Its former restricted query reported 065 even on 067. A
   clock-only read is now PROVIDER_STATE_READY rather than ACCOUNT_READY.
6. Command-5A maturation formerly loaded only the first 256 observation batches
   across a whole cycle before selecting a subject. It now scopes the SQL read
   to the archived subject identity before applying the bound. Overflow is an
   explicit `LOCAL_RESEARCH_READ_LIMIT_EXCEEDED`, not a truncated successful
   read. Pending-batch metadata no longer loads every large JSON payload.
   This does not prune any archive or claim to finish retention cleanup.

## Test evidence and limits

The executed tests cover optional-context perturbations around a genuinely
positive Q fixture, missing required capacity/risk evidence, repeated frontier
selection, repeated management selection, exception sanitization, provisional
WAIT/OPEN classification, schema compatibility and durable backfill authority.

These are deterministic source proofs. The optional-context test reaches the
frontier boundary, not every upstream feature producer. Repeated unchanged
management economics do not establish empirical policy stability. Neither test
promotes H/D, estimates profitability, proves all 20 feature families consumed,
or certifies all management lifecycles on a current real account.

The Command-5A regression places 260 unrelated subjects before the desired
observation, executes the real local maturation path, and verifies a single
durable dataset and idempotent replay. Its modeled fixture remains a test,
not a real resolved market outcome or empirical promotion.

Initial full validation passed 3114 Node tests with 15 skipped, 1231 Python
tests and 23 browser tests. The later schema/stage patch passed 23 focused
tests and is subject to final exact-SHA CI. Typecheck, lint, build, security and
Git storage checks passed before that small patch and must remain green on the
final commit. Windows recovery tests run only against disposable test artifacts.

Reticle was skipped because these changes are backend/CLI-only with no UI
surface. The existing browser regression suite was still executed.

## Remaining work

- RUNTIME_RECOVERY_REQUIRED: identify the repeated connection termination with
  adequate failure-time telemetry. Do not infer a provider cause from recovery.
- CURRENT_MARKET_REQUIRED: complete one canonical current-release no-submit
  chain after stability is demonstrated. Do not retry during this incident.
- CODE_SOLVABLE: finish the scoped registry-to-consumer census, stage latency
  coverage and governed legacy SQLite payload retention/reconstruction work.
  Existing declarations and one archive certification are not full closure.
- FUTURE_OUTCOME_REQUIRED and EMPIRICAL_ONLY: independent resolved whole-chain
  outcomes, calibration and controlled out-of-sample policy evaluation.
- OWNER_GATED: first Paper submission, follower execution and live authorization.

No completed-system percentage or zero-blocker count is claimed. Execution
remains locked. Source fixes remain separate from deployed/runtime proof.
