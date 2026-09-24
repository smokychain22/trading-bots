from math import isclose
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))

from research.validation import (
    ValidationObservation,
    WalkForwardConfig,
    build_grouped_walk_forward_plan,
    calibration_metrics,
    fit_isotonic_calibrator,
    fit_platt_scaler,
    PitValidationObservation, build_purged_walk_forward_plan,
)


def test_grouped_walk_forward_never_splits_an_economic_chain_and_reserves_final_oos():
    observations = []
    for day in range(1, 9):
        observations.extend([
            ValidationObservation(f"{day}-entry", f"chain-{day}", f"2026-01-{day:02d}T14:00:00+00:00"),
            ValidationObservation(f"{day}-exit", f"chain-{day}", f"2026-01-{day:02d}T20:00:00+00:00"),
        ])
    plan = build_grouped_walk_forward_plan(observations, WalkForwardConfig(
        train_groups=2, validation_groups=1, forward_groups=1, step_groups=1, embargo_groups=1, final_oos_groups=1,
    ))
    assert len(plan.splits) == 2
    assert plan.final_oos_ids == ("8-entry", "8-exit")
    for split in plan.splits:
        partitions = [set(split.train_ids), set(split.validation_ids), set(split.forward_ids), set(plan.final_oos_ids)]
        assert all(not left.intersection(right) for index, left in enumerate(partitions) for right in partitions[index + 1:])
        for day in range(1, 9):
            assert not ((f"{day}-entry" in set().union(*partitions)) ^ (f"{day}-exit" in set().union(*partitions)))


def test_calibration_metrics_are_exact_and_empty_input_stays_unknown():
    metrics = calibration_metrics([0.1, 0.9], [0, 1], bin_count=2)
    assert isclose(metrics.brier_score or 0, 0.01)
    assert isclose(metrics.expected_calibration_error or 0, 0.1)
    empty = calibration_metrics([], [], bin_count=5)
    assert empty.brier_score is None
    assert empty.log_loss is None


def test_platt_and_isotonic_require_caller_defined_sufficiency_and_both_classes():
    assert fit_platt_scaler([1.0], [1], minimum_samples=2) is None
    assert fit_isotonic_calibrator([1.0, 2.0], [1, 1], minimum_samples=2) is None

    scores = [-3.0, -2.0, -1.0, 1.0, 2.0, 3.0]
    # Deliberately not perfectly separable. Perfect separation has no finite
    # maximum-likelihood Platt coefficient and must not be used as a fit test.
    labels = [0, 0, 1, 0, 1, 1]
    platt = fit_platt_scaler(scores, labels, minimum_samples=6)
    isotonic = fit_isotonic_calibrator(scores, labels, minimum_samples=6)
    assert platt is not None
    assert isotonic is not None
    assert platt.predict(-2.0) < platt.predict(2.0)
    predictions = [isotonic.predict(score) for score in scores]
    assert predictions == sorted(predictions)


class ValidationDiscoveryTests(unittest.TestCase):
    """The repository runs unittest, so these checks must be discoverable there."""

    def test_existing_group_split(self):
        test_grouped_walk_forward_never_splits_an_economic_chain_and_reserves_final_oos()

    def test_existing_metrics(self):
        test_calibration_metrics_are_exact_and_empty_input_stays_unknown()

    def test_existing_calibrators(self):
        test_platt_and_isotonic_require_caller_defined_sufficiency_and_both_classes()

    def test_nonfinite_probabilities_never_report_zero_calibration_error(self):
        for value in (float('nan'), float('inf'), float('-inf')):
            with self.assertRaisesRegex(ValueError, 'PROBABILITY_INVALID'):
                calibration_metrics([value], [1], 2)
            for fit in (fit_isotonic_calibrator, fit_platt_scaler):
                with self.assertRaisesRegex(ValueError, 'SCORE_INVALID'):
                    fit([value, 1], [0, 1], 2)

    def test_identical_scores_have_order_independent_empirical_frequency(self):
        for labels in ([0, 1], [1, 0]):
            fitted = fit_isotonic_calibrator([0.5, 0.5], labels, 2)
            self.assertIsNotNone(fitted)
            self.assertEqual(fitted.predict(0.5), 0.5)
            self.assertEqual(fitted.upper_bounds, (0.5,))

    def test_no_convergence_is_not_a_fitted_model(self):
        self.assertIsNone(fit_platt_scaler([-2, -1, 1, 2], [0, 1, 0, 1], 4, max_iterations=1))

    def test_ties_are_aggregated_before_adjacent_pooling(self):
        fitted = fit_isotonic_calibrator([0, 0, 1, 1, 1], [0, 1, 0, 1, 1], 5)
        self.assertEqual(fitted.predict(0), 0.5)
        self.assertEqual(fitted.predict(1), 2 / 3)

    def test_timezone_is_required(self):
        with self.assertRaisesRegex(ValueError, 'TIMESTAMP'):
            build_grouped_walk_forward_plan([ValidationObservation('o', 'c', '2026-01-01T00:00:00')],
                WalkForwardConfig(1, 1, 1, 1, 0, 1))

    def test_purge_late_labels_not_just_group_names(self):
        rows = [PitValidationObservation(str(d), str(d), f'2026-01-{d:02d}T10:00:00Z',
                f'2026-01-{d:02d}T09:59:00Z', f'2026-01-{d:02d}T16:00:00Z', f'2026-01-{d:02d}T15:00:00Z')
                for d in range(1, 8)]
        config = WalkForwardConfig(2, 1, 1, 1, 0, 1)
        clean = build_purged_walk_forward_plan(rows, config, 60, 'test-pit-v1')
        self.assertTrue(clean.plan.splits)
        self.assertEqual(clean.plan.final_oos_ids, ('7',))
        rows[0] = PitValidationObservation('1', '1', rows[0].observed_at, rows[0].feature_available_at,
                                          '2026-01-05T00:00:00Z', '2026-01-04T23:00:00Z')
        late = build_purged_walk_forward_plan(rows, config, 60, 'test-pit-v1')
        self.assertIn('1', late.purged_ids)
        self.assertGreater(late.refused_split_count, 0)
        self.assertTrue(all('1' not in s.train_ids for s in late.plan.splits))

    def test_missing_labels_are_censored_and_future_features_fail(self):
        rows = [PitValidationObservation(str(d), str(d), f'2026-01-{d:02d}T10:00:00Z',
                f'2026-01-{d:02d}T09:00:00Z', None, None) for d in range(1, 6)]
        config = WalkForwardConfig(1, 1, 1, 1, 0, 1)
        self.assertFalse(build_purged_walk_forward_plan(rows, config, 0, 'test').plan.splits)
        rows[0] = PitValidationObservation('1', '1', rows[0].observed_at, '2026-02-01T00:00:00Z', None, None)
        with self.assertRaisesRegex(ValueError, 'FUTURE_FEATURE'):
            build_purged_walk_forward_plan(rows, config, 0, 'test')
