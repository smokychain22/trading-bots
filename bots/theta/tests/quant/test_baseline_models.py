"""Tests for bots/theta/quant/research/baseline_models.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.baseline_models import (  # noqa: E402
    Episode,
    bucketed_empirical_baseline,
    cross_bucketed_empirical_baseline,
    fit_regularized_linear_baseline,
    predict_regularized_linear_baseline,
    unconditional_mean_baseline,
)


class UnconditionalMeanTests(unittest.TestCase):
    def test_computes_the_population_mean(self):
        episodes = [Episode("c1", 100.0, {}), Episode("c2", -50.0, {}), Episode("c3", 25.0, {})]
        result = unconditional_mean_baseline(episodes)
        self.assertAlmostEqual(result.mean_outcome, 25.0)
        self.assertEqual(result.n, 3)

    def test_an_empty_dataset_reports_none_never_a_fabricated_zero(self):
        result = unconditional_mean_baseline([])
        self.assertIsNone(result.mean_outcome)
        self.assertEqual(result.n, 0)

    def test_a_single_episode_has_no_stdev_never_a_fabricated_zero_variance(self):
        result = unconditional_mean_baseline([Episode("c1", 10.0, {})])
        self.assertIsNone(result.stdev_outcome)


class BucketedEmpiricalTests(unittest.TestCase):
    def test_groups_by_the_requested_bucket_key(self):
        episodes = [
            Episode("c1", 100.0, {"dte_bucket": "0-14"}),
            Episode("c2", 50.0, {"dte_bucket": "0-14"}),
            Episode("c3", -20.0, {"dte_bucket": "15-30"}),
        ]
        result = bucketed_empirical_baseline(episodes, "dte_bucket")
        self.assertAlmostEqual(result["0-14"].mean_outcome, 75.0)
        self.assertAlmostEqual(result["15-30"].mean_outcome, -20.0)

    def test_an_episode_missing_the_bucket_key_contributes_to_no_bucket(self):
        episodes = [Episode("c1", 100.0, {"dte_bucket": "0-14"}), Episode("c2", 999.0, {})]
        result = bucketed_empirical_baseline(episodes, "dte_bucket")
        self.assertEqual(set(result.keys()), {"0-14"})
        self.assertEqual(result["0-14"].n, 1)

    def test_a_bucket_value_with_zero_episodes_is_simply_absent_never_synthesized(self):
        episodes = [Episode("c1", 100.0, {"dte_bucket": "0-14"})]
        result = bucketed_empirical_baseline(episodes, "dte_bucket")
        self.assertNotIn("46-60", result)


class CrossBucketedTests(unittest.TestCase):
    def test_groups_by_the_full_cross_of_dimensions(self):
        episodes = [
            Episode("c1", 100.0, {"dte_bucket": "0-14", "delta_bucket": "0.20-0.25"}),
            Episode("c2", 50.0, {"dte_bucket": "0-14", "delta_bucket": "0.20-0.25"}),
            Episode("c3", -20.0, {"dte_bucket": "0-14", "delta_bucket": "0.25-0.30"}),
        ]
        result = cross_bucketed_empirical_baseline(episodes, ["dte_bucket", "delta_bucket"])
        self.assertAlmostEqual(result[("0-14", "0.20-0.25")].mean_outcome, 75.0)
        self.assertAlmostEqual(result[("0-14", "0.25-0.30")].mean_outcome, -20.0)

    def test_an_episode_missing_any_requested_dimension_contributes_to_no_cross_bucket(self):
        episodes = [Episode("c1", 100.0, {"dte_bucket": "0-14"})]  # missing delta_bucket
        result = cross_bucketed_empirical_baseline(episodes, ["dte_bucket", "delta_bucket"])
        self.assertEqual(result, {})


class RegularizedLinearBaselineTests(unittest.TestCase):
    def test_fits_a_simple_linear_relationship(self):
        # outcome = 10 + 2*x -- noiseless, so ridge with a small lambda
        # should recover it closely.
        episodes = [Episode(f"c{i}", 10.0 + 2.0 * i, {"x": float(i)}) for i in range(10)]
        model = fit_regularized_linear_baseline(episodes, ["x"], ridge_lambda=0.01)
        self.assertIsNotNone(model)
        prediction = predict_regularized_linear_baseline(model, {"x": 5.0})
        self.assertAlmostEqual(prediction, 20.0, delta=1.0)

    def test_returns_none_when_there_are_fewer_episodes_than_parameters(self):
        episodes = [Episode("c1", 10.0, {"x": 1.0, "y": 2.0})]
        model = fit_regularized_linear_baseline(episodes, ["x", "y"])
        self.assertIsNone(model)

    def test_an_episode_missing_a_required_feature_is_excluded_not_imputed(self):
        episodes = [Episode(f"c{i}", 10.0 + 2.0 * i, {"x": float(i)}) for i in range(5)]
        episodes.append(Episode("bad", 999.0, {}))  # missing x -- must be excluded
        model = fit_regularized_linear_baseline(episodes, ["x"], ridge_lambda=0.01)
        self.assertIsNotNone(model)
        # If the bad row had been included with an imputed 0, the fit
        # would be pulled toward it; confirm the recovered slope is still
        # close to the true relationship.
        prediction = predict_regularized_linear_baseline(model, {"x": 0.0})
        self.assertAlmostEqual(prediction, 10.0, delta=2.0)

    def test_prediction_returns_none_when_a_required_feature_is_missing(self):
        episodes = [Episode(f"c{i}", 10.0 + 2.0 * i, {"x": float(i)}) for i in range(5)]
        model = fit_regularized_linear_baseline(episodes, ["x"], ridge_lambda=0.01)
        self.assertIsNotNone(model)
        self.assertIsNone(predict_regularized_linear_baseline(model, {}))


if __name__ == "__main__":
    unittest.main()
