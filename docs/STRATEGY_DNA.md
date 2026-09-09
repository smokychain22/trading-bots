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
| `bots/theta/quant/research/data/hypotheses.json` | **The core deliverable**: 13 testable conditional hypotheses across all 6 archetypes, each with source experts, required feature families, a benchmark/null/ablation reference, an experiment ID, a data-availability verdict, and a status (RETAIN/CORRECT/TEST/REJECT) with rationale. Includes a deliberately preserved contradiction (H-R-01 vs H-R-02) and the SQQQ failure-DNA lesson as an explicit, non-deletable measurement hypothesis (H-H-02, H-A-03). |
| `bots/theta/quant/research/data/benchmarks.json` | TRD's own B0–B6/A1–A6 matrix, reused verbatim, plus 8 archetype-specific benchmark definitions for comparisons the canonical matrix doesn't name explicitly. |
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
- **Explicit RETAIN/CORRECT/TEST/REJECT** → every hypothesis has one, with rationale. Current tally: 6 RETAIN (already structurally enforced by a TRD `[MUST]` or the charter's own non-negotiable rules — kept as standing constraints, still worth confirmatory benchmarking), 1 CORRECT (H-A-02, needs re-parameterization before it's backtester-ready), 6 TEST (genuinely open), 0 REJECT (nothing in the corpus was found to be worth discarding outright — the closest candidates, like universal 50%-close or automatic-CC-after-assignment, were already TRD prohibited-shortcuts, not corpus-sourced hypotheses to reject here).
- **No invented performance numbers, no tuning toward 70–80%** → `experiments.json` contains zero results (every entry's `status` is `NOT_YET_RUN`, `BLOCKED_ON_HYPOTHESIS_REFINEMENT`, or `GATED_DO_NOT_RUN`), and a unit test (`test_no_hypothesis_claims_a_performance_number`) structurally guards against a future edit adding one directly into the hypothesis registry instead of into a real experiment-run record.

## What this is not

This is not a backtester, and running these experiments for real is Phase 6 work that
depends on Codex's infrastructure (FusionSnapshot, candidate/decision persistence, a
point-in-time dataset pipeline) existing first. Nothing here was validated against real
data. `validate_registry()` checks internal *consistency* of the hypothesis
registry — cross-references resolve, no orphaned IDs, no asymmetric contradictions —
not economic validity. That's what Phase 6 is for.

## Known gaps, honestly flagged rather than papered over

- No Python interpreter was available on this machine to actually execute
  `registry.py`, `weighting.py`, or the test suite. Every JSON file's syntax and
  cross-references were validated with a Node.js script (also not committed — it was
  scratch tooling) and the Python code was traced by hand against that same validated
  data. Codex or a future session should run the actual test suite the first time a
  Python toolchain exists in this repo, and treat this milestone as unverified-by-
  execution until that happens.
- H-A-02 is marked `CORRECT`, not `TEST` or `RETAIN` — its statement conflates a
  settled architectural rule (a recovery bound should exist) with a genuinely open
  parameter (what the bound should be). It needs to be split before a backtester
  should consume it as written; see its `rationale` field.
- H-D-01 (defined-risk) surfaces a real vocabulary gap: the 11 candidate actions
  supplied for this registry have no distinct action for opening a spread structure.
  Left unfilled rather than inventing one, since THETA-D is explicitly deferred.
