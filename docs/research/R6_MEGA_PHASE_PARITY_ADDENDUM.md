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

## Real-evidence trigger run: `115285b..b64946f` (research export bridge)

Inspected on copy/research/export paths only. Six commits, all additive at
the schema level.

### DATASET_ABSENT confirmed by Codex's own handoff and export tool

`tools/theta-research-export.ts` (new) queries
`trade.candidate_point_in_time_evidence` for the newest evidence window and
throws `NO_POINT_IN_TIME_EVIDENCE_TO_EXPORT` / `NO_POINT_IN_TIME_EVIDENCE_IN_WINDOW`
when none exists. Codex's own 2026-09-12 HANDOFF.md entry states directly:
"No point-in-time rows exist yet, so the export command correctly reports a
data blocker and creates no artifact." No `research_exports/` directory
exists in this working tree (now also `.gitignore`d, confirming it is
Production-side-generated, not a checked-in fixture).

**`DATASET_ABSENT` stands. No dataset hash, no rows, nothing to load.**

### Canonical R4 direction-aware pricing is now independently enforced in TypeScript

`copy-engine-contract.ts` gained `directionAwarePriceDeterioration({direction,
masterPrice, followerPrice})` with `OrderCashflowDirection = "CREDIT"|"DEBIT"`
and the IDENTICAL sign convention this branch's Python
`compute_price_deterioration` already uses: CREDIT →
`masterPrice - followerPrice`, DEBIT → `followerPrice - masterPrice`,
positive = ADVERSE. Migration 022 persists `economic_direction`,
`master_execution_price`, `follower_observed_price`,
`price_deterioration_per_share` directly on `copy.follower_copy_event`.

Codex's own CLAUDE REVIEW note in `docs/HANDOFF.md` (2026-09-12) already
classifies this branch's Python economics as `RESEARCH_ONLY`: "The
direction-aware Python follower economics are RESEARCH_ONLY because the
same correction is now enforced by the canonical TypeScript planner." No
action needed on this branch beyond acknowledging the convergence -- the
Python module remains a research-side mirror, never Production authority,
per the standing ownership split.

### Roll legs: canonical vocabulary changed name, not shape

`ROLL_CSP`/`ROLL_CC` (rejected at persistence) were replaced by four
explicit actions: `ROLL_CSP_CLOSE`/`ROLL_CSP_OPEN`/`ROLL_CC_CLOSE`/
`ROLL_CC_OPEN`, with `master_copy_event_roll_lineage` requiring
`parent_master_copy_event_id` on every `*_OPEN` leg. This is the SAME
two-independent-legs invariant `evaluate_follower_roll` already encodes
(`ROLL_CLOSE_OLD`/`ROLL_OPEN_NEW`) -- naming differs, semantics match.
`CANONICAL_ACTION_TO_LIFECYCLE_EVENT` in `follower_copy_economics.py` still
maps the OLD six-action enum; this is now stale against the renamed
canonical actions.

**REQUIRED_CODEX_CHANGE: 0** (nothing Production needs from research).
**DEFERRED (research-side, non-blocking):** update
`CANONICAL_ACTION_TO_LIFECYCLE_EVENT`'s keys from `ROLL_CSP`/`ROLL_CC` to
the four explicit `*_CLOSE`/`*_OPEN` actions the next time this module is
touched for a substantive reason -- not done here per the "no busywork
while DATASET_ABSENT" instruction, since it changes no behavior (the old
keys were already unreachable placeholders, not consumed by any dataset
row).

**`PARITY_STILL_VALID` = YES. `REQUIRED_CODEX_CHANGE` count for this run: 0.**

## Root-cause repair run: adopting Codex's port-time fixes (`b64946f..281b3f9`)

Canonical main advanced again mid-run (six commits: Optionomics flow
evidence, virtual shadow trader, provider entitlement audit). Per Codex's
own `docs/HANDOFF.md` (2026-09-12, "Optionomics evidence closure and
research autopilot"): **"The empirical pipeline was selectively ported
from Claude with dataset-hash, null-outcome, and branch-lineage
repairs."** Main now carries `empirical_pipeline.py`, `experiment_
registry.py`, `production_export_loader.py`, `dataset_contracts.py`,
`dataset_readiness.py`, and `research_targets.py` as a curated subset --
not a merge of this branch. Diffing HEAD against that ported subset found
three real defects Codex's repair introduced fixes for, all now applied
here too (this branch is the source of truth for research engineering;
these were genuine bugs, not stylistic drift):

1. **UNKNOWN-to-zero in sufficiency counting** (`empirical_pipeline.py`):
   `(e.whole_chain_net_pnl or 0) > 0` / `<= 0` coerced a RESOLVED-but-
   unknown-PnL row into a zero-PnL outcome, silently counting it as a
   loss. This is the exact failure mode this codebase is built to forbid.
   Fixed to filter to `whole_chain_net_pnl is not None` first, then bucket
   only labeled outcomes.
2. **Fabricated branch lineage in slicing** (`empirical_pipeline.py`):
   every episode was grouped under `config.strategy_branch` regardless of
   its own actual branch, because the v1 outcome row carries no branch
   field of its own -- an artifact of the config being reused as if it
   were per-row data. `branch_slices` now stays empty until a defensible
   per-episode branch join exists in the export, rather than fabricating
   one.
3. **CLI dataset-hash key mismatch** (`empirical_pipeline.py`): the CLI
   read `raw_export.get("dataset_hash")` (snake_case), but the real
   export (and every fixture) uses `datasetHash` (camelCase, mirroring
   the TypeScript schema). Fixed.
4. **Hash-identity `exportedAt` inclusion** (`production_export_loader.py`):
   this branch's recomputed hash still included `exportedAt` in the
   signed object, but Codex's `point-in-time-evidence.ts` fix (previous
   run's addendum) excludes it from dataset IDENTITY as pure file-creation
   provenance. Two exports of the identical immutable window would
   otherwise hash differently. Fixed to match exactly; all six test
   fixtures that independently recomputed a tampered hash updated to the
   same convention, plus the same `test_export_timestamp_is_provenance_
   not_dataset_identity` regression test Codex added.

**Not adopted (cosmetic, not a defect):** `dataset_readiness.py`'s
`run_empirical_program` fingerprint on main now calls `production_export_
loader.canonical_json`/`sha256_hex` instead of `reproducibility._canonical_
json`/`_sha256_hex`. Both produce identical output for this call's actual
input (a dict of plain strings/enum values -- no floats, so the two
implementations' JS-number-formatting divergence never triggers). This is
a dedup/cleanup, not a correctness fix, so left as-is per the no-busywork
rule while `DATASET_ABSENT`.

**947 -> 948 Python tests** (net +1: the new `test_export_timestamp_is_
provenance_not_dataset_identity` regression, matching main's own addition).
Full suite passes. Security scan: 0 findings.

**`DATASET_ABSENT` still stands** -- these are engineering repairs to code
that has never yet run against a real dataset, found here specifically
BECAUSE Codex's port exercised the same logic against its own fixtures.
`PARITY_STILL_VALID` = YES. `REQUIRED_CODEX_CHANGE` count for this run: 0.
