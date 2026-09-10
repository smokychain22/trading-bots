# THETA Trader Decomposition Experiments

Durability artifact. Persists the decomposition-experiment design previously produced
only as conversational output — a set of experiment *designs* (not results; nothing has
been run) for isolating which component of an expert's observed behavior actually
carries the hypothesized edge, once real historical data and a backtester exist
(Phase 6 gate). These are BLOCKED_BY_DATA and BLOCKED_BY_INTEGRATION (no backtester)
in full.

## Purpose

An expert's `borrowed_prior` in `EXPERT_REGISTRY.md` is typically a bundle of several
decisions at once (which underlying, when to enter, what structure, when to exit). The
decomposition experiments below exist to isolate which piece of that bundle — if any —
is where the actual edge (if any) lives, rather than accepting or rejecting the whole
bundle as one unit. This directly serves the "expert evidence generates hypotheses
only" discipline: a decomposition experiment turns a vague "this trader seems good" into
a specific, falsifiable claim about one decision axis at a time.

## Registered decomposition designs

1. **ExpertEntry + StandardExit** — use the expert-informed entry-selection rule (e.g.
   ownership-acceptability screening per H-Q-01) but manage/exit every position with
   the mechanical baseline (e.g. `BR-1` hold-to-expiry). Isolates whether the entry
   selection itself carries value independent of any management sophistication.
2. **RandomEntry + ExpertExit** — random eligible-candidate entry (`B5`) combined with
   the expert-informed management rule (e.g. active close/roll per H-R-01, or the
   alternatives-comparison discipline of H-R-03). Isolates management value
   independent of entry selection.
3. **ExpertContract + RandomTiming** — the expert-informed strike/DTE/structure choice
   applied at a randomly chosen eligible entry timestamp rather than an
   opportunistically chosen one. Isolates whether contract selection itself matters
   independent of entry timing.
4. **ExpertTiming + RandomContract** — the inverse of design 3: expert-informed entry
   timing with a randomly chosen contract from the eligible set. Isolates timing value
   independent of contract selection.
5. **ExpertManagement + StandardEntry** — the conventional baseline entry (`BQ-1`/`BQ-2`
   style, or the plain conventional lattice) combined with the expert-informed
   management discipline. A second angle on design 2, useful when the "standard entry"
   reference needs to be the conventional lattice specifically rather than a pure
   random baseline.
6. **ExpertUnderlying + RandomEligibleContract** — the expert-informed underlying
   selection (which tickers this expert's prior applies to at all) combined with a
   random eligible contract on those same underlyings. Isolates whether the
   underlying-selection judgment itself (as distinct from THETA-Q's ownership model,
   which this design would help validate or challenge) carries value.

## How these connect to the existing benchmark/experiment registry

None of designs 1-6 has a registered `experiment_id` in `research/data/experiments.json`
today — they are decomposition *designs*, one level more granular than the
archetype-level experiments already registered there (`EXP-Q-01`, `EXP-R-01`, etc.).
Before any of these six designs is actually run, it should be registered with its own
`experiment_id`, `hypothesis_ids`, comparison definition, and acceptance/rejection
criteria in `experiments.json` — this file records the *design pattern*, not a
shortcut around that registration discipline (see `PHASE2_4_CORRECTION_AUDIT.md` for
this noted as a correction-pass item: these designs must not be run informally outside
the registered-experiment discipline once data exists).

## Required guards (apply to every design above, restated from the shared standard)

- Same candidate set and time period across every variant compared within one design
  (per H-R-01/H-R-02's own `failure_mode` requirement, generalized here to all six
  patterns).
- Purged walk-forward, untouched final OOS never used for selection.
- Raw N and independent-cluster N reported together.
- Selection-bias diagnostics (DSR/PBO) given that six designs times however many
  expert/archetype combinations is a meaningful search breadth in its own right.

## Status

SPECIFIED / BLOCKED_BY_DATA / BLOCKED_BY_INTEGRATION throughout. No decomposition
experiment has been run. This file registers design patterns for future use once a
backtester exists, consistent with Part E/G of this durabilization instruction (do not
run pretend empirical experiments without the required historical data).
