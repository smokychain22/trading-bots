# Schema change request for Codex — R1H item M

**Author:** Claude, on `claude/theta-r1-real-state`. **Owner of any actual
migration:** Codex, against `main`. This document requests changes only —
no migration file has been created on this branch, per the standing rule
that Claude does not create conflicting production migrations while Codex
is actively modifying `main`.

**REFRESHED 2026-09-11** against `origin/main` at `6fc33ed`
(`migrations/001-013`, read-only `git fetch` — no rebase/merge performed).
The original version of this document was checked only against
`migrations/001-008`; Codex has since landed 009-013 (private Paper API
keys, paper account roles, optional follower limits, explicit/null-guarded
option position intent) — none of which touch `trade.management_decision`,
`trade.strategy_route`, `trade.shadow_opportunity`,
`trade.management_opportunity`, or `ops.scheduler_checkpoint`. Every
classification below was re-verified against the actual fetched
`origin/main` tree, not assumed carried over from the stale version.

TS-side repository interfaces already exist at
`src/theta/persistence-repositories.ts` (with an in-memory reference
implementation at `persistence-repositories-memory.ts`, tests at
`tests/persistence-repositories.test.ts`) — this document is what those
interfaces need from the real schema to have a genuine Postgres-backed
implementation, not a redesign of them.

## Classification summary (against origin/main@6fc33ed)

| Requested object | Status | Notes |
|---|---|---|
| `FusionSnapshotRepository` → `trade.fusion_snapshot` | **ALREADY_EXISTS** | unchanged across 009-013 |
| `DecisionReceiptRepository` → `trade.decision` + `trade.decision_reason` | **ALREADY_EXISTS** | unchanged across 009-013 |
| `LifecycleEpisodeRepository` → `trade.economic_chain` | **ALREADY_EXISTS** | unchanged across 009-013 |
| `ManagementDecisionReceiptRepository` → `trade.management_decision` | **MISSING** | no such table anywhere in 001-013 |
| `StrategyRouteRepository` → `trade.strategy_route` | **MISSING** | no such table anywhere in 001-013 |
| `ShadowOpportunityRepository` → `trade.shadow_opportunity` | **MISSING** | no such table anywhere in 001-013 |
| `ManagementOpportunityRepository` → `trade.management_opportunity` | **MISSING** | no such table anywhere in 001-013 |
| `SchedulerCheckpointRepository` → `ops.scheduler_checkpoint` | **MISSING** | no such table anywhere in 001-013; `ops.paper_execution_control`/`ops.provider_verification`/`ops.paper_account_role_event` (010) exist but serve unrelated concerns, not a lease/heartbeat model |

No requested object is **PARTIALLY_EXISTS** or **SUPERSEDED** — Codex's
009-013 work (customer/copy/account-role/option-intent concerns) is
orthogonal to everything this document requests; nothing here duplicates
persistence Codex has already built.

Incidental, non-blocking observation: `migrations/012` and `013` added
`trade.order_intent.position_intent` (explicit long/short position intent
on an order, with a null-guard constraint). This has no interaction with
any table requested below — noted only so Codex can see it was checked,
not overlooked.

## Already schema-compatible (no change requested)

- `FusionSnapshotRepository` → `trade.fusion_snapshot`. Compatible as-is.
- `DecisionReceiptRepository` (new-risk path) → `trade.decision` +
  `trade.decision_reason`. Compatible as-is.
- `LifecycleEpisodeRepository` → `trade.economic_chain`. Compatible as-is
  (already has `chain_id`, `lifecycle_state`, `opened_at`, `closed_at`).

## 1. Management decisions have no compatible table — MISSING

`trade.decision` was designed around the new-risk OPEN/WAIT/PASS decision
shape (`selected_candidate_id`, `action_code` constrained to make sense
with `candidate_set_id`, no chain linkage). A management decision
(HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY for a CSP or covered-call leg;
ACCEPT_ASSIGNMENT/CLOSE_STOCK; RECOVERY_WAIT/SELL_STOCK/SELL_CC) is
structurally different: it always concerns an *existing* `chain_id`, it
carries a `holdAdvantage` scalar with no analogue in `trade.decision`, and
it needs to persist every alternative's utility breakdown
(`certainCashflow`/`estimatedFutureValue`/`tailRiskPenalty`/
`capitalDaysPenalty`/`executionPenalty`/`utility`), not just the winner.

