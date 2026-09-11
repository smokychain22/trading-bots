"""Tests for bots/theta/quant/research/episode_economics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.episode_economics import (  # noqa: E402
    SecuredCapitalInputs,
    premium_capture_fraction,
    return_on_secured_capital,
    return_per_capital_day,
    secured_capital,
    whole_chain_return,
    whole_episode_pnl,
)


class WholeEpisodePnlTests(unittest.TestCase):
    def test_the_exact_roll_accounting_example_from_the_directive(self):
        # original STO +200, BTC -350, new STO +180, later BTC -15
        total = whole_episode_pnl([200.0, -350.0, 180.0, -15.0])
        self.assertAlmostEqual(total, 15.0)
        self.assertNotAlmostEqual(total, 195.0)  # the wrong number a net-credit-only view would report

    def test_a_single_leg_episode_is_just_its_own_pnl(self):
        self.assertAlmostEqual(whole_episode_pnl([42.0]), 42.0)

    def test_an_empty_sequence_is_zero_never_none_a_non_existent_episode_has_no_pnl_to_report(self):
        self.assertAlmostEqual(whole_episode_pnl([]), 0.0)


class SecuredCapitalTests(unittest.TestCase):
    def test_a_known_multiplier_computes_real_secured_capital(self):
        # $150 CSP premium collected is irrelevant to secured capital --
        # a $150 strike (not premium) with 100 contracts... use the
        # directive's own example: strike ~ collateral basis, multiplier 100.
        capital = secured_capital(SecuredCapitalInputs(strike=150.0, contracts=1.0, multiplier=100))
        self.assertAlmostEqual(capital, 15_000.0)

    def test_an_unverified_multiplier_is_unknown_never_assumed_100(self):
        capital = secured_capital(SecuredCapitalInputs(strike=150.0, contracts=1.0, multiplier=None))
        self.assertIsNone(capital)

    def test_a_non_positive_multiplier_is_unknown(self):
        capital = secured_capital(SecuredCapitalInputs(strike=150.0, contracts=1.0, multiplier=0))
        self.assertIsNone(capital)


class ReturnDenominatorTests(unittest.TestCase):
    def test_premium_capture_fraction_is_not_the_same_number_as_return_on_secured_capital(self):
        # The directive's own example: $2 premium x 100 shares = $200
        # collected is NOT a 200-on-something return; against a $15,000
        # secured collateral base it is a ~1.33% return on capital, while
        # against the $150 premium itself it is a 100% capture fraction
        # (both realized).
        premium_collected = 200.0
        realized_pnl = 200.0  # fully captured, expired worthless
        capital = secured_capital(SecuredCapitalInputs(strike=150.0, contracts=1.0, multiplier=100))

        capture = premium_capture_fraction(premium_collected, realized_pnl)
        roc = return_on_secured_capital(realized_pnl, capital)

        self.assertAlmostEqual(capture, 1.0)  # 100% of premium captured
        self.assertAlmostEqual(roc, 200.0 / 15_000.0)  # ~1.33% return on capital
        self.assertNotAlmostEqual(capture, roc)

    def test_unknown_secured_capital_makes_return_on_capital_unknown_never_a_fabricated_number(self):
        roc = return_on_secured_capital(200.0, None)
        self.assertIsNone(roc)

    def test_return_per_capital_day_scales_by_both_capital_and_days(self):
        rate = return_per_capital_day(150.0, 15_000.0, 30.0)
        self.assertAlmostEqual(rate, 150.0 / (15_000.0 * 30.0))

    def test_return_per_capital_day_is_unknown_for_non_positive_capital_days(self):
        self.assertIsNone(return_per_capital_day(150.0, 15_000.0, 0.0))

    def test_whole_chain_return_propagates_none_from_an_unknown_whole_chain_pnl(self):
        self.assertIsNone(whole_chain_return(None, 15_000.0))

    def test_whole_chain_return_propagates_none_from_unknown_capital(self):
        self.assertIsNone(whole_chain_return(500.0, None))

    def test_whole_chain_return_computes_normally_when_both_are_known(self):
        self.assertAlmostEqual(whole_chain_return(1_500.0, 15_000.0), 0.10)


if __name__ == "__main__":
    unittest.main()
