# Phase-2 work ledger, 2026-09-30

Execution locks remain unchanged. Source corrections below are local tested
engineering until the exact release is reviewed, CI-verified and deployed.
No entry here closes the full phase.

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
uses a synthetic local map. It cannot certify the actual Production consumer
call graph. Keep that audit open until requirement-specific paths are executed.