**Requested table:** `trade.management_decision`

| column | type | nullable | invariant |
|---|---|---|---|
| `management_decision_id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | no | |
| `fusion_snapshot_id` | `uuid REFERENCES trade.fusion_snapshot(fusion_snapshot_id)` | no | |
| `chain_id` | `uuid REFERENCES trade.economic_chain(chain_id)` | no | every management decision is about an existing chain |
| `lifecycle_state_at_decision` | `trade.lifecycle_state` (existing enum) | no | the state the chain was in when this decision was evaluated |
| `route` | `text CHECK (route IN ('SHORT_PUT','ASSIGNMENT_PENDING','STOCK_RECOVERY','COVERED_CALL'))` | no | which K1-K4 orchestrator produced this |
| `selected_action` | `text` | yes | null only for a genuinely inconclusive (not fail-closed) evaluation |
| `hold_advantage` | `numeric(24,10)` | yes | null when HOLD's own utility is unknown (management_action_value.py's own convention) |
| `valuations_json` | `jsonb NOT NULL` | no | array of `{action, feasible, certainCashflow, estimatedFutureValue, tailRiskPenalty, capitalDaysPenalty, executionPenalty, utility, reasons}` |
| `aegis_state` | `core.aegis_action` (existing enum) | yes | |
| `execution_quality_acceptable` | `boolean` | yes | |
| `fail_closed_reason` | `text` | yes | non-null iff the pipeline failed closed |
| `policy_version` | `text` | no | |
| `model_versions_json` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | no | |
| `decided_at` | `timestamptz` | no | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | no | |

Index: `(chain_id, decided_at DESC)`. Uniqueness: none required beyond the
primary key (a chain may be re-evaluated many times before an action is
actually taken). Append-only via the existing
`core.reject_immutable_mutation` trigger, matching every other `trade.*`
table's discipline.

Lifecycle relationship: one `economic_chain` has zero-to-many
`management_decision` rows over its lifetime (one per management-cycle
evaluation, not one per state transition — most evaluations reaffirm HOLD
and no transition happens).

**Idempotency requirement:** `management_decision_id` should be caller-
supplied as a deterministic value derived from `(chain_id, decided_at,
route)` (mirroring `scheduler-engine.ts`'s `deterministicJobId` pattern),
not `gen_random_uuid()`'s default — so a retried write after a crash
inserts the same row rather than a duplicate. `gen_random_uuid()` is kept
as the column default only for a caller that has no natural deterministic
key; Codex should decide whether to keep the random default or require
the deterministic id at the application layer.

**Why the existing schema cannot represent this:** `trade.decision` has
no `chain_id` column at all (it links to `candidate_set_id`/
`selected_candidate_id`, which only make sense for a brand-new position,
not a management action on an already-open one), no field for
`hold_advantage`, and no `jsonb` column shaped to hold a multi-alternative
utility breakdown — extending `trade.decision` to serve both purposes
would either force nullable columns that are meaningless for one of the
two decision kinds, or silently blur the "new risk" vs. "manage existing
risk" distinction this whole item K architecture exists to keep separate.

## 2. No table for the strategy router's OWN eligibility reasoning — MISSING

`trade.decision.strategy_branch` records which branch a decision *used*,
but nothing persists the router's full eligibility sweep across all five
branches (THETA_CONVENTIONAL/THETA_HOLD_STRIKE/THETA_DEFINED_RISK/
THETA_RECOVERY/THETA_CC) for a given `fusion_snapshot` — i.e., which
branches were eligible, which were rejected and why, per the R1 roadmap's
explicit requirement that the router "return explicit reasons for
selected, rejected, WAIT, Q=0."

**Requested table:** `trade.strategy_route`

| column | type | nullable | invariant |
|---|---|---|---|
| `strategy_route_id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | no | |
| `fusion_snapshot_id` | `uuid REFERENCES trade.fusion_snapshot(fusion_snapshot_id)` | no | |
| `evaluated_at` | `timestamptz` | no | |
| `branch_eligibility_json` | `jsonb NOT NULL` | no | array of `{branch, eligible, reasonCodes}`, one entry per branch, always all five even when most are ineligible |
| `selected_branch` | `core.strategy_branch` (existing enum) | yes | null for a cycle where no branch was eligible |
| `policy_version` | `text` | no | |

