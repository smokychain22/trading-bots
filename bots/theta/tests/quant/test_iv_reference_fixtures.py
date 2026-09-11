"""Numerical fixtures for bots/theta/quant/research/bs_reference.py.

Verification-only cross-checks (ATM/ITM/OTM/deep-ITM/deep-OTM/near-zero-DTE/
impossible-price/low-vega/high-IV/non-convergence) -- never runs against
real THETA data, never feeds an executable decision.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.bs_reference import BsInputs, bs_price, bs_vega, implied_volatility  # noqa: E402


class BsPriceTests(unittest.TestCase):
    def test_atm_call_price_matches_a_hand_verified_reference(self):
        # S=K=100, T=0.25y, r=0.05, sigma=0.2. By construction d1=0.175,
        # d2=0.075 exactly ((r+0.5*sigma^2)*T = 0.0175, /(sigma*sqrt(T))
        # = /0.1 = 0.175), so the reference value below is independently
        # hand-derivable from the closed-form formula, not copied from
        # this module's own output.
        price = bs_price(BsInputs(100.0, 100.0, 0.25, 0.05, 0.2, "call"))
        self.assertAlmostEqual(price, 4.6150, places=3)

    def test_deep_itm_call_price_approaches_intrinsic_value(self):
        price = bs_price(BsInputs(200.0, 100.0, 0.25, 0.05, 0.2, "call"))
        intrinsic = 200.0 - 100.0 * math_exp_neg(0.05, 0.25)
        self.assertAlmostEqual(price, intrinsic, delta=0.5)

    def test_deep_otm_put_price_is_small_but_positive(self):
        price = bs_price(BsInputs(200.0, 100.0, 0.25, 0.05, 0.2, "put"))
        self.assertGreater(price, 0.0)
        self.assertLess(price, 0.5)

    def test_t_equals_zero_returns_intrinsic_value_for_a_call(self):
        price = bs_price(BsInputs(110.0, 100.0, 0.0, 0.05, 0.2, "call"))
        self.assertAlmostEqual(price, 10.0)

    def test_t_equals_zero_returns_intrinsic_value_for_a_put(self):
        price = bs_price(BsInputs(90.0, 100.0, 0.0, 0.05, 0.2, "put"))
        self.assertAlmostEqual(price, 10.0)

    def test_negative_years_to_expiry_raises_never_silently_solved(self):
        with self.assertRaises(ValueError):
            bs_price(BsInputs(100.0, 100.0, -0.01, 0.05, 0.2, "call"))


def math_exp_neg(r, t):
    import math
    return math.exp(-r * t)


class VegaTests(unittest.TestCase):
    def test_vega_is_zero_at_expiry(self):
        self.assertAlmostEqual(bs_vega(BsInputs(100.0, 100.0, 0.0, 0.05, 0.2, "call")), 0.0)

    def test_vega_is_positive_for_a_live_atm_option(self):
        self.assertGreater(bs_vega(BsInputs(100.0, 100.0, 0.25, 0.05, 0.2, "call")), 0.0)

    def test_vega_is_small_for_a_deep_itm_option_low_vega_region(self):
        atm_vega = bs_vega(BsInputs(100.0, 100.0, 0.1, 0.05, 0.2, "call"))
        deep_itm_vega = bs_vega(BsInputs(200.0, 100.0, 0.1, 0.05, 0.2, "call"))
        self.assertLess(deep_itm_vega, atm_vega)


class ImpliedVolatilityTests(unittest.TestCase):
    def test_recovers_the_known_sigma_used_to_generate_the_price(self):
        true_sigma = 0.35
        price = bs_price(BsInputs(100.0, 105.0, 0.5, 0.03, true_sigma, "call"))
        recovered = implied_volatility(price, 100.0, 105.0, 0.5, 0.03, "call")
        self.assertIsNotNone(recovered)
        self.assertAlmostEqual(recovered, true_sigma, places=4)

    def test_recovers_high_iv_correctly(self):
        true_sigma = 2.5  # a genuinely extreme, high-IV case
        price = bs_price(BsInputs(50.0, 55.0, 0.05, 0.02, true_sigma, "put"))
        recovered = implied_volatility(price, 50.0, 55.0, 0.05, 0.02, "put")
        self.assertIsNotNone(recovered)
        self.assertAlmostEqual(recovered, true_sigma, places=3)

    def test_near_zero_dte_atm_still_converges(self):
        # T ~ 1.8 days, ATM: vega is small but not catastrophically so --
        # Newton itself should still recover the true sigma.
        true_sigma = 0.15
        price = bs_price(BsInputs(100.0, 100.0, 0.005, 0.05, true_sigma, "call"))
        recovered = implied_volatility(price, 100.0, 100.0, 0.005, 0.05, "call")
        self.assertIsNotNone(recovered)
        self.assertAlmostEqual(recovered, true_sigma, places=4)

    def test_deep_itm_with_very_short_t_is_a_genuinely_ill_posed_iv_solve(self):
        # This is a REAL finding, not a code bug: for a deep-ITM contract
        # with very little time remaining, the option's time value is many
        # orders of magnitude smaller than its intrinsic value, so the
        # price-vs-sigma relationship is indistinguishable from flat at
        # double-precision (catastrophic cancellation) across a wide range
        # of candidate sigmas -- this is exactly why real vendors solve IV
        # via the OTM-equivalent side (put-call parity) rather than
        # directly on a deep-ITM contract. The solver must still fail
        # GRACEFULLY here (return a value inside the valid [1e-4, 5.0]
        # bound, or None) -- never raise, hang, or return something
        # outside the valid sigma domain.
        true_sigma = 0.15
        price = bs_price(BsInputs(300.0, 100.0, 0.02, 0.05, true_sigma, "call"))
        recovered = implied_volatility(price, 300.0, 100.0, 0.02, 0.05, "call")
        if recovered is not None:
            self.assertGreaterEqual(recovered, 1e-4)
            self.assertLessEqual(recovered, 5.0)

    def test_a_price_below_intrinsic_value_is_an_arbitrage_violation_returns_none(self):
        # K=100, S=110, T>0: intrinsic (undiscounted) is >= 10; a quoted
        # price of 1.0 for a call this deep ITM is not solvable.
        recovered = implied_volatility(1.0, 110.0, 100.0, 0.25, 0.05, "call")
        self.assertIsNone(recovered)

    def test_t_equals_zero_has_no_iv_to_solve_for_returns_none_never_a_guess(self):
        recovered = implied_volatility(10.0, 110.0, 100.0, 0.0, 0.05, "call")
        self.assertIsNone(recovered)

    def test_one_bad_contract_never_affects_another_contracts_solve(self):
        # The exact contamination pattern found in ivsurf's own vectorized
        # implementation (docs/research/THETA_IV_SOLVER_COMPARISON.md) --
        # here, solving a genuinely unsolvable (below-intrinsic) contract
        # first must not affect a subsequent, valid contract's own solve.
        bad = implied_volatility(0.01, 110.0, 100.0, 0.25, 0.05, "call")
        self.assertIsNone(bad)
        good = implied_volatility(
            bs_price(BsInputs(100.0, 100.0, 0.25, 0.05, 0.2, "call")),
            100.0, 100.0, 0.25, 0.05, "call",
        )
        self.assertIsNotNone(good)
        self.assertAlmostEqual(good, 0.2, places=4)


if __name__ == "__main__":
    unittest.main()
