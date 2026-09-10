# Empirical Management Experiment Registry (Phase 5)

Extends `../phase2/BENCHMARK_AND_EXPERIMENT_REGISTRY.md` and `research/data/
experiments.json` (unchanged, authoritative) with the management-specific controlled
experiment matrix this task requires. **Every experiment below is `NOT_YET_RUN` — no
backtester exists (Phase 6 gate). No numeric result appears anywhere in this file.**

## Controlled variants (management-timing dimension)

| Variant | Existing benchmark ID | New in this pass |
|---|---|---|
| Fixed 25%/50%/75% capture | `B3` | — |
| Fixed 50% specifically | `BR-2` | — |
| Expiry (hold to expiration) | `BR-1` | — |
| Fixed time exit (e.g. 21-DTE style) | `B4` | — |
| Underlying stop (close if underlying breaches a fixed adverse move) | — | Proposed `BR-5` — not yet added to `benchmarks.json`, recommended for a future session |
| Premium stop (fixed multiple of entry credit) | — | Proposed `BR-4` (see `PHASE5_MASTER_SPEC.md` §2) |
| Remaining-EV exit (close when a real `EV_net` estimate turns negative) | — | Not a benchmark — this is the *challenger* direction (H-M-02/03/04), requires the management model in `MANAGEMENT_MODEL_SPECIFICATION.md` to exist first |
| Event exit (close ahead of a named event, e.g. earnings) | — | Related to `earnings_distance_days`'s existing hard-veto at entry; a management-time version is TEST, not yet registered as its own hypothesis |
| Dynamic management (regime/ownership/DTE-conditioned) | — | H-M-02/03/04 |
| Roll | `BR-1` (never-roll) is the counter-extreme; "always roll if credit positive" has no dedicated ID (per `../PHASE2_4_CORRECTION_AUDIT.md` finding 5) | — |
| Assignment (accept vs. avoid) | `BA-1`/`BA-3` | — |
| Recovery WAIT | `BA-2` (unconditional) | — |
| Immediate CC | `BC-2` | — |
| Delayed CC | — | Related to the proposed H-C-03 in `CC_POLICY_HYPOTHESES.md`, not yet a registered hypothesis or benchmark |
| Stock exit (`CLOSE_STOCK`) | Implicit alternative in H-A-01/H-C-01/H-C-02's `alternatives` fields | Not yet a standalone benchmark ID |

## Required metrics (per experiment, restated from the shared standard — not new)

`EV_net`, `PF_net`, Managed Episode WR, Whole-Chain WR, AvgWin, AvgLoss, payoff shape
(`BreakEvenWR`/`EdgeBuffer`), max DD, ES/CVaR, capital-days
(`ReturnPerCapitalDay`), assignment frequency, recovery duration, open-inventory MTM
(`WholeChainPnL`'s open component), fill/slippage (execution-label outcome once the
fill model exists). Every experiment reports the full set together — never one metric
in isolation, per this repository's standing discipline.

## The 70-80% target discipline (Section G, restated as a standing rule for this registry specifically)

**No experiment in this registry may be tuned — by threshold selection, feature
selection, or OOS-split manipulation — to manufacture a result in the 70-80% Managed
Episode WR range.** The registry's job is to find whether any *named, independently
validated* high-confidence cohort naturally supports that range (TRD §40, §50's own
framing) — and if a lower-WR cohort (the task's own example: 62%) shows better
after-cost EV, PF, DD, tail behavior, and capital efficiency, **that cohort is reported
as the superior one**, full stop, regardless of how it compares to the 70-80% figure.
This is not a new rule — it restates `CLAUDE.md`'s non-negotiable rules and TRD §2.2
— recorded here because this Phase 5 task's management-timing experiments are exactly
where the temptation to reverse-engineer a specific WR by picking a favorable stop/
target threshold would be strongest, given how directly a stop/target parameter can be
swept to move realized WR.

## Status

Registry of experiment *designs* only. All `NOT_YET_RUN`, `BLOCKED_BY_DATA`. No
performance claimed anywhere in this file.
