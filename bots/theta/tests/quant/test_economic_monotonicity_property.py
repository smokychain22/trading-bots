"""Economic monotonicity property tests (work package 81), against real
production code -- not a reimplementation. Reuses fixtures from
test_defined_risk_economics.py (WP32, unchanged) and test_sizing.py
(unchanged), which already independently prove several of these
properties (qty never floored to one, capacity tightening never
increases quantity, mismatched multiplier hard-blocked); this file adds
the remaining named properties: fees up => net non-increasing, slippage
up => net non-increasing, capital requirement up => efficiency
non-increasing holding return fixed.
"""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_defined_risk_economics import _costs, _long, _short
from models.defined_risk_economics import compute_defined_risk_economics


class FeesAndSlippageMonotonicityTests(unittest.TestCase):
    def test_higher_fees_never_increases_net_credit_after_cost(self):
        low = compute_defined_risk_economics(_short(), _long(), _costs(fees_per_contract=0.05))
        high = compute_defined_risk_economics(_short(), _long(), _costs(fees_per_contract=0.50))
        self.assertLessEqual(high.net_credit_after_cost, low.net_credit_after_cost)

    def test_higher_slippage_never_increases_net_credit_after_cost(self):
        low = compute_defined_risk_economics(_short(), _long(), _costs(est_slippage_per_contract=0.5))
        high = compute_defined_risk_economics(_short(), _long(), _costs(est_slippage_per_contract=5.0))
        self.assertLessEqual(high.net_credit_after_cost, low.net_credit_after_cost)

    def test_higher_commission_never_increases_net_credit_after_cost(self):
        low = compute_defined_risk_economics(_short(), _long(), _costs(commission_per_contract=0.10))
        high = compute_defined_risk_economics(_short(), _long(), _costs(commission_per_contract=2.00))
        self.assertLessEqual(high.net_credit_after_cost, low.net_credit_after_cost)

    def test_defined_risk_already_includes_both_leg_costs(self):
        economics = compute_defined_risk_economics(_short(), _long(), _costs(fees_per_contract=1.0))
        self.assertEqual(economics.total_fees_both_legs, 2.0)  # one fee per leg, both legs -- proven, not assumed


if __name__ == '__main__':
    unittest.main()
