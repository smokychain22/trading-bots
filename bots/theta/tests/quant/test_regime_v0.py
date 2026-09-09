"""Tests for bots/theta/quant/models/regime_v0.py. Synthetic data only.

Run with (from the repo root):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.regime_v0 import (  # noqa: E402
    EventState,
    LiquidityState,
    RegimeInputs,
    RegimePolicyV0,
    StressState,
    TrendState,
    VolatilityState,
    classify,
)


def _policy(**overrides) -> RegimePolicyV0:
    defaults = dict(
        policy_version="TEST-REGIME-1",
        bull_ma_slope_floor=0.001,
        bear_ma_slope_ceiling=-0.001,
        rv_low_ceiling=0.15,
        rv_high_floor=0.35,
        rv_shock_floor=0.60,
        max_adverse_gap_shock_threshold=0.10,
        liquidity_thin_spread_pct_floor=0.05,
        liquidity_dislocated_spread_pct_floor=0.15,
        correction_drawdown_ceiling=-0.10,
        crisis_drawdown_ceiling=-0.20,
    )
    defaults.update(overrides)
    return RegimePolicyV0(**defaults)


def _clean_inputs(**overrides) -> RegimeInputs:
    defaults = dict(
        ma_slope=0.0,
        rv20=0.20,
        max_adverse_gap=0.01,
        earnings_distance_days=40,
        corporate_action_pending=False,
        macro_risk_flag=False,
        spread_pct=0.02,
        portfolio_or_market_drawdown=-0.02,
    )
    defaults.update(overrides)
    return RegimeInputs(**defaults)


class TrendAxisTests(unittest.TestCase):
    def test_bull(self):
        s = classify(_clean_inputs(ma_slope=0.01), _policy())
        self.assertEqual(s.trend_state, TrendState.BULL)

    def test_bear(self):
        s = classify(_clean_inputs(ma_slope=-0.01), _policy())
        self.assertEqual(s.trend_state, TrendState.BEAR)

    def test_range(self):
        s = classify(_clean_inputs(ma_slope=0.0), _policy())
        self.assertEqual(s.trend_state, TrendState.RANGE)

    def test_unknown(self):
        s = classify(_clean_inputs(ma_slope=None), _policy())
        self.assertIsNone(s.trend_state)


class VolatilityAxisTests(unittest.TestCase):
    def test_low(self):
        s = classify(_clean_inputs(rv20=0.10), _policy())
        self.assertEqual(s.volatility_state, VolatilityState.LOW)

    def test_normal(self):
        s = classify(_clean_inputs(rv20=0.20), _policy())
        self.assertEqual(s.volatility_state, VolatilityState.NORMAL)

    def test_high(self):
        s = classify(_clean_inputs(rv20=0.40), _policy())
        self.assertEqual(s.volatility_state, VolatilityState.HIGH)

    def test_shock_from_rv(self):
        s = classify(_clean_inputs(rv20=0.70), _policy())
        self.assertEqual(s.volatility_state, VolatilityState.SHOCK)

    def test_shock_from_gap_even_with_normal_rv(self):
        s = classify(_clean_inputs(rv20=0.20, max_adverse_gap=0.15), _policy())
        self.assertEqual(s.volatility_state, VolatilityState.SHOCK)


class EventAxisTests(unittest.TestCase):
    def test_macro_risk_takes_priority(self):
        s = classify(_clean_inputs(macro_risk_flag=True, corporate_action_pending=True, earnings_distance_days=1), _policy())
        self.assertEqual(s.event_state, EventState.MACRO_RISK)

    def test_corporate_action_priority_over_earnings(self):
        s = classify(_clean_inputs(corporate_action_pending=True, earnings_distance_days=1), _policy())
        self.assertEqual(s.event_state, EventState.CORPORATE_ACTION)

    def test_earnings_near(self):
        s = classify(_clean_inputs(earnings_distance_days=2), _policy())
        self.assertEqual(s.event_state, EventState.EARNINGS_NEAR)

    def test_none(self):
        s = classify(_clean_inputs(earnings_distance_days=40), _policy())
        self.assertEqual(s.event_state, EventState.NONE)

    def test_unknown_when_no_flags_and_earnings_distance_missing(self):
        s = classify(_clean_inputs(earnings_distance_days=None), _policy())
        self.assertIsNone(s.event_state)


class LiquidityAxisTests(unittest.TestCase):
    def test_normal(self):
        s = classify(_clean_inputs(spread_pct=0.01), _policy())
        self.assertEqual(s.liquidity_state, LiquidityState.NORMAL)

    def test_thin(self):
        s = classify(_clean_inputs(spread_pct=0.08), _policy())
        self.assertEqual(s.liquidity_state, LiquidityState.THIN)

    def test_dislocated(self):
        s = classify(_clean_inputs(spread_pct=0.20), _policy())
        self.assertEqual(s.liquidity_state, LiquidityState.DISLOCATED)


class StressAxisTests(unittest.TestCase):
    def test_normal(self):
        s = classify(_clean_inputs(portfolio_or_market_drawdown=-0.02), _policy())
        self.assertEqual(s.stress_state, StressState.NORMAL)

    def test_correction(self):
        s = classify(_clean_inputs(portfolio_or_market_drawdown=-0.12), _policy())
        self.assertEqual(s.stress_state, StressState.CORRECTION)

    def test_crisis(self):
        s = classify(_clean_inputs(portfolio_or_market_drawdown=-0.25), _policy())
        self.assertEqual(s.stress_state, StressState.CRISIS)


class OrthogonalityAndConfidenceTests(unittest.TestCase):
    def test_axes_are_independent_bull_trend_with_event_risk(self):
        # Explicitly proves axes don't collapse into one score: BULL trend
        # co-exists with EARNINGS_NEAR event state in the same snapshot.
        s = classify(_clean_inputs(ma_slope=0.01, earnings_distance_days=1), _policy())
        self.assertEqual(s.trend_state, TrendState.BULL)
        self.assertEqual(s.event_state, EventState.EARNINGS_NEAR)

    def test_confidence_is_fraction_of_resolved_axes(self):
        s = classify(_clean_inputs(ma_slope=None, spread_pct=None), _policy())
        # 3 of 5 axes resolvable (volatility, event, stress); trend and
        # liquidity are UNKNOWN.
        self.assertAlmostEqual(s.confidence, 3 / 5, places=10)

    def test_full_confidence_when_all_inputs_known(self):
        s = classify(_clean_inputs(), _policy())
        self.assertEqual(s.confidence, 1.0)


if __name__ == "__main__":
    unittest.main()
