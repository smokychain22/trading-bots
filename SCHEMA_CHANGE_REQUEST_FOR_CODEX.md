# Schema change request for Codex — R1H item M

**STATUS: RESOLVED.** Codex landed `migrations/014_theta_runtime_persistence.sql`
on `main` (commit `0fd3c2a`, `origin/main@acdfeed` as of this refresh),
implementing all five originally-requested objects plus one improvement
this document did not think to ask for. No further schema action is
needed from this document. It is kept for historical record of what was
requested and why, and as the reference for what Claude's
`persistence-repositories.ts` interfaces must be checked against.

**Author:** Claude, on `claude/theta-r1-real-state`. **Owner of the actual
migration:** Codex, against `main` — Codex wrote and merged the real
migration; no migration file was ever created on this branch.

**REFRESHED 2026-09-11 (second refresh)** against `origin/main` at
`acdfeed63f181f53dc2bc9c85de4eba99cbd64cd` (read-only `git fetch`, no
rebase/merge). The first refresh (against `6fc33ed`, migrations 001-013)
classified all five requested objects as MISSING. That is now stale:
Codex's migration 014 (visible on `main` as of this refresh) supplies all
five.

## Classification summary (against origin/main@acdfeed, migrations 001-014)

| Requested object | Status | Notes |
|---|---|---|
| `FusionSnapshotRepository` → `trade.fusion_snapshot` | **ALREADY_EXISTS** | unchanged since the original request |
| `DecisionReceiptRepository` → `trade.decision` + `trade.decision_reason` | **ALREADY_EXISTS** | migration 014 additionally widened `trade.decision` (`aegis_action` now nullable, plus `runtime_selected_candidate_ref`/`policy_version`/`model_versions_json`/`fail_closed_reason`/`receipt_json` columns) — a genuine, welcome improvement over what was requested |
| `LifecycleEpisodeRepository` → `trade.economic_chain` | **ALREADY_EXISTS** | unchanged; migration 014 additionally added `trade.lifecycle_transition` (an append-only transition log this document never explicitly asked for — better than the bare episode table alone, since it makes every state change auditable, not just current state) |
| `ManagementDecisionReceiptRepository` → `trade.management_decision` | **ALREADY_EXISTS** (migration 014) | column-for-column match with this document's original proposal; append-only via `core.reject_immutable_mutation` as requested |
| `StrategyRouteRepository` → `trade.strategy_route` | **ALREADY_EXISTS** (migration 014) | matches this document's proposal; `UNIQUE(fusion_snapshot_id)` present as requested |
| `ShadowOpportunityRepository` → `trade.shadow_opportunity` | **ALREADY_EXISTS** (migration 014) | matches `shadowOpportunityEntrySchema` field-for-field, including the WAIT/wait_reason and Q_ZERO/recommended_quantity CHECK constraints this document asked for |
| `ManagementOpportunityRepository` → `trade.management_opportunity` | **ALREADY_EXISTS** (migration 014) | matches `managementOpportunityEntrySchema` field-for-field |
| `SchedulerCheckpointRepository` → `ops.scheduler_checkpoint` | **ALREADY_EXISTS** (migration 014) | matches this document's proposal, plus `correlation_key`/`max_attempts`/`next_run_at` columns this document did not request but which are a genuine improvement |

That is **five** requested persistence objects (`trade.management_decision`,
`trade.strategy_route`, `trade.shadow_opportunity`,
`trade.management_opportunity`, `ops.scheduler_checkpoint`) — an earlier
version of this document's summary line miscounted this as four; corrected
here.

## What Claude's persistence-repositories.ts should be checked against next

`src/theta/persistence-repositories.ts` (interfaces) and
`persistence-repositories-memory.ts` (in-memory reference implementation,
explicitly NOT production) were written against this document's proposed
shapes, before migration 014 existed. Now that the real schema exists,
the interfaces should be diffed against migration 014's actual column
names/types (e.g. `ops.scheduler_checkpoint` has `correlation_key`/
`max_attempts`/`next_run_at` that the TS `SchedulerCheckpointRecord`
does not yet model) before Codex builds the real Postgres-backed
repository implementation — this is a follow-up task, not yet done as of
this refresh, and is called out explicitly rather than assumed to already
match.

## Historical record: the original request (as first written, migrations 001-008)

The sections below are preserved for context on why each table was
requested — the actual schema Codex built (migration 014) is the living
source of truth, not this historical text.

<details>
<summary>Original per-table request detail (click to expand)</summary>

### 1. Management decisions (`trade.management_decision`)

`trade.decision` was designed around the new-risk OPEN/WAIT/PASS decision
shape (`selected_candidate_id`, `action_code` constrained to make sense
with `candidate_set_id`, no chain linkage). A management decision
(HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY for a CSP or covered-call leg;
ACCEPT_ASSIGNMENT/CLOSE_STOCK; RECOVERY_WAIT/SELL_STOCK/SELL_CC) is
structurally different: it always concerns an *existing* `chain_id`, it
carries a `holdAdvantage` scalar with no analogue in `trade.decision`, and
it needs to persist every alternative's utility breakdown, not just the
winner.

### 2. Strategy router eligibility (`trade.strategy_route`)

`trade.decision.strategy_branch` records which branch a decision *used*,
but nothing persisted the router's full eligibility sweep across all five
branches for a given `fusion_snapshot` — which branches were eligible,
which were rejected and why.

### 3. Shadow/management opportunity books (`trade.shadow_opportunity`, `trade.management_opportunity`)

Neither the new-risk shadow book nor the management opportunity book had
any persisted home — the single largest gap for OpportunityCaptureRate/
TradeRegret/WaitRegret/GateRegret/ManagementRegret/RollVsHoldRegret, none
of which is computable without a durable, append-only record of every
evaluated opportunity, not just the ones that became a `trade.decision`.
Kept as two tables (not one) since the two entry shapes are genuinely
different (single `evNet` vs. multi-alternative utilities).

### 4. Scheduler checkpoints (`ops.scheduler_checkpoint`)

No table anywhere supported the restart-safe scheduler's lease/heartbeat/
idempotency requirements — `ops.paper_execution_control`/`ops.
provider_verification`/`ops.paper_account_role_event` are all
single-purpose operational tables for unrelated concerns.

</details>
