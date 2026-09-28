# THETA Codex master continuation receipt

Receipt state: `SUPERSEDED_HISTORICAL_RECEIPT`

Current operator authority is `src/theta/canonical-system-truth.ts` plus the
newest entries at the top of `docs/operations/THETA_IMPLEMENTATION_BOARD.md`.
The Aiven transfer-quota block recorded below was real at the time, but it has
since cleared. Production is at schema head 067 and Phase 1 now awaits one
final Mode-B certification. The historical details below remain unchanged as
incident evidence.

This receipt records implemented and verified work. It does not authorize a Paper order, a follower order, or live execution.

## Canonical source

- Starting main for this continuation: `909afa408ae9233ae98309a69eb222936b1713d2`
- Current source-bearing implementation head before this receipt update: `2d6445cb9eeb5e8ff4210b59b853327e94e15e81`
- Exact CI for that head: run `36326674981`, `success`
- Canonical remote: `origin/main`
- Command-5A remains isolated on `codex/theta-command5a`. It is not deployed and is not merged wholesale into Production.

## Implemented on main

### Bounded PostgreSQL backup tools

Commit `dc36d2528e440f98284a447f591c68d2dd725506` added bounded `psql`, `pg_dump`, and `pg_restore` execution to the Windows backup path.

- `psql` hard deadline: 600 seconds
- `pg_dump` and `pg_restore` hard deadline: 14,400 seconds
- Production dump progress deadline: 900 seconds without file-byte growth
- Timed-out child process trees are terminated
- Child diagnostics are sanitized
- Aiven transfer-quota failures are typed separately
- Regression test: `tests/windows/theta-postgres-tool-deadline.test.ps1`

### Preserved backup verification

Commit `b4bb8b8` added deterministic verification of prior recovery generations through `Test-ThetaVerifiedBackupDirectory`.

The verifier requires:

- expected backup-root containment
- a complete manifest
- a verified verification receipt
- a matching archive SHA-256
- successful restore-parity receipt

The preserved generation `2026-09-22_100128-c600e016` passed this verifier locally. Its archive remains at `C:\ProjectBackups\trading-bots\daily\2026-09-22_100128-c600e016\database.backup`. The previous generation `2026-09-21_215137-51b9c85f` also remains preserved.

### Measured storage growth policy

Commit `fae07aa4932cd4b0a5707eabfacd3533aec4779f` added a daily byte-growth ratio to the storage forecast. A daily growth-budget breach pauses eligible nonessential research persistence before absolute capacity is exhausted. Operational truth remains writable.

### Bounded locked-worker maintenance

Commit `ab29f2ad5738fa3c734ddcf220c65521d072a2c1` removed unbounded child-process waits from the locked Windows supervisor's independent maintenance paths.

The bounded runner now owns local evidence backfill, research export, the descriptive empirical pipeline, durable evidence bundling, the storage audit, canonical-frontier archive projection, DuckDB probing, Parquet compaction and verification, archive health, runtime receipt writing, and the database-independent no-submit probe. Each call has an explicit deadline, terminates its child process tree on timeout, drains stderr without exposing it, and records a typed timeout state where the status contract has a matching field. A blocked child can no longer stop lease renewal and future locked cycles indefinitely.

### Bounded governed checkpoint

Commit `a04e65f28b68fee5522f59a442d8f26429c33fb6` applies the same process ownership to the outer migration checkpoint. Pre-backup, migration, invariant verification, storage audit, 900-second soak, and post-backup now have stage-specific hard deadlines and typed timeout failures. The checkpoint terminates a timed-out child process tree and preserves the previously verified recovery generation.

### Bounded archive certification

Commit `2e08a792fa5f4a66a66910ca801b9896d48f993f` bounds the archive-certification Parquet compactor and verifier. Child timeout, start failure, and nonzero exit are stage-specific. Raw stderr is not included in the certification exception.

### Bounded operational and forensic tools

Commits `92857778d387109cf37af335fe0d0947f6e4dd84`, `1793e84d8e8c883a3680b83f00a967fb60b2fe7c`, `815e378e830939efe8a82c8d60ffa222e33193ed`, `5171b2fe7e800974202f1c7fc11a6411002b75eb`, and `98103c8243be84be1f1d866f1e546bc7df5a1c22` closed the remaining unbounded subprocesses in decision-history certification, source-identity lookup, recovery discovery, operator-facing diagnostics, and replay provenance checks.

Every audited subprocess now has an explicit deadline. Long-running historical certification has typed `PASS`, `FAILED`, `TIMED_OUT`, `START_FAILED`, and `NOT_RUN` execution states. Git, ripgrep, GitHub CLI, nested Node, and external Python calls use argument-safe bounded execution. Raw child stderr is not copied into durable receipts.

### Canonical runtime truth baseline

Commit `52265ebe1bf9395c291bda9b9ea6f976f1f537a1` refreshed the canonical runtime-truth baseline to the last fully verified implementation source. The truth audit reports `SOURCE_BASELINE_UNCHANGED`, no changed source files, zero avoidable unknowns, and the exact remaining first-Paper dependency: restore Aiven transfer quota, complete the schema-067 checkpoint, cut over a locked current release, and collect current-release open-session evidence. This is not a strategy WAIT.

