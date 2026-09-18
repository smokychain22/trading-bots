# THETA C2 Research Synthesis — 2026-09-18

Branch `claude/theta-c2-research`, forked from the frozen C1 integration candidate
`53a23a707c57f96a47a481e5e2dbd4b824978254`. Research/challenger work only — no broker
authority, no Production mutation, C1 untouched.

**Before reading further:** this repository already carries an exceptionally mature
research program — `docs/quant/phase2/` through `phase6_router/`, `docs/research/*`,
and a real Python quant package at `bots/theta/quant/` with 474 passing tests before
this pass. Most of the C2 master directive's sections (1–29) are **already answered**
by that existing corpus, in more depth and rigor than this document could add by
re-deriving them. This synthesis therefore does three things only: (1) surfaces one
critical cross-cutting architecture finding that must be flagged, not silently
absorbed; (2) maps each directive section to the file that already answers it, so
nothing is duplicated; (3) documents the genuinely new work this pass added.

## 1. Critical finding: a real Python/TypeScript duplication risk exists — flagging, not fixing

`docs/quant/phase6_router/PYTHON_TS_BRIDGE_ARCHITECTURE.md` states the intended
architecture explicitly: **"Python quant (`bots/theta/quant/`) is mathematical/policy
truth. TypeScript (`src/theta/`) orchestrates... it never recomputes a formula Python
already owns."** That same document states the bridge between them is **"SPECIFIED,
not implemented — the single most consequential remaining R1 gap."**

`bots/theta/quant/models/` already contains real, tested, more heavily hypothesis-
annotated implementations of exactly what the (now C1-frozen) TypeScript management
work in `src/theta/` independently reimplemented:

| Concept | Python (`bots/theta/quant/models/`) | TypeScript (`src/theta/`, C1-frozen) |
|---|---|---|
| Covered-call ranking / utility | `covered_call_ranker.py` (H-C-01/H-C-02) | `covered-call-lattice.ts` |
| Pareto/nondominated filtering | `pareto_frontier.py` | `covered-call-lattice.ts`'s `nondominatedCoveredCallCandidates` |
| Recovery decision (WAIT/SELL_STOCK/SELL_CC) | `recovery_decision.py` (H-A-02 bounded-wait) | `recovery-state.ts` + `paper-bootstrap-management-policy.ts` |
| Same-state management action-value / roll | `management_action_value.py` (H-M-01) | `paper-bootstrap-management-policy.ts`, `roll-incremental-utility.ts` |

Both sides independently satisfy similar invariants (UNKNOWN-never-creates-false-
dominance, bounded recovery wait, no permanent action bias) — they were not built
carelessly. But **two independently-evolving implementations of the same policy
logic is exactly the "TWO BRAINS" failure mode this C2 directive's own section 2
warns against**, just internal to THETA rather than an external vendor brain. Per
this same C2 directive's hard rule ("C1 is frozen... do not reopen... unless Codex
returns a concrete integration regression") and C2's own charter (research only, no
architecture rewrites), **this is not something to resolve unilaterally in this
pass.** It is reported here as the single highest-priority item for Codex + the
owner to resolve before ONE-BRAIN integration proceeds further — the open question
being whether `src/theta/`'s C1 candidate is retired in favor of wiring the
already-specified Python bridge, whether the Python models become the reference
implementation the TS is cross-checked against, or whether the two are formally
reconciled into one. No code changes were made to either side to address this in
this pass.

## 2. Directive-section-to-existing-corpus map (sections 4–29)

