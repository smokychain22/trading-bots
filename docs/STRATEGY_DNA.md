# THETA Strategy DNA / Hypothesis Foundation

Owner: Claude (quant research + strategy-validation lead). Built entirely offline,
independent of Codex's provider-connectivity work, per explicit instruction. **This is
a narrative index into structured, machine-usable data and code** — the actual
deliverable is under `bots/theta/quant/expert_priors/` and `bots/theta/quant/research/`,
not this document. Read this first for orientation, then go to the data.

## Why this exists ahead of Phase 6

`docs/PHASED_PLAN.md` places research/model work in Phase 6, after broker/provider
infrastructure (Phases 1–5). This milestone is an explicit, instructed exception: it is
**pure offline research** — expert-evidence curation, hypothesis formalization, and
benchmark/experiment design — that needs no database, no provider connection, and no
Codex-built infrastructure to exist. It does not jump ahead on anything that actually
requires infrastructure (no backtester was built or run; no experiment has a result).

## What's here

| File | Contents |
|---|---|
| `bots/theta/quant/expert_priors/data/expert_sources.json` | The canonical Expert Strategy DNA representation: all 11 named sources from TRD §14/§53, each with evidence_class (all D_EXPERT_DNA), evidence_state, borrowed prior, explicit do-not-assume caveat, and failure-DNA/failure-study flags. |
| `bots/theta/quant/expert_priors/weighting.py` | The evidence-weight framework as pure functions: `RawExpertWeight_e = DataQuality × SampleConfidence × RegimeFit × Recency × Independence × Transferability`, `ShrunkWeight_e`, `ExpertPrior(a\|X)` (TRD EXPMATH-001/002). No hard-coded shrinkage constant — `k_shrink` must come from a versioned config, never a default baked into code. |
| `bots/theta/quant/expert_priors/data/expert_archetype_map.json` | Which archetype(s) each expert's evidence informs, with a note explaining the fit — including cross-cutting cases where an expert doesn't fit one archetype cleanly. |
| `bots/theta/quant/research/data/strategy_archetypes.json` | The six requested archetypes (THETA-Q/H/R/C/A/D), each mapped explicitly to the frozen runtime `strategy_branch` enum where one exists — this is a research-organizing taxonomy, not a redefinition of that schema enum. |
| `bots/theta/quant/research/candidate_actions.py` | The 11-action candidate vocabulary (WAIT/OPEN_CSP/HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/RECOVERY_WAIT/SELL_CC/CLOSE_STOCK/REDEPLOY), with an explicit mapping to the runtime `entry_action`/`management_action` schema enums. |
| `bots/theta/quant/research/data/feature_families.json` | The full TRD Appendix H feature registry, each tagged with a data-availability status that cross-references `docs/DATA_READINESS_ASSESSMENT.md`. |
| `bots/theta/quant/research/data/hypotheses.json` | **The core deliverable**: 14 testable conditional hypotheses across all 6 archetypes, each with source experts, required feature families, a benchmark/null/ablation reference, an experiment ID, a data-availability verdict, and a status (RETAIN/CORRECT/TEST/REJECT) with rationale, plus the full mechanism/state/alternatives/label/payoff/failure-mode/calibration/evidence/acceptance/rejection field set (Phase 1B). Includes a deliberately preserved contradiction (H-R-01 vs H-R-02) and the SQQQ failure-DNA lesson as an explicit, non-deletable measurement hypothesis (H-H-02, H-A-03), plus H-A-02/H-A-04's constraint-vs-parameter split. |
| `bots/theta/quant/research/data/benchmarks.json` | TRD's own B0–B6/A1–A6 matrix, reused verbatim, plus 11 archetype-specific benchmark definitions and a `control_matrix` mapping the ten requested controls (Phase 1B) to their IDs. |
| `bots/theta/quant/research/data/experiments.json` | One experiment per hypothesis (or hypothesis pair), with acceptance/rejection criteria drawn only from TRD's own evidentiary standard (§30/§49/§50) — no invented numeric thresholds. |
| `bots/theta/quant/research/registry.py` | Loader + full cross-reference validator (`validate_registry()`) for everything above. |
| `bots/theta/tests/quant/` | Unit tests: weighting math (hand-computed expected values), registry integrity, expert/archetype cross-references, candidate-action vocabulary. Stdlib `unittest` only — no external dependency, since no Python toolchain exists in this repo yet to install one into. |

## How the requested checklist maps to what was built

