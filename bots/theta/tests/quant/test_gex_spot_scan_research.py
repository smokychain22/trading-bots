"""Tests for bots/theta/quant/research/gex_spot_scan_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.gex_spot_scan_research import (  # noqa: E402
    GexScanContract,
    GexSignConvention,
    GexSpotScanState,
    run_spot_scan,
)

STANDARD_CONVENTION = GexSignConvention(convention_id="CALL_POSITIVE_PUT_NEGATIVE_OI_WEIGHTED", call_sign=1.0, put_sign=-1.0, verified=False)


def _contract(strike, option_type, iv=0.25, oi=1000.0, years=0.1, multiplier=100):
    return GexScanContract(strike=strike, years_to_expiry=years, implied_volatility=iv, open_interest=oi, option_type=option_type, multiplier=multiplier)


class RunSpotScanTests(unittest.TestCase):
    def test_invalid_grid_too_few_points(self):
        result = run_spot_scan([_contract(100, "call")], [100.0], STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertEqual(result.state, GexSpotScanState.INVALID_GRID)

    def test_invalid_grid_unsorted(self):
        result = run_spot_scan([_contract(100, "call")], [110.0, 90.0], STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertEqual(result.state, GexSpotScanState.INVALID_GRID)

    def test_invalid_grid_nonpositive(self):
        result = run_spot_scan([_contract(100, "call")], [-10.0, 90.0], STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertEqual(result.state, GexSpotScanState.INVALID_GRID)

    def test_sparse_chain_below_minimum(self):
        contracts = [_contract(100, "call"), _contract(105, "put")]
        result = run_spot_scan(contracts, [90.0, 100.0, 110.0], STANDARD_CONVENTION, minimum_usable_contracts=5)
        self.assertEqual(result.state, GexSpotScanState.SPARSE_CHAIN)
        self.assertEqual(result.usable_contract_count, 2)

    def test_excluded_contracts_never_counted_as_zero_exposure(self):
        contracts = [
            _contract(100, "call", oi=1000.0),
            GexScanContract(strike=105, years_to_expiry=0.1, implied_volatility=None, open_interest=500.0, option_type="put", multiplier=100),
        ]
        result = run_spot_scan(contracts, [90.0, 100.0, 110.0], STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertEqual(result.usable_contract_count, 1)
        self.assertEqual(result.excluded_contract_count, 1)

    def test_heavy_downside_put_oi_versus_lighter_upside_call_oi_finds_a_crossing(self):
        # Gamma peaks near each contract's OWN strike. A large put OI clustered
        # low and a smaller call OI clustered high means put exposure (negative,
        # under this convention) dominates near the low strikes and call exposure
        # (positive) dominates near the high strikes -- the signed curve should
        # cross zero somewhere on a wide enough grid, unlike a same-strike book
        # (where sign never depends on spot at all).
        contracts = [_contract(85, "put", oi=8000.0), _contract(115, "call", oi=1500.0)]
        grid = [80.0 + i * 2.0 for i in range(21)]  # 80..120
        result = run_spot_scan(contracts, grid, STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertIn(result.state, (GexSpotScanState.COMPUTED, GexSpotScanState.MULTIPLE_CROSSINGS))
        self.assertGreater(len(result.zero_crossings), 0)

    def test_same_strike_book_never_crosses_regardless_of_oi_mix(self):
        # A call and a put at the IDENTICAL strike have identical gamma at every
        # spot (verified separately in test_bs_gamma.py), so the sign of the
        # OI-weighted sum is constant across the whole grid -- this is a real,
        # useful negative case distinguishing "same strike" from "different
        # strikes" for spot-scan crossing behavior.
        contracts = [_contract(100, "call", oi=5000.0), _contract(100, "put", oi=1000.0)]
        grid = [80.0 + i * 2.0 for i in range(21)]
        result = run_spot_scan(contracts, grid, STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertEqual(result.state, GexSpotScanState.NO_CROSSING)

    def test_all_calls_never_crosses_zero(self):
        contracts = [_contract(90, "call"), _contract(100, "call"), _contract(110, "call")]
        grid = [80.0, 90.0, 100.0, 110.0, 120.0]
        result = run_spot_scan(contracts, grid, STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertEqual(result.state, GexSpotScanState.NO_CROSSING)
        self.assertEqual(result.zero_crossings, ())

    def test_sign_convention_is_carried_through_unchanged(self):
        contracts = [_contract(100, "call")]
        grid = [90.0, 100.0, 110.0]
        result = run_spot_scan(contracts, grid, STANDARD_CONVENTION, minimum_usable_contracts=1)
        self.assertEqual(result.sign_convention, STANDARD_CONVENTION)
        self.assertFalse(result.sign_convention.verified)


if __name__ == "__main__":
    unittest.main()