Index: `(fusion_snapshot_id)`. Uniqueness:
`UNIQUE(fusion_snapshot_id)` — one router evaluation per snapshot, which
also gives idempotent writes for free (`INSERT ... ON CONFLICT
(fusion_snapshot_id) DO NOTHING`, since a snapshot's router evaluation is
deterministic given the same inputs — a retried write is a no-op, never a
duplicate row).

**Why the existing schema cannot represent this:** `trade.decision.
strategy_branch` records only the ONE branch a decision ultimately used
— it has no room for "THETA_CC was ineligible because no stock is held"
or "THETA_DEFINED_RISK was eligible but scored lower," which the roadmap
explicitly requires the router to expose. A `decision` row also does not
exist at all in cycles where every branch is ineligible (nothing gets
proposed), so there would be no row to attach that reasoning to even if
`trade.decision` had the columns.

## 3. No table for the shadow opportunity book (new-risk or management) — MISSING

Neither `shadow-opportunity-book.ts`'s new-risk entries (ACCEPTED/
REJECTED/WAIT/PASS/AEGIS_REJECTED/Q_ZERO/EXECUTION_REJECTED) nor
`management-opportunity-book.ts`'s management entries have any persisted
home. This is the single largest gap for the empirical work the roadmap
asks for (OpportunityCaptureRate/TradeRegret/WaitRegret/GateRegret/
ManagementRegret/RollVsHoldRegret) — none of it is computable without a
durable, append-only record of every evaluated opportunity, not just the
ones that became a `trade.decision`.

**Requested tables:** `trade.shadow_opportunity` and
`trade.management_opportunity` (kept as two tables, not one, since the two
entry shapes are genuinely different — single `evNet` vs. multi-
alternative utilities — exactly as the two TS contract files are kept
separate rather than unified into one schema that would blur that
distinction).

`trade.shadow_opportunity` columns mirror
`shadowOpportunityEntrySchema` field-for-field (`opportunity_id`,
`snapshot_id` → FK `trade.fusion_snapshot`, `underlying`,
`contract_symbol`, `strategy_branch`, `ev_net`, `tail_adjusted_ev`,
`return_per_capital_day`, `capital_required`, `uncertainty`,
`ownership_snapshot_id`, `regime_snapshot_id`, `aegis_state`,
`recommended_quantity`, `execution_quality_acceptable`, `outcome`,
`wait_reason`, `rejection_category`, `reasons_json`, `policy_version`,
`model_versions_json`, `eventual_outcome_known`, `eventual_realized_pnl`).

`trade.management_opportunity` columns mirror
`managementOpportunityEntrySchema` field-for-field (`entry_id`,
`snapshot_id`, `chain_id` → FK `trade.economic_chain`,
`lifecycle_state`, `route`, `alternatives_json`, `selected_label`,
`aegis_state`, `execution_quality_acceptable`,
`unknown_input_reason_codes_json`, `policy_version`,
`model_versions_json`, `fail_closed_reason`, `eventual_outcome_known`,
`eventual_realized_pnl`).

Both append-only (a later empirical pass fills `eventual_outcome_known`/
`eventual_realized_pnl` via a **new row**, never an UPDATE to the
original entry, consistent with every other `trade.*` table's
immutability discipline).

**Idempotency requirement:** `opportunity_id`/`entry_id` should be
caller-supplied deterministic values (already the case in
`shadow-opportunity-book.ts`/`management-opportunity-book.ts`'s own
builders), with a `UNIQUE` constraint on the id column so a retried write
after a crash is a no-op, not a duplicate observation.

