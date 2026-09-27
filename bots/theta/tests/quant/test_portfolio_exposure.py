"""Tests for bots/theta/quant/features/portfolio_exposure.py (work package 15)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.portfolio_exposure import ConfirmedPosition, portfolio_exposure_result  # noqa: E402


def _pos(**overrides) -> ConfirmedPosition:
    base = dict(
        underlying_symbol="SPY", sector_code="45", market_value=10000.0, shares_held=0,
        is_covered_call_eligible=False, assignment_exposure_notional=0.0,
    )
    base.update(overrides)
    return ConfirmedPosition(**base)


class TestPortfolioExposureResult(unittest.TestCase):
    def test_gross_and_net_exposure(self):
        positions = [_pos(market_value=10000.0), _pos(underlying_symbol="QQQ", market_value=-5000.0)]
        result = portfolio_exposure_result(positions, total_account_value=100000.0, as_of="t", retrieved_at="t")
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertAlmostEqual(result.structured_value["grossExposure"], 15000.0)
        self.assertAlmostEqual(result.structured_value["netExposure"], 5000.0)

    def test_underlying_concentration(self):
        positions = [_pos(underlying_symbol="SPY", market_value=50000.0)]
        result = portfolio_exposure_result(positions, total_account_value=100000.0, as_of="t", retrieved_at="t")
        self.assertAlmostEqual(result.structured_value["maxUnderlyingConcentrationPct"], 0.5)

    def test_sector_exposure_only_when_sector_known(self):
        positions = [_pos(sector_code="45", market_value=10000.0), _pos(underlying_symbol="XOM", sector_code=None, market_value=5000.0)]
        result = portfolio_exposure_result(positions, total_account_value=100000.0, as_of="t", retrieved_at="t")
        self.assertEqual(result.structured_value["bySector"], {"45": 10000.0})

    def test_assignment_exposure_summed(self):
        positions = [_pos(assignment_exposure_notional=1000.0), _pos(underlying_symbol="QQQ", assignment_exposure_notional=500.0)]
        result = portfolio_exposure_result(positions, total_account_value=100000.0, as_of="t", retrieved_at="t")
        self.assertAlmostEqual(result.structured_value["assignmentExposureNotional"], 1500.0)

    def test_covered_share_utilization(self):
        positions = [_pos(shares_held=100, is_covered_call_eligible=True)]
        result = portfolio_exposure_result(positions, total_account_value=100000.0, as_of="t", retrieved_at="t")
        self.assertEqual(result.structured_value["coveredShareUtilization"], 100)

    def test_no_broker_state_inference_empty_positions_is_a_real_zero(self):
        result = portfolio_exposure_result([], total_account_value=100000.0, as_of="t", retrieved_at="t")
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.structured_value["grossExposure"], 0.0)
        self.assertEqual(result.structured_value["positionCount"], 0)

    def test_missing_account_value_is_unknown(self):
        result = portfolio_exposure_result([_pos()], total_account_value=None, as_of="t", retrieved_at="t")
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_non_positive_account_value_is_invalid(self):
        result = portfolio_exposure_result([_pos()], total_account_value=0.0, as_of="t", retrieved_at="t")
        self.assertEqual(result.state, FeatureResultState.INVALID)


if __name__ == "__main__":
    unittest.main()
