# THETA Phase 2 Quant/Engineering Master Contract

**Status of this document:** durability artifact. The content below was previously
produced only as conversational output (an earlier "CLAUDE BOT PHASE 2" deliverable)
and was never committed to the repository. This file, and the sibling files in
`docs/quant/phase2/`, persist that work as reviewable, version-controlled specification
— not as new research, and not as an implementation. Nothing here overrides the TRD;
where this document restates a TRD requirement it cites the section, and where it goes
beyond the TRD (a design choice the TRD leaves open) that is stated explicitly.

**Conflict precedence, per this durabilization pass's charter:** TRD v1.1 FINAL > PRD
v1.1 FINAL > Backend/Database Schema v1.1 FINAL > PostgreSQL bootstrap > canonical
blueprint > this repo's own research corpus (`bots/theta/quant/research/data/*.json`,
`docs/STRATEGY_DNA.md`) > expert inference > GitHub reference examples. Every item below
is labeled RETAIN / CORRECT / TEST / REJECT against that precedence, and every item
carries a maturity label — see Part E of the durabilization instruction and
`docs/quant/PHASE2_4_CORRECTION_AUDIT.md`.

## Scope

This master spec indexes the full Phase 2 engineering/research contract for every
THETA archetype and cross-cutting subsystem. It does not repeat structured data already
correctly captured in `bots/theta/quant/research/data/*.json` — those remain the single
source of truth for hypotheses, benchmarks, experiments, and feature families. This
document is the narrative connective tissue Codex needs to see how those pieces compose
into engine contracts, plus the pieces that were never captured anywhere: the AEGIS
quant contract, the dataset/label contract, and the model-governance rules.

## Contract index

| Subsystem | File | Maturity of the subsystem overall |
|---|---|---|
| THETA-Q (quality ownership / CSP entry) | this file, §1 | Baseline: IMPLEMENTED (`models/theta_q_baseline.py`, `theta_q_lattice.py`). Learned entry-outcome model: SPECIFIED (not built). |
| THETA-H (hold-the-strike) | this file, §2 | Baseline: IMPLEMENTED (`models/theta_h_baseline.py`). Empirical validation: BLOCKED_BY_DATA. |
| Ownership model | this file, §3 | v0: IMPLEMENTED (`models/ownership_v0.py`). Formula itself: RESEARCH_HYPOTHESIS (see `COMPONENT_STATUS` in that module). |
| Regime model | this file, §4 | v0: IMPLEMENTED (`models/regime_v0.py`). |
| Severe drawdown model | this file, §5 | Label spec: IMPLEMENTED (`models/severe_drawdown_spec.py`). Fitted predictive model: SPECIFIED, BLOCKED_BY_DATA. |
| Assignment model | this file, §6 | Decision logic: RETAIN at architecture level (H-A-01/02/03/04). Fitted probability model: SPECIFIED, BLOCKED_BY_DATA. |
| Recovery model | this file, §7 | Survival-curve spec: IMPLEMENTED (`models/recovery_spec.py`). Fitted curve: BLOCKED_BY_DATA. |
| Covered-call engine | this file, §8 | SPECIFIED (CCUtility formula registered; ranker not built). |
| Roll engine | this file, §9 | SPECIFIED (RollUtility/NetRollCredit formulas registered; evaluator not built). |
| Management decision engine | this file, §10 | SPECIFIED. |
| AEGIS quant contract | `AEGIS_SIZING_EXECUTION_CONTRACT.md` | SPECIFIED. |
| Sizing | `AEGIS_SIZING_EXECUTION_CONTRACT.md` | v0 IMPLEMENTED for THETA-Q/H hard caps; confidence-weighted sizing SPECIFIED. |
| Execution/fill/TCA | `AEGIS_SIZING_EXECUTION_CONTRACT.md` | SPECIFIED. |
| Point-in-time data contract | `DATASET_AND_LABEL_CONTRACT.md` | SPECIFIED. |
| Labels | `DATASET_AND_LABEL_CONTRACT.md` | SPECIFIED; drawdown label IMPLEMENTED as a spec (`severe_drawdown_spec.py`). |
| Backtest/replay | `DATASET_AND_LABEL_CONTRACT.md` §5 | SPECIFIED; no backtester exists (Phase 6 gate). |
| Benchmarks/nulls | `BENCHMARK_AND_EXPERIMENT_REGISTRY.md` | IMPLEMENTED as data (`research/data/benchmarks.json`); this file adds narrative grouping only. |
| Calibration | `MODEL_REGISTRY.md` | SPECIFIED. |
| Walk-forward / untouched OOS | `DATASET_AND_LABEL_CONTRACT.md` §5 | SPECIFIED. |
| Dependence / effective N | `DATASET_AND_LABEL_CONTRACT.md` §5 | SPECIFIED (restates TRD §50, `shared_evidence_requirement` in `experiments.json`). |
| Model governance | `MODEL_REGISTRY.md` | SPECIFIED. |

