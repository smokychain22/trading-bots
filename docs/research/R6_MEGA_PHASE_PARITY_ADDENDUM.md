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

## Provider/mechanism research review: `d9e13f9..605f6dd`

Three commits: Paper execution/lifecycle engineering closure (migration 024,
`trusted-option-quote.ts`, command assembly/orchestrator, order store) and
six new research documents (`THETA_OPTIONOMICS_DATA_MAP.md`,
`THETA_OPTIONOMICS_FEATURE_CATALOG.md`, `THETA_QUANTWHEEL_TEARDOWN.md`,
`THETA_QUANTWHEEL_HYPOTHESES.md`, `THETA_ALERTSIFY_COMPETITOR_MAP.md`,
`THETA_EXTERNAL_MECHANISM_MATRIX.md`).

**Execution engineering: `NO_RESEARCH_IMPACT`.** Migration 024 adds
`quote_source`/`quote_feed`/`quote_content_hash` to `trade.order_intent` --
confirmed absent from `point-in-time-evidence.ts`'s and
`postgres-dataset-export.ts`'s SELECT lists, so this branch's dataset
contracts/loader are unaffected. `trusted-option-quote.ts`'s
`assessTrustedOptionQuote` is upstream of order placement, not a dataset
row shape. `first-paper-order-readiness.ts`/`r7-phase-status.ts` gained an
OPERATIONAL R7 gate (`R7_FULL_PHASE`, submission/management/lifecycle-path
readiness) -- this is Codex's execution-readiness receipt (can Production
mechanically submit an order safely), a different R7 facet from this
branch's `research_evidence_packet.research_ready_for_paper` (does the
strategy have positive empirical evidence). No naming collision, no
overlap, no conflict.

**Research documents: reviewed, not duplicated.** Codex's six new docs are
disciplined and already encode the standing invariants this branch
enforces in code: `THETA_QUANTWHEEL_TEARDOWN.md`/`_HYPOTHESES.md`
explicitly reject "positive roll credit = success," "annualized yield
flatters small credits," and "GEX level/sweep size establishes expectancy
by itself" -- the exact assumptions this run's directive named to attack.
`THETA_ALERTSIFY_COMPETITOR_MAP.md`'s adopted mechanisms (master-fill-first,
deterministic lineage IDs, cashflow-direction-aware slippage guards) match
this branch's `follower_copy_economics.py` (`master_confirmation_sufficient`,
canonical `copyEventId`, `CashflowDirection`) with no gap found.
`THETA_QUANTWHEEL_HYPOTHESES.md`'s 9 mechanisms (put-wall distance,
gamma-flip, Vanna, Charm, expected-move-relative strikes, Real Cost, roll
frontier, equity released, per-ticker chain accounting) are genuinely NEW
structural/GEX-family mechanisms not present in this branch's 14-hypothesis
registry (`quant/research/data/hypotheses.json`) -- no duplication found,
and none added, since every one is `INSUFFICIENT_DATA`/`TEST CONTRACT
READY` pending real data, and `experiment_registry.py`'s existing generic
`EXPERT_PRIOR` ablation family is sufficient to hold them until a specific
experiment is actually eligible to run (adding named experiment IDs now
would be architecture-building against `DATASET_ABSENT`, which this run's
directive forbids).