- **Canonical Expert Strategy DNA representation** → `expert_sources.json` (11 experts, all TRD §14/§53 content transcribed, not paraphrased from memory).
- **Evidence-weight framework** → `weighting.py`, exact formula from TRD §48.
- **Six archetypes** → `strategy_archetypes.json`, explicitly cross-referenced to the frozen runtime branch enum so nothing looks like a silent schema redefinition.
- **Map expert evidence into archetypes** → `expert_archetype_map.json`.
- **Preserve contradictions and failure DNA rather than averaging** → H-R-01/H-R-02 (active management vs. patience, explicitly cross-linked as contradicting, never merged into one blended rule) and H-H-02/H-A-03 (SQQQ failure-DNA retained as standing measurement constraints, not softened into a trading tip).
- **Convert trader behavior into testable conditional hypotheses** → all 13 entries in `hypotheses.json` are `IF <state/feature condition> THEN <action> has <effect relative to a named baseline>` statements, not restated folklore.
- **Candidate actions** → `candidate_actions.py`, exactly the 11 requested, with the runtime-enum mapping and an explicit note on the one vocabulary gap found (defined-risk spread structures have no distinct action in this list — flagged in H-D-01 rather than silently invented).
- **Feature families per hypothesis** → `feature_families_required` on every hypothesis, referencing IDs in `feature_families.json`.
- **Testable now vs. needs future provider data** → `data_availability_status` on every hypothesis, distinguishing infra-independent historical testability from genuine Alpaca-entitlement or future-live-TCA blockers (cross-referenced to `docs/DATA_READINESS_ASSESSMENT.md`, not re-derived).
- **Benchmarks and random-null comparisons per strategy family** → `benchmarks.json`, canonical + archetype-specific, with B5 as the shared random-null reference.
- **Experiment IDs and acceptance/rejection criteria** → `experiments.json`, criteria sourced only from TRD's own standard.
- **Explicit RETAIN/CORRECT/TEST/REJECT** → every hypothesis has one, with rationale. Current tally (post Phase 1B H-A-02 split, 14 hypotheses): 7 RETAIN (already structurally enforced by a TRD `[MUST]` or the charter's own non-negotiable rules — kept as standing constraints, still worth confirmatory benchmarking), 0 CORRECT (H-A-02's conflation was resolved by splitting it into H-A-02/RETAIN + H-A-04/TEST, not by relabeling it), 7 TEST (genuinely open), 0 REJECT (nothing in the corpus was found to be worth discarding outright — the closest candidates, like universal 50%-close or automatic-CC-after-assignment, were already TRD prohibited-shortcuts, not corpus-sourced hypotheses to reject here).
- **No invented performance numbers, no tuning toward 70–80%** → `experiments.json` contains zero results (every entry's `status` is `NOT_YET_RUN`, `BLOCKED_ON_HYPOTHESIS_REFINEMENT`, or `GATED_DO_NOT_RUN`), and a unit test (`test_no_hypothesis_claims_a_performance_number`) structurally guards against a future edit adding one directly into the hypothesis registry instead of into a real experiment-run record.

## What this is not

This is not a backtester, and running these experiments for real is Phase 6 work that
depends on Codex's infrastructure (FusionSnapshot, candidate/decision persistence, a
point-in-time dataset pipeline) existing first. Nothing here was validated against real
data. `validate_registry()` checks internal *consistency* of the hypothesis
registry — cross-references resolve, no orphaned IDs, no asymmetric contradictions —
not economic validity. That's what Phase 6 is for.

## Phase 1 update: full hypothesis field set + THETA-Q baseline code

