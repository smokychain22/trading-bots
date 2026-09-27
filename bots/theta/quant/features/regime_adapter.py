"""REGIME feature-to-RegimeInputs adapter (THETA long-run build, work
package 18, Phase 2 feature family: REGIME).

`regime_v0.classify()` is already a real, tested, rule-based regime
classifier (`models/regime_v0.py`) -- it is NOT reimplemented here. Its
`RegimeInputs.ma_slope`/`rv20` have always been externally-supplied,
never-computed floats; this module is the real, first consumer wiring:
it converts this session's own TREND/REALIZED_VOLATILITY `FeatureResult`
producers into `RegimeInputs`, closing that gap for real rather than
leaving it perpetually "someone else's job."

Only `ma_slope`/`rv20` are wired here -- the remaining `RegimeInputs`
fields (`max_adverse_gap`, `earnings_distance_days`,
`corporate_action_pending`, `macro_risk_flag`, `spread_pct`,
`portfolio_or_market_drawdown`) map to EVENT_CONTEXT/LIQUIDITY/
DRAWDOWN_RECOVERY (already built this session, WP12/WP11/WP16) but are
left as explicit caller-supplied parameters here rather than silently
wired through a second adapter path -- a future package can extend this
one function once all five source families are confirmed ready, rather
than each adapter re-deriving the same wiring independently. Never
promotes a `FeatureResult` state other than `OK` into a value: any
non-OK state maps to `None` (UNKNOWN), exactly preserving `regime_v0.py`'s
own UNKNOWN semantics.
"""

from typing import Optional

from features.feature_contract import FeatureResult, FeatureResultState
from models.regime_v0 import RegimeInputs


def _ok_value(result: Optional[FeatureResult]) -> Optional[float]:
    if result is None or result.state != FeatureResultState.OK:
        return None
    return result.value


def regime_inputs_from_features(
    trend_result: Optional[FeatureResult], realized_vol_result: Optional[FeatureResult],
    max_adverse_gap: Optional[float] = None, earnings_distance_days: Optional[int] = None,
    corporate_action_pending: Optional[bool] = None, macro_risk_flag: Optional[bool] = None,
    spread_pct: Optional[float] = None, portfolio_or_market_drawdown: Optional[float] = None,
) -> RegimeInputs:
    """Builds a real `RegimeInputs` from real `FeatureResult`s. A TREND
    result whose family isn't `TREND`, or a REALIZED_VOLATILITY result
    whose family isn't `REALIZED_VOLATILITY`, is rejected explicitly --
    never silently accepted from the wrong producer."""
    if trend_result is not None and trend_result.family != "TREND":
        raise ValueError(f"REGIME_ADAPTER_WRONG_FAMILY:expected_TREND_got_{trend_result.family}")
    if realized_vol_result is not None and realized_vol_result.family != "REALIZED_VOLATILITY":
        raise ValueError(f"REGIME_ADAPTER_WRONG_FAMILY:expected_REALIZED_VOLATILITY_got_{realized_vol_result.family}")
    return RegimeInputs(
        ma_slope=_ok_value(trend_result), rv20=_ok_value(realized_vol_result),
        max_adverse_gap=max_adverse_gap, earnings_distance_days=earnings_distance_days,
        corporate_action_pending=corporate_action_pending, macro_risk_flag=macro_risk_flag,
        spread_pct=spread_pct, portfolio_or_market_drawdown=portfolio_or_market_drawdown,
    )
