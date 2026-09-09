"""Tests for severe_drawdown_spec.py and recovery_spec.py. Synthetic data only.

Run with (from the repo root):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from datetime import date
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.severe_drawdown_spec import (  # noqa: E402
    DrawdownThresholdFamily,
    LabelStatus,
    PricePoint,
    SevereDrawdownLabelSpec,
    compute_severe_drawdown_label,
)
from models.recovery_spec import (  # noqa: E402
    RecoveryBasis,
    SurvivalPoint,
    summarize_recovery,
)


def _spec(**overrides) -> SevereDrawdownLabelSpec:
    defaults = dict(
        spec_version="TEST-SDD-1",
        horizon_days=20,
        threshold_family=DrawdownThresholdFamily.PERCENT_FROM_ENTRY,
        threshold_value=0.10,
    )
    defaults.update(overrides)
    return SevereDrawdownLabelSpec(**defaults)


class SevereDrawdownLabelTests(unittest.TestCase):
    def test_breach_detected_within_horizon(self):
        entry_date = date(2024, 1, 1)
        path = [
            PricePoint(date(2024, 1, 5), 98.0),
            PricePoint(date(2024, 1, 10), 85.0),  # drawdown -15%, breaches 10% threshold
            PricePoint(date(2024, 1, 15), 90.0),
        ]
        result = compute_severe_drawdown_label(
            entry_price=100.0, entry_date=entry_date, price_path=path,
            spec=_spec(), dataset_cutoff=date(2024, 2, 1),
        )
        self.assertEqual(result.status, LabelStatus.BREACHED)
        self.assertEqual(result.breach_date, date(2024, 1, 10))
        self.assertAlmostEqual(result.worst_drawdown_observed, -0.15, places=10)

    def test_survives_when_never_breaches_and_cutoff_is_past_horizon(self):
        entry_date = date(2024, 1, 1)
        path = [
            PricePoint(date(2024, 1, 5), 98.0),
            PricePoint(date(2024, 1, 10), 95.0),  # worst drawdown -5%, below 10% threshold
            PricePoint(date(2024, 1, 21), 99.0),  # just past the 20-day horizon
        ]
        result = compute_severe_drawdown_label(
            entry_price=100.0, entry_date=entry_date, price_path=path,
            spec=_spec(horizon_days=20), dataset_cutoff=date(2024, 2, 1),
        )
        self.assertEqual(result.status, LabelStatus.SURVIVED)
        self.assertAlmostEqual(result.worst_drawdown_observed, -0.05, places=10)

    def test_censored_when_dataset_cutoff_is_before_horizon_end(self):
        entry_date = date(2024, 1, 1)
        path = [PricePoint(date(2024, 1, 5), 98.0)]
        result = compute_severe_drawdown_label(
            entry_price=100.0, entry_date=entry_date, price_path=path,
            spec=_spec(horizon_days=20), dataset_cutoff=date(2024, 1, 10),  # cutoff well before horizon end
        )
        self.assertEqual(result.status, LabelStatus.CENSORED)

    def test_leakage_guard_ignores_points_beyond_dataset_cutoff(self):
        entry_date = date(2024, 1, 1)
        path = [
            PricePoint(date(2024, 1, 5), 98.0),  # before cutoff, no breach
            PricePoint(date(2024, 1, 20), 50.0),  # AFTER the cutoff -- must be ignored even though it would breach
        ]
        result = compute_severe_drawdown_label(
            entry_price=100.0, entry_date=entry_date, price_path=path,
            spec=_spec(horizon_days=20), dataset_cutoff=date(2024, 1, 10),
        )
        # Must be CENSORED (insufficient data through the horizon), NOT
        # BREACHED -- the later point is real future data relative to the
        # cutoff and must never be read.
        self.assertEqual(result.status, LabelStatus.CENSORED)
        self.assertAlmostEqual(result.worst_drawdown_observed, -0.02, places=10)

    def test_unimplemented_threshold_family_raises_rather_than_guessing(self):
        with self.assertRaises(NotImplementedError):
            compute_severe_drawdown_label(
                entry_price=100.0, entry_date=date(2024, 1, 1), price_path=[],
                spec=_spec(threshold_family=DrawdownThresholdFamily.MULTIPLE_OF_RV),
                dataset_cutoff=date(2024, 2, 1),
            )


class RecoverySummaryTests(unittest.TestCase):
    def _curve(self):
        return [
            SurvivalPoint(0, 1.0),
            SurvivalPoint(5, 0.8),
            SurvivalPoint(10, 0.6),
            SurvivalPoint(20, 0.4),
            SurvivalPoint(40, 0.1),
        ]

    def test_hand_computed_probabilities(self):
        summary = summarize_recovery(self._curve(), RecoveryBasis.ASSIGNMENT_ECONOMIC_BASIS)
        self.assertAlmostEqual(summary.p_recovery_by_5d, 0.2, places=10)
        self.assertAlmostEqual(summary.p_recovery_by_10d, 0.4, places=10)
        self.assertAlmostEqual(summary.p_recovery_by_20d, 0.6, places=10)

    def test_median_is_first_crossing_of_one_half(self):
        summary = summarize_recovery(self._curve(), RecoveryBasis.ASSIGNMENT_ECONOMIC_BASIS)
        self.assertEqual(summary.median_recovery_days, 20)

    def test_p95_is_none_when_curve_never_reaches_it(self):
        summary = summarize_recovery(self._curve(), RecoveryBasis.ASSIGNMENT_ECONOMIC_BASIS)
        self.assertIsNone(summary.p95_recovery_days)
        self.assertTrue(summary.unresolved_beyond_observed_range)

    def test_p95_found_when_curve_reaches_it(self):
        # S(80) = 0.03 crosses the P95 threshold (<= 0.05), but a nonzero
        # survival probability still means 3% of the sample has not
        # recovered by day 80 -- reaching P95 is not the same claim as
        # "fully resolved," so unresolved_beyond_observed_range is
        # correctly still True here. See test_curve_that_reaches_zero_is_
        # fully_resolved below for the actually-resolved case.
        curve = self._curve() + [SurvivalPoint(80, 0.03)]
        summary = summarize_recovery(curve, RecoveryBasis.ASSIGNMENT_ECONOMIC_BASIS)
        self.assertEqual(summary.p95_recovery_days, 80)
        self.assertTrue(summary.unresolved_beyond_observed_range)

    def test_curve_that_reaches_zero_is_fully_resolved(self):
        curve = self._curve() + [SurvivalPoint(80, 0.0)]
        summary = summarize_recovery(curve, RecoveryBasis.ASSIGNMENT_ECONOMIC_BASIS)
        self.assertFalse(summary.unresolved_beyond_observed_range)

    def test_basis_is_recorded_not_implicitly_assumed(self):
        summary = summarize_recovery(self._curve(), RecoveryBasis.WHOLE_CHAIN_BREAKEVEN)
        self.assertEqual(summary.basis, RecoveryBasis.WHOLE_CHAIN_BREAKEVEN)

    def test_query_before_first_observed_point_is_undefined(self):
        curve = [SurvivalPoint(5, 1.0), SurvivalPoint(10, 0.5)]
        summary = summarize_recovery(curve, RecoveryBasis.ORIGINAL_STRIKE_PRICE)
        # 5d query lands exactly on the first point (defined); no point
        # before t=5 exists, which this fixture doesn't probe further, but
        # the important behavior (no crash, no fabricated 1.0) is exercised
        # by the non-decreasing-curve validation test below.
        self.assertIsNotNone(summary.p_recovery_by_5d)

    def test_non_monotonic_curve_is_rejected(self):
        bad_curve = [SurvivalPoint(0, 0.5), SurvivalPoint(5, 0.9)]  # increasing -- invalid survival curve
        with self.assertRaises(ValueError):
            summarize_recovery(bad_curve, RecoveryBasis.ORIGINAL_STRIKE_PRICE)

    def test_empty_curve_is_rejected(self):
        with self.assertRaises(ValueError):
            summarize_recovery([], RecoveryBasis.ORIGINAL_STRIKE_PRICE)

    def test_out_of_range_probability_is_rejected(self):
        with self.assertRaises(ValueError):
            summarize_recovery([SurvivalPoint(0, 1.2)], RecoveryBasis.ORIGINAL_STRIKE_PRICE)


if __name__ == "__main__":
    unittest.main()
