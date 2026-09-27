# THETA Canonical Phase Closure Matrix

**Purpose:** map the WP01–WP100 research/source queue (branch
`claude/theta-overnight-quant`, tracked in
`THETA_CLAUDE_OVERNIGHT_EXECUTION_LEDGER.md`) back onto the project's real
canonical phase sequence, and determine the true closure state of every
phase after Phase 1. A work package being `COMPLETE_SOURCE` does not mean
its phase is `CLOSED`.

## 0. Canonical phase sequence — read directly from the documents, not invented

The authoritative phase sequence is `docs/PHASED_PLAN.md`, which states
its own provenance: "Derived from TRD §38 (Build Plan and Milestones) and
§57 (Release Signature Matrix / Gates G1–G7), cross-checked against the
prior Codex read-through's independent phase breakdown." It defines
**10 phases, Phase 0 through Phase 9**:

| Phase | Owner | Purpose |
|---|---|---|
| 0 | Codex | Repository and safety foundation |
| 1 | Codex | Broker truth and lifecycle ingestion |
| 2 | Codex (Claude reviews feature contracts) | Optionomics contracts and point-in-time intelligence |
| 3 | Codex builds; Claude specifies the snapshot contract | Immutable decision truth (FusionSnapshot) |
| 4 | Codex-led; Claude verifies formulas | Deterministic THETA mechanics (Wheel state machine, economic ledger) |
| 5 | Codex-led | AEGIS and execution |
| 6 | **Claude-led** | Research and shadow validation |
| 7 | Codex-led; Claude monitors calibration/drift live | Paper runtime |
| 8 | Joint | Paper validation and evidence accumulation |
| 9 | Joint, no automatic live authorization | Graduation consideration |

**Important, load-bearing finding — a second, unrelated phase-numbering
system exists in this repo and must not be conflated with the one
above:** `docs/quant/phase2/`, `phase3_strategy_dna/`,
`phase4_method_corpus/`, `phase5_management/`, `phase6_router/` are an
**internal quant-workstream sub-numbering**, entirely nested inside the
canonical **Phase 6** above — confirmed by `docs/QUANT_IMPLEMENTATION_MAP.md`'s
own header ("the working reference for Phase 6") and by
`docs/quant/phase2/PHASE2_MASTER_SPEC.md`'s own text ("no backtester
exists (**Phase 6** gate)" — i.e. its own "Phase 2" folder name is not
the canonical Phase 2). Every WP01–100 mapping below uses the canonical
Phase 0–9 sequence only.

`THETA_MASTER_PHASE_LEDGER.md` is Codex's own engineering/empirical
ledger, using a third label set (R1–R9, P1–P2H). Where cited below it is
translated to the canonical Phase 0–9 numbers, not treated as a fourth
independent sequence.

Per the user's framing, Phase 0/1 (Codex-owned repository/safety
foundation and broker-truth ingestion) are taken as already addressed and
are out of scope for this reconciliation, which covers **Phase 2 through
Phase 9**.

## 1. Per-phase purpose, required capabilities, closure gate, dependencies

| Phase | Required capabilities (from `PHASED_PLAN.md`) | Exact closure gate (verbatim intent) | Depends on |
|---|---|---|---|
| 2 | Deployment-resolved operation aliases, capability checks, rate limiting, cache/freshness, canonical feature-family mappings (OPT-001..004); Claude confirms every ingested feature family has a `feature_definition` (FEAT-001) | Documented-contract fixture mapping and degraded-mode tests pass; a raw Optionomics response can never place an order; a qualified quote may become price evidence only under the provider-authority rule | Phase 1 |
| 3 | `FusionSnapshot`, feature/regime snapshots, candidate sets including WAIT, reasons/rejections, version activation, decision records, audit/replay manifest | A frozen decision replays deterministically without re-fetching mutable live data (DATA-003) | Phase 2 |
| 4 | Wheel state machine and transition guards, economic ledger, stock lots, coverage/collateral reservations, CSP/CC/roll/assignment/expiry/call-away reconciliation, canonical P&L | Mathematical fixtures prove short-option signs, old-roll-loss preservation, open assigned-stock inclusion, cost-once treatment, valid zero sizing | Phase 3 |
| 5 | Hard-veto vs soft-evidence enforcement, position sizing, stress/inventory/correlation controls, durable order intent, adaptive limit policy, TCA | Paper-safe autonomous order mechanics; no duplicate/orphan states under chaos tests | Phase 4 |
| 6 | Deterministic baseline policy, candidate economics, conservative fill model, shadow trades, experiment ledger, benchmark/null runs (B0–B6, A1–A6), PIT datasets, purged walk-forward, untouched OOS, calibration, model governance | Policy changes are evidence-backed via the benchmark/ablation matrix; never tune to force a target win rate | Phases 1–5 (real experiments); pure offline research (Strategy DNA) exempted and already run early |
| 7 | Scheduler enabled only in `PAPER` mode, market-session readiness, management re-evaluations, reconciliations, alerting, reports, operator controls | Stable paper evidence across lifecycle and TCA scenarios | Phase 6 |
| 8 | Accumulate real Alpaca Paper order/fill/lifecycle/execution/management/whole-chain evidence; classify losses by decision/contract/size/limit/execution/regime/flow/management/provider/state-machine/accounting cause | Sufficient independent Paper evidence supports stable after-cost economics and operational integrity; Paper profit alone is insufficient | Phase 7 |
| 9 | Data/quant/strategy/risk/execution/accounting/security/operational sign-offs; after-cost EV, PF, AvgWin/Loss, DD, ES/CVaR, effective N, calibration, capital-days, assignment/recovery, execution quality, restart safety, reconciliation, Paper-vs-sim discrepancy | All applicable release gates pass; no metric waives another failed gate; live trading requires a **separate explicit authorization** | Phase 8 |

