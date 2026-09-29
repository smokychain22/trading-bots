"""Property test closing work package 79's "risk worse cannot improve
permission" requirement -- hard veto blocking new risk and unknown-input
fail-safe are already covered by test_aegis.py/test_aegis_contract.py
(unchanged); this file adds the one missing property: strictly worsening
any single risk input never yields a strictly MORE permissive AEGIS state
than the clean baseline.
"""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_aegis import _clean_inputs, _policy
from models.aegis import _STRICTNESS_ORDER, assess_aegis


def _rank(state):
    return _STRICTNESS_ORDER.index(state)


WORSENING_VARIANTS = (
    {'ticker_concentration_pct': 0.90},
    {'sector_concentration_pct': 0.90},
    {'correlation_cluster_exposure_pct': 0.90},
    {'portfolio_capital_at_risk_pct': 0.95},
    {'inventory_capacity_used_pct': 0.95},
    {'assignment_capacity_used_pct': 0.95},
    {'liquidity_acceptable': False},
    {'execution_quality_acceptable': False},
    {'provider_state': 'STALE'},
    {'stress_gap_detected': True, 'stress_iv_shock_detected': True, 'stress_spread_widening_detected': True},
    {'ticker_concentration_pct': None},  # missing decisive input -- fail safe, never more permissive
)


class AegisMonotonicityPropertyTests(unittest.TestCase):
    def test_worsening_any_single_input_never_improves_permission(self):
        baseline = assess_aegis(_policy(), _clean_inputs())
        baseline_rank = _rank(baseline.new_risk_state)
        for overrides in WORSENING_VARIANTS:
            worsened = assess_aegis(_policy(), _clean_inputs(**overrides))
            self.assertGreaterEqual(
                _rank(worsened.new_risk_state), baseline_rank,
                msg=f'{overrides} produced a MORE permissive state than the clean baseline',
            )

    def test_baseline_itself_is_allow_full(self):
        baseline = assess_aegis(_policy(), _clean_inputs())
        self.assertEqual(_rank(baseline.new_risk_state), 0)


if __name__ == '__main__':
    unittest.main()
