"""Tests for bs_reference.py's bs_gamma -- added for the R7 P2C spot-scan
gamma-flip research. Existing price/vega/IV coverage lives in
test_iv_reference_fixtures.py; this file is scoped to gamma only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.bs_reference import BsInputs, bs_gamma  # noqa: E402


class BsGammaTests(unittest.TestCase):
    def test_gamma_is_positive_for_a_valid_atm_option(self):
        inputs = BsInputs(spot=100.0, strike=100.0, years_to_expiry=0.25, risk_free_rate=0.02, sigma=0.25, option_type="call")
        self.assertGreater(bs_gamma(inputs), 0.0)

    def test_gamma_is_identical_for_call_and_put_same_terms(self):
        call = BsInputs(spot=100.0, strike=105.0, years_to_expiry=0.5, risk_free_rate=0.03, sigma=0.3, option_type="call")
        put = BsInputs(spot=100.0, strike=105.0, years_to_expiry=0.5, risk_free_rate=0.03, sigma=0.3, option_type="put")
        self.assertAlmostEqual(bs_gamma(call), bs_gamma(put), places=10)

    def test_gamma_is_zero_at_expiry(self):
        inputs = BsInputs(spot=100.0, strike=100.0, years_to_expiry=0.0, risk_free_rate=0.02, sigma=0.25, option_type="call")
        self.assertEqual(bs_gamma(inputs), 0.0)

    def test_gamma_is_zero_for_nonpositive_sigma(self):
        inputs = BsInputs(spot=100.0, strike=100.0, years_to_expiry=0.25, risk_free_rate=0.02, sigma=0.0, option_type="call")
        self.assertEqual(bs_gamma(inputs), 0.0)

    def test_gamma_peaks_near_the_money_versus_deep_out_of_the_money(self):
        atm = BsInputs(spot=100.0, strike=100.0, years_to_expiry=0.25, risk_free_rate=0.02, sigma=0.25, option_type="put")
        deep_otm = BsInputs(spot=100.0, strike=60.0, years_to_expiry=0.25, risk_free_rate=0.02, sigma=0.25, option_type="put")
        self.assertGreater(bs_gamma(atm), bs_gamma(deep_otm))


if __name__ == "__main__":
    unittest.main()