### Typed child-backup failure propagation

Commit `2d6445cb9eeb5e8ff4210b59b853327e94e15e81` closes a checkpoint diagnostics gap without exposing provider stderr. `Backup-Theta.ps1` now emits a strict, secret-free failure receipt containing only `state=FAILED` and a validated uppercase reason code. The bounded parent accepts only that receipt shape and carries the code into the durable migration-checkpoint incident. Missing or malformed child receipts become `BACKUP_FAILURE_RECEIPT_MISSING` instead of a guessed provider cause.

A future Aiven quota failure will therefore be recorded as `AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED` by the canonical checkpoint itself. Raw child stderr remains drained and excluded. Focused PowerShell tests cover accepted receipts, malformed and lowercase rejection, backup failure classification, typed parent propagation, and continued stderr isolation.

### Readiness and blocker reconciliation

The canonical blocker registry now has no open code-solvable Codex or Claude blocker. Real Alpaca fill timestamps and per-branch canonical-frontier fault isolation were verified against their existing Production adapters and regression tests. The isolated Command-5A producer is classified as `EXTERNAL_RUNTIME_CHECKPOINT`, since its source and exact CI are complete while deployment correctly remains behind Phase 1.

An intentionally stopped, fully locked worker behind the governed database checkpoint is classified as `EXTERNAL_BLOCKED` rather than an engineering failure. Active or unexplained worker misalignment still fails. Exact-source V20 certification reports `CODE_SOLVABLE=[]` and `PASS`. Premarket certification reports `engineeringGate=PASS`, `overall=EXTERNAL_BLOCKED`, exact CI pass, and the two runtime blockers `LOCKED_WORKER` and `RUNTIME_TRUTH`.

## Governed checkpoint incident

The canonical recovery gate passed with four fresh physical probes, rollback-safe writes, stable postmaster identity, read-only disabled, safe power, adequate connection headroom, a stopped worker, and a preserved prior verified generation.

Exactly one governed pre-migration retry started with generation ID `2026-09-27_123317-3fdbf682`.

`pg_dump` reached 268,255,232 bytes and then stopped byte, timestamp, and CPU progress. A separate bounded and sanitized PostgreSQL probe returned SQLSTATE `53000` with provider classification `AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED`. The exact dump process tree was terminated after the stall and quota condition were both proven. The incomplete staging generation was not promoted.

Durable incident evidence:

- `C:\ProjectBackups\trading-bots\logs\migration-checkpoint-failed-20260927-181513.json`
- `C:\ProjectBackups\trading-bots\logs\backup-20260927-173313.log`

Current checkpoint classification:

- `BLOCKER_ID=AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED`
- `CATEGORY=EXTERNAL_PROVIDER_BLOCKED`
- `OWNER=AIVEN_ACCOUNT_OWNER_OR_PROVIDER`
- `DEPENDENT_TASKS=PRE_BACKUP,RESTORE_PARITY,MIGRATIONS_065_067,SOAK_900S,POST_BACKUP,CUTOVER,REAL_CURRENT_WORKER_CYCLE,PHASE_1_CLOSURE`
- `INDEPENDENT_TASKS_STILL_AVAILABLE=SOURCE_HARDENING,STORAGE_POLICY,COMMAND5A_ISOLATED_WORKTREE,TESTS,DOCUMENTATION`
- `CLOSURE_CONDITION=TRANSFER_QUOTA_RESTORED_AND_CANONICAL_FOUR_PROBE_RECOVERY_GATE_PASSES_AGAIN`

No second retry is allowed under the governed same-normalized-failure policy until that closure condition is met.

## Database and worker truth

- Production schema head: `064`
- Migrations applied during this continuation: none
- Migration 067: not applied to Production
- 900-second soak: not reached
- Post-migration backup and restore parity: not reached
- Windows worker release remains stopped at `af3d43d14d703c47ff52e833588130af60d61e48`
- Local supervisor count: zero at the incident checkpoint
- Local worker count: zero at the incident checkpoint
- Current-main deployment: blocked by the governed database checkpoint
- Phase 1: `NOT_CLOSED`

Infrastructure interruption and provider quota failure are not strategy `WAIT` evidence.

## Command-5A isolated worktree

Worktree: `work/trading-bots-command5a`

Branch: `codex/theta-command5a`

Current isolated branch head at this receipt: `226fb7a3684a0d20c6e205bd5590c39d0d955785`

New isolated commits:

- `512486f` bounds schedule, observation, maturation, and health subprocesses
- `faccccc` bounds local evidence backfill, research export, empirical pipeline, storage audit, archive projection, Parquet compaction and verification, DuckDB dependency probe, runtime receipt writing, and the database-independent no-submit probe
- `bc44454` reconciles the isolated branch with current main while retaining the Command-5A scheduler and archive-health integration
- `e0df7dc` reconciles the isolated branch with the bounded checkpoint and archive-certification source fixes
- `226fb7a` merges the current bounded operational tooling and canonical truth baseline into the isolated branch without granting broker authority