## 2/3. WP01–WP100 mapped to phases, one state set each

`SOURCE_STATUS` uses the ledger's own vocabulary (`COMPLETE_SOURCE` /
`RECONCILED_EXISTING` collapses `SOURCE_IMPLEMENTED`/`REAL_DATA_PRODUCER`/
etc. — see `THETA_CLAUDE_OVERNIGHT_EXECUTION_LEDGER.md` WP100 section for
the exact per-WP state). `INTEGRATION_STATUS`/`DATA_STATUS`/
`EMPIRICAL_STATUS`/`RUNTIME_STATUS` are assessed fresh here, per phase.

| WP range | Capability | PRIMARY_PHASE | SECONDARY_PHASES | SOURCE_STATUS | INTEGRATION | DATA | EMPIRICAL | RUNTIME |
|---|---|---|---|---|---|---|---|---|
| 01, 20, 21, 23 | FeatureResult contract, 20-family bundle, definitions registry, strictness funnel | 6 | 2 (FEAT-001 seam) | COMPLETE_SOURCE | WIRED (bundle→registry→router adapter chain complete) | N/A (infra) | N/A | Not runtime-deployed (research-only) |
| 02–12, 14–16 | 16 of 20 real/derived feature producers (TREND…DRAWDOWN_RECOVERY, excl. SECTOR/FUNDAMENTAL_QUALITY) | 6 | 2 | COMPLETE_SOURCE | WIRED into bundle | PARTIAL (real archive has the fields; every candidate is soft-evidence-UNKNOWN for several of them, see §7) | INSUFFICIENT_SAMPLE (0 outcomes to validate against) | Not runtime-deployed |
| 13, 17 | SECTOR, FUNDAMENTAL_QUALITY | 6 | 2 | COMPLETE_SOURCE (typed-UNKNOWN contract only) | WIRED (bundle carries them as UNKNOWN) | BLOCKED_DATA (no authorized provider; **not a TRD-canonical family at all** — see §4) | N/A | N/A |
| 18, 19 | REGIME wiring, EXECUTION_QUALITY adapter | 6 | — | COMPLETE_SOURCE (adapters over pre-existing canonical producers) | WIRED | Real | INSUFFICIENT_SAMPLE | Not runtime-deployed |
| 22 | Router research adapter | 6 | 3 | COMPLETE_SOURCE | WIRED to real `strategy_router.py` | Real | INSUFFICIENT_SAMPLE | Not runtime-deployed |
| 24 | Historical loaders | 6 | — | COMPLETE_SOURCE | WIRED | Real for Sep24 (N=1); superseded by the WP67-era archive recovery (N=7550 candidates, still 0 outcomes) | INSUFFICIENT_SAMPLE | N/A |
| 25 | Filter-value analysis | 6 | — | COMPLETE_SOURCE (dataset+coverage machinery) | WIRED | Real, deduped population exists | **EMPIRICAL_INSUFFICIENT_SAMPLE** (0% selection rate, 100% identical rejection reason — no outcome variance) | N/A |
| 26 | Feature ablations | 6 | — | COMPLETE_SOURCE (mechanism exists, WP60) | WIRED | BLOCKED_DATA (no resolved outcome label anywhere) | BLOCKED_DATA | N/A |
| 27, 28 | Immutable quant snapshot, T0 research adapter | 3 | 6 | COMPLETE_SOURCE | Consumes Codex's real T0ReplayBundle shape; **see FUSION_SNAPSHOT_AUDIT.md gaps in §4/Phase 3** | N/A | N/A | Not runtime-deployed |
| 29–34 | Q/H/D/A/C economics | 4 | 6 | RECONCILED_EXISTING (Q/H/A/C) + COMPLETE_SOURCE (D, genuinely new) | Formula-level only; not reconciled against Codex's actual runtime ledger this pass | N/A | Not empirically run (0 outcomes) | Not verified against runtime this pass |
| 35 | WAIT economics | 4, 6 | — | COMPLETE_SOURCE | Structural only | N/A | INSUFFICIENT_SAMPLE | N/A |
| 36–39 | Cost/slippage baseline, fill-probability baseline, after-cost EV identifiability, empirical estimators | 6 | — | COMPLETE_SOURCE | WIRED | Real inputs where present | **EMPIRICAL_INSUFFICIENT_SAMPLE** (WP37: 0 real `BROKER_ACTUAL` fill labels exist anywhere) | N/A |
| 40 | Assignment labels | 6, 8 | — | COMPLETE_SOURCE | WIRED | BLOCKED_DATA (0 real assignment events) | BLOCKED_DATA | N/A |
| 41–46 | Recovery/tail datasets, whole-chain outcome builder, management action space/RTG, profit-taking challengers | 4, 6 | — | RECONCILED_EXISTING | WIRED (pre-existing) | Real structurally; 0 real resolved rows | INSUFFICIENT_SAMPLE | N/A |
| 47–50 | Entry/management/regime/fill datasets | 6 | — | RECONCILED_EXISTING (47) + COMPLETE_SOURCE (48–50) | WIRED | Real archive rows exist; 0 label-resolved rows | EMPIRICAL_INSUFFICIENT_SAMPLE | N/A |
| 51–58 | Purged walk-forward, OOS manifest, logistic/tree baselines, calibration, cohort calibration, model registry, experiment registry | 6 | — | RECONCILED_EXISTING (51,53,55,58) + COMPLETE_SOURCE (52,54,56,57) | WIRED, all consume the same real machinery | N/A (machinery, not data) | Never run on real data — no rows to split | N/A |
| 59, 60 | Benchmark runner (all IDs classified), feature ablations | 6 | — | COMPLETE_SOURCE (59) + RECONCILED_EXISTING (60) | WIRED | Real capability-evidence probed | EMPIRICAL_INSUFFICIENT_SAMPLE (every mechanic-implemented ID reports `RUNNER_IMPLEMENTED_DATA_UNAVAILABLE`) | N/A |
| 61–63 | DSR, PBO, multiple-testing ledger | 6, 9 | — | RECONCILED_EXISTING (61,62) + COMPLETE_SOURCE (63) | WIRED | N/A | Never run — no real trial return series | N/A |
| 64 | Failure attribution | 8 | 6 | COMPLETE_SOURCE | WIRED (generic) | N/A | Never run on real Paper losses (none exist) | N/A |
| 65, 66 | Experience memory, reproducibility bundle | 6 | — | COMPLETE_SOURCE | WIRED | N/A | N/A | N/A |
| 67, 68 | Future capture contract, horizon adapters | 6, 8 | — | COMPLETE_SOURCE | WIRED (registry-driven) | BLOCKED_FUTURE_OBSERVATIONS (every field is, by definition, not yet capturable) | N/A | N/A |
| 69, 70 | Expiration outcome, management checkpoint outcomes | 4, 6, 8 | — | COMPLETE_SOURCE | WIRED | BLOCKED_DATA (0 real expiration/lifecycle events) | BLOCKED_DATA | N/A |
| 71, 72 | Truth firewall, source data validation | 6 | — | COMPLETE_SOURCE | WIRED | N/A | N/A | N/A |
| 73, 74 | Missingness engine, deduped coverage report | 2, 6 | — | COMPLETE_SOURCE | WIRED | Real (run against the full recovered archive) | Supports population-description only, see §7 | N/A |
| 75, 76 | Strictness/economics join, Q-blocked/D-available cohort | 6 | — | COMPLETE_SOURCE | WIRED | BLOCKED_DATA (0 real outcomes/D candidates to join against) | BLOCKED_DATA | N/A |
| 77 | WAIT analysis | 6 | — | COMPLETE_SOURCE | WIRED | BLOCKED_DATA (no matured WAIT observations) | BLOCKED_DATA | N/A |
| 78 | Management accounting fixtures | 4 | 6 | COMPLETE_SOURCE | Formula-level only | N/A | N/A (property proof, not empirical) | Not reconciled against Codex's runtime ledger this pass |
| 79 | AEGIS fixtures | 5 | 6 | RECONCILED_EXISTING | Formula-level only | N/A | N/A | Not reconciled against Codex's runtime AEGIS enforcement this pass |
| 80 | Sizing fixtures | 5 | 6 | RECONCILED_EXISTING | Formula-level only | N/A | N/A | Not reconciled against Codex's runtime sizing enforcement this pass |
| 81 | Economic monotonicity properties | 4 | 6 | COMPLETE_SOURCE | Formula-level only | N/A | N/A | Not reconciled against runtime |
| 82 | Generic PIT leakage harness | 6 | — | COMPLETE_SOURCE | WIRED, applied to 3 real modules | N/A | N/A | N/A |
| 83, 84 | Research CLI, dedupe performance fix | 6 | — | COMPLETE_SOURCE | WIRED (some subcommands `BLOCKED_MISSING_INTEGRATION` honestly) | N/A | N/A | N/A |
| 85, 86 | Storage classification, Codex handoff pack | 6 | — | COMPLETE_SOURCE | WIRED | N/A | N/A | N/A |
| 87 | Phase 6 real experiment run | 6 | — | N/A (this WP is itself an empirical run, not a source deliverable) | N/A | Real, deduped, exhaustive for what exists | **EMPIRICAL_INSUFFICIENT_SAMPLE** (0 selected candidates, 0 outcomes — the honest, negative, real result) | N/A |
| 88, 89 | Shadow prediction receipts, promotion evidence assembler | 6, 9 | — | COMPLETE_SOURCE | WIRED | N/A | Never populated with a real shadow prediction (no fitted model exists — see 51–58) | N/A |
| 90 | Drift detection | 6, 7 | — | COMPLETE_SOURCE | WIRED | N/A | Never run — no baseline/current windows of real data exist yet | N/A |
| 91, 92 | Paper analysis readiness, Paper-vs-model discrepancy | 8 | 6 | COMPLETE_SOURCE | WIRED (adapters only — no real Paper runtime feed connects to them) | BLOCKED_FUTURE_OBSERVATIONS / OWNER_GATED (`MASTER_PAPER_EXECUTION_ENABLED=false`) | N/A | Not connected to any runtime feed |
| 93, 94 | Graduation metric engine, release evidence matrix | 9 | 6 | COMPLETE_SOURCE | WIRED (assembly only — every sub-metric it would assemble is itself unpopulated) | N/A | N/A | N/A |
| 95 | Cross-module E2E | 4, 5, 6 | — | COMPLETE_SOURCE (test only) | WIRED for the one chain tested | Synthetic fixtures only | N/A | N/A |
| 96, 97 | Adversarial matrix, duplicate-authority search | 6 | — | COMPLETE_SOURCE (3 real defects found & fixed) | WIRED | N/A | N/A | N/A |
| 98–100 | TODO elimination, full gate, final reconciliation | 6 | — | COMPLETE_SOURCE (verification only) | N/A | N/A | N/A | N/A |

