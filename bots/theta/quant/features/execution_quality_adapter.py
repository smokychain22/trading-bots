"""EXECUTION_QUALITY feature-to-contract adapter (THETA long-run build,
work package 19, Phase 2 feature family: EXECUTION_QUALITY).

CORRECTION (this pass): a first attempt at this work package created a
NEW, duplicate `features/execution_quality.py` producer without first
checking for an existing canonical one -- `models/execution_quality.py`
(`assess_execution_quality`) already existed, real, mature, and tested
(`tests/quant/test_execution_quality.py`, pre-existing, NOT written this
session). That duplicate file was deleted; this module is the correct
fix -- a thin adapter around the EXISTING canonical function, matching the
same division of labor already established for TREND/REALIZED_VOLATILITY
(regime_adapter.py): never reimplement, only convert.

Truth class is always `MODELED_RESEARCH`: `assess_execution_quality` is,
by its own docstring, a deterministic heuristic baseline -- never a real
broker fill. A genuine `BROKER_ACTUAL` execution-quality observation (once
real Paper fills exist) is a SEPARATE future capability (work packages
91-92, Paper-evidence adapters), not this function's job.
"""

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass
from models.execution_quality import ExecutionQualityAssessment


def execution_quality_assessment_to_result(
    assessment: ExecutionQualityAssessment, option_symbol: str, as_of: str, retrieved_at: str,
    version: str = "execution-quality-heuristic-v1",
) -> FeatureResult:
    feature_id = f"EXECUTION_QUALITY_{option_symbol}"
    if assessment.recommended_action == "UNKNOWN":
        return FeatureResult(
            feature_id=feature_id, family="EXECUTION_QUALITY", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_probability", source_provider="INTERNAL_DERIVED",
            source_operation="assess_execution_quality", as_of=as_of, retrieved_at=retrieved_at,
            freshness_seconds=None, coverage=None, version=version,
            reason_codes=tuple(reason.code for reason in assessment.reasons) or ("EXECUTION_QUALITY_UNKNOWN",),
        )
    return FeatureResult(
        feature_id=feature_id, family="EXECUTION_QUALITY", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MODELED_RESEARCH, value=None,
        structured_value={
            "spreadPct": assessment.spread_pct, "fillProbability": assessment.fill_probability,
            "expectedSlippagePerShare": assessment.expected_slippage_per_share,
            "acceptable": assessment.acceptable, "recommendedAction": assessment.recommended_action,
        },
        units="usd_and_probability", source_provider="INTERNAL_DERIVED", source_operation="assess_execution_quality",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=1.0, version=version,
        reason_codes=tuple(reason.code for reason in assessment.reasons) or ("EXECUTION_QUALITY_OK",),
    )