The shared bounded runner:

- uses a no-window process
- captures stdout
- drains but does not expose stderr
- supports bounded stdin for receipt writers
- terminates the full process tree on deadline
- returns typed `COMPLETED` or `TIMED_OUT` state

Command-5A tests passed after these changes. The full isolated branch suite passed with 2,912 passing, 0 failing, and 15 skipped tests before the second subprocess-hardening commit. Focused PowerShell, wiring, type-check, lint, security, and Git storage-policy checks passed after the second commit.

Command-5A continues to have `brokerAuthority=false`. It remains an isolated research/runtime continuation until the Production integration gate is opened after Phase 1.

## Deferred post-Phase-1 Claude handoff

The owner pinned `claude/theta-overnight-quant` at remote SHA `dbd812deb128438d8bb437605e7a43acbe5c8194`. `git ls-remote` verified that exact remote identity. The branch has not been merged, deployed, or inspected for Production integration during Phase 1.

The controlled queue is stored in `docs/operations/THETA_POST_PHASE1_RECONCILIATION_QUEUE.json`. It records the historical dataset-hash incident, isolated branch-integration classifications, Codex-owned runtime producer priorities, and B1/B2/BH-1 policy boundary. Every item is `DEFERRED_UNTIL_PHASE1_CLOSED`.

The recovered historical archive contains zero selected candidates and zero resolved outcomes. It cannot support profitability, fill-model, assignment-model, or feature-ablation promotion. The declared historical `datasetHash` remains unverified and no archived artifact or provenance was rewritten.

## Verification performed

Main at `52265ebe1bf9395c291bda9b9ea6f976f1f537a1`:

- lint: pass
- TypeScript check: pass
- unit tests: 2,858 passing, 0 failing, 15 skipped
- production build: pass
- security scan: pass, zero findings
- Git storage policy: pass
- historical regression registry: 24 passing, 0 failing, 0 unclassified
- premarket session simulator: 14 passing, 0 failing
- accelerated bounded soak: 391 completed cycles, 0 failures, 0 timeouts, 0 unhandled processes, 0 broker mutations
- unknown audit: 0 avoidable unknowns, 0 unresolved safety-critical unknowns, 0 unresolved Paper-entry unknowns
- Python AEGIS suite: 31 passing
- exact GitHub CI run `36325138320`: success

Latest source-bearing main at `2d6445cb9eeb5e8ff4210b59b853327e94e15e81`:

- TypeScript check: pass
- lint: pass
- unit tests: 2,865 passing, 0 failing, 15 skipped
- production build: pass
- security scan: pass, zero findings
- Git storage policy: pass
- all four Windows backup/process safety suites: pass
- V19 evidence certification: pass
- V20 evidence closure: pass with `CODE_SOLVABLE=[]`
- premarket certification: engineering pass, overall external-blocked
- exact GitHub CI run `36326674981`: success

Main worker hardening at `ab29f2ad5738fa3c734ddcf220c65521d072a2c1`:

- PowerShell bounded-process tests: pass
- local-worker wiring tests: pass
- PowerShell parser: pass
- lint and TypeScript check: pass
- unit tests: 2,855 passing, 0 failing, 15 skipped
- production build: pass
- security scan: pass, zero findings
- Git storage policy: pass

Command-5A isolated branch:

- unit tests: 2,912 passing, 0 failing, 15 skipped before final subprocess expansion
- focused Windows bounded-process tests: pass
- focused Command-5A worker wiring tests: pass
- PowerShell parser: pass
- TypeScript check: pass
- lint: pass
- security scan: pass, zero findings
- Git storage policy: pass
- current isolated head: `226fb7a3684a0d20c6e205bd5590c39d0d955785`
- focused Command-5A tests: 63 passing, 0 failing
- exact GitHub CI run `36325225336`: success

## Remaining governed sequence

When the external quota is restored, the next database attempt must start from the canonical four-probe recovery gate. The sequence remains:

1. verified pre-migration backup
2. isolated restore parity
3. missing migrations through exact source/ledger head
4. migration invariants
5. full 900-second soak
6. verified post-migration backup
7. second isolated restore parity
8. exact-current-main locked cutover
9. one real current-worker cycle
10. durable release identity, method provenance, T0, and deterministic replay proof

## Safety state

- `ORDER_SUBMISSIONS=0`
- `BROKER_MUTATIONS=0`
- `FOLLOWER_SUBMISSIONS=0`
- `MASTER_PAPER_EXECUTION_ENABLED=false`
- `FOLLOWER_PAPER_EXECUTION_ENABLED=false`
- `PAPER_PAUSE_NEW_ORDERS=true`
- `LIVE_AUTHORIZATION=NOT_GRANTED`
- `FIRST_PAPER_CANARY=OWNER_GATED`
- `READY_FOR_FIRST_PAPER=NO`