**Minor, non-blocking observation (not a `REQUIRED_CODEX_CHANGE`):**
`THETA_OPTIONOMICS_FEATURE_CATALOG.md`'s experiment-outcome vocabulary
(`KEEP`/`KEEP_CONDITIONALLY`/`REMOVE`/`REJECT`/`INSUFFICIENT_DATA`) omits
`CHALLENGER` and `RESEARCH_ONLY`, which this branch's `champion_
challenger.py`/`promotion_checker.py` and prior directives both use. Worth
aligning next time that document is touched substantively; not raised as a
required change since it is a documentation vocabulary gap, not a contract
defect.

**`DATASET_ABSENT` still stands.** No `research_exports/` artifact exists.
`PARITY_STILL_VALID` = YES. `REQUIRED_CODEX_CHANGE` count for this run: 0.

## Adversarial review + loss-taxonomy build: `f8a3c11..66b3f7d`

One canonical commit reviewed (`66b3f7d`, "preserve quote age and uncertain
economics") plus Codex's own `docs/THETA_PROFITABILITY_CLOSURE_REVIEW_
2026-09-13.md`, which independently performed the identical adversarial
review this session's directive asked for and found three real defects,
all already fixed:

1. **Quote staleness laundering**: freshness previously checked only
   `asOf` against `maximumAgeMs`; a stale provider quote wrapped in a
   fresh ingestion timestamp could pass. Now every one of provider/
   ingestion/as-of timestamps is checked, plus a `providerTime <=
   ingestionTime` sequence invariant and validation that the age policy
   itself isn't garbage (NaN/negative).
2. **Array/object-to-number coercion**: `Number([5])` evaluates to `5` and
   `Number([])` to `0` in JS -- `asFiniteNumberOrNull` previously ran
   `Number(value)` on anything non-null/undefined, so an array-wrapped
   numeric field would silently coerce. Now restricted to `typeof value
   === 'number' | 'string'` first, with a strict decimal regex for
   strings.
3. **Certain-P&L fabrication**: `certainEconomicPnl` previously returned
   `wholeChainPnl` (a pre-trade MARK) for `CLOSE_FULL`/`CLOSE_CC`/
   `SELL_STOCK` as if it were a confirmed liquidation result. Fixed to
   always `null` -- a mark is not a fill price plus realized costs.

All three are exactly the class of defect this run's directive asked
Claude to hunt for adversarially (UNKNOWN handling, certainty
fabrication, unit/type coercion). Independently re-derived and confirmed
correct; no residual gap found on inspection. **No `REQUIRED_CODEX_CHANGE`
produced -- Codex's own repair already closes all three.**

### Math cross-check against this branch's existing formulas

Verified this branch's `management_policy.management_utility` already
implements the directive's `Q(a|s)` exactly: `remaining_ev - λ·tail_risk -
κ·capital_days - ξ·execution_cost - opportunity_cost`, with the R6D
UNKNOWN-never-zero invariant (any `None` component -> `None`, never
silently substituted). `episode_economics.return_per_capital_day` already
matches `RPCD = E[PnL_net] / (CapitalRequired × ExpectedHoldingDays)`
exactly. `episode_economics.whole_episode_pnl` already enforces the
roll-accounting invariant the directive names (`[200,-350,180,-15] ==
15`, never `195`).

One deliberate non-gap worth recording: the directive's `U(a)` formula
also lists standalone `ν·Concentration` and `ω·ModelUncertainty` penalty
terms that `management_utility` does not fold in as scalar weights.
Concentration is instead enforced as a HARD capacity gate in
`account_risk_capacity.py` (a marginal EV gain can never buy its way past
a concentration limit) -- a stricter design than a soft penalty weight,
consistent with THETA's existing hard-gate/soft-signal architecture.
Model uncertainty is carried as an explicit field on
`action_value_distribution.OutcomeDistribution` (a full outcome
distribution, not a collapsed scalar) rather than inside the point-
estimate utility. Both are correct places for these terms to live, not
omissions -- recorded here so a future session does not "fix" a
non-defect.

### New this run: `loss_taxonomy.py`

Provider-independent, no-data-required, and not previously covered by any
existing module: a `FailureCategory` enum (20 categories, covering both
this run's 16-item list and the earlier session's 15-item "mistake
diagnostics" list, deduplicated) plus a `DecisionQuality` process/outcome
grid (`GOOD_PROCESS_GOOD_OUTCOME` / `GOOD_PROCESS_BAD_OUTCOME` /
`BAD_PROCESS_LUCKY_OUTCOME` / `BAD_PROCESS_BAD_OUTCOME`). Critically,
`attribute_failure()` **raises** `AttributionWithoutEvidenceError` if
called with an empty evidence list for any named category (only the
explicit `unattributed()` "normal variance" path needs no evidence) --
structurally enforcing "require failure attribution before recommending
policy changes" rather than leaving it as a convention to remember.
`loss_requires_no_policy_change()` returns True only for
`GOOD_PROCESS_BAD_OUTCOME`, so a single bad realization of a
well-specified decision can never trigger a policy change on its own, and
a lucky win from a bad process can never certify that process as sound.
11 new tests, all passing.

**959 Python tests pass** (+11). Security scan: 0 findings.
`DATASET_ABSENT` still stands -- no `research_exports/` artifact exists,
so every EMPIRICAL item from this run's directive (loss-management
matrix results, profit-taking comparisons, assignment/recovery findings,
sizing/stress tests, model fitting, feature ablations, copy-drift
measurement, OOS/calibration/DSR/PBO) remains `BLOCKED_ON_DATA` -- the
machinery each requires (management_policy.py, experiment_registry.py's
PROFIT_TAKING_POLICIES/LOSS_POLICIES/ROLL_ALTERNATIVES/DTE_BINS/
DELTA_MAGNITUDE_BINS/FEATURE_ABLATION_FAMILIES, walk_forward.py,
selection_bias.py, follower_copy_economics.py) already exists and was not
rebuilt.

**`REQUIRED_CODEX_CHANGE` count for this run: 0.**

## No-new-evidence checkpoint + two provider-independent additions: `66b3f7d` unchanged

`git log --oneline 66b3f7d..origin/main` empty -- origin/main has not
advanced since the previous review. No `research_exports/` artifact
exists. `DATASET_ABSENT` stands unchanged; every empirical item this
run's directive asked for (entry experiments, profit-taking comparisons,
loss-management episode matrix, assignment/recovery findings, model
fitting, calibration, DSR/PBO, feature ablation, copy-drift measurement)
remains `BLOCKED_ON_DATA`, correctly, since the machinery each requires
already exists (`experiment_registry.py`, `management_policy.py`,
`walk_forward.py`, `selection_bias.py`, `loss_taxonomy.py`).

Two genuine, provider-independent, no-data-required gaps were found and
closed rather than manufacturing empirical work against absent data:

1. **Sizing-basis research (`follower_copy_economics.py`)**: the
   directive asked whether proportional follower sizing should use
   equity/risk-budget/collateral/ES-CVaR ratios or a hybrid, and this
   branch had only ONE sizing basis (capacity-cap minimum). Added
   `SizingBasis` (5 variants), `compute_proportional_target_quantity`
   (per-basis ratio, None-safe, zero is a valid target), `compute_hybrid_
   target_quantity` (min of known component targets -- conservative by
   construction, never an average or a max), and `resolve_follower_
   quantity`, which combines a basis TARGET with the existing HARD
   capacity cap via `min()` -- the capacity cap always wins, generalizing
   the standing "never let Kelly override AEGIS" invariant to every
   sizing basis, not only Kelly. 12 new tests.
2. **R8 cohort reporting + P&L decomposition (`paper_cohort_analytics.py`,
   new module)**: the directive asked for cohort breakdowns across 15
   named dimensions and a decision-alpha/execution-alpha/sizing-effect/
   management-effect/tail-realization decomposition, and
   `paper_validation_analytics.py` had neither -- only a flat summary,
   incident tally, and stability recommendation. Added `CohortDimension`
   (15 values matching the directive exactly), `CohortKey`/`CohortEpisode`/
   `CohortAggregate`, `build_cohort_report` (means computed only over
   known values -- an unresolved episode contributes to `n` but never
   silently to a mean), `PnLDecomposition` with `reconcile_decomposition`
   and `require_reconciled_decomposition` (**raises**
   `DecompositionReconciliationError` when a fully-known decomposition's
   five components do not sum to the realized whole-chain P&L, catching a
   double-counted or omitted term structurally rather than by convention).
   10 new tests.

Both are CONTRACT/SHAPE modules in the same pattern as `action_value_
distribution.py`: every numeric field Optional, exercised only against
synthetic fixtures, no fabricated performance number anywhere.

**981 Python tests pass** (+22). Security scan: 0 findings.
**`REQUIRED_CODEX_CHANGE` count for this run: 0** (no new canonical
commits existed to review).

## Anti-paralysis audit + funnel/regret gap closure: `66b3f7d..eafee51`

Two canonical commits reviewed: R7 execution-price/TCA vertical slice
(migrations 025-026, `transaction-cost-analysis.ts`, `adaptive-limit-
policy.ts`, `execution-option-quote.ts`) and provider-neutral quote
lineage. Codex's own handoff explicitly asked for review of "TCA sign
conventions" and "common-horizon action economics."

**TCA sign convention: independently re-derived, correct, no defect.**
`buildTransactionCostAnalysis`'s `perShareCost = side==='BUY' ? fillPrice
- decisionMid : decisionMid - fillPrice` matches this branch's own
`CashflowDirection` convention exactly for THETA's short-premium lifecycle
(SELL/STO = CREDIT-open, BUY/BTC = DEBIT-close): positive = adverse in
both. `spreadCapture`'s SELL/BUY branches are correctly oriented (1.0 =
filled at the favorable side of the spread for that side). No double-
counting found: fees, market impact, and slippage are three separate
Optional fields, never summed into each other.

**management-input-state.ts/management-action-frontier.ts: two real
correctness repairs, both HARD safety gates, both correctly tightening
(not evidence of paralysis).** (1) `aegisState` was being assigned the
ENTIRE `riskState` object rather than its actual approval-status field --
fixed to `riskState.newRiskState ?? riskState.state`, and a new check now
rejects any AEGIS state other than `ALLOW_FULL`/`ALLOW_REDUCED`. (2) a
`null` `accountAgeMs` previously did NOT count as `BROKER_DATA_STALE` --
fixed to fail closed. Both are genuine correctness fixes to a previously
UNDER-strict path (a broken object could silently pass any truthy check;
a missing timestamp was silently treated as fresh), not new business
strictness. **No `REQUIRED_CODEX_CHANGE`.**

### Closed three genuine, non-duplicative research-contract gaps

This run's directive asked specifically for `ALLOW_REDUCED` vs hard-
rejection tracking, near-miss candidates, and alternative strike/expiry
outcomes -- none of which existed, unlike GLOBAL_WAIT/funnel/
OpportunityCaptureRate/GateRegret/regime-frequency, which were all already
built (`management_policy.GlobalWaitEvidence`, `strictness_diagnostics.
CandidateFunnel`/`funnel_ratios`, `strategy_routing_shadow.GateRegretRecord`,
`regime_report.build_regime_report` -- the last already generically
answers "trade frequency by regime" via a caller-supplied cell key, so
nothing new was needed there).

1. **`AegisDisposition`/`AegisDispositionBreakdown`** (`strictness_
   diagnostics.py`): distinguishes `ALLOWED_FULL`/`ALLOWED_REDUCED`/
   `BLOCKED` -- a funnel reporting only "selected vs rejected" cannot tell
   a bot trading full size from one AEGIS quietly trims on every trade.
   `reduced_rate()`/`block_rate()`, both None (never fabricated 0.0) when
   their denominator is zero.
2. **`NearMissCandidate`/`NearMissSummary`** (`strictness_diagnostics.py`):
   a candidate that passed every gate but ranked just below the cutoff by
   MARGIN -- distinct from `GateRegretRecord`'s named-gate rejection.
   `resolved_count`/`profitable_count` only count candidates whose
   outcome was actually reconstructed, never presumed unprofitable from
   non-selection alone.
3. **`AlternativeContractRegret`** (`strategy_routing_shadow.py`): the
   same-family/same-underlying question "would a different strike/expiry
   have done better," distinct from `RouteRegret`'s family-level
   substitution. `regret = counterfactual_outcome - selected_outcome`,
   None unless BOTH sides are real reconstructed values -- never a
   theoretical re-pricing standing in for either.

11 new tests. **PAPER_ACTIVE_BASELINE note (no code needed):** this is not
a distinct metric class requiring new machinery -- it is simply a
`policy_version` value flowing through `ExperimentConfig`, and must be
judged on the identical `SLICE_METRICS` (EV/tail/drawdown/capital-days/
execution-quality/gate-regret) as any candidate policy, never exempted
from them merely because its purpose is bootstrapping data.

**992 Python tests pass** (+11). Security scan: 0 findings.
`DATASET_ABSENT` still stands. **`REQUIRED_CODEX_CHANGE` count for this
run: 0.**

## PAPER_ACTIVE_BASELINE adversarial review + reference-corpus completion: `eafee51..a9d8ffa`

One canonical commit ("make paper baseline and rechecks explicit",
migration 027, `shadow-virtual-trader.ts`). This is exactly the
`theta-paper-active-baseline-v2` policy this run's directive asked to be
judged as a DATA-GENERATION policy, not a proven-alpha policy.

### What the code actually does (verified by reading it, not assumed)

`selectShadowOpeningCandidate` computes `structuralPremiumReturnPerCapitalDay
= premium / collateral / dte` (a purely descriptive ratio), builds a
three-dimensional Pareto frontier (structural return, spread%, ownership
score -- `dominates()` requires no-worse-on-all-three and strictly-better-
on-at-least-one), and picks deterministically among frontier members by a
disclosed, versioned tie-break order. `empiricalEvReady: false` and
`executionAuthorized: false` are hardcoded constants, not derived values --
they cannot silently flip true. No probability or EV is fabricated
anywhere in the file.

**Confirms the four `PAPER_ACTIVE_BASELINE` review questions positively:**
no fabricated probability (verified: only a ratio, never called "expected
return" anywhere in the file or its `whyNotWait` receipt); Pareto logic is
transparent (`paretoFrontierCandidateIds` and each candidate's own
`dominatedBy` list are both exposed, not hidden inside a score); the
tie-break order is disclosed and itself versioned
(`shadowSelectionPolicyVersion`); search breadth is whatever the caller's
candidate list contains -- not restricted by this function itself.

### Genuine finding: structural-return-per-capital-day mathematically favors short DTE

`structuralReturn = premium / (collateral * dte)`. Under the standard
Brenner-Subrahmanyam Black-Scholes ATM approximation (`premium ≈ k * S *
sigma * sqrt(T)` for a constant `k`), `premium / collateral` scales
approximately with `sqrt(T)` for a fixed underlying/strike/IV, so
`structuralReturn ~ sqrt(T) / T = 1 / sqrt(T)` -- **strictly decreasing in
DTE**. Two contracts with genuinely identical annualized premium yield
will be ranked as if the shorter-dated one is a better trade, purely as
an artifact of dividing by raw calendar days rather than by a
time-scaling-consistent denominator (e.g. dividing by `sqrt(dte)` instead
of `dte`, or reporting an annualized rate). Since this ratio is also the
PRIMARY tie-break/ranking dimension in the Pareto frontier's sort order
(checked first, before spread and ownership), the resulting Paper dataset
this policy generates will be systematically skewed toward short-DTE
contracts -- not because short DTE is empirically better, but because of
this specific formula's own time-scaling artifact. This directly matters
because the dataset THIS baseline generates is the evidence the eventual
model-fitting stage will train on; a systematically DTE-skewed sample
would under-represent the 25-45 DTE cohort this repository's own
hypothesis registry (`H-Q-01`/`H-Q-02`, `hypotheses.json`) is actually
about.

This is NOT a code defect (the formula is honestly labeled descriptive,
per Codex's own handoff: "calculates only descriptive premium-per-
collateral-day", and the whole policy is explicitly `NOT` presented as
proven alpha) and is therefore correctly classified `RESEARCH_CHALLENGER`,
not `REQUIRED_CODEX_CHANGE`, per this run's own instruction ("issue
REQUIRED_CODEX_CHANGE only if it creates a concrete production safety/
correctness defect" -- a sampling-breadth concern for a data-GENERATION
policy is not a safety/correctness defect).

**RESEARCH_CHALLENGER recommendation:** once enough scans accumulate to
check, verify whether the resulting Paper dataset's DTE distribution is in
fact skewed short before concluding anything needs to change -- and if it
is, the fix belongs in DATASET INTERPRETATION (stratify analysis by DTE
bucket, per `experiment_registry.DTE_BINS`, which this repository already
has) or in a FUTURE baseline policy version, never a retroactive relabel
of already-collected v2 receipts.

### Reference-corpus completion (directive section 3)

Checked `GITHUB_REPO_RESEARCH_LEDGER.md` against the directive's named
list (QuantConnect LEAN, QuantLib, OpenGamma Strata, py_vollib, Optopsy,
credible SVI/SSVI/eSSVI). LEAN, QuantLib, and Optopsy were already
substantively documented from an earlier session. `py_vollib`, SVI/SSVI,
and OpenGamma Strata had zero prior mentions anywhere in the repository --
added all three with real evidence (verified commit SHAs, licenses, file
paths, via `gh api`):

- **`vollib/py_vollib`** (MIT, commit `11f2058f...`): wraps Peter Jäckel's
  "Let's Be Rational" rational-function IV solver. Cross-checked against
  this repo's own `bs_reference.implied_volatility` and found the two are
  ALREADY equivalent in their bound-checking (both refuse a below-
  intrinsic or unbracketed price; `bs_reference.py` returns `None`,
  `py_vollib` raises an exception) -- recorded explicitly as **not a gap**,
  to prevent a future session from "fixing" a non-defect. Recommended
  action: `TEST` (cross-check IV fixtures as a second oracle), never
  adopted as a dependency.
- **SVI/SSVI/eSSVI**: GitHub search for a credible implementation returned
  only 0-8-star unmaintained repositories -- below this repository's own
  evidence-credibility bar. Documented the primary academic sources
  instead (Gatheral 2004; Gatheral & Jacquier 2013) with the actual
  closed-form parameterization and the two explicit no-arbitrage
  invariants (butterfly, calendar) that must be checked before any
  `SurfaceResidual` feature is trusted. `BLOCKED_ON_DATA` for
  implementation -- no per-expiry strike/IV observations exist yet to fit
  against.
- **`OpenGamma/Strata`** (Apache-2.0, commit `987932ee...`): confirms,
  rather than changes, this repository's existing provenance-travels-
  with-every-value discipline (`dataset_contracts.ProviderProvenance`/
  `DataQuality`) already matches an institutional-grade benchmark.
  `NO_CHANGE_REQUIRED`.

**`DATASET_ABSENT` still stands.** No Python code changed this run
(reference-corpus and adversarial-review work only). Security scan: 0
findings. **`REQUIRED_CODEX_CHANGE` count for this run: 0.**

## Optionomics feature-engine adversarial review: `a9d8ffa..33ac674`

Two commits: "layer Optionomics decision evidence" (migration 028,
`optionomics-feature-engine.ts`, `optionomics-quote-qualification.ts`)
and "schedule open-session quote proof". Read both new modules in full.

### Core boundary re-confirmed: OPTIONOMICS_INTELLIGENCE != EXECUTION_QUOTE_AUTHORITY

`OptionomicsContractFeatureState.quote.executable` is hardcoded `false`;
`semantics` is hardcoded `'SESSION_RECORDED_RESEARCH'`.
`assessOptionomicsQuoteQualification` hardcodes `ready: false` and always
includes `PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED` /
`ORDER_PRICING_USE_NOT_DOCUMENTED` in its blockers regardless of how good
the observed evidence is -- this harness cannot be made to report positive
execution-quote readiness under the current provider contract, no matter
what data it observes. Boundary held. **NO_CHANGE_REQUIRED.**

### Provider/derived separation re-confirmed

Every numeric field is a `FeatureValue<T>` with an explicit `KNOWN`/
`UNKNOWN`/`INVALID` state and a `reason` string -- no field defaults to
zero. Raw IV value (`rawValue`) is preserved alongside the parsed/typed
`impliedVolatility`, and `units` stays `'UNKNOWN'` rather than assuming
decimal when the provider doesn't confirm it. `responseHash` travels with
every snapshot. **NO_CHANGE_REQUIRED.**

### REQUIRED_CODEX_CHANGE: skew/risk-reversal has no delta-proximity tolerance

**Problem:** `deriveSkew` (and `deriveTerm`'s expiry-averaging) select the
chain entry CLOSEST to a 0.25-delta target by absolute distance, with NO
tolerance check on how close "closest" actually is:
```
const put25 = entries.filter(...).toSorted((a,b) =>
  Math.abs(Math.abs(a.delta)-0.25) - Math.abs(Math.abs(b.delta)-0.25))[0];