## 1. THETA-Q contract

Entry candidate scoring for the conventional 30-60 DTE CSP lattice. Implemented:
`models/theta_q_baseline.py` (transparent, non-ML hard-veto + ownership-product scoring
+ sizing) and `models/theta_q_lattice.py` (multi-band delta grid, ≥2 bands enforced at
construction — TRD's own rejection of a single fixed-delta rule, see `BQ-2` in
`benchmarks.json`). Runtime consumption is via `bots/theta/quant/runtime/theta_q_contract.py`
(Codex-authored JSON contract adapter — imports these modules rather than reimplementing
them; confirmed by inspection during the integration-recovery pass).

Open item (SPECIFIED, not built): the calibrated entry-outcome model referenced by TRD
§17, which `theta_q_baseline.py`'s own docstring explicitly defers ("EV_net requires a
calibrated entry-outcome probability model ... which this transparent v0 baseline does
not include by design"). `BQ-3` in `benchmarks.json` is the control this future model
must beat.

## 2. THETA-H contract

Short-dated (2-5 DTE) ATM/near-ATM entry with intentional assignment. Implemented:
`models/theta_h_baseline.py` — separate hard-veto set (DTE window, gamma ceiling,
overnight-gap-history ceiling), diagnostics (distance-to-strike, assignment-probability
proxy, overnight-gap risk flag), and a structural test
(`test_no_wr_field_exists_anywhere_in_the_output`) guarding against this module ever
claiming a win rate. Governed by hypotheses H-H-01 (TEST, narrow-cohort claim, not
assumed to transfer) and H-H-02 (RETAIN, the Leg-WR-hides-inventory-drawdown guard).

## 3. Ownership model contract

`models/ownership_v0.py` implements `Ownability = LiquidityQuality × StructuralQuality ×
RecoveryQuality × TailQuality × EventAdjustment`. The module's own `COMPONENT_STATUS`
dict is the authoritative maturity record — reproduced here for visibility, not
duplicated as a second source of truth:

- ARCHITECTURAL (must hold regardless of formula details): ownership is scored at all
  (never assumed) — TRD UNIV-003; a liquidity floor exists; an event-proximity
  adjustment exists; thesis invalidation is a hard signal, never averaged into the score.
- TEST (open, unproven): the multiplicative combinator itself versus a weighted sum or
  gating structure; every individual component's internal formula
  (`LiquidityQuality`/`StructuralQuality`/`RecoveryQuality`/`TailQuality`/
  `EventAdjustment_decay_function`).

`RecoveryQuality` and `TailQuality` are additionally blocked on `recovery_spec.py` and
`severe_drawdown_spec.py`'s fitted models existing — v0 uses raw historical-episode
proxies, explicitly flagged as a stand-in, not the real model.

## 4. Regime model contract

`models/regime_v0.py` implements the 5-axis regime taxonomy (Trend/Volatility/Event/
Liquidity/Stress states + confidence), deliberately never collapsed into one scalar.
Used as context for every archetype's entry/management decision, never as a standalone
gate on its own.

## 5. Severe drawdown model contract

`models/severe_drawdown_spec.py` implements the label specification only — threshold
families, `BREACHED`/`SURVIVED`/`CENSORED` statuses, and a leakage guard that only reads
points with `entry_date <= as_of <= min(horizon_end, dataset_cutoff)`. This is a label
*definition*, not a fitted predictive model; producing `p_severe_drawdown` for
`ownership_v0.py`/`theta_q_baseline.py` to consume requires fitting a model against this
label on real historical data — SPECIFIED, BLOCKED_BY_DATA.

