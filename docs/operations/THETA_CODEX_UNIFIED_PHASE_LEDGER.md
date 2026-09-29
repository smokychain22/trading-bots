# THETA unified phase ledger

This ledger records parallel source work separately from release closure. It is
not an authorization to place an order or to deploy this integration branch.

## Authority at branch creation, 2026-09-29

| Item | Verified state |
| --- | --- |
| `origin/main` and integration base | `cf9bc26a3cdd3646a663fe6fa97c8055606a2caa` |
| Current locked release | `cf9bc26a3cdd3646a663fe6fa97c8055606a2caa` |
| Worker | One online PowerShell supervisor, release SHA aligned, execution locked |
| Alpaca clock | Closed at `2026-09-29T02:54:58-04:00`, next open `2026-09-29T09:30:00-04:00` |
| Production schema / recovery | Schema 067, prior verified soak, backup and restore parity retained |
| Phase 1 | `FORWARD_DATA_REQUIRED`, no open-session current-release frontier or T0 replay yet |
| First Paper order | `OWNER_GATED`, zero orders authorized |

The local worker status reported research-archive transfer quota exhaustion and
a deferred storage audit at this observation. Its circuit still reported
`DB_HEALTHY`. This is a typed infrastructure/degradation signal, not a strategy
WAIT and not proof of an open-session decision. Recheck it during the open-session
evidence window without restarting the aligned worker for this status alone.

## Phase source and closure states

| Phase | Parallel source state | Closure state | Evidence or exact remaining dependency |
| --- | --- | --- | --- |
| 1 | Current release frozen | `FORWARD_DATA_REQUIRED` | Current-worker open-session canonical frontier, durable method provenance, honest per-method L7 and non-real rejection, persisted T0, provider-free deterministic replay. |
| 2 | `PARTIAL_SOURCE` | `WAITING_ON_PHASE_1` | Current executable two-sided quote entitlement, provenance and PIT operation matrix need qualification. Optional research features cannot become hard entry gates by default. |
| 3 | `PARTIAL_SOURCE` | `WAITING_ON_PHASE_2` | Candidate contracts were already normalized. This branch validates broker-derived portfolio exposure and correlation shape, rejects future-received evidence, and now records actual completed account, positions, orders, clock, calendar, contract and quote receipt times rather than relabeling the decision time as their receipt time. Other state blobs and current-worker replay still need audit. Research T0 adapters do not prove Production replay. |
| 4 | `PARTIAL_SOURCE` | `WAITING_ON_PHASE_3` | Q/H/D/A/C/WAIT economics need after-cost and lifecycle invariants. No empirical continuation value is available. |
| 5 | `PARTIAL_SOURCE` | `WAITING_ON_PHASE_4` | One AEGIS and sizing authority remains mandatory. Simulated idempotency and restart tests do not authorize Paper submissions. |
| 6 | `SOURCE_COMPLETE_DATA_PENDING` for imported research modules only | `EMPIRICALLY_UNPROVEN` | Historical recovered corpus has no selected or resolved outcomes. Future capture and truth-class joins require later real observations. |
| 7 | Existing locked worker observed | `OWNER_GATED` | Paper readiness and first order require separate owner authorization after preceding evidence gates. |
| 8 | No Paper outcomes | `FUTURE_DATA_REQUIRED` | Actual fills, lifecycle and whole-chain outcomes do not yet exist. |
| 9 | No live permission | `OWNER_GATED` | Live-money authorization was not granted. |

## Claude WP01-WP100 compatibility review

Remote `claude/theta-overnight-quant` was fetched at
`d1daa30332e6097266add566dafc3cf86cd199d5`. Its merge base with the
integration base is `429c193911fcccccd68eddea660d175426817736`.
The controlled import contains only new `bots/theta/quant/` modules and their
quant tests, plus the additive PIT-safe realized-volatility result wrapper.
The 1225-test quant suite and 11 subtests passed on this integration branch.