Per a follow-up research assignment, `hypotheses.json` was enriched in place
(no breaking changes to existing fields/cross-references) with the full
field set requested: `mechanism`, `state`, `alternatives`, `label_type` +
`label_definition` (TRD section 46's label taxonomy), `payoff_target`,
`failure_mode`, `calibration_requirement`, `evidence_requirement`,
`acceptance_criterion`, and `rejection_criterion` — all 13 hypotheses, not a
subset. `registry.py` and its tests now enforce that every hypothesis has
this full field set and a valid `label_type`.

`bots/theta/quant/models/theta_q_baseline.py` is the first simple,
non-ML THETA-Q baseline: a transparent, reason-coded CSP candidate
scorer (hard-veto liquidity/event/contract gates, an explicit ownership ×
(1 − severe-drawdown) soft score, TRD Appendix A economics formulas, and
hard-cap-only sizing). It deliberately does **not** compute a fabricated
`EV_net` — that requires a calibrated entry-outcome model this baseline
doesn't have, and inventing one would violate the no-invented-numbers rule.
`bots/theta/tests/quant/test_theta_q_baseline.py` covers it with synthetic
(clearly labeled, non-real-market) fixtures, including hand-computed
economics, quantity-zero reachability, and IV-rank never acting as a
standalone gate.

## Continuation plan for the rest of the Phase 1 research brief

Given the size of the full brief (ownership/regime models, deeper entry
research, THETA-H-specific statistics, assignment/recovery survival
modeling, covered-call utility modeling, roll intelligence, management
policy sweeps, model-family selection, and the full validation framework),
this update deliberately scoped to the hypothesis-registry enrichment and
the THETA-Q baseline rather than shipping shallow stubs for everything at
once — thin, unvalidated stand-ins for a survival model or a regime HMM
would look like progress without being trustworthy. Next, in priority order:

1. Ownership model (item 4): formalize the feature list already in
   `feature_families.json` into an actual scoring function (still
   non-ML-first, per the brief's own "start with interpretable baselines"
   instruction), replacing the placeholder product formula in
   `theta_q_baseline.py`'s `_ownership_evaluation`.
2. Regime model (item 5): a rule-based baseline over trend/volatility/
   event/liquidity/stress, before any clustering/HMM challenger.
3. THETA-H-specific baseline (item 7): a variant of `theta_q_baseline.py`'s
   structure for the 2-5 DTE cohort, kept statistically separate per H-H-02.
4. Assignment/recovery survival modeling (item 8) and covered-call
   `CCUtility` implementation (item 9) — both have exact formulas already in
   the TRD and in `hypotheses.json`'s `payoff_target` fields, ready to
   implement once items 1-2 exist to feed them.
5. Roll intelligence (`RollUtility`, item 10) and management-policy sweeps
   (item 11) build on the same pattern.
6. Model family selection (item 12) and the validation framework (item 13)
   are Phase 6 infrastructure-heavy work and stay gated on Codex's
   FusionSnapshot/dataset pipeline regardless of how much research design
   is ready before then.

## Phase 1B update: executed test suite, ownership/regime/THETA-H models, benchmark matrix

Python 3.12 was not actually present on this machine despite being expected;
installed it (`winget install Python.Python.3.12`) and ran the full quant
suite for the first time. **Result: all 57 previously-unexecuted tests
passed on the first run** (the hand-tracing from the prior sessions held
up). New work added in this update was developed test-first against the
now-working interpreter, so everything below has actually been executed,
not just hand-traced.

- **`bots/theta/quant/models/ownership_v0.py`**: the first interpretable
  Ownability model — `LiquidityQuality x StructuralQuality x RecoveryQuality
  x TailQuality x EventAdjustment`, every component reason-coded and
  labeled `ARCHITECTURAL` or `TEST` in `COMPONENT_STATUS` (only "ownership
  gets scored at all", "a liquidity floor exists", "an event adjustment
  exists", and "thesis invalidation is a hard signal, not a score input"
  are architectural; the multiplicative combination itself and every
  component's internal formula are TEST). Explicitly separates
  `ownability_at_entry` from `ownability_after_adverse_move` (same function,
  re-invoked on fresh state) and `thesis_invalidation` (a boolean reason
  code, never blended into the numeric score).
- **`bots/theta/quant/models/severe_drawdown_spec.py`**: the label
  specification for `P(severe_drawdown | state, underlying, horizon)` — NOT
  a fitted model (none exists until the dataset does). Formalizes the
  threshold-family vocabulary, `BREACHED` / `SURVIVED` / `CENSORED` label
  status, and a leakage-guarded label-computation function that only ever
  reads price data through `min(horizon_end, dataset_cutoff)` — a unit test
  proves it ignores a later, would-breach data point sitting past the
  cutoff.
- **`bots/theta/quant/models/recovery_spec.py`**: formalizes `S_recovery(t)`
  and its derived quantities (`P(recovery<=5d/10d/20d)`, median, P95,
  censored-tail detection) as pure functions over any survival curve, plus
  an explicit `RecoveryBasis` enum so "recovered" is always tied to a named
  economic basis (assignment cost basis, whole-chain breakeven) rather than
  "price went up." One test failure was found and fixed here — see below.
- **`bots/theta/quant/models/regime_v0.py`**: Regime v0, five independent
  axes (trend/volatility/event/liquidity/stress) per TRD section 42's own
  `regime_state` shape — deliberately does NOT collapse them into one score.
  A test proves BULL trend can co-exist with EARNINGS_NEAR event state in
  the same snapshot, which a single blended score would destroy. The module
  docstring specifies exactly how a future HMM/clustering challenger would
  be evaluated (per-axis replacement, OOS-beats-baseline-or-it-doesn't
  promote — TRD REG-003), not implemented speculatively now.
- **`bots/theta/quant/models/theta_q_lattice.py`**: the THETA-Q candidate
  grid generator. `LatticeConfig` raises `ValueError` at construction if
  fewer than two delta bands are configured — "never choose only 0.20 or
  0.25 delta" is enforced structurally, not left as a convention to
  remember. WAIT is always present in the result.
- **`bots/theta/quant/models/theta_h_baseline.py`**: the THETA-H baseline,
  in a completely separate class/type namespace from `theta_q_baseline.py`
  (`ThetaHCandidateInputs`/`ThetaHPolicyV0`/`ThetaHEvaluation`, not shared
  types) so the two archetypes' stats can never be accidentally pooled, per
  H-H-02. Adds the requested short-DTE diagnostics (gamma exposure,
  overnight gap history, distance-to-strike, an explicit assignment-
  probability *proxy* labeled as not a fitted model, and a
  recovery-requirement flag). No win-rate field exists anywhere in its
  output — a test asserts this structurally.
- **H-A-02 split** (`hypotheses.json`): the previously conflated `CORRECT`
  hypothesis is now two entries. `H-A-02` is a `measurement`-type,
  `RETAIN`-status architectural constraint ("a recovery bound must exist"),
  verified by implementation inspection, no experiment attached. `H-A-04` is
  the genuinely open, `TEST`-status parameterized question ("which bound"),
  with an explicit three-step leakage guard in its `failure_mode` field:
  define the candidate sweep before touching any OOS split, select using
  only the purged walk-forward split, confirm on a separate untouched OOS
  split the candidate was never evaluated against during selection — a
  result produced any other way is rejected on process grounds regardless
  of the number. `experiments.json`'s `EXP-A-02` was renamed `EXP-A-04` to
  match rather than left as an orphaned reference.
- **Benchmark matrix** (`benchmarks.json`): added the three missing
  requested controls (`BQ-2` fixed-single-delta CSP, `BQ-3` the THETA-Q v0
  baseline itself run as-is, `BA-3` unconditional assignment) and a
  `control_matrix` block mapping every one of the ten requested controls to
  its benchmark ID, with an explicit note that several of these (BQ-2,
  BA-1/BA-3, BC-2) are deliberately bad policies included so the real
  strategy has to prove it beats them — never policies to actually run.

### Guardrail: the transparent baseline must not quietly become the decision rule

Per explicit feedback: not fabricating `EV_net` was the right call, but the
bigger risk is the *reverse* mistake — letting a heuristic that happened to
be implemented first silently calcify into the production alpha model
because nothing forced a comparison against something better. The intended
progression, now recorded here so it isn't lost:

```
Transparent heuristic (theta_q_baseline.py, theta_h_baseline.py, ownership_v0.py, regime_v0.py)
        |
Benchmark (this heuristic IS benchmark BQ-3 -- it is compared, not trusted)
        |
Empirical conditional outcomes (Phase 6 dataset once it exists)
        |
Calibrated model (TRD MODEL-003)
        |
Scenario EV (TRD section 17 cycle-value model)
        |
AEGIS (risk transform)
        |
Decision
```

`BQ-3` in `benchmarks.json` exists specifically to operationalize this: the
transparent baseline is registered as a *control other things must beat*,
not as a candidate for the production decision path. Nothing in this
codebase currently wires any of these v0 modules into an actual trading
decision — they are research/backtest inputs only, and should stay that way
until Phase 6 produces something further down this chain that beats them.

## Known gaps, honestly flagged rather than papered over

- **Resolved in Phase 1B**: Python 3.12 is now actually installed on this machine
  (it was not, despite being expected — see the Phase 1B section above) and the
  full suite (131 tests as of this update) has been executed for real, not just
  hand-traced. One genuine test defect was found and fixed during this process —
  a test's expectation was wrong, not the code (`unresolved_beyond_observed_range`
  correctly stays `True` even after the P95 quantile is reached, since a nonzero
  survival probability still means part of the sample hasn't recovered; the test
  wrongly conflated "P95 found" with "fully resolved"). No code defects were found
  in any of the previously-unexecuted modules.
- **Resolved in Phase 1B**: H-A-02's conflation of a settled constraint with an
  open parameter was split into H-A-02 (RETAIN, architectural) and H-A-04 (TEST,
  parameterized, with an explicit leakage guard) — see the Phase 1B section above.
- H-D-01 (defined-risk) surfaces a real vocabulary gap: the 11 candidate actions
  supplied for this registry have no distinct action for opening a spread structure.
  Left unfilled rather than inventing one, since THETA-D is explicitly deferred.
- The new v0 models (ownership, regime, THETA-H, lattice) are unit-tested for
  internal correctness (formulas, edge cases, UNKNOWN handling) but not validated
  against real data — that's still Phase 6, gated on Codex's dataset pipeline.