**Why the existing schema cannot represent this:** there is no table
anywhere in `trade.*` for an opportunity that was EVALUATED but never
became a `trade.decision` at all (a WAIT, a PASS, a Q_ZERO, an
AEGIS-rejected candidate) — `trade.candidate`/`trade.candidate_reason`
come closest, but they only exist inside a `candidate_set`, which itself
only exists when the new-risk pipeline actually reached candidate
generation; a management-path evaluation (HOLD/CLOSE/ROLL/etc.) has no
`candidate_set` concept at all. Regret analysis specifically needs the
opportunities that were evaluated and NOT converted into a candidate/
decision, which is exactly the population `trade.candidate`/
`trade.decision` cannot hold.

## 4. No table for scheduler checkpoints (R1I) — MISSING

No table anywhere in `migrations/001-013` supports the restart-safe
scheduler's lease/heartbeat/idempotency requirements.

**Requested table:** `ops.scheduler_checkpoint` (in the `ops` schema,
alongside `ops.paper_execution_control`/`ops.provider_verification`,
since this is operational/runtime state, not trading truth)

| column | type | nullable | invariant |
|---|---|---|---|
| `job_id` | `text PRIMARY KEY` | no | deterministic correlation id (see `scheduler.ts`) — never a random id, so retries are idempotent |
| `job_kind` | `text` | no | e.g. `RECONCILIATION`, `POSITION_MANAGEMENT`, `EXPIRATION_MANAGEMENT`, `PENDING_ORDER_RECONCILIATION`, `WAIT_RECHECK`, `OPPORTUNITY_SCAN` |
| `lease_owner` | `text` | no | |
| `lease_expires_at` | `timestamptz` | no | |
| `last_heartbeat_at` | `timestamptz` | no | |
| `attempt` | `int NOT NULL DEFAULT 0` | no | bounded-retry counter |
| `status` | `text CHECK (status IN ('PENDING','LEASED','COMPLETED','FAILED','ABANDONED'))` | no | |
| `last_error` | `text` | yes | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | no | |

This table is **mutable by design** (lease state, unlike trading truth,
is expected to be updated in place) — it should NOT go through
`core.reject_immutable_mutation`. Index:
`(status, lease_expires_at)` for the expired-lease-recovery scan.
Uniqueness: primary key on `job_id` already enforces one row per
deterministic job identity, which is what makes lease acquisition a
straightforward `UPDATE ... WHERE job_id = $1 AND (status != 'LEASED' OR
lease_expires_at <= now())` compare-and-swap.

**Idempotency requirement:** `job_id` IS the idempotency key
(`deterministicJobId(jobType, correlationKey)` in
`scheduler-engine.ts`) — this table's entire design exists to make
retries safe, not merely to log them.

**Why the existing schema cannot represent this:** `ops.
paper_execution_control`/`ops.provider_verification`/`ops.
paper_account_role_event` (010) are all single-purpose operational tables
for unrelated concerns (execution gating, provider readiness, account
role transitions) with no lease/lease-expiry/attempt-count/heartbeat
columns at all — none of them are a job dispatch table, and repurposing
any of them would conflate unrelated operational domains into one table.

## Summary of requested additions (all MISSING, none PARTIALLY_EXISTS/SUPERSEDED)

- `trade.management_decision` (new table)
- `trade.strategy_route` (new table)
- `trade.shadow_opportunity` (new table)
- `trade.management_opportunity` (new table)
- `ops.scheduler_checkpoint` (new table, mutable, not append-only)

No changes requested to any existing table. Codex decides the actual
migration numbering (next would be `014`), ordering, and whether these
are one migration or several.

## Separately: source-file divergence noticed during this refresh (not a schema matter, flagging anyway)

While fetching `origin/main` read-only to refresh this document, a few
`src/theta/*.ts` files were found to have diverged independently between
this branch and `main` since the shared ancestor (`main` has its own
evolution of calendar/session wiring; this branch has additionally
layered event-state/corporate-actions/cross-symbol-selection/the
multiplier fix on top of an earlier version of the same files) —
`theta-shadow-cycle.ts`, `theta-shadow-once.ts`, `alpaca-provider.ts`,
`option-chain-ingestion.ts`, and (a smaller, logic-level difference)
`aegis-derivation.ts`. This is a **TypeScript source merge concern for
Codex to reconcile when integrating this branch**, not a database schema
matter — noted here only because it was discovered in the same read-only
pass and Codex asked for the fetch to inform exactly this kind of
comparison. See the accompanying handoff message for the full list.
