"""Tests for bots/theta/quant/models/cost_slippage_baseline.py (work
package 36). Property tests: wider spread, thinner size, more legs, and
longer DTE can never IMPROVE (lower) the modeled slippage, and higher
base slippage/fees can never lower net expected outcome.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.cost_slippage_baseline import CostSlippageScalingInputs, estimate_scaled_slippage  # noqa: E402


def _inputs(**overrides) -> CostSlippageScalingInputs:
    base = dict(
        base_slippage_per_share=0.02, spread_pct=0.02, quote_size=50,
        min_quote_size_for_full_confidence=20, leg_count=1, dte=30, reference_dte=30,
    )
    base.update(overrides)
    return CostSlippageScalingInputs(**base)


class TestEstimateScaledSlippage(unittest.TestCase):
    def test_wider_spread_cannot_improve_net_expected_outcome(self):
        narrow = estimate_scaled_slippage(_inputs(spread_pct=0.01))
        wide = estimate_scaled_slippage(_inputs(spread_pct=0.10))
        self.assertGreaterEqual(wide.scaled_slippage_per_share, narrow.scaled_slippage_per_share)

    def test_higher_base_slippage_cannot_improve_it(self):
        low = estimate_scaled_slippage(_inputs(base_slippage_per_share=0.01))
        high = estimate_scaled_slippage(_inputs(base_slippage_per_share=0.05))
        self.assertGreater(high.scaled_slippage_per_share, low.scaled_slippage_per_share)

    def test_thinner_displayed_size_cannot_improve_it(self):
        thick = estimate_scaled_slippage(_inputs(quote_size=100))
        thin = estimate_scaled_slippage(_inputs(quote_size=5))
        self.assertGreaterEqual(thin.scaled_slippage_per_share, thick.scaled_slippage_per_share)

    def test_unknown_size_is_treated_conservatively_never_as_ample(self):
        known_ample = estimate_scaled_slippage(_inputs(quote_size=1000))
        unknown = estimate_scaled_slippage(_inputs(quote_size=None))
        self.assertGreater(unknown.scaled_slippage_per_share, known_ample.scaled_slippage_per_share)

    def test_more_legs_cannot_improve_it(self):
        one_leg = estimate_scaled_slippage(_inputs(leg_count=1))
        two_legs = estimate_scaled_slippage(_inputs(leg_count=2))
        self.assertGreater(two_legs.scaled_slippage_per_share, one_leg.scaled_slippage_per_share)

    def test_longer_dte_than_reference_cannot_improve_it(self):
        near = estimate_scaled_slippage(_inputs(dte=30, reference_dte=30))
        far = estimate_scaled_slippage(_inputs(dte=90, reference_dte=30))
        self.assertGreater(far.scaled_slippage_per_share, near.scaled_slippage_per_share)

    def test_same_economics_are_deterministic(self):
        first = estimate_scaled_slippage(_inputs())
        second = estimate_scaled_slippage(_inputs())
        self.assertEqual(first.scaled_slippage_per_share, second.scaled_slippage_per_share)

    def test_always_modeled_research_never_broker_actual(self):
        result = estimate_scaled_slippage(_inputs())
        self.assertEqual(result.truth_class, "MODELED_RESEARCH")


if __name__ == "__main__":
    unittest.main()
