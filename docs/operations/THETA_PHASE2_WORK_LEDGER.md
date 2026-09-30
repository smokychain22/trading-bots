# Phase-2 work ledger, 2026-09-30

Execution locks remain unchanged. Source corrections below are local tested
engineering until the exact release is reviewed, CI-verified and deployed.
No entry here closes the full phase.

## Requirement-specific closure pass

- Request-owned PostgreSQL pools now use the same idle/checked-out error
  containment as the persistent pools, without changing limits or retries.
  The ownership inventory classifies every source constructor. Per-process
  capacity is explicit. A serverless fleet-wide maximum is not fabricated.
- Unreached Q enumeration and sizing retain null through the Production
  projection, persisted diagnostic and operator loader. Observed zero remains
  zero. Malformed persisted operator-control booleans fail closed, including
  idempotent replay and rollback/release paths.
- The database-independent observation path had the same false-zero problem
  and wrote READY envelopes even for failed stages. It now records explicit
  stage-not-observed and blocked-plan receipts. A later failure cannot prove
  that an unreported earlier stage never ran. Finalist receipt time follows
  actual response completion rather than the request start.
- A disposable PostgreSQL test runs the actual autonomous cycle through a
  broker-read failure and recovery. The recovered cycle performs fresh reads,
  uses a new identity and persists a new snapshot with zero submissions.
- Linux CI now binds Python integration tests to its installed interpreter.
  Previously the local Windows fallback could hide skipped orchestration
  cases on Linux. Disposable database test names are archived by exact CI SHA.
- The historical F01-F24 index is explicitly navigation metadata. Reviewed
  requirement bindings select exact executed regression cases instead of
  granting PASS from source patterns, enums or a global certificate.
- The full-suite stress run exposed a test-only unhandled-rejection race in
  the intentional six-on-two starvation reproduction. Rejection handlers now
  attach in the same turn, before any timer wait. No runtime timeout changed.
- A generated evidence artifact binds each reviewed requirement to executed
  test names and source/test hashes. It cannot grant runtime or broker maturity.
  The closure-register test checks artifact integrity and rejects stale hashes.

No Production migration, soak, backup, execution-gate change or broker mutation
was performed for this source/acceptance work. Deployment proof remains separate.

Final source-pass validation: 570 focused requirement tests and the full Node
suite of 3220 passed, 16 skipped, zero failures. Typecheck/lint/build and
security/storage checks passed. The Python 1234, browser 23 and four Windows
recovery test results above remain scoped to their unchanged components.
The CI workflow will execute the full combined release, including the newly
enabled Linux Python orchestration cases and disposable PostgreSQL recovery.

A bounded read-only health check at 2026-09-30T19:07:56.406Z observed schema
067, writable admission, unchanged postmaster start, d870f29 locked runtime,
one active lease and GOOD reconciliation with zero positions/open orders.
No restart or cutover was performed. This does not deploy the source fixes.

## Subsequent executed corrections

- Required provider failures and SYSTEM_HOLD cannot certify canonical WAIT.
  Corporate-action persistence failures now propagate as infrastructure errors.
- Account persistence uses the bounded canonical Alpaca adapter, preserves unknown
  numeric values, and timestamps actual response completion. Transaction rollback
  failure discards the client. Calendar-invalid OCC expiries are rejected.
- Optionomics duplicate contracts and conflicting/cross-symbol context preserve
  typed uncertainty. Feature availability follows the latest input receipt.
- Fresh finalist and corporate-action evidence uses actual response completion,
  with plan expiry and quote age evaluated after the request finishes.
- Real disposable PostgreSQL tests executed timeout, own-backend termination,
  idle-client termination, rollback and queue-drain paths. Production was not
  fault-injected. CI also runs this isolated database suite.
- Offline performance tooling now exercises decoding, normalization, features,
  hashing and SQLite WAL round-trip at 2601/5000/10000 rows. Synthetic local
  timings do not certify Aiven latency or current-market behavior.

Latest local validation for this correction batch: Node 3199 passed, 16 skipped,
Python 1234 passed, browser 23 passed, typecheck/lint/build passed, security scan
zero findings, storage policy and four Windows recovery scripts passed. These
are source tests, not a deployed release or an inherited phase certificate.

| Item | Proven cause and correction | Requirement-specific tests | Runtime impact |
| --- | --- | --- | --- |
| DB observer | Throwing telemetry could mask a successful operation or the original failure. Isolate callback failure and retain sanitized SQLSTATE and operation timing. | runtime-postgres-client, runtime-postgres-pool | Observability only, no new retry or timeout. |
| Pool bounds | NaN configuration could fall through to pg defaults. Reject invalid pool/timeout numbers. | runtime-postgres-pool | Fail closed before connection creation. |
| Owned administration pools | Seven acquisitions preceded their cleanup scopes. Close the owned pool when acquisition fails. | owned-pool-client | No administration command executed. |
| Operator status | Overlapping requests and seven parallel helper pools multiplied connections. Single-flight overlapping reads and serialize owned helper lifetimes. | operator-status-read-batch | Per-process bound only. Fleet maximum remains deployment-dependent. |
| Customer transactions | Readback inside a checked-out transaction could acquire a second client. Rollback failure also returned an unsafe client. Reuse canonical transaction wrapper and release before readback. | customer-store-transactions, disposable DB customer-persistence | No broker operation or permission change. |
| Provider enumeration | Duplicate pages inflated counts or replaced contradictory quotes. Deduplicate normalized identical identities and reject conflicts/token loops. | alpaca-provider, phase2-provider-matrix, underlying-history | No freshness, spread or strategy policy change. |
| Event duplicates | Duplicate grouping copied arrays repeatedly and ignored differences in PIT verification. Group linearly, preserve conflicts and stable earliest observation. | normalized-event-evidence | Utility is not claimed to be the Production event authority. |
| Router portfolio | Production reused a manual flat-account default despite fresh broker reads. Derive symbol applicability, preserve missing data, persist observed state/origin. | broker-router-portfolio, theta-shadow-cycle, Python strategy-router contract | Changes applicability evidence, never promotes H/D or replaces management. |
| L7 rejection | A self-declared REAL row could contradict its decisive origins. Reject manual/missing/policy-only decisive evidence. | method-l7-realness-authority | Truth classification only. |
| Development dependencies | Two vulnerable transitive brace-expansion versions. Update only locked development resolutions. | npm audit, security scan | No Production dependency change. |

Runtime evidence for deployed d870f29 is kept in ignored local receipts. Its
verified archive hash is
`3ef90e33a9cdfec22162ffd006ad37787cb9b4b8bb69aaa29006a54f920c357a`.
Replayed frontier hash is
`bfab96f7d8f332866f8b0248f33f1bc3016a13450a251ca09ad01a6b30df2c1b`.
Source-only corrections above do not retroactively change that evidence.

Phase-3 continuation finding: `proveDecisionDataRoute` in V19 certification
used a synthetic local map. Current code labels that declaration-only evidence
NOT_PROVEN. Reviewed source behaviors now have executed named cases and hashes
in the separate Phase-3 artifact. This does not confer current-worker L7.

Phase-4 continuation completed whole-chain repository-to-management input-to-
policy wiring, typed original/current thesis health, symbol-scoped snapshots
and consistent management capital-day units. The Phase-4 artifact covers twelve
reviewed source groups with 222 executed tests. Current worker remains d870f29,
unchanged, so deployment and real-inventory evidence are not silently closed.
Phase 5 proceeds from the current call graph, not the historical closure label.
