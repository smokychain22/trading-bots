"""Tests for bots/theta/quant/research/tail_risk_metrics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.tail_risk_metrics import (  # noqa: E402
    compute_tail_risk_summary,
    expected_upside_in_best_tail,
)


class TailRiskSummaryTests(unittest.TestCase):
    def test_empty_input_reports_none_everywhere_never_a_fabricated_number(self):
        summary = compute_tail_risk_summary([])
        self.assertEqual(summary.n, 0)
        self.assertIsNone(summary.mean_pnl)
        self.assertIsNone(summary.value_at_risk)
        self.assertIsNone(summary.expected_shortfall)
        self.assertEqual(summary.pnl_quantiles, {})

    def test_mean_and_probability_profitable_are_computed_correctly(self):
        pnl = [100.0, -50.0, 200.0, -10.0]
        summary = compute_tail_risk_summary(pnl)
        self.assertAlmostEqual(summary.mean_pnl, 60.0)
        self.assertAlmostEqual(summary.probability_profitable, 0.5)

    def test_var_and_es_use_the_frozen_loss_equals_negative_pnl_convention(self):
        # A sample where the worst outcomes are large losses -- VaR/ES
        # must be POSITIVE numbers representing real losses, not signed
        # like PnL.
        pnl = [10.0] * 18 + [-1000.0, -2000.0]  # 20 observations, worst 2 are severe losses
        summary = compute_tail_risk_summary(pnl, alpha=0.90)
        self.assertGreater(summary.value_at_risk, 0)  # a loss is reported as positive
        self.assertGreaterEqual(summary.expected_shortfall, summary.value_at_risk)

    def test_a_uniformly_profitable_sample_has_zero_or_negative_var(self):
        # If even the "worst" outcomes in the tail are still profitable,
        # VaR (a LOSS quantile) is <= 0 -- correctly reflecting that
        # there is no real loss in this tail, never clamped to a
        # fabricated positive number.
        pnl = [100.0, 150.0, 120.0, 130.0, 110.0]
        summary = compute_tail_risk_summary(pnl, alpha=0.8)
        self.assertLessEqual(summary.value_at_risk, 0)

    def test_alpha_must_be_strictly_between_zero_and_one(self):
        with self.assertRaises(ValueError):
            compute_tail_risk_summary([1.0, 2.0], alpha=1.0)
        with self.assertRaises(ValueError):
            compute_tail_risk_summary([1.0, 2.0], alpha=0.0)

    def test_default_quantile_labels_are_reported(self):
        pnl = list(range(1, 101))  # 1..100
        summary = compute_tail_risk_summary([float(x) for x in pnl])
        self.assertIn("p50", summary.pnl_quantiles)
        self.assertAlmostEqual(summary.pnl_quantiles["p50"], 50.5, delta=1.0)

    def test_custom_quantile_labels_are_honored(self):
        pnl = [float(x) for x in range(1, 101)]
        summary = compute_tail_risk_summary(pnl, quantile_labels={"median": 0.5})
        self.assertEqual(set(summary.pnl_quantiles.keys()), {"median"})

    def test_a_single_observation_reports_a_degenerate_but_valid_summary(self):
        summary = compute_tail_risk_summary([42.0])
        self.assertEqual(summary.n, 1)
        self.assertAlmostEqual(summary.mean_pnl, 42.0)
        self.assertAlmostEqual(summary.value_at_risk, -42.0)  # a single profitable observation has a negative "loss"


class ExpectedUpsideInBestTailTests(unittest.TestCase):
    def test_reports_the_average_of_the_best_outcomes(self):
        pnl = [10.0] * 18 + [1000.0, 2000.0]
        result = expected_upside_in_best_tail(pnl, alpha=0.90)
        self.assertGreater(result, 10.0)

    def test_is_a_distinct_quantity_from_expected_shortfall_never_a_sign_flip_of_it(self):
        pnl = [10.0] * 18 + [-1000.0, -2000.0]
        summary = compute_tail_risk_summary(pnl, alpha=0.90)
        upside = expected_upside_in_best_tail(pnl, alpha=0.90)
        # ES here reflects the worst-loss tail (large negative pnl); the
        # best-tail upside reflects the ordinary +10 outcomes -- these
        # must not be equal or simply sign-flipped versions of each other.
        self.assertNotAlmostEqual(upside, -summary.expected_shortfall)

    def test_empty_input_returns_none(self):
        self.assertIsNone(expected_upside_in_best_tail([]))


if __name__ == "__main__":
    unittest.main()