## 4. Phase 2 reassessment (not automatically inherited from any prior closure)

**Claude-owned seam (FEAT-001 — every ingested feature family has a
`feature_definition`):** SOURCE COMPLETE. `feature_definitions_registry.py`
(WP21) covers all 20 families in the expanded research decomposition;
`feature_bundle.py` (WP20) wires every one of them, missing-or-not, into
one bundle with no silent omission.

**Load-bearing correction, proven from the canonical documents, not
asserted:** `docs/QUANT_IMPLEMENTATION_MAP.md` §1 states the TRD's own
(§13, Appendix H) canonical feature-family list is **10 families**:
Contract, Premium economics, Volatility, Underlying, Flow/context,
Events, Portfolio, Lifecycle, Expert priors, Regime. **Neither SECTOR nor
FUNDAMENTAL_QUALITY appears in that list.** `docs/DATA_READINESS_ASSESSMENT.md`'s
own TRD §13/Appendix H feature-readiness matrix independently confirms
the same set (Volatility, Flow/context, Events, Underlying, Contract/
Greeks, Execution, Expert priors/regime) with no sector or fundamental
row. The one other place "SECTOR" appears in canonical docs
(`docs/quant/phase6_router/FUSION_SNAPSHOT_AUDIT.md`) refers to AEGIS's
own portfolio **sector-concentration risk check** (computed from
position state, not from an external per-symbol sector/GICS feature) —
a different concept entirely from the `features/sector.py` producer.

