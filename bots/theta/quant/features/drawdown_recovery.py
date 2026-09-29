"""DRAWDOWN_RECOVERY feature (THETA long-run build, work package 16, Phase
2 feature family: DRAWDOWN_RECOVERY).

Current account/strategy drawdown from a supplied, already PIT-ordered
equity curve (or whole-chain capital curve) -- no index after
`as_of_index` is ever read, by construction, matching every other
PIT-cutoff feature in this package.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


class RecoveryState(str, Enum):
    AT_HIGH_WATER_MARK = "AT_HIGH_WATER_MARK"
    IN_DRAWDOWN = "IN_DRAWDOWN"
    RECOVERED = "RECOVERED"  # back at/above the prior high-water mark after a drawdown


@dataclass(frozen=True)
class DrawdownRecoveryInput:
    equity_curve: Sequence[Optional[float]]  # already PIT-ordered, one point per period
    as_of_index: int
    max_bars_since_last: int = 1


def drawdown_recovery_result(
    observation: DrawdownRecoveryInput, as_of: str = "", retrieved_at: str = "",
    version: str = "drawdown-recovery-v1",
) -> FeatureResult:
    feature_id = "DRAWDOWN_RECOVERY"
    if observation.as_of_index < 0 or observation.as_of_index >= len(observation.equity_curve):
        raise ValueError("DRAWDOWN_RECOVERY_AS_OF_INDEX_OUT_OF_RANGE")

    bars_since_last = (len(observation.equity_curve) - 1) - observation.as_of_index
    if bars_since_last > observation.max_bars_since_last:
        return FeatureResult(
            feature_id=feature_id, family="DRAWDOWN_RECOVERY", state=FeatureResultState.STALE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_pct", source_provider="APPLICATION_BROKER_CONFIRMED", source_operation="drawdown_recovery_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"DRAWDOWN_RECOVERY_STALE:{bars_since_last}_bars_since_as_of",),
        )

    # No future equity: only equity_curve[: as_of_index + 1] is ever read.
    window = observation.equity_curve[: observation.as_of_index + 1]
    if any(value is None for value in window):
        return FeatureResult(
            feature_id=feature_id, family="DRAWDOWN_RECOVERY", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_pct", source_provider="APPLICATION_BROKER_CONFIRMED", source_operation="drawdown_recovery_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=("DRAWDOWN_RECOVERY_UNKNOWN:missing_equity_point_in_window",),
        )
    if len(window) < 1 or window[0] <= 0.0:
        return FeatureResult(
            feature_id=feature_id, family="DRAWDOWN_RECOVERY", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_pct", source_provider="APPLICATION_BROKER_CONFIRMED", source_operation="drawdown_recovery_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=("DRAWDOWN_RECOVERY_INVALID:non_positive_starting_equity",),
        )

    high_water_mark = window[0]
    high_water_mark_index = 0
    max_drawdown_pct = 0.0
    drawdown_start_index: Optional[int] = None
    recovery_duration_bars: Optional[int] = None
    for index, equity in enumerate(window):
        if equity >= high_water_mark:
            if drawdown_start_index is not None:
                recovery_duration_bars = index - drawdown_start_index
            high_water_mark = equity
            high_water_mark_index = index
            drawdown_start_index = None
        else:
            if drawdown_start_index is None:
                drawdown_start_index = high_water_mark_index
            drawdown_pct = (high_water_mark - equity) / high_water_mark
            max_drawdown_pct = max(max_drawdown_pct, drawdown_pct)

    current_equity = window[-1]
    current_drawdown_pct = (high_water_mark - current_equity) / high_water_mark if high_water_mark > 0 else 0.0
    if current_drawdown_pct <= 0.0:
        state = RecoveryState.RECOVERED if drawdown_start_index is None and max_drawdown_pct > 0.0 else RecoveryState.AT_HIGH_WATER_MARK
    else:
        state = RecoveryState.IN_DRAWDOWN

    return FeatureResult(
        feature_id=feature_id, family="DRAWDOWN_RECOVERY", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=None,
        structured_value={
            "currentDrawdownPct": current_drawdown_pct, "maxDrawdownPct": max_drawdown_pct,
            "highWaterMark": high_water_mark, "currentEquity": current_equity,
            "recoveryState": state.value, "recoveryDurationBars": recovery_duration_bars,
        },
        units="usd_and_pct", source_provider="APPLICATION_BROKER_CONFIRMED", source_operation="drawdown_recovery_result",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=1.0, version=version,
        reason_codes=("DRAWDOWN_RECOVERY_OK",),
    )
