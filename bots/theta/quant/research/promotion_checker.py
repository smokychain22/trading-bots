"""Machine-checkable evaluation against THETA_MODEL_PROMOTION_CONTRACT.md (R6).

Turns that document's checklist into a single, deterministic classifier.
`PROMOTION_ELIGIBLE_RESEARCH` is the best outcome this module can ever
report -- it means the checklist passed, nothing more. It does NOT
activate Production, does NOT populate an executable EV_net anywhere,
and Codex remains final authority over any actual promotion decision
(cross-symbol-economic-frontier.ts, migrations, execution gates). This
module is a research-side gate, not a deployment mechanism.

No I/O, no provider dependency -- pure functions over caller-supplied
evaluation results, exercised only against synthetic fixtures until real
resolved episodes exist (`docs/research/THETA_EV_MODEL_SPEC.md`'s
EV_MODEL_NOT_EMPIRICALLY_READY status, unchanged).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class PromotionResult(str, Enum):
    STRUCTURAL_FAILURE = "STRUCTURAL_FAILURE"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
    STATISTICAL_FAILURE = "STATISTICAL_FAILURE"
    ECONOMIC_FAILURE = "ECONOMIC_FAILURE"
    RISK_FAILURE = "RISK_FAILURE"
    EXECUTION_FAILURE = "EXECUTION_FAILURE"  # R6F, THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_SPEC_v1.0 section 39: "edge disappears after spread/slippage/fill reality" -- a distinct failure mode from RISK_FAILURE's tail/ES/drawdown concerns
    PROMOTION_ELIGIBLE_RESEARCH = "PROMOTION_ELIGIBLE_RESEARCH"


@dataclass(frozen=True)
class PromotionCheckInputs:
    """One model's evaluation results, in the shape
    THETA_MODEL_PROMOTION_CONTRACT.md's checklist requires. Every
    threshold below (`min_independent_chain_n`, `max_acceptable_pbo`,
    `max_acceptable_es_regression_pct`, `max_acceptable_drawdown_
    regression_pct`) is REQUIRED and caller-supplied -- never a
    hardcoded default -- per the standing "no arbitrary financial
    threshold without a previously justified specification" instruction,
    and per the contract's own "thresholds defined before seeing final
    OOS results" requirement (the caller must have fixed these BEFORE
    unsealing final OOS, not after)."""

    # --- Structural gates (checked first: a structural violation
    # invalidates any statistical/economic conclusion regardless of how
    # favorable the numbers look) ---
    used_point_in_time_joins: bool
    leakage_violations: List[str] = field(default_factory=list)  # from walk_forward.py's assert_* functions; non-empty = violation
    only_resolved_chains_used: bool = True  # False if any CENSORED_OPEN/INVALID_DATA/EXTERNAL_ACTIVITY_CONTAMINATED chain entered training/eval
    execution_model_is_direction_aware: bool = True  # False if fill pricing used a shared midpoint/directionless formula
    final_oos_touched_exactly_once: bool = True  # False if final OOS was used for selection, not just confirmation
    training_dataset_hash: Optional[str] = None
    evaluation_dataset_hash: Optional[str] = None
    model_version: Optional[str] = None
    roll_accounting_verified: bool = True  # False if any roll's old-leg realized P&L was found dropped/absorbed rather than summed (episode_economics.py's whole_episode_pnl discipline)
    return_denominator_verified: bool = True  # False if a reported "return" was actually premium_collected-denominated rather than secured-capital-denominated (episode_economics.py's PremiumCapture vs ReturnOnSecuredCapital distinction)
    fill_probability_is_fabricated: bool = False  # True if any reported fill probability was NOT FillProbability.UNKNOWN despite no calibrated fill model existing
    feature_provenance_recorded: bool = True  # False if any feature's source/PIT-availability timestamp was not recorded per row
    ablation_result: Optional[str] = None  # an ablation.py AblationResult value (as its .value string, to avoid a hard import dependency) -- must be "IMPROVES" to promote
    regime_stability_verified: Optional[bool] = None  # False/None if per-regime-cell performance (regime_report.py) was not checked or was inconsistent across cells

    # --- Data sufficiency ---
    independent_chain_n: int = 0
    min_independent_chain_n: int = 0  # REQUIRED, caller-justified

    # --- Statistical evidence ---
    deflated_sharpe_ratio: Optional[float] = None  # from selection_bias.py; None = not computable
    min_acceptable_dsr: Optional[float] = None  # REQUIRED if deflated_sharpe_ratio is supplied
    probability_of_backtest_overfitting: Optional[float] = None
    max_acceptable_pbo: Optional[float] = None  # REQUIRED if probability_of_backtest_overfitting is supplied
    final_oos_ci_excludes_zero: Optional[bool] = None  # None = not yet computed
    calibration_acceptable: Optional[bool] = None  # from calibration_metrics.py's diagnostics, caller's own pass/fail judgment

    # --- Economic evidence ---
    oos_ev_net: Optional[float] = None

    # --- Risk evidence ---
    es_regression_pct: Optional[float] = None  # positive = worse than baseline
    max_acceptable_es_regression_pct: Optional[float] = None  # REQUIRED if es_regression_pct is supplied
    drawdown_regression_pct: Optional[float] = None
    max_acceptable_drawdown_regression_pct: Optional[float] = None  # REQUIRED if drawdown_regression_pct is supplied
    catastrophic_subgroup_collapse: bool = False

    # --- Execution realism (R6F) ---
    edge_survives_realistic_execution: Optional[bool] = None  # False/None if the edge was only positive under an idealized (e.g. midpoint) fill assumption and disappears under direction-aware spread/slippage


def evaluate_promotion(inputs: PromotionCheckInputs) -> "PromotionCheckResult":
    reasons: List[str] = []

    # --- 1. STRUCTURAL_FAILURE -- checked first, unconditionally ---
    if not inputs.used_point_in_time_joins:
        reasons.append("features were not provably joined point-in-time (never a positional join)")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if inputs.leakage_violations:
        reasons.append(f"{len(inputs.leakage_violations)} leakage violation(s) detected: {inputs.leakage_violations[:3]}")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if not inputs.only_resolved_chains_used:
        reasons.append("a CENSORED_OPEN/INVALID_DATA/EXTERNAL_ACTIVITY_CONTAMINATED chain entered training or evaluation")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if not inputs.execution_model_is_direction_aware:
        reasons.append("execution model used a midpoint/directionless fill assumption, not direction-aware pricing")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if not inputs.final_oos_touched_exactly_once:
        reasons.append("final OOS segment was used for selection, not solely for confirmation (ML-002 violation)")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if inputs.training_dataset_hash is None or inputs.evaluation_dataset_hash is None:
        reasons.append("training/evaluation dataset hash is missing -- result is not reproducible")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if inputs.training_dataset_hash == inputs.evaluation_dataset_hash:
        reasons.append("training and evaluation dataset hashes are identical -- OOS evaluation is not actually disjoint from training")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if inputs.model_version is None:
        reasons.append("no immutable model version identifier was assigned")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if not inputs.roll_accounting_verified:
        reasons.append("a roll's old-leg realized P&L was dropped/absorbed rather than summed into whole-episode economics")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if not inputs.return_denominator_verified:
        reasons.append("a reported return was denominated by premium collected rather than secured/committed capital")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if inputs.fill_probability_is_fabricated:
        reasons.append("a fabricated (non-UNKNOWN) fill probability was reported without a calibrated fill model")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)
    if not inputs.feature_provenance_recorded:
        reasons.append("feature provenance (source + point-in-time availability) was not recorded per row")
        return PromotionCheckResult(PromotionResult.STRUCTURAL_FAILURE, reasons)

    # --- 2. DATA_INSUFFICIENT ---
    if inputs.min_independent_chain_n <= 0:
        raise ValueError("min_independent_chain_n must be a positive, caller-justified threshold -- it cannot default to 0")
    if inputs.independent_chain_n < inputs.min_independent_chain_n:
        reasons.append(f"independent_chain_n={inputs.independent_chain_n} below the required minimum {inputs.min_independent_chain_n}")
        return PromotionCheckResult(PromotionResult.DATA_INSUFFICIENT, reasons)

    # --- 3. STATISTICAL_FAILURE ---
    if inputs.deflated_sharpe_ratio is None:
        reasons.append("deflated_sharpe_ratio is unknown -- cannot confirm the result survives multiple-testing deflation")
        return PromotionCheckResult(PromotionResult.STATISTICAL_FAILURE, reasons)
    if inputs.min_acceptable_dsr is None:
        raise ValueError("min_acceptable_dsr must be supplied whenever deflated_sharpe_ratio is supplied")
    if inputs.deflated_sharpe_ratio < inputs.min_acceptable_dsr:
        reasons.append(f"DSR={inputs.deflated_sharpe_ratio:.4f} below the required minimum {inputs.min_acceptable_dsr}")
        return PromotionCheckResult(PromotionResult.STATISTICAL_FAILURE, reasons)
    if inputs.probability_of_backtest_overfitting is not None:
        if inputs.max_acceptable_pbo is None:
            raise ValueError("max_acceptable_pbo must be supplied whenever probability_of_backtest_overfitting is supplied")
        if inputs.probability_of_backtest_overfitting > inputs.max_acceptable_pbo:
            reasons.append(f"PBO={inputs.probability_of_backtest_overfitting:.4f} exceeds the acceptable maximum {inputs.max_acceptable_pbo}")
            return PromotionCheckResult(PromotionResult.STATISTICAL_FAILURE, reasons)
    if inputs.final_oos_ci_excludes_zero is not True:
        reasons.append("final-OOS confidence interval does not (or is not confirmed to) exclude zero")
        return PromotionCheckResult(PromotionResult.STATISTICAL_FAILURE, reasons)
    if inputs.calibration_acceptable is not True:
        reasons.append("calibration diagnostics are unknown or unacceptable")
        return PromotionCheckResult(PromotionResult.STATISTICAL_FAILURE, reasons)
    if inputs.ablation_result != "IMPROVES":
        reasons.append(f"ablation_result={inputs.ablation_result!r} -- a feature/strategy must show a genuine IMPROVES ablation result, never NEUTRAL/DEGRADES/INCONCLUSIVE/unknown, to promote")
        return PromotionCheckResult(PromotionResult.STATISTICAL_FAILURE, reasons)
    if inputs.regime_stability_verified is not True:
        reasons.append("regime-cell performance stability was not verified (or was found inconsistent) -- an average improvement hiding regime-specific failure is not promotable")
        return PromotionCheckResult(PromotionResult.STATISTICAL_FAILURE, reasons)

    # --- 4. ECONOMIC_FAILURE ---
    if inputs.oos_ev_net is None or inputs.oos_ev_net <= 0:
        reasons.append(f"oos_ev_net is not positive (got {inputs.oos_ev_net})")
        return PromotionCheckResult(PromotionResult.ECONOMIC_FAILURE, reasons)

    # --- 5. RISK_FAILURE ---
    if inputs.catastrophic_subgroup_collapse:
        reasons.append("a catastrophic subgroup collapse was detected -- an average improvement hiding a materially worse cohort")
        return PromotionCheckResult(PromotionResult.RISK_FAILURE, reasons)
    if inputs.es_regression_pct is not None:
        if inputs.max_acceptable_es_regression_pct is None:
            raise ValueError("max_acceptable_es_regression_pct must be supplied whenever es_regression_pct is supplied")
        if inputs.es_regression_pct > inputs.max_acceptable_es_regression_pct:
            reasons.append(f"ES regression {inputs.es_regression_pct:.4f} exceeds the acceptable maximum {inputs.max_acceptable_es_regression_pct}")
            return PromotionCheckResult(PromotionResult.RISK_FAILURE, reasons)
    if inputs.drawdown_regression_pct is not None:
        if inputs.max_acceptable_drawdown_regression_pct is None:
            raise ValueError("max_acceptable_drawdown_regression_pct must be supplied whenever drawdown_regression_pct is supplied")
        if inputs.drawdown_regression_pct > inputs.max_acceptable_drawdown_regression_pct:
            reasons.append(f"drawdown regression {inputs.drawdown_regression_pct:.4f} exceeds the acceptable maximum {inputs.max_acceptable_drawdown_regression_pct}")
            return PromotionCheckResult(PromotionResult.RISK_FAILURE, reasons)

    # --- 6. EXECUTION_FAILURE ---
    if inputs.edge_survives_realistic_execution is not True:
        reasons.append("edge_survives_realistic_execution is unknown or False -- the edge is not confirmed to survive realistic spread/slippage/fill economics")
        return PromotionCheckResult(PromotionResult.EXECUTION_FAILURE, reasons)

    # --- 7. PROMOTION_ELIGIBLE_RESEARCH ---
    reasons.append("every structural/data/statistical/economic/risk gate passed -- eligible for research promotion only; Production activation remains Codex's sole decision and is out of scope for this module")
    return PromotionCheckResult(PromotionResult.PROMOTION_ELIGIBLE_RESEARCH, reasons)


@dataclass(frozen=True)
class PromotionCheckResult:
    result: PromotionResult
    reasons: List[str]
