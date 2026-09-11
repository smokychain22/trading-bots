# Schema change request for Codex — R1H item M

Status: accepted with production constraints in migration `014_theta_runtime_persistence.sql`. The request remains as review provenance. The migration also adds an append-only lifecycle-transition table and stronger JSON/state invariants.

**Author:** Claude, on `claude/theta-r1-real-state`. **Owner of any actual
migration:** Codex, against `main`. This document requests changes only —
no migration file has been created on this branch, per the standing rule
that Claude does not create conflicting production migrations while Codex
is actively modifying `main`.

Checked against the current canonical schema (`migrations/001-008`) before
writing this. TS-side repository interfaces already exist at
`src/theta/persistence-repositories.ts` (with an in-memory reference
implementation at `persistence-repositories-memory.ts`, tests at
`tests/persistence-repositories.test.ts`) — this document is what those
interfaces need from the real schema to have a genuine Postgres-backed
implementation, not a redesign of them.

## Already schema-compatible (no change requested)

- `FusionSnapshotRepository` → `trade.fusion_snapshot`. Compatible as-is.
- `DecisionReceiptRepository` (new-risk path) → `trade.decision` +
  `trade.decision_reason`. Compatible as-is.
- `LifecycleEpisodeRepository` → `trade.economic_chain`. Compatible as-is
  (already has `chain_id`, `lifecycle_state`, `opened_at`, `closed_at`).

## 1. Management decisions have no compatible table

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

## 2. No table for the strategy router's OWN eligibility reasoning

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
`UNIQUE(fusion_snapshot_id)` — one router evaluation per snapshot.

## 3. No table for the shadow opportunity book (new-risk or management)

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

## 4. No table for scheduler checkpoints (R1I)

No table anywhere in `migrations/001-008` supports the restart-safe
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

## Summary of requested additions

- `trade.management_decision` (new table)
- `trade.strategy_route` (new table)
- `trade.shadow_opportunity` (new table)
- `trade.management_opportunity` (new table)
- `ops.scheduler_checkpoint` (new table, mutable, not append-only)

No changes requested to any existing table. Codex decides the actual
migration numbering/ordering and whether these are one migration or
several.
