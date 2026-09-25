# THETA zero-surprise PRE-VPS blocker matrix (COMMAND 4)

Built via a read-only fork audit of `docs/operations/THETA_IMPLEMENTATION_BOARD.md`
at main `e2d9fdc` ("V12 five-strategy and research-storage closure,
2026-09-25"), cross-referenced against this branch's own tracking. No
Production files were touched producing this matrix.

## Board's own current-state summary

Worker cut over 2026-09-24 to release `f737c76`, `MASTER_THETA_PAPER`,
new-risk `LOCKED`, reconciliation `GOOD`, zero positions/orders. "The
decision-critical UNKNOWN denominator is now `COMPLETE`, while runtime,
policy approval and empirical proof remain separate readiness checks." Q
remains the only Paper-facing branch; H/D stay research-only;
profitability remains empirically unproven. Non-negotiable per the board
itself: no forced order, no gate relaxation to increase trade count, no
worker cutover from write-recovery alone.

## Blocker matrix

| Blocker | Current state | Classification | Why |
|---|---|---|---|
| Database operability | `WRITES_RESTORED_NOT_RELEASE_READY` | CODEX_OWNED | Postgres runtime resilience -- named single-writer domain |
| First-Paper blocker-budget runtime observation | `VERIFIED_SOURCE_AWAITING_RUNTIME` -- needs a natural locked open-session run | CODEX_OWNED | Worker lifecycle / first-Paper gates |
| Bounded universe discovery | `POST_VWAP_FIX_REACHED_PROVIDER_FANOUT` -- real scan still timing out at Vercel's 300s limit | CODEX_OWNED | Execution/runtime infra |
| Bounded option-snapshot expiration scope | `DEPLOYED_NOT_RUNTIME_CLOSED` | CODEX_OWNED | Runtime/execution |
| Aiven transient availability | `ACTIVE_RUNTIME_BLOCKER` -- `POSTGRES_57P03` intermittent, root cause unestablished | CODEX_OWNED | Database pools -- named single-writer domain |
| Option contract executability (quote age/spread) | Real, now-measured funnel (see `THETA_PERFORMANCE_AND_REPLAY_RECEIPT_2026-09-23.md`); feed vs. scan-delay separation still open | FORWARD_DATA_REQUIRED | Needs open-session comparison only Codex can run |
| AEGIS stress (IV/spread) | **CLOSED this pass** -- real producers now exist (see Q-6 closure) | -- | Verified via COMMAND 1 |
| Schema-064 locked worker + IV Paper-plan gate | `PARTIAL_REAL_DB_PROOF` -- shell proof done, full broker/AEGIS/management cycle not yet observed | CODEX_OWNED | Worker lifecycle, canonical persistence |
| Prospective earnings / corporate-action negative assurance | Both `PROVIDER_LIMITED`/unproven | SHARED_REVIEW | Provider-semantics research is Claude-safe; the Paper-gate wiring is Codex-owned (already fails closed) |
| Management candidates (roll/CC discovery) | `VERIFIED_CI_NOT_RUNTIME` -- CI-proven, no running worker observation yet | CODEX_OWNED | Broker mutation path / PaperOrderCoordinator adjacent |
| Worker release (SHA mismatch) | Intentional, pending controlled cutover | CODEX_OWNED | Worker lifecycle -- named single-writer domain |
| Storage budget (Aiven research/TOAST) | `ACTIVE_STORAGE_BLOCKER` -- bootstrap budget breached | CODEX_OWNED (execution) / SHARED_REVIEW (classification research) | Migrations/canonical persistence are single-writer |
| Historical replay export / Q-10 | **CLOSED this pass** -- 8,605 real candidates, 3 sessions, already analyzed by Codex's own tooling | -- | See Q-10 closure |
| Empirical profitability | Insufficient real independent whole-chain outcomes | EMPIRICAL_RESEARCH_REQUIRED | Zero real trades exist; no design substitutes for real data |

## CLAUDE_SAFE_TO_IMPLEMENT items from this matrix

None remain unimplemented after this pass. The one real candidate
(running the false-reject analyzer against real replay data) turned out
to already be done by Codex's own independently-built tooling before this
matrix was even produced -- verified, not duplicated. The two self-
corrections made this pass (`historical-false-reject-analyzer.ts`'s
release-provenance gating, `wait-regret-dataset.ts`'s null-not-zero
rates) were real defects this matrix's own research surfaced while
cross-checking Codex's parallel work, not new scope from the matrix
itself.

## Everything else stays with Codex or requires real data

Every other row touches a named single-writer domain (worker lifecycle,
database pools, execution controls, broker mutation path, migrations) or
is blocked on real session accumulation only the running worker can
produce. No further Claude-side design work closes any of them faster.
