# THETA Management Model Specification (Phase 5)

Extends `../phase2/MODEL_REGISTRY.md` with the specific baseline+challenger structure
this Phase 5 task requires for the management decision surface. Follows the same
fields as the Phase 2 registry (features, label, censoring, leakage risks, benchmark,
calibration, failure criterion, economic objective) — added here rather than
duplicating `MODEL_REGISTRY.md`'s existing entries, which this file cross-references.

## Management competing-risk / hazard model

- **Baseline:** none implemented (same as `MODEL_REGISTRY.md`'s "management model"
  entry). **Candidate baseline formalism (new in this pass):** a competing-risks
  survival model where each management action (CLOSE, ROLL, EXPIRE, ASSIGN) is a
  distinct "event type" that can end a position's HOLD state, with HOLD itself as the
  censored/ongoing state at any given timestamp.
- **Challenger:** a full multinomial hazard model with time-varying covariates
  (DTE, moneyness, ownership state, regime state) predicting the instantaneous
  probability of each event type at each timestep — versus the simpler alternative of
  treating this as a sequence of independent binary classifiers (one per action),
  which is a legitimate simpler baseline in its own right and should be tried first per
  MODEL-001.
- **Features:** `dte`, `log_moneyness`, `delta`, `ownership_acceptability`,
  `p_severe_drawdown`, `regime_state`, `premium_capture`, `capital_days`,
  `contract_iv`.
- **Label:** which event type (CLOSE/ROLL/EXPIRE/ASSIGN) actually terminated the HOLD
  state, or right-censored if the position is still open at dataset cutoff.
- **Censoring:** standard right-censoring for still-open positions at dataset cutoff —
  identical discipline to `recovery_spec.py`'s existing censoring handling, extended
  from a single-event survival model to a competing-risks setting.
- **Leakage risks:** the same purged walk-forward/untouched-OOS discipline as every
  other THETA model; the specific new risk here is that a competing-risks model's
  covariates must be time-varying and computed strictly from data at or before each
  evaluated timestep, not the position's eventual (only-knowable-in-hindsight) outcome
  path.
- **Benchmark:** `BR-4` (fixed premium stop, proposed in `PHASE5_MASTER_SPEC.md`),
  `B3`/`BR-2` (fixed profit-take), `BR-1` (hold-to-expiry).
- **Calibration:** full `shared_calibration_requirement` per event type, not one global
  number — a competing-risks model that is well-calibrated for CLOSE but poorly
  calibrated for ASSIGN should not be reported as "calibrated" without that
  distinction.
- **Failure criterion:** no improvement in downstream `ManagementUtility`-based
  decisions over the simpler per-action binary-classifier baseline, or poor per-event
  calibration.
- **Economic objective:** feed `ManagementUtility` (see `ACTION_VALUE_FORMULAS.md`)
  with real event probabilities rather than the current architecture-only reasoning.
- **Data dependency:** `TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA`.

## Assignment model

Cross-reference: `MODEL_REGISTRY.md`'s existing "assignment model" entry is
unchanged and authoritative. This pass adds one refinement: the assignment model's
serving-time inputs must exactly match what a competing-risks hazard model above would
use for its ASSIGN event type, so the two are not developed as accidentally
inconsistent parallel models. **Status: SPECIFIED, BLOCKED_BY_DATA, unchanged.**

## Recovery survival model

Cross-reference: `MODEL_REGISTRY.md`'s existing "recovery model" entry is unchanged
and authoritative (`recovery_spec.py`'s survival-curve contract). No new fields added
by this pass beyond noting that the H-A-04 recovery-wait sweep and this section's
competing-risks model both eventually need to share the same underlying recovery-time
survival curve, not two independently-fit versions of it. **Status: SPECIFIED
(contract only), BLOCKED_BY_DATA, unchanged.**

## Roll evaluator

Cross-reference: `MODEL_REGISTRY.md`'s existing "roll evaluator" entry is unchanged.
This pass adds: the roll evaluator's `EV_best_alternative` computation should draw
from the same management competing-risks model above where possible (e.g. using the
model's own ASSIGN/EXPIRE/HOLD probability estimates as the alternative-comparison
inputs), rather than being built as a fully separate model with its own independent
probability estimates for the same underlying events — a "one source of truth per
concept" instinct applied to models, not just documents. **Status: SPECIFIED,
unimplemented, unchanged.**

## Covered-call ranker

Cross-reference: `MODEL_REGISTRY.md`'s existing "covered-call ranker" entry is
unchanged. No new fields added.

## Severe-drawdown model

Cross-reference: `MODEL_REGISTRY.md`'s existing "severe drawdown model" entry is
unchanged, including the `CORPORATE_ACTION_AMBIGUOUS` status still not yet implemented
in `severe_drawdown_spec.py` (per `../PHASE2_4_CORRECTION_AUDIT.md` finding 2, still
open).

## Status

One new candidate model (management competing-risk/hazard model) registered; five
existing model entries cross-referenced without duplication. All SPECIFIED,
BLOCKED_BY_DATA. No model has been fit. No performance claimed.