```
If the nearest available put delta in a sparse/illiquid chain is, say,
0.05 or 0.70, this code still selects it, still treats it as "the 25-delta
point," and returns a `KNOWN` skew value with no `UNKNOWN`/degraded state
--indistinguishable downstream from a genuine near-25-delta skew computed
from a liquid chain.

**Canonical SHA:** `33ac674452f58b511edc215a528e8b29a6e04b377`
**Exact evidence:** `src/theta/optionomics-feature-engine.ts`, function
`deriveSkew` (put/call nearest-delta selection has no distance bound
before `known(...)` is returned).
**Affected invariant:** "UNKNOWN is preserved, never silently converted to
a confident value" -- the same standing invariant this repository already
enforces everywhere else in this exact file (every OTHER field here
correctly returns `unknown(...)` when its precondition isn't met).
**Affected files/modules:** `src/theta/optionomics-feature-engine.ts`
(`deriveSkew`), and by the same pattern, `deriveTerm`'s per-expiration
averaging includes every listed strike/type rather than an ATM-relative
subset (related but distinct, see the RESEARCH_CHALLENGER below).
**Minimal suggested fix:** require `Math.abs(Math.abs(delta) - 0.25) <=`
some explicit, caller-supplied tolerance (never an invented default; make
the caller pass it, per this repository's own no-invented-threshold
discipline) before returning `known(...)`; otherwise return
`unknown('NO_CONTRACT_WITHIN_TOLERANCE_OF_25_DELTA')`.
**Tests required:** a chain with only far-from-25-delta contracts (e.g.
0.05 and 0.70) must produce `UNKNOWN`, not a numeric skew.
**Research consequence:** without this, a sparse-chain skew value could
silently enter the feature set looking exactly as trustworthy as a
liquid-chain skew value, which would corrupt any later skew ablation
(`THETA_OPTIONOMICS_FEATURE_CATALOG.md`'s "Downside skew" row) without any
visible signal that it happened.

### RESEARCH_CHALLENGER: term structure conflates moneyness with tenor

`deriveTerm` averages IV across EVERY strike and option type available at
each expiration, then takes `far_average - near_average`. If the near and
far expirations have different strike coverage (very plausible -- near-
dated chains often list more strikes than far-dated ones), the result
mixes a genuine term-structure effect with a moneyness-mix artifact, not
a clean "far ATM IV minus near ATM IV" signal. Not a defect (well-defined,
reproducible, never fabricated) -- but worth testing whether an ATM-
relative version (nearest-strike-to-spot per expiration, matching this
same file's own 25-delta selection pattern) produces a materially
different and more stable signal before either version is trusted as a
feature. `BLOCKED_ON_DATA` for the actual comparison.

### Reference-corpus convergence

Codex independently built `THETA_PROFESSIONAL_REFERENCE_MAP.md`, correctly
classifying `py_vollib` as `TEST_ONLY` (matching this branch's own
independent finding from the prior run) and flagging Optopsy's AGPL-3.0
license as `REFERENCE_ONLY` (never adopted as a dependency) -- verified
Codex's license claim independently via `gh api repos/goldspanlabs/optopsy`
and confirmed `AGPL-3.0` is correct. No duplication: Codex's map is a
routing table, this branch's `GITHUB_REPO_RESEARCH_LEDGER.md` is the
detailed per-repo dossier -- complementary, not competing.

**No Python code changed this run** (TypeScript adversarial review only).
Security scan: 0 findings. `DATASET_ABSENT` still stands.
**`REQUIRED_CODEX_CHANGE` count for this run: 1** (delta-proximity
tolerance, above).

## Round-trip confirmation + formula audit: `33ac674..0f609fb`

Four commits: professional reference pack verification (12 repos re-
checked at exact SHAs), Optionomics capability census (35 authenticated
capabilities persisted), Optionomics evidence hardening (migration 029:
request timing/rate-limit/HTTP-status/one-way-hashed credential-identity
provenance on `market.optionomics_raw_observation`), and Optionomics
feature-engine v2.

### My prior REQUIRED_CODEX_CHANGE was fixed exactly as specified

`docs/HANDOFF.md`: "Claude's `9e7a679` skew review was accepted and
repaired. Skew now stays UNKNOWN without a caller-supplied proximity
policy and rejects far-from-25-delta pairs." Verified directly:
`deriveSkew` now takes a required `deltaTolerance` parameter -- `UNKNOWN`
when not configured, `INVALID` for a nonsensical value (`<=0` or `>=0.25`),
and `UNKNOWN` (not a numeric value) when neither the nearest put nor call
is actually within tolerance. Exactly the fix recommended: caller-supplied,
never an invented default. **Confirmed correct. Closed.**

### New formulas (v2): all verified correct

`mid=(bid+ask)/2`, `spread=ask-bid`, `relativeSpread=spread/mid` (mid<=0
guarded to `UNKNOWN`, crossed/negative quote to `INVALID` -- matches this
run's directive exactly). `downsideCushion=(S-breakeven)/S` matches the
directive's formula exactly. `creditYieldOnCollateral=grossPremium/
collateral` algebraically reduces to `bid/strike` (multiplier cancels),
matching the directive's `CreditYield=credit*multiplier/collateral`.
`expectedMoveApprox=S*IV*sqrt(dte/365)` correctly annualizes DTE (days) to
years before the sqrt -- the exact T-units check this run's directive
asked for, done correctly.
`expectedMoveNormalizedStrikeDistance=|S-strike|/expectedMove` is honestly
named (never called a probability). **NO_CHANGE_REQUIRED for all of the
above -- independently re-derived and correct.**

### Feature-destination allowlist: strategy isolation preserved

New `optionomics-feature-destinations.ts` gives each of the five canonical
branches (plus `MANAGEMENT` and `R6_RESEARCH`) its OWN feature-family
allowlist rather than one universal set -- e.g. `THETA_HOLD_STRIKE`
excludes `VOLATILITY`/`SKEW`/`SURFACE`/`CROWD`/`HISTORICAL_CONTEXT` (a
short-DTE specialist has no use for term/skew/surface research context),
while `R6_RESEARCH` alone gets everything including `CROWD`. This is
exactly the "did delta/DTE/IVR/GEX/flow become an accidental universal
gate across every branch" concern this run's directive raised, answered
structurally rather than by convention. **NO_CHANGE_REQUIRED.**

### Provenance/security

Migration 029 adds `requested_at`/`request_path`/`http_status`/
`rate_limit_json`/`credential_identity_ref_hash` (one-way SHA-256, not the
credential itself) to `market.optionomics_raw_observation`, plus a
`requested_at <= ingestion_timestamp` PIT-order CHECK. Purely additive,
zero overlap with the dataset export's SELECT list. **NO_RESEARCH_IMPACT.**

**No Python code changed this run.** Security scan: 0 findings.
`DATASET_ABSENT` still stands. **`REQUIRED_CODEX_CHANGE` count for this
run: 0** (one was closed, none newly found).

## Parallel research engineering (no main delta): four new modules

origin/main unchanged at `0f609fb`. Per this run's directive, continued
independent research engineering rather than idling. Built four
genuinely new, non-duplicative, dependency-free modules (searched the
existing registry first per the "search for an existing equivalent"
instruction -- none found):

1. **`volatility_surface_research.py`** -- raw-SVI (Gatheral 2004)
   quasi-explicit calibration: grid-searches `(m, sigma)`, solving the
   LINEAR `(a, d, c)` sub-problem exactly via a dependency-free 3x3
   Gaussian-elimination solve at each grid point. Verified against
   noiseless synthetic SVI-generated data: recovers the exact total-
   variance curve (residual < 1e-6, matches at held-out log-moneyness
   points to 3 decimal places). Diagnostics: strike-count/liquidity
   gating (no invented minimum), Gatheral's sufficient (not necessary,
   explicitly labeled) butterfly-arbitrage condition `b*sigma*(1+|rho|)
   <= 4`, a calendar-arbitrage check (total variance non-decreasing in T
   at matched k), and `SurfaceResidual = MarketIV - FittedIV` that
   refuses to compute for an `UNRELIABLE` fit. 12 tests.
2. **`iv_realized_vol_research.py`** -- four RV estimators (close-to-
   close baseline; Parkinson, Garman-Klass, Rogers-Satchell challengers,
   each with its own documented assumption set: no-drift vs drift-
   independent, jump-sensitivity). `compute_vrp` refuses to produce
   IV-RV/IV²-RV²/IV÷RV quantities unless both sides' horizons match
   within a caller-supplied tolerance -- the classic 30-day-IV-vs-252-
   day-RV methodological error this run's directive named is
   structurally blocked, not just documented. 9 tests.
3. **`term_structure_research.py`** -- resolves standing
   `RESEARCH_CHALLENGER A`. Implements ALL_STRIKE_MEAN (an exact mirror
   of Codex's current production `deriveTerm`, reproduced so it can be
   compared on identical data), ATM_RELATIVE, MATCHED_LOG_MONEYNESS
   (with a required, no-invented-default moneyness tolerance),
   TOTAL_VARIANCE, and FORWARD_VARIANCE (recovers the correct forward
   vol under a flat term structure; refuses a negative forward variance,
   which is itself the calendar-arbitrage condition). `TermMethod
   Comparison.all_strike_diverges_from_matched` gives a direct, testable
   answer to whether the production method's moneyness-mix concern is
   real on a given observation. Declares no winner. 11 tests.
4. **`paper_baseline_dte_bias.py`** -- resolves standing
   `RESEARCH_CHALLENGER B`. A DTE-bucket funnel (raw candidates ->
   eligible -> Pareto frontier -> selected -> near-miss) across the
   canonical 7 buckets (2-5 through 60+), built AHEAD of data per the
   explicit "build the diagnostic now" instruction. `build_dte_bias_
   report` requires a caller-supplied minimum-receipt-count and skew-
   significance threshold (no invented defaults) and reports `skew_
   detected=None` -- never a guess -- below that minimum. The moment real
   `theta_paper_active_baseline_receipt` rows exist, this runs
   immediately with zero further engineering. 7 tests.

All four verified against exact/synthetic ground truth (not merely "it
runs") -- the SVI fit against noiseless generated curves, the RV
estimators against hand-computed stddev and zero-range edge cases, the
term methods against hand-derived expected values, the DTE diagnostic
against a constructed skewed-vs-unskewed selection pattern.

**Explicitly NOT built this run** (scoped out, not silently skipped):
a full trader-DNA mechanism registry (the existing 14-hypothesis
`hypotheses.json` plus `THETA_QUANTWHEEL_HYPOTHESES.md` already cover the
same discipline -- OBSERVED/RECONSTRUCTED/INFERRED/UNKNOWN evidence
levels for a large registry expansion is a multi-hour undertaking better
scoped to its own run); a literal anti-paralysis test harness that drives
Codex's actual TypeScript runtime (not buildable from this Python
research branch -- the EXPECTED behaviors for all eight named scenarios
are already structurally encoded in `management_policy.GlobalWaitEvidence`
/`strictness_diagnostics.AegisDisposition`, which distinguish hard-safety
veto from soft-evidence ranking by construction).

**1031 Python tests pass** (+39). Security scan: 0 findings.
`DATASET_ABSENT` still stands -- these are all provider-independent,
no-data-required deliverables, exercised only against synthetic ground
truth.