| Module group | Classification | Consumer and maturity truth |
| --- | --- | --- |
| Feature contracts, 20 families, regime/router adapters | `RESEARCH_ONLY`, `NEEDS_APP_WIRING` | Typed and tested, not a current-worker Production ranking authority. Provider-qualified input is still required for many features. |
| Historical dedupe, v1-to-v6 bridge, coverage and strictness | `RESEARCH_ONLY`, `BLOCKED_DATA` | Useful for structural evidence. Declared historical dataset hashes remain unverified and cannot support promotion. |
| Future capture, assignment/expiration, fill and management datasets | `RESEARCH_ONLY`, `NEEDS_APP_WIRING` | Contracts and offline builders exist. Real future and broker-actual producers are not established by these modules. |
| Baselines, calibration, walk-forward, OOS, selection-bias and benchmarks | `RESEARCH_ONLY`, `BLOCKED_EMPIRICAL` | Executable tests are present. No resolved independent outcomes justify fitted probabilities, EV or strategy promotion. |
| Claude `validation_experiment.py` SHA change | `CONFLICTING`, not imported | Current main accepts an exact checkout HEAD in isolated offline validation. Claude's version would require ancestry in `origin/main`, breaking integration-worktree validation. |
| Claude operations truth documents | `SUPERSEDED_BY_MAIN`, not imported | Main's later recovery, deployment and storage facts remain authoritative. |

The imported quant code has no new Node, database, broker, worker, execution or
Production-authority change. The CLI explicitly reports
`BLOCKED_MISSING_INTEGRATION` for commands without a real dataset/policy adapter.
The research truth firewall is a contract-level guard, not sufficient proof of
real-world promotion. No L7, L8 or broker authority is claimed by this import.

## Command-5A reconciliation

Remote `codex/theta-command5a` was fetched at
`226fb7a3684a0d20c6e205bd5590c39d0d955785`. It diverges from main before
the schema-067 PostgreSQL and recovery fixes. A branch merge would delete or
replace current Production database tooling, so no wholesale merge is allowed.
Its GET-only Alpaca future-observation source, bounded scheduling, namespace
isolation, local SQLite subjects/jobs, maturation, provider deferrals, storage
watermarks and Windows scheduling have now been merged into this isolated
integration branch. The merge auto-resolved against current main's later
PostgreSQL, schema-067, backup and release fixes. The integrated delta contains
61 files and does not delete those later main facilities. This is source and
test integration only. No Command-5A component has been deployed into the
frozen Phase-1 worker, and no real T0 subject has been captured by it.

The integrated source passed TypeScript checking, lint, 68 focused
Command-5A/read-only tests, 2,967 passing Node tests with 15 skipped,
1,222 Python unittest cases, four Windows backup/deadline tests, 23 browser
tests, build, security scan and Git storage policy. The focused tests prove
GET-only requests, exact-leg marks, typed provider deferrals, idempotent local
jobs and bounded process wiring. They do not prove provider entitlement or
current-worker market outcomes.

The frozen `cf9bc26a3cdd3646a663fe6fa97c8055606a2caa` release still uses
its earlier provider receipt semantics. This branch's corrected receipt times
are not deployed. A Phase-1 L7 claim from that worker must be judged against
the persisted raw provider and decision timestamps, not inferred from this
branch's source tests or its synthesized source-provenance fields.

The first isolated integration SHA `d36e0801451b11f01712a86817af8a3c8382928d`
passed exact-SHA CI run `36534651935`. Later Phase-3 typing work on this
branch passed exact-SHA CI runs `36535577075` and `36536038309`. The subsequent
provider-timing correction is source-only and still requires its own CI.

## Unknown and safety register

| Class | Current state |
| --- | --- |
| `CODE_SOLVABLE` | Command-5A runtime producer/consumer port and Phase-2 operation qualification remain under audit. Do not report zero until tested. |
| `DATA_REQUIRED` | Recheck current Alpaca quote entitlement and exact BBO timing in the supported session. |
| `FUTURE_DATA_REQUIRED` | Open-session current-release frontier/T0, future marks and broker-actual outcomes. |
| `EXTERNAL_PROVIDER_REQUIRED` | None newly proved by this branch import. Transfer-quota signal needs separate bounded confirmation. |
| `INAPPLICABLE` | Recovery and covered call with a broker-confirmed flat account. |
| `RESEARCH_ONLY` | Unpromoted feature families, historical dedupe, empirical models and benchmarks. |

`ORDER_SUBMISSIONS=0`, `BROKER_MUTATIONS=0`, `FOLLOWER_SUBMISSIONS=0`,
`MASTER_PAPER_EXECUTION_ENABLED=false`,
`FOLLOWER_PAPER_EXECUTION_ENABLED=false`, `PAPER_PAUSE_NEW_ORDERS=true`,
`LIVE_AUTHORIZATION=NOT_GRANTED`.