**Conclusion: SECTOR and FUNDAMENTAL_QUALITY are not canonical,
TRD-mandated feature families.** They are part of an expanded 20-family
research decomposition adopted by an earlier work-package master command,
never a TRD requirement. Their `BLOCKED_DATA` status therefore **does
not** block Phase 2 (or Phase 6) closure — this is proven from the
documents above, not merely asserted.

**What does block Phase 2's own exit gate** ("a raw Optionomics response
can never place an order; a qualified quote may become price evidence
only under the provider-authority rule"): this is Codex-owned runtime
behavior. `THETA_MASTER_PHASE_LEDGER.md`'s "P2H Optionomics intelligence
activation" row records `PRODUCTION_AUTH_PASS; INTELLIGENCE_READY;
EXECUTION_QUOTE_UNQUALIFIED` — the quote-pricing-suitability gate is
explicitly **not yet met**. This is independently, freshly confirmed by
this session's own empirical finding (§7): every one of the 7550
recovered real candidates carries the soft-evidence code
`EXECUTION_QUOTE_REQUIRED: official OPRA BBO unavailable; spread too
wide` — a live, present-day instance of exactly this unresolved gate.

**Phase 2 state: `BLOCKED_CODEX`.** Claude's own seam is source-complete;
the phase-level closure blocker is a specific, named Codex runtime
capability (OPRA/two-sided quote qualification), not a Claude-owned gap.

## 5. Phase 3 reassessment (not automatically inherited)

WP27 (`immutable_quant_snapshot.py`) and WP28 (`t0_bundle_adapter.py`)
are real, tested, and consume Codex's actual `T0ReplayBundle` shape —
this is COMPLETE_SOURCE for Claude's "specifies the snapshot contract"
role.

`docs/quant/phase6_router/FUSION_SNAPSHOT_AUDIT.md` (a prior Claude audit
of Codex's real `FusionSnapshot` schema, not re-run this pass but not
superseded either) records specific, named, still-open gaps: no
`portfolioExposure` field distinct from `positionState` (needed by
AEGIS's own SECTOR/CORRELATION/PORTFOLIO risk families), and
`contractCandidates` typed as `z.array(z.unknown())` rather than a real
schema. Phase 3's exit gate ("a frozen decision replays deterministically
without re-fetching mutable live data") depends on these being resolved.

**Phase 3 state: `BLOCKED_CODEX`.** The contract-specification side is
source-complete; the audited gaps are a named, Codex-owned integration
task, not reverified as closed in this pass.

## 6. Phase 4 reassessment — this WP01-100 pass is Phase 4's economics/formula-verification queue itself

WP29–34 (Q/H/D/A/C economics), WP35 (WAIT), WP78 (management accounting
fixtures), WP81 (economic monotonicity properties) are the concrete
content of Claude's Phase 4 role ("verify every formula against Appendix
A... verify roll old-loss preservation... cost-once treatment"). Every
one of these is real, tested, `COMPLETE_SOURCE` or `RECONCILED_EXISTING`.
Distinguishing the requested categories precisely:

- **FORMULA_IMPLEMENTED**: Q/H/D/A/C economics, WAIT, roll/fee/capital-days
  accounting — yes, for every listed formula.
- **DERIVED_FROM_REAL_INPUTS**: yes where real archive fields exist (strike,
  bid/ask, DTE, multiplier) — proven against the real recovered archive in
  `historical_v1_to_v6_bridge.py`'s own 109-file validation pass.
- **EMPIRICALLY_ESTIMATED**: **no** — 0 resolved outcomes exist anywhere to
  estimate an empirical quantity (win rate, realized EV) from.
- **OOS_VALIDATED**: **no** — the untouched-OOS manifest (WP52) has never
  been populated with real rows to hold out.
- **PAPER_VALIDATED**: **no** — `MASTER_PAPER_EXECUTION_ENABLED=false`;
  no real Paper fills exist.

This pass did **not** re-audit Codex's actual runtime economic ledger
(`bots/theta/app/`) to confirm it implements these same formulas
identically — that reconciliation is out of this session's scope (Claude
does not own `bots/theta/app/`) and was not performed.

**Phase 4 state: `SOURCE_COMPLETE_INTEGRATION_PENDING`.** The
formula/fixture side is complete and correct per Appendix A; whether
Codex's live ledger conforms is the remaining, unverified integration
step — not itself proven broken, just not reconciled this pass.

## 6b. Phase 5 reassessment

WP79/WP80 (AEGIS/sizing property fixtures, `RECONCILED_EXISTING` — the
producers were already real and mature; this pass added one missing
monotonicity property) are Claude's review-side deliverable for Phase 5.
Phase 5's own exit gate ("paper-safe autonomous order mechanics; no
duplicate/orphan states under chaos tests") is entirely Codex-owned
runtime (order intent, preflight, TCA) and was not re-audited this pass.

**Phase 5 state: `SOURCE_COMPLETE_INTEGRATION_PENDING`.** Same reasoning
as Phase 4 — Claude's fixture/property side is complete; the runtime
reconciliation against Codex's actual execution code is unverified this
pass, not proven failing.

## Phase 6 — the dominant home of WP01-100

Every remaining capability the user listed in section 6 of the task
(management datasets, AEGIS/sizing, regime modeling, training datasets,
purged walk-forward, untouched OOS, baselines, calibration, cohort
calibration, model/experiment registries, benchmarks, ablations, DSR,
PBO, multiple-testing, failure attribution, experience memory,
reproducibility, future capture contracts, horizon observations,
expiration outcomes, truth firewall, missingness, coverage, strictness/
economics analysis, Q-blocked/D-available cohorts, WAIT analysis, drift,
Paper-analysis readiness, Paper-vs-model discrepancy, graduation
metrics, release evidence matrix) is real, tested, wired
`COMPLETE_SOURCE` or `RECONCILED_EXISTING` infrastructure — see the WP
table above for the exact per-item breakdown. **None of it constitutes
empirical validation**, per §7 below, and per Phase 6's own exit gate
("policy changes are evidence-backed via the benchmark/ablation matrix")
no policy change has ever been evidence-backed, because there is no
resolved-outcome evidence to back one with.

**Phase 6 state: `SOURCE_COMPLETE_EMPIRICAL_PENDING`.**

## 7. Empirical truth (restated, binding)

The full deduplicated recovered historical archive:
`666 raw archive copies → 109 unique snapshots → 302 unique decisions →
7550 unique candidates → 8731 unique execution-evidence rows → 0 selected
candidates → 0 resolved outcomes.`

This dataset does **not** prove and must never be cited as proving:
profitable expectancy, win rate, fill probability, assignment
probability, management superiority, strategy superiority, calibration
quality, or Paper/live readiness.

It **does** legitimately support: coverage analysis (WP74), missingness
analysis (WP73), strictness/rejection-reason population description
(WP25's population half), data-lineage/provenance analysis (the v1→v6
bridge work), and structural-behavior verification (every property/
fixture test in WP78–82).

## 8. Hash provenance blocker

Carried as `BLOCKED_CODEX_PROVENANCE`, per instruction — a refinement of
the ledger's existing `BLOCKED_CODEX` tag for this specific finding: the
real archived exports' declared `datasetHash` does not reproduce from
their own content under the documented Production hashing formula
(`historical_v1_to_v6_bridge.py`'s own module docstring; attempted
against all 109 unique files, 0 verified). No result derived from this
archive may be treated as promotion-grade empirical evidence — only as
structural/population-description evidence (§7) — until Codex resolves
why the archive and the documented formula disagree.

## 9. Future data dependencies

No fixed minimum-N policy exists in the canonical documents for most
metrics — `docs/QUANT_IMPLEMENTATION_MAP.md` §7 states adequacy is
metric/cohort dependent, **except** the one explicit canonical rule
found: the 70–80% WR claim standard (§50) requires "raw N and
independent-cluster N — target ~300+ independent OOS episodes, preferably
500+ across regimes," together with the full metric set (AvgWin/Loss,
PF, EV, DD, ES/CVaR, open MTM) and confirmation the untouched OOS was
never used for threshold selection. No other fixed N is invented here.

| Phase blocked | Data needed | Minimum sample / readiness rule | Producer owner | Re-evaluation trigger |
|---|---|---|---|---|
| 2 | Qualified two-sided OPRA (or equivalent) options quote meeting the `FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_READY` gate | No fixed N — this is a capability/entitlement gate, not a sample-size gate | Codex + Optionomics/Alpaca entitlement | The moment Codex's provider-capability check confirms OPRA (or equivalent) entitlement |
| 3 | `FusionSnapshot` carrying a real `portfolioExposure` field and a typed (not `unknown[]`) `contractCandidates` | N/A (schema completeness, not sample size) | Codex | When the named schema fields are added and `FUSION_SNAPSHOT_AUDIT.md` is re-run and passes |
| 4/5 | Reconciliation of Codex's actual runtime ledger/AEGIS enforcement against Claude's formula fixtures | N/A (an audit, not a sample) | Joint (Claude audits, Codex's code is the subject) | Whenever either side's code changes; not yet scheduled |
| 6 | Real selected candidates with resolved (`BROKER_ACTUAL`) outcomes — fills, assignment/exercise, expiration, whole-chain P&L | Metric/cohort dependent (§50's ~300–500+ episode target applies specifically to a 70–80% WR claim; other metrics have no fixed rule) | Codex (Command-5A capture) + Alpaca (broker truth) | The moment any candidate is actually selected and its chain resolves |
| 7/8 | Real Paper fills, fill prices, latency, partials, cancel/replace, assignment, exercise, expiration, management outcomes, whole-chain outcomes; horizon observations (+15m/+1h/EOD/+1d/+3d/+5d) | Metric/cohort dependent; no fixed N | Codex (Command-5A / Paper runtime) | The moment `MASTER_PAPER_EXECUTION_ENABLED=true` and real fills begin accumulating |
| 9 | Everything above, plus operational/restart/reconciliation/idempotency evidence | All applicable release gates (G1–G7), no fixed N | Joint + owner | After Phase 8 produces sufficient independent Paper evidence |

## 10. Codex dependencies (deduplicated)

Not requested to be worked now — Phase 1 gating still applies to anything
listed as `POST_PHASE1_INTEGRATION` or later.

| Handoff | Classification |
|---|---|
| Resolve `EXECUTION_QUOTE_UNQUALIFIED` — qualify a two-sided, fresh, exact-contract Optionomics or Alpaca quote for order pricing | POST_PHASE1_INTEGRATION / PROVIDER |
| Add `portfolioExposure` as its own typed `FusionSnapshot` field | POST_PHASE1_INTEGRATION / PERSISTENCE |
| Type `contractCandidates` as a real schema, not `z.array(z.unknown())` | POST_PHASE1_INTEGRATION / PERSISTENCE |
| Resolve the archived exports' `datasetHash` non-reproduction (investigate whether the backup pipeline reformats files post-export, or the documented hashing formula has drifted from the actual producer) | HISTORICAL_PROVENANCE |
| Capture real fill/fill-price/latency/partial/cancel-replace evidence per `future_capture_contract.py`'s registry (8 required fields: `filled`, `fill_price`, `assignment_event`, `exercise_event`, `expiration_outcome`, `management_action_taken`, `management_outcome`, `whole_chain_state`) | COMMAND5A_RUNTIME_PRODUCER |
| Capture future BBO/underlying/IV/Greeks at named horizons (+15m/+1h/EOD/+1d/+3d/+5d) | COMMAND5A_RUNTIME_PRODUCER |
| Enable `MASTER_PAPER_EXECUTION_ENABLED` (owner-gated, not requested here) | PAPER_RUNTIME / OWNER_GATED |
| Any real broker fill/assignment/exercise event | BROKER_ACTUAL |
| Live authorization | DEPLOYMENT / OWNER_GATED — explicitly not requested |

## 11. Source-solvable gap check

No further source-solvable gap was found this pass. Every remaining item
above is either a named Codex-owned integration/runtime task, a real
data/observation dependency that only real trading time can produce, or
an owner-gated authorization decision. No new module was written in
producing this matrix — this is a mapping/documentation deliverable only.

## 12. Final phase matrix

| PHASE | CANONICAL_PURPOSE | WPS_MAPPING | SOURCE | WIRING | PERSISTENCE | REPLAY | TESTS | REAL_DATA | EMPIRICAL | RUNTIME | EXTERNAL_BLOCKERS | EXACT_CLOSURE_CONDITION | CURRENT_STATE |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | Optionomics contracts & PIT intelligence | 01,13,17,20,21,23,73,74 | COMPLETE (Claude seam) | WIRED | N/A (Claude side) | N/A | REAL | Structural only | Codex quote qualification unresolved | Codex `EXECUTION_QUOTE_UNQUALIFIED` | BLOCKED_CODEX | Fixture/degraded-mode tests pass + qualified quote pipeline live | **BLOCKED_CODEX** |
| 3 | Immutable decision truth | 22,27,28 | COMPLETE | WIRED | N/A | Real (consumes Codex's T0ReplayBundle) | REAL | N/A | Codex schema gaps (FUSION_SNAPSHOT_AUDIT) | Not reverified this pass | BLOCKED_CODEX | Deterministic replay without live re-fetch (DATA-003), named schema gaps closed | **BLOCKED_CODEX** |
| 4 | Deterministic THETA mechanics | 29-40,41-46(partial),78,81 | COMPLETE | Formula-level | N/A | N/A | REAL | Real archive fields | 0 resolved outcomes | Not reconciled vs. Codex runtime ledger | Integration audit not run this pass | Fixtures prove signs/roll-loss/cost-once/zero-sizing AND Codex runtime matches | **SOURCE_COMPLETE_INTEGRATION_PENDING** |
| 5 | AEGIS and execution | 79,80 | RECONCILED_EXISTING | Formula-level | N/A | N/A | REAL | N/A | N/A | Not reconciled vs. Codex runtime | Integration audit not run this pass | Paper-safe order mechanics, no duplicate/orphan under chaos AND Claude fixtures match runtime | **SOURCE_COMPLETE_INTEGRATION_PENDING** |
| 6 | Research and shadow validation | 02-12,14-16,18,19,24-26,29-77,79-98 (Claude-side portions) | COMPLETE | WIRED | Real (hashes/manifests) | Real (deterministic re-conversion proven) | REAL (1224 pass) | Real, deduped (7550 candidates) | **0 resolved outcomes — EMPIRICAL_INSUFFICIENT_SAMPLE** | Not runtime-deployed | Phase 2 quote gate is the root cause of 0 real outcomes | **SOURCE_COMPLETE_EMPIRICAL_PENDING** |
| 7 | Paper runtime | (none — Codex-owned; WP91 preps adapters only) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Codex R7=`COMPLETE_FOR_BOUNDED_CANARY`, empirical `INSUFFICIENT_EVIDENCE` | Owner authorization + Codex runtime | Stable Paper evidence across lifecycle/TCA scenarios | **OWNER_GATED** |
| 8 | Paper validation & evidence accumulation | 64,67,68,69,70,91,92 | COMPLETE (adapters) | WIRED, unconnected to any live feed | N/A | N/A | REAL | BLOCKED_FUTURE_OBSERVATIONS | None (no real Paper trade exists) | `MASTER_PAPER_EXECUTION_ENABLED=false` | Owner gate + Phase 7 | Sufficient independent real Paper evidence | **OWNER_GATED** |
| 9 | Graduation consideration | 93,94 | COMPLETE (assembly only) | WIRED, nothing to assemble yet | N/A | N/A | REAL | N/A | None | N/A | Everything upstream + explicit owner authorization | All release gates (G1-G7) pass; separate live authorization | **OWNER_GATED** |

```
PHASES_CLOSED = 0
PHASES_SOURCE_COMPLETE = 0 (none reach plain "source complete, nothing pending" — every phase has at least one named pending category)
PHASES_INTEGRATION_PENDING = 2 (Phase 4, Phase 5)
PHASES_DATA_BLOCKED = 0 (folded into BLOCKED_CODEX/EMPIRICAL_PENDING/OWNER_GATED above, no phase's SOLE blocker is a bare data gap)
PHASES_EMPIRICAL_BLOCKED = 1 (Phase 6)
PHASES_RUNTIME_BLOCKED = 0 (folded into BLOCKED_CODEX for Phases 2-3)
PHASES_OWNER_GATED = 3 (Phase 7, Phase 8, Phase 9)
PHASES_BLOCKED_CODEX = 2 (Phase 2, Phase 3)

SOURCE_SOLVABLE_GAPS_REMAINING = 0

NEXT_PHASE_THAT_CAN_ACTUALLY_ADVANCE = Phase 2 (resolving EXECUTION_QUOTE_UNQUALIFIED unblocks real candidate selection, which is the single upstream root cause blocking Phase 6's empirical evidence, which in turn blocks Phases 7-9)
NEXT_REQUIRED_EVIDENCE = A qualified, fresh, two-sided, exact-contract options quote (OPRA or an equivalent Codex/Optionomics-confirmed provider-capability answer) — everything else in this matrix is waiting on real candidates actually clearing that one gate
```
