# THETA Benchmark and Experiment Registry — Narrative Index

Durability artifact (see `PHASE2_MASTER_SPEC.md`). **This file does not duplicate
structured data.** The canonical, single source of truth for every benchmark ID,
experiment ID, and control-matrix mapping remains
`bots/theta/quant/research/data/benchmarks.json` and
`bots/theta/quant/research/data/experiments.json` — both already IMPLEMENTED as data
and unchanged by this durabilization pass. This file adds the narrative grouping the
original conversational Phase 2 deliverable provided, organized by baseline/null
*family* rather than by ID, so a reader can see the shape of the control matrix without
re-deriving it from the raw JSON.

## Family: no-trade / opportunity-cost reference

- **Cash/WAIT** (`B0`) — the floor every other family must clear; also the standard
  answer whenever a hard veto or `HARD_VETO` risk state applies.

## Family: naive/random selection nulls

- **Random eligible CSP** (`B5`) — matched by ticker/DTE/structure/size; the standard
  random-null reference reused across every archetype's entry-selection hypothesis
  (H-Q-01, H-H-01), not redefined per archetype.
- **Random-entry variants for other archetypes** reuse `B5` against the archetype's own
  universe/DTE/structure rather than a bespoke random-null per archetype, per
  `benchmarks.json`'s own note.

## Family: naive economic selection (premium/IV-blind)

- **IV/premium only** (`BQ-1`) — counterfactual for H-Q-01/H-Q-02; the naive rule this
  repo's ownership model must beat.
- **Fixed delta** (`BQ-2`) — a deliberately bad control: always the closest-to-0.20/0.25
  delta contract, ignoring the multi-band lattice entirely. Exists specifically because
  `LatticeConfig` enforces ≥2 delta bands at construction (see
  `test_single_delta_band_is_rejected_at_construction`) — `BQ-2` is the counterfactual
  that construction-time rule is designed to beat, never a policy to run live.
- **Fixed DTE** and **fixed delta + fixed DTE** — the conventional 30-60 DTE lattice
  treated as fully static, no ownership/regime conditioning; a stricter version of
  `BQ-1`/`BQ-2` combined. Not yet a separately named ID in `benchmarks.json` — flagged
  here as a gap the benchmark registry could add if a future experiment needs the
  combined-naive control isolated from each factor individually (see
  `PHASE2_4_CORRECTION_AUDIT.md` for this specific finding).

## Family: transparent baseline (the thing sophistication must beat)

- **Transparent THETA-Q baseline itself** (`BQ-3`) — `models/theta_q_baseline.py` run
  as-is. Answers "does sophisticated THETA actually beat something simple," not itself
  a candidate for the production decision rule (see that file's own docstring and
  `benchmarks.json`'s description).

## Family: management-timing extremes

- **Hold to expiry** (`BR-1`) — counterfactual for H-R-01 (the active-management
  thesis).
- **Fixed 25/50/75% capture** (`B3`, canonical TRD benchmark) and **fixed 50% specific**
  (`BR-2`) — counterfactual for H-R-02 (the patience thesis); `BR-2` is the exact
  opposing baseline stated in H-R-02's `acceptance_criterion`.
- **Fixed time exit** (`B4`, canonical) — time-based management benchmark, distinct
  from profit-capture-based management.
- **Mechanical roll / never roll** — the two extremes H-R-03's alternatives-comparison
  requirement is meant to beat; `BR-1` (never roll, folded into hold-to-expiry) is
  already registered, "always roll if credit positive" (the naive policy EXP-R-03
  compares against) is described in `experiments.json`'s `EXP-R-03` entry rather than
  given its own benchmark ID — a candidate future registry addition, not yet made.

## Family: assignment-handling extremes

- **Mechanical close-before-assignment** (`BA-1`) — counterfactual for H-A-01,
  deliberately a bad policy (throws away recoverable optionality).
- **Unconditional assignment acceptance** (`BA-3`) — the opposite bad extreme,
  accepting every assignment regardless of ownership quality.
- **Buy-and-hold assigned underlying** (`B6`, canonical) — tests whether active Wheel
  management adds value beyond simply holding, once assigned.

## Family: recovery-handling extremes

- **Unconditional hold-to-original-basis recovery** (`BA-2`) — counterfactual for
  H-A-04's parameterized sweep specifically (not H-A-02, which is now a settled
  architectural constraint verified by inspection, not backtest).

## Family: covered-call handling extremes

- **Max annualized yield only** (`BC-1`) — counterfactual for H-C-01.
- **Immediate CC after every assignment** (`BC-2`) — counterfactual for H-C-02, and a
  direct test of one of the charter's own non-negotiable rules.

## Family: canonical TRD ablation steps (A1-A6)

`A1` (+ ownership model) through `A6` (+ execution/fill model) — the incremental-value
ablation ladder TRD §49 defines, each step adding exactly one component over the
previous. `EXP-Q-01`/`EXP-Q-02` scope `A1` specifically to the CSP-entry decision;
later hypotheses reuse `A5` (dynamic management) for the R-family, and no hypothesis
yet requires `A2`/`A6` in isolation — flagged as an intentional current gap (those
ablation steps have no experiment registered against them yet), not an oversight to
silently fill.

## Cross-cutting principle (restated from `benchmarks.json`, not new)

Several of the above are deliberately bad policies — `BQ-2`'s single delta, `BA-1`/
`BA-3`'s opposite mechanical extremes, `BC-2`'s immediate-CC — included specifically so
a real THETA policy has to prove it beats them, never because any of them should run
live. Never collapse two controls that isolate different hypotheses into one combined
comparison (e.g. testing ownership-model value and regime-model value in the same run
without the intermediate `A1`-only step) — this loses the ability to attribute an
observed improvement to a specific component.

## Status

All benchmark/experiment definitions referenced here are already correctly persisted as
structured data (`benchmarks.json`/`experiments.json`, both unmodified by this
durabilization pass). Every experiment status is `NOT_YET_RUN` or `GATED_DO_NOT_RUN`
(the `EXP-D-01` THETA-D gate) — nothing in this file or the underlying JSON records a
result, and none should be added until a real backtester exists and is actually run
(Phase 6 gate).