| Directive section | Existing authoritative source | Status |
|---|---|---|
| §4 Strategy router research | `docs/quant/phase6_router/STRATEGY_ROUTER_SPEC.md`, `EXPERT_STRATEGY_ROUTING_MATRIX.md`; `bots/theta/quant/models/strategy_router.py` | IMPLEMENTED (baseline) |
| §5 Candidate lattice research | `bots/theta/quant/models/theta_q_lattice.py`; `docs/quant/phase2/PHASE2_MASTER_SPEC.md` §1 | IMPLEMENTED (baseline) |
| §6 Expected move | `docs/research/THETA_FORMULA_CATALOG.md` | DOCUMENTED |
| §7 Realized volatility baselines | **NEW this pass** — see §3 below | IMPLEMENTED (baseline only; EWMA/close-to-close/Parkinson/HAR-RV feature construction) |
| §8 VRP | `docs/research/THETA_FORMULA_CATALOG.md`; not yet a wired feature | DOCUMENTED, RESEARCH_ONLY |
| §9 IV rank/percentile | `docs/research/THETA_OPTIONOMICS_DATA_MAP.md`, `THETA_OPTIONOMICS_FEATURE_CATALOG.md`, `THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md` | DOCUMENTED, evidence gap open |
| §10 Skew/term structure | `docs/research/THETA_FORMULA_CATALOG.md`; QuantLib/ivsurf cross-checked there | DOCUMENTED |
| §11 Optionomics deep feature ablation | `docs/research/THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`, `THETA_OPTIONOMICS_FEATURE_CATALOG.md` | DOCUMENTED, ablations BLOCKED_BY_DATA |
| §12 GEX/dealer positioning | `docs/research/THETA_GEX_DEFINITION_MATRIX.md` — **the single most rigorous item in the whole corpus**: 5 independently-read GEX implementations, confirms no two compute "zero gamma" identically | RESEARCH_ONLY, correctly NOT promoted |
| §13 Flow/UOA | `docs/research/THETA_QUANTWHEEL_TEARDOWN.md`, `GITHUB_REPO_RESEARCH_LEDGER.md` (Options-Flow-Predictor entry) | RESEARCH_ONLY |
| §14 Market regime | `bots/theta/quant/models/regime_v0.py` (5 independent axes, HMM explicitly named as a future challenger only) | IMPLEMENTED (baseline) |
| §15 Profitability probability model | `docs/quant/phase2/MODEL_REGISTRY.md` (entry-outcome model: logistic/LightGBM SPECIFIED, not built) | SPECIFIED, BLOCKED_BY_DATA |
| §16 Tail/downside | `bots/theta/quant/models/severe_drawdown_spec.py`; `docs/quant/phase2/MODEL_REGISTRY.md` | SPECIFIED (label), fitted model BLOCKED_BY_DATA |
| §17 Assignment probability | `bots/theta/quant/models/assignment_model.py`; TRD §17 | SPECIFIED, BLOCKED_BY_DATA |
| §18 Recovery time (survival) | `bots/theta/quant/models/recovery_spec.py` | SPECIFIED (survival-curve spec), fitted curve BLOCKED_BY_DATA |
| §19–21 Management/loss/profit-transition research | `docs/quant/phase5_management/*`, `docs/research/THETA_DYNAMIC_MANAGEMENT_AND_STRATEGY_SWITCHING.md`, `bots/theta/quant/models/management_action_value.py` | SPECIFIED; MFE/MAE interface exists in C1 (`managed-episode-path-features.ts`) but is not yet consumed by any of this |
| §22 Roll research | `docs/quant/phase2/FORMULA_REGISTRY.md` (NetRollCredit/RollUtility); `roll-incremental-utility.ts` (C1) | IMPLEMENTED (baseline, on both sides — see §1 finding) |
| §23 CC research | `covered_call_ranker.py`; `covered-call-lattice.ts` (C1) | IMPLEMENTED (baseline, on both sides — see §1 finding) |
| §24 Position sizing | `bots/theta/quant/models/sizing.py`; `docs/quant/phase2/AEGIS_SIZING_EXECUTION_CONTRACT.md` | IMPLEMENTED (hard caps); fractional-Kelly challenger not yet built |
| §25 Portfolio risk | `docs/quant/phase2/AEGIS_SIZING_EXECUTION_CONTRACT.md`; `bots/theta/quant/models/aegis.py` | SPECIFIED |
| §26 Professional trader research | TRD §14/§53 (frozen, authoritative — see §4 below for this pass's addendum) + `docs/research/THETA_QUANTWHEEL_TEARDOWN.md`/`THETA_QUANTWHEEL_HYPOTHESES.md` | DOCUMENTED; addendum below |
| §27 Institutional benchmarks | `docs/quant/phase2/BENCHMARK_AND_EXPERIMENT_REGISTRY.md` + this pass's Cboe verification (§4 below) | DOCUMENTED; addendum below |
| §28 GitHub research | `docs/research/GITHUB_REPO_RESEARCH_LEDGER.md`, `THETA_GITHUB_TOP15.md`, `THETA_GITHUB_GAP_MATRIX.md`, `THETA_PROFESSIONAL_REFERENCE_MAP.md`, `THETA_STRATEGY_REPO_CATALOG.md` (QuantLib, LEAN, optopsy, options-wheel, ivsurf, py_vollib all already verified with real commit SHAs/licenses); `THETA_CLAUDE_ORCHESTRATION_RESEARCH.md` (this research lane's own prior pass: fast-check, xstate, temporal, DDD-hexagonal, OpenTelemetry) | ALREADY COMPLETE — no re-verification attempted this pass to avoid wasted duplicate work |
| §29 Validation framework | `docs/research/THETA_WALK_FORWARD_SPEC.md`, `docs/quant/phase2/DATASET_AND_LABEL_CONTRACT.md` §5 | SPECIFIED, mature |

## 3. New this pass: realized-volatility baselines

`bots/theta/quant/features/realized_volatility.py` (+ 23 tests in
`bots/theta/tests/quant/test_realized_volatility.py`, all passing; full quant suite:
497/497 passing). This fills a genuinely empty gap — `bots/theta/quant/features/` had
no files at all, and `regime_v0.py`'s `RegimeInputs.rv20` has always been an
externally-supplied `Optional[float]` with no in-repo computation behind it.

Implements, per MODEL-001 (baseline-first):
- `close_to_close_realized_volatility` — the canonical simplest baseline.
- `parkinson_realized_volatility` — high/low range estimator.
- `ewma_variance_series` / `ewma_volatility` — RiskMetrics-style recursion.
- `har_rv_features` / `fit_har_rv_ols` — Corsi (2009) HAR-RV daily/weekly/monthly
  feature construction plus a closed-form OLS fit helper for research use.

Every function is a pure transform with no I/O and no lookahead by construction
(`har_rv_features` never reads past its own `as_of_index`, proven by a dedicated
test that mutates every future value and confirms the result is unchanged).
UNKNOWN-never-zero is enforced throughout (`None` on any window with too few valid
observations, never a fabricated `0.0`). Nothing here is wired into a production
decision path, into `regime_v0.py`, or claimed as an improvement over anything —
that claim requires the untouched-OOS discipline `THETA_WALK_FORWARD_SPEC.md`
already specifies, which in turn requires the historical options data that
`HISTORICAL_OPTIONS_DATA_GAP.md` documents as not yet available. GARCH/EGARCH/rough-
volatility challengers remain explicitly deferred per that same MODEL-001 discipline
until these baselines are actually beaten on real OOS data.

## 4. Addendum: professional-trader / institutional-benchmark cross-check

`docs/research/RESEARCH_REGISTER.md` already states TRD §14/§53's expert-prior table
is authoritative and should not be reconstructed from other sources without cross-
checking against it. This pass read TRD §14 ("Expert Strategy DNA as Offline
Priors") and §53 ("Professional Strategy Evidence Register") directly from the
source `.docx` (extracted via its own `word/document.xml`, not paraphrased from
memory) and cross-checked the named individuals against live public search:

- **Ivan Orehovec** — real, active identity confirmed (`x.com/ivanoreh`), founder of
  "QuantWheel" (`quantwheel.com`, a wheel-strategy screening/journaling tool, not a
  single disclosed rule set). This confirms TRD §53's "Observed/corpus prior; not one
  universal CSP rule" posture for this name is accurate — no audited performance
  record exists publicly; self-reported per-trade posts only (e.g. one post citing a
  16 DTE $PARA CSP at 0.5% weekly yield). No change to TRD's evidence posture is
  warranted or made.
- **Orange Cat, Hendo_67, Wheeling to Freedom** — no independently verifiable public
  source found by this pass. This is consistent with, not contradictory to, TRD
  §53's own labeling of these as observed/corpus-supported priors from the owner's
  private historical corpus (`docs/research/RESEARCH_REGISTER.md`'s blueprint-
  lineage note) rather than public content — do not treat "not found on the public
  web" as evidence the TRD's prior itself is wrong.
- **David Romic / "Lick Neeson"** — a second-hand (aggregator-cited, not primary-
  source-verified) reference surfaced two concrete claims: "roll almost always for a
  credit" and "the optimal window to roll losing positions is 14–21 DTE," plus an
  explicit warning against rolling a position down >40% with deteriorating
  fundamentals. The second point corroborates THETA's own existing, already-frozen
  thesis-invalidation design (price loss ≠ automatic roll, C1) — logged as a
  low-confidence `HYPOTHESIS`, not promoted, and not a reason to alter frozen C1
  behavior.
- **Cboe S&P 500 PutWrite Index (PUT)** and **Cboe S&P 500 BuyWrite Index (BXM)** —
  **VERIFIED** against Cboe's own published methodology PDFs
  (`cdn.cboe.com/api/global/us_indices/governance/Cboe_SP_500_PutWrite_Indices_
  Methodology.pdf`, `.../BXM_Methodology.pdf`). PUT: sells a sequence of one-month,
  at-the-money SPX puts (written ~3rd Friday monthly), collateralized in 1-/3-month
  T-Bills sized to the maximum possible settlement loss; daily history backfilled to
  1986-06-30. BXM: holds a long S&P 500 portfolio and writes a succession of
  one-month ATM SPX calls monthly (announced 2002, methodology by Prof. Robert
  Whaley). These are the two highest-quality benchmark sources in this entire
  research set — real, audited, decades of daily history — and were **not yet
  present** in `docs/quant/phase2/BENCHMARK_AND_EXPERIMENT_REGISTRY.md`'s existing
  benchmark family list. Recommended (not made — data/benchmark-ID additions belong
  to that registry's own owner) as a genuine addition: a `B-PUT`/`B-BXM` benchmark
  family for THETA's own CSP/CC cohort performance once real fills exist to compare
  against.

No claim above overrides or edits the frozen TRD §14/§53 table. No code or the TRD
itself was changed.

## 5. Shadow challenger recommendations (grounded in already-registered hypotheses)

Per `docs/quant/phase3_strategy_dna/THETA_HYPOTHESIS_LIBRARY.md`, six hypotheses are
already `TEST` status (genuinely open, not yet accepted/rejected, blocked only on a
working backtester + real historical options data per
`docs/research/HISTORICAL_OPTIONS_DATA_GAP.md`) with acceptance/rejection criteria
already specified in `research/data/hypotheses.json`. Rather than inventing new
challenger candidates, this pass's recommendation is to treat these SIX as the actual
top shadow-challenger backlog, in this priority order (info value × data readiness ×
overfitting risk, per the C2 directive's own ranking instruction):

1. **H-A-04** (bounded recovery-wait beats unconditional waiting) — highest priority:
   directly extends the already-frozen C1 `RecoveryState`/RECOVERY_WAIT forward-
   economics work, has the clearest acceptance criterion (walk-forward-selected bound
   vs. unconditional wait, confirmed OOS), lowest engineering complexity (a bound
   sweep over an existing state).
2. **H-R-01 vs. H-R-02** (active close/roll vs. hold-to-cycle) — both hypotheses'
   own source text admits the regime mechanism is "(unverified)"; this pair should be
   run together (they are each other's control) rather than separately, using the
   already-existing MFE/MAE path interface (`managed-episode-path-features.ts`, C1)
   as the feature source.
3. **H-C-01 / H-C-02** (full CCUtility vs. max-yield; recovery-conditioned CC timing)
   — RETAIN-status architecturally, but the empirical confirmation is still open;
   directly exercises the (see §1 finding) duplicated CC-ranking logic on both sides,
   which makes this a natural forcing function for resolving that duplication.
4. **H-H-01** (2-5 DTE ATM short-put, narrow validated cohort) — explicitly a
   "research challenger" per TRD §15, not a claim of general transferability; highest
   engineering complexity of this list since it needs its own validated underlying
   cohort before any comparison is meaningful.
5. **H-D-01** (defined-risk spread when CSP sizing is zero) — correctly `TEST (GATED)`
   — do not schedule ahead of Level 3/archetype-graduation gates; listed last and
   explicitly not to be started before those gates, per its own status.

Promotion mechanics for any of the above already exist and require no new
specification: `src/theta/management-policy-promotion-ladder.ts` (C1, frozen) defines
`BOOTSTRAP_PAPER → SHADOW_CHALLENGER → PAPER_CANDIDATE → PAPER_CHAMPION` with
`liveEligible` hardcoded `false` and never settable by evidence; `docs/quant/phase2/
MODEL_REGISTRY.md`'s per-model promotion/failure criteria (untouched-OOS EV_net
improvement, no DD/ES regression, calibration, clustered-bootstrap/regime-resampling
survival) apply directly. No new promotion criteria were invented this pass.

## 6. Data requirements / insufficient evidence

Unchanged from `docs/research/HISTORICAL_OPTIONS_DATA_GAP.md`'s own conclusion:
**no additional data provider is justified.** Alpaca + Optionomics remain sufficient
in principle; what's missing is empirical coverage/entitlement verification
(historical option bid/ask, intraday quote timestamps for fill replay), not a new
vendor. Every hypothesis above is `INSUFFICIENT_DATA`/`BLOCKED_BY_DATA` until that
verification happens — this pass does not change that status, and does not fabricate
a backtest result to work around it.

## Receipt

See the conversation's final C2 receipt for the structured status fields. This
document does not repeat them.
