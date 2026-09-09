"""Tests for bots/theta/quant/models/ownership_v0.py. Synthetic data only.

Run with (from the repo root):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.ownership_v0 import (  # noqa: E402
    COMPONENT_STATUS,
    OwnershipInputs,
    OwnershipPolicyV0,
    evaluate,
)


def _policy(**overrides) -> OwnershipPolicyV0:
    defaults = dict(
        policy_version="TEST-OWN-1",
        min_stock_avg_volume=1_000_000,
        min_option_open_interest=100,
        min_option_volume=20,
        max_spread_pct=0.08,
        rv_normalization_ceiling=0.6,
        downside_semivar_normalization_ceiling=0.04,
        gap_frequency_normalization_ceiling=0.5,
        event_decay_window_days=5,
    )
    defaults.update(overrides)
    return OwnershipPolicyV0(**defaults)


def _clean_inputs(**overrides) -> OwnershipInputs:
    defaults = dict(
        stock_avg_volume=5_000_000,
        option_open_interest=500,
        option_volume=100,
        spread_pct=0.02,
        ret_1d=0.001,
        ret_5d=0.01,
        ret_20d=0.03,
        ret_60d=0.05,
        ma20_rel=0.02,
        ma50_rel=0.01,
        ma200_rel=0.03,
        ma_slope=0.01,
        relative_strength=0.4,
        rv10=0.2,
        rv20=0.22,
        rv60=0.25,
        drawdown=-0.03,
        max_adverse_gap=0.02,
        gap_frequency=0.1,
        downside_semivariance=0.02,
        historical_recovery_median_days=10.0,
        historical_recovery_p95_days=40.0,
        severe_drawdown_episode_count=1,
        earnings_distance_days=30,
        ex_dividend_distance_days=None,
        known_event_distance_days=None,
        thesis_invalidated=False,
    )
    defaults.update(overrides)
    return OwnershipInputs(**defaults)


class ComponentStatusTests(unittest.TestCase):
    def test_multiplicative_combination_is_flagged_test_not_architectural(self):
        self.assertEqual(COMPONENT_STATUS["multiplicative_combination"], "TEST")

    def test_liquidity_and_event_existence_are_architectural(self):
        self.assertEqual(COMPONENT_STATUS["liquidity_floor_exists"], "ARCHITECTURAL")
        self.assertEqual(COMPONENT_STATUS["event_adjustment_exists"], "ARCHITECTURAL")

    def test_thesis_invalidation_handling_is_architectural(self):
        self.assertEqual(
            COMPONENT_STATUS["thesis_invalidation_is_a_hard_signal_not_a_score_input"], "ARCHITECTURAL"
        )


class LiquidityComponentTests(unittest.TestCase):
    def test_liquidity_pass_scores_one(self):
        result = evaluate(_clean_inputs(), _policy())
        liquidity = next(c for c in result.components if c.name == "LiquidityQuality")
        self.assertEqual(liquidity.value, 1.0)

    def test_liquidity_fail_scores_zero_not_none(self):
        result = evaluate(_clean_inputs(spread_pct=0.5), _policy())
        liquidity = next(c for c in result.components if c.name == "LiquidityQuality")
        self.assertEqual(liquidity.value, 0.0)
        # A zero component still propagates through the product -- the
        # overall Ownability must reflect it, not silently ignore it.
        self.assertEqual(result.ownability, 0.0)

    def test_liquidity_unknown_makes_overall_ownability_none(self):
        result = evaluate(_clean_inputs(stock_avg_volume=None), _policy())
        self.assertIsNone(result.ownability)


class StructuralComponentTests(unittest.TestCase):
    def test_structural_score_hand_computed(self):
        inputs = _clean_inputs(ma20_rel=0.05, ma50_rel=-0.02, ma200_rel=0.03, ma_slope=0.01, relative_strength=0.4)
        result = evaluate(inputs, _policy())
        structural = next(c for c in result.components if c.name == "StructuralQuality")
        # above_count=2/3, slope_component=1.0, rs_component=0.5+0.4/2=0.7
        # (2/3 + 1.0 + 0.7) / 3
        expected = (2 / 3 + 1.0 + 0.7) / 3
        self.assertAlmostEqual(structural.value, expected, places=10)


class TailComponentTests(unittest.TestCase):
    def test_tail_score_hand_computed(self):
        inputs = _clean_inputs(downside_semivariance=0.02, gap_frequency=0.1)
        policy = _policy(downside_semivar_normalization_ceiling=0.04, gap_frequency_normalization_ceiling=0.5)
        result = evaluate(inputs, policy)
        tail = next(c for c in result.components if c.name == "TailQuality")
        # semivar_penalty = 0.02/0.04 = 0.5, gap_penalty = 0.1/0.5 = 0.2
        # score = 1 - max(0.5, 0.2) = 0.5
        self.assertAlmostEqual(tail.value, 0.5, places=10)


class RecoveryComponentTests(unittest.TestCase):
    def test_recovery_proxy_hand_computed(self):
        inputs = _clean_inputs(historical_recovery_median_days=10.0)
        policy = _policy(event_decay_window_days=5)
        result = evaluate(inputs, policy)
        recovery = next(c for c in result.components if c.name == "RecoveryQuality")
        # 1 - 10/(5*4) = 1 - 0.5 = 0.5
        self.assertAlmostEqual(recovery.value, 0.5, places=10)

    def test_recovery_unknown_without_history(self):
        result = evaluate(_clean_inputs(historical_recovery_median_days=None), _policy())
        recovery = next(c for c in result.components if c.name == "RecoveryQuality")
        self.assertIsNone(recovery.value)
        self.assertIsNone(result.ownability)


class EventAdjustmentTests(unittest.TestCase):
    def test_event_adjustment_hand_computed(self):
        inputs = _clean_inputs(earnings_distance_days=3, ex_dividend_distance_days=None, known_event_distance_days=None)
        policy = _policy(event_decay_window_days=5)
        result = evaluate(inputs, policy)
        event = next(c for c in result.components if c.name == "EventAdjustment")
        self.assertAlmostEqual(event.value, 3 / 5, places=10)

    def test_nearest_of_multiple_event_distances_is_used(self):
        inputs = _clean_inputs(earnings_distance_days=30, ex_dividend_distance_days=2, known_event_distance_days=10)
        policy = _policy(event_decay_window_days=5)
        result = evaluate(inputs, policy)
        event = next(c for c in result.components if c.name == "EventAdjustment")
        self.assertAlmostEqual(event.value, min(2, 10, 30) / 5 if min(2, 10, 30) < 5 else 1.0, places=10)
        # nearest is 2, decay window 5 -> clipped ratio 2/5 = 0.4
        self.assertAlmostEqual(event.value, 0.4, places=10)


class ThesisInvalidationTests(unittest.TestCase):
    def test_thesis_invalidated_is_a_reason_not_baked_into_the_score(self):
        clean = evaluate(_clean_inputs(thesis_invalidated=False), _policy())
        invalidated = evaluate(_clean_inputs(thesis_invalidated=True), _policy())
        # Same numeric ownability either way -- invalidation is a separate signal.
        self.assertEqual(clean.ownability, invalidated.ownability)
        self.assertTrue(invalidated.thesis_invalidated)
        self.assertIn("THESIS_INVALIDATED", [r.code for r in invalidated.reasons])
        self.assertNotIn("THESIS_INVALIDATED", [r.code for r in clean.reasons])


class FullEvaluationTests(unittest.TestCase):
    def test_all_known_components_multiply_to_the_reported_ownability(self):
        result = evaluate(_clean_inputs(), _policy())
        self.assertIsNotNone(result.ownability)
        product = 1.0
        for c in result.components:
            self.assertIsNotNone(c.value)
            product *= c.value
        self.assertAlmostEqual(result.ownability, product, places=10)

    def test_ownability_is_in_zero_one_range_when_known(self):
        result = evaluate(_clean_inputs(), _policy())
        self.assertGreaterEqual(result.ownability, 0.0)
        self.assertLessEqual(result.ownability, 1.0)


if __name__ == "__main__":
    unittest.main()
