"""Tests for bots/theta/quant/research/correlation_metrics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.correlation_metrics import (  # noqa: E402
    ConcentrationExposure,
    ReturnSeries,
    build_correlation_matrix,
    cluster_concentration,
    dynamic_correlation_clusters,
    pairwise_correlation,
)


class PairwiseCorrelationTests(unittest.TestCase):
    def test_perfectly_correlated_series_score_one(self):
        a = [1.0, 2.0, 3.0, 4.0]
        b = [2.0, 4.0, 6.0, 8.0]
        self.assertAlmostEqual(pairwise_correlation(a, b), 1.0)

    def test_perfectly_anti_correlated_series_score_negative_one(self):
        a = [1.0, 2.0, 3.0, 4.0]
        b = [4.0, 3.0, 2.0, 1.0]
        self.assertAlmostEqual(pairwise_correlation(a, b), -1.0)

    def test_mismatched_lengths_return_none_never_a_silent_truncation(self):
        self.assertIsNone(pairwise_correlation([1.0, 2.0, 3.0], [1.0, 2.0]))

    def test_a_constant_series_has_undefined_correlation_never_zero(self):
        self.assertIsNone(pairwise_correlation([5.0, 5.0, 5.0], [1.0, 2.0, 3.0]))

    def test_too_few_observations_returns_none(self):
        self.assertIsNone(pairwise_correlation([1.0], [2.0]))


class CorrelationMatrixTests(unittest.TestCase):
    def test_builds_a_symmetric_lookup_over_multiple_series(self):
        series = [
            ReturnSeries("SPY", (0.01, 0.02, -0.01, 0.03)),
            ReturnSeries("QQQ", (0.02, 0.04, -0.02, 0.06)),  # perfectly correlated with SPY
            ReturnSeries("GLD", (-0.01, 0.00, 0.02, -0.03)),
        ]
        matrix = build_correlation_matrix(series)
        self.assertAlmostEqual(matrix.get("SPY", "QQQ"), 1.0)
        self.assertAlmostEqual(matrix.get("QQQ", "SPY"), 1.0)  # symmetric lookup
        self.assertEqual(matrix.get("SPY", "SPY"), 1.0)

    def test_an_unknown_pair_returns_none(self):
        series = [ReturnSeries("SPY", (0.01, 0.02)), ReturnSeries("FLAT", (1.0, 1.0))]
        matrix = build_correlation_matrix(series)
        self.assertIsNone(matrix.get("SPY", "FLAT"))


class DynamicClusterTests(unittest.TestCase):
    def test_highly_correlated_symbols_cluster_together(self):
        series = [
            ReturnSeries("SPY", (0.01, 0.02, -0.01, 0.03)),
            ReturnSeries("QQQ", (0.02, 0.04, -0.02, 0.06)),  # perfectly correlated
            ReturnSeries("GLD", (-0.03, 0.01, 0.02, -0.01)),  # uncorrelated-ish
        ]
        matrix = build_correlation_matrix(series)
        clusters = dynamic_correlation_clusters(matrix, threshold=0.9)
        spy_cluster = next(c for c in clusters if "SPY" in c)
        self.assertIn("QQQ", spy_cluster)

    def test_every_symbol_appears_in_exactly_one_cluster(self):
        series = [
            ReturnSeries("A", (0.01, 0.02, 0.03)),
            ReturnSeries("B", (0.02, 0.04, 0.06)),
            ReturnSeries("C", (-0.01, 0.05, -0.02)),
        ]
        matrix = build_correlation_matrix(series)
        clusters = dynamic_correlation_clusters(matrix, threshold=0.5)
        all_members = [s for cluster in clusters for s in cluster]
        self.assertEqual(sorted(all_members), ["A", "B", "C"])
        self.assertEqual(len(all_members), len(set(all_members)))  # no symbol counted twice

    def test_an_uncorrelated_symbol_forms_its_own_singleton_cluster(self):
        series = [
            ReturnSeries("A", (0.01, 0.02, 0.03, 0.04)),
            ReturnSeries("B", (0.02, 0.04, 0.06, 0.08)),  # correlated with A
            ReturnSeries("C", (0.04, -0.02, 0.01, -0.03)),  # not correlated with A/B
        ]
        matrix = build_correlation_matrix(series)
        clusters = dynamic_correlation_clusters(matrix, threshold=0.99)
        c_cluster = next(c for c in clusters if "C" in c)
        self.assertEqual(c_cluster, frozenset({"C"}))

    def test_invalid_threshold_raises(self):
        matrix = build_correlation_matrix([ReturnSeries("A", (1.0, 2.0))])
        with self.assertRaises(ValueError):
            dynamic_correlation_clusters(matrix, threshold=1.5)


class ClusterConcentrationTests(unittest.TestCase):
    def test_reports_total_capital_and_concentration_percentage_per_cluster(self):
        exposures = [
            ConcentrationExposure("SPY", 10_000.0),
            ConcentrationExposure("QQQ", 15_000.0),
            ConcentrationExposure("GLD", 5_000.0),
        ]
        clusters = [frozenset({"SPY", "QQQ"}), frozenset({"GLD"})]
        result = cluster_concentration(exposures, clusters)
        spy_qqq_cluster = next(c for c in result if "SPY" in c.cluster)
        self.assertAlmostEqual(spy_qqq_cluster.total_capital, 25_000.0)
        self.assertAlmostEqual(spy_qqq_cluster.concentration_pct, 25_000.0 / 30_000.0)

    def test_zero_total_capital_reports_zero_concentration_never_a_division_error(self):
        result = cluster_concentration([], [frozenset({"SPY"})])
        self.assertAlmostEqual(result[0].concentration_pct, 0.0)


if __name__ == "__main__":
    unittest.main()