Proposed addition (CORRECT — the original conversational Phase 2 deliverable used a
three-value status enum without a path for corporate-action ambiguity): a fourth status,
`CORPORATE_ACTION_AMBIGUOUS`, for cases where a split/merger/spinoff makes the
breach/survive determination genuinely undecidable rather than merely missing data. This
is a proposal, not yet implemented in `severe_drawdown_spec.py` — flagged here so Codex
and a future Claude session don't rediscover the need independently.

## 6. Assignment model contract

Governed entirely by hypotheses H-A-01 (RETAIN: assignment-when-acceptable beats
mechanical close-before-assignment, architecturally), H-A-02 (RETAIN: a recovery-wait
bound must exist, architecturally), H-A-03 (RETAIN: Leg WR must never stand alone for
this archetype), H-A-04 (TEST: which specific bound value, via a pre-registered sweep
with the three-step leakage guard in `hypotheses.json`). No probability model exists yet
for assignment likelihood beyond the THETA-H diagnostic proxy
(`assignment_probability_proxy` in `theta_h_baseline.py`, itself explicitly a proxy, not
a fitted model). SPECIFIED, BLOCKED_BY_DATA for the fitted version.

## 7. Recovery model contract

`models/recovery_spec.py` implements the survival-curve summary contract
(`RecoverySummary`, median/P95 crossing detection, monotonicity validation,
undefined-before-first-observation handling) over three recovery bases
(`ORIGINAL_STRIKE_PRICE` / `ASSIGNMENT_ECONOMIC_BASIS` / `WHOLE_CHAIN_BREAKEVEN`). Like
the severe-drawdown spec, this is the *shape* of the model's output, not a fitted curve
— fitting requires real historical recovery episodes. SPECIFIED, BLOCKED_BY_DATA.

## 8. Covered-call engine contract

Governed by `CCUtility` (see `FORMULA_REGISTRY.md`) and hypotheses H-C-01 (RETAIN: full
utility trade-off beats max-yield-only selection, architecturally — TRD LIFE-004) and
H-C-02 (RETAIN: no immediate CC after every assignment — one of the charter's own
non-negotiable rules). No ranker implementation exists yet. SPECIFIED.

## 9. Roll engine contract

Governed by `RollUtility` and `NetRollCredit` (kept as two distinct quantities — a
positive `NetRollCredit` is never treated as proof of a good roll, per H-R-03's
`failure_mode`). H-R-01 and H-R-02 are a deliberately preserved contradictory pair (early
close/roll vs. patience), resolved empirically by A5, not by inspection. H-R-03 (RETAIN)
requires every roll to beat the best feasible alternative (HOLD/CLOSE/ASSIGN/REDEPLOY)
computed at the same decision timestamp — this is TRD ROLL-002, a hard rule, not a
hypothesis under test. No roll evaluator implementation exists yet. SPECIFIED.

## 10. Management decision engine contract

The engine that, at any open-position decision timestamp, evaluates
HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/SELL_CC/CLOSE_STOCK/REDEPLOY against each other using the
utility formulas in `FORMULA_REGISTRY.md`, never picking an action by a fixed rule
without the comparison (this is the general form of H-R-03, applied beyond just rolls).
No implementation exists yet — this is the natural home for the "management decision
engine" named in the durabilization instruction, and it is intentionally left
unimplemented rather than stubbed, since a stub would misrepresent its maturity.
SPECIFIED.

## Cross-references

- Formulas: `FORMULA_REGISTRY.md`
- Model maturity table: `MODEL_REGISTRY.md`
- Data/label contract: `DATASET_AND_LABEL_CONTRACT.md`
- Risk/sizing/execution contract: `AEGIS_SIZING_EXECUTION_CONTRACT.md`
- Benchmark/experiment grouping: `BENCHMARK_AND_EXPERIMENT_REGISTRY.md`
- Corrections found while assembling this package: `../PHASE2_4_CORRECTION_AUDIT.md`
