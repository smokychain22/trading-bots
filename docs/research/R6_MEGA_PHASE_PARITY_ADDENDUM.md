# R6 Mega-Phase Parity Addendum

Inspected `db0f17a..origin/main` (through `38f1f6e`) for research-contract-
relevant diffs only, per the pace rule -- not a full re-read of migration
018 or the already-ported R6G/R6H work (Codex's own
`docs/research/THETA_R6G_PRODUCTION_PARITY.md` already records that both
were PORTED/approved).

## Migration 019 (`019_real_shadow_evidence_activation.sql`)

Two NEW tables, both additive-only (no change to any column my existing
`dataset_contracts.py`/`production_export_loader.py` already consume):
`research.theta_shadow_scan_run` (cross-symbol scan completeness/
membership metadata) and `research.theta_execution_observation_job`
(+1m/+5m/+30m/EOD deterministic quote-observation scheduling).

**PARITY_STILL_VALID** for every existing field/enum/hash convention this
branch already models. No `dataset_contracts.py`/`production_export_
loader.py`/`dataset_readiness.py` rewrite performed -- per the explicit
"do not rebuild" pace rule.

**Deferred, non-blocking:** dedicated Python dataclasses for `theta_
shadow_scan_run`/`theta_execution_observation_job` were NOT added this
phase -- they are not yet part of `postgres-dataset-export.ts`'s own
SELECT list (confirmed by re-reading that file's diff -- unchanged), so a
real dataset export does not carry them yet. Adding Python types for
tables the export itself doesn't surface would be speculative, not
schema-parity work.

## Firewall parity: Codex extended `forbiddenFeatureKeys`

`point-in-time-evidence.ts`'s diff added five bare terms: `outcome`,
`future`, `result`, `realizedreturn`, `pnl` (two of which -- `outcome`/
`result` -- this branch's R6H firewall already had). The three new bare
terms (`future`, `pnl`, `realizedreturn`) are now unioned into
`production_export_loader.py`'s `_FORBIDDEN_FEATURE_KEYS` for continued
parity. All 14 loader tests still pass unchanged.

## Real dataset status (confirmed from `docs/HANDOFF.md`'s own 2026-09-12
## R6H entry, Codex's own words)

> "Neon reports one complete SHADOW context, zero broker orders, and zero
> broker fills." "Point-in-time rows, shadow candidates, subsequent BBO
> observations, and resolved labels remain empty." "The market is closed
> and no genuine decision-time candidate scan has run."

**`DATASET_ABSENT`.** No export exists to load. This is the exact
condition the R6 mega-phase directive names as the trigger to fast-forward
into R3/R4/R5 quant responsibilities rather than wait idle -- see this
session's R3/R4/R5 deliverables below.

## Closure-run re-check: `38f1f6e..103725f` (migration 020 + local worker)

Inspected only research-contract-relevant paths. Two commits, both
additive and non-semantic for research contracts:

1. **Migration 020 (`020_local_worker_runtime.sql`)** creates
   `ops.runtime_worker_status` and `ops.runtime_worker_lease` -- worker
   lease/heartbeat/health tables in the `ops` schema, with zero overlap
   with any research evidence table (`trade.candidate_*`,
   `market.execution_quote_observation`, `research.theta_*`). No field
   this branch models changed. **PARITY_STILL_VALID.**

2. **`src/research/r6-readiness.ts`** gained `marketSessions`,
   `quoteObservations`, `invalidQuoteRate`, `providerFailureRate` and
   `observationMissedRate`. Notably, the first three are the SAME quality
   dimensions this session's `empirical_pipeline.py::DataQualityReport`
   computes independently (`sessions`, `execution_observations`,
   `invalid_quote_rate`) -- convergent, not conflicting. **PARITY_STILL_
   VALID.**

**OPTIONAL_CODEX_ENHANCEMENT (not required, nothing is wrong today):**
`providerFailureRate` and `observationMissedRate` derive from
`research.theta_shadow_scan_member` and
`research.theta_execution_observation_job`, neither of which appears in
`postgres-dataset-export.ts`'s own SELECT list. They are therefore
computable DB-side (where Codex already computes them) but NOT from a
dataset export. If an export-side audit should ever report those two
rates, the export would need to carry those two tables. This is a
coverage preference, not a mathematical defect -- recorded here rather
than raised as a `REQUIRED_CODEX_CHANGE`.

**`REQUIRED_CODEX_CHANGE` count for this closure run: 0.**

## Bug-fix run re-check: `103725f..115285b` (copy engine + migration 021)

Three canonical commits, inspected on copy/research/export paths only.

### Migration 021 (`021_disabled_copy_planning.sql`) + `postgres-disabled-copy-planner.ts`

Canonical Production now requires, at the database level, exactly the
invariants this branch's R4 research contract asserts:

| Canonical constraint | Research equivalent | Status |
|---|---|---|
| `master_copy_event_requires_broker_confirmation` (FILL or LIFECYCLE_ACTIVITY) | `master_confirmation_sufficient` | **NEWLY ADDED this run** |
| `master_copy_event_explicit_roll_legs` CHECK (`action NOT IN ('ROLL_CSP','ROLL_CC')`) + planner's `ROLL_REQUIRES_EXPLICIT_CLOSE_AND_OPEN_EVENTS` | `evaluate_follower_roll` (two independent legs) | already held; now cross-referenced by `CANONICAL_ROLL_ACTIONS_REJECTED_AT_PERSISTENCE` |
| `MASTER_FILL_REQUIRED_BEFORE_COPY` / `MASTER_BROKER_CONFIRMATION_REQUIRED` | same reason codes reused verbatim | aligned |
| `copyOutcomeSchema` (COPY_FULL / COPY_REDUCED / SKIP_ACCOUNT / BLOCKED / RECONCILE / DUPLICATE_NOOP) | `to_canonical_copy_outcome` maps the research `CopyDecision` onto it | **NEWLY ADDED this run** — research does not keep a competing outcome vocabulary |
| `copyActionSchema` (14 actions) | `CANONICAL_ACTION_TO_LIFECYCLE_EVENT` | **NEWLY ADDED this run** |
| `execution_authorized=false` on every persisted follower intent | research contract activates nothing, ever | aligned |
| Own-account capacity only (`authorizedCapitalRemaining`, `maxContractsPerPosition`) | `compute_follower_quantity` (own capacity, master qty only as an upper bound) | aligned |
| `followerAssigned === false` ⇒ `ASSIGNMENT_DIVERGED` | `follower_may_participate` refuses assignment without the follower's own short | aligned |

**Deliberate non-adoption:** Production's `expectedSlippagePerContract` /
`maxSlippagePerContract` pair is an execution-engine input. Research keeps
price deterioration as a *measured, signed* quantity with a
caller-supplied limit and does NOT model a follower fill probability or an
expected slippage — that remains future Paper TCA evidence.

### `115285b` — Codex removed the superseded readiness subset

Codex deleted `ResearchPaperReadinessCheck`/`research_ready_for_paper`
from `dataset_readiness.py` on canonical main. This branch has now removed
the same helper and its tests, so exactly ONE R7 entry point exists:
`research_evidence_packet.research_ready_for_paper` (14 dimensions).

### `3bebd33` — forbidden-feature-key union

Codex added `future`, `pnl`, `realizedreturn` to
`production_export_loader.py`'s `_FORBIDDEN_FEATURE_KEYS` — the identical
three terms this branch had already unioned in the previous run.
Convergent; no conflict.

**`PARITY_STILL_VALID` = YES. `REQUIRED_CODEX_CHANGE` count for this run: 0.**
