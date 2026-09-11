"""Tests for bots/theta/quant/research/drawdown_metrics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.drawdown_metrics import EquityPoint, compute_drawdown_summary  # noqa: E402


def _points(pairs):
    return [EquityPoint(as_of=d, equity=e) for d, e in pairs]


class DrawdownSummaryTests(unittest.TestCase):
    def test_a_single_point_reports_none_everywhere(self):
        summary = compute_drawdown_summary(_points([("2024-01-01", 100.0)]))
        self.assertIsNone(summary.max_drawdown_pct)

    def test_a_monotonically_rising_curve_has_zero_drawdown(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-02", 110.0), ("2024-01-03", 120.0),
        ]))
        self.assertAlmostEqual(summary.max_drawdown_pct, 0.0)
        self.assertFalse(summary.unrecovered_trough_present)

    def test_computes_max_drawdown_percentage_correctly(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-02", 120.0), ("2024-01-03", 90.0), ("2024-01-04", 100.0),
        ]))
        # Peak 120 -> trough 90 = 25% drawdown
        self.assertAlmostEqual(summary.max_drawdown_pct, 0.25)

    def test_max_drawdown_duration_measures_peak_to_trough_days(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-05", 120.0), ("2024-01-10", 90.0),
        ]))
        self.assertAlmostEqual(summary.max_drawdown_duration_days, 5.0)

    def test_a_fully_recovered_trough_reports_a_recovery_duration(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-05", 80.0), ("2024-01-15", 105.0),
        ]))
        self.assertIsNotNone(summary.longest_recovery_days)
        self.assertAlmostEqual(summary.longest_recovery_days, 10.0)
        self.assertFalse(summary.unrecovered_trough_present)

    def test_an_unrecovered_trough_at_series_end_is_flagged(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-05", 120.0), ("2024-01-10", 90.0),
        ]))
        self.assertTrue(summary.unrecovered_trough_present)
        self.assertIsNone(summary.longest_recovery_days)

    def test_time_underwater_percentage_reflects_the_fraction_of_days_below_peak(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-02", 100.0), ("2024-01-03", 90.0), ("2024-01-04", 90.0),
        ]))
        self.assertGreater(summary.time_underwater_pct, 0.0)

    def test_ulcer_index_is_zero_for_a_curve_with_no_drawdown(self):
        summary = compute_drawdown_summary(_points([("2024-01-01", 100.0), ("2024-01-02", 110.0)]))
        self.assertAlmostEqual(summary.ulcer_index, 0.0)

    def test_ulcer_index_is_positive_when_a_drawdown_exists(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-02", 80.0), ("2024-01-03", 100.0),
        ]))
        self.assertGreater(summary.ulcer_index, 0.0)

    def test_a_deeper_and_longer_drawdown_produces_a_higher_ulcer_index_than_a_shallow_brief_one(self):
        shallow_brief = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-02", 98.0), ("2024-01-03", 100.0),
        ]))
        deep_long = compute_drawdown_summary(_points([
            ("2024-01-01", 100.0), ("2024-01-02", 60.0), ("2024-01-03", 60.0), ("2024-01-04", 100.0),
        ]))
        self.assertGreater(deep_long.ulcer_index, shallow_brief.ulcer_index)

    def test_out_of_order_input_is_sorted_by_as_of_never_assumed_pre_sorted(self):
        summary = compute_drawdown_summary(_points([
            ("2024-01-10", 90.0), ("2024-01-01", 100.0), ("2024-01-05", 120.0),
        ]))
        self.assertAlmostEqual(summary.max_drawdown_pct, 0.25)


if __name__ == "__main__":
    unittest.main()
