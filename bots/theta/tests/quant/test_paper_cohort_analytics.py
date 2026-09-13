"""Tests for bots/theta/quant/research/paper_cohort_analytics.py. Synthetic fixtures only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.paper_cohort_analytics import (  # noqa: E402
    CohortDimension,
    CohortEpisode,
    CohortKey,
    DecompositionReconciliationError,
    PnLDecomposition,
    PredictedVsRealized,
    build_cohort_report,
    reconcile_decomposition,
    require_reconciled_decomposition,
)


class PredictedVsRealizedTests(unittest.TestCase):
    def test_error_is_none_when_prediction_unknown(self):
        pair = PredictedVsRealized(predicted_ev=None, realized_pnl=100.0)
        self.assertIsNone(pair.error)

    def test_error_is_none_when_realization_unknown(self):
        pair = PredictedVsRealized(predicted_ev=50.0, realized_pnl=None)
        self.assertIsNone(pair.error)

    def test_error_computed_when_both_known(self):
        pair = PredictedVsRealized(predicted_ev=50.0, realized_pnl=80.0)
        self.assertAlmostEqual(pair.error, 30.0)


class DecompositionReconciliationTests(unittest.TestCase):
    def _decomposition(self, **overrides):
        defaults = dict(
            decision_alpha=20.0, execution_alpha=-2.0, sizing_effect=0.0,
            management_effect=5.0, tail_realization=0.0,
        )
        defaults.update(overrides)
        return PnLDecomposition(**defaults)

    def test_partially_known_decomposition_reconciles_to_none(self):
        decomposition = self._decomposition(tail_realization=None)
        self.assertIsNone(reconcile_decomposition(decomposition, 23.0))

    def test_unknown_realized_pnl_reconciles_to_none(self):
        decomposition = self._decomposition()
        self.assertIsNone(reconcile_decomposition(decomposition, None))

    def test_fully_known_matching_sum_reconciles_true(self):
        decomposition = self._decomposition()  # sums to 23.0
        self.assertTrue(reconcile_decomposition(decomposition, 23.0))

    def test_fully_known_mismatched_sum_reconciles_false(self):
        decomposition = self._decomposition()  # sums to 23.0
        self.assertFalse(reconcile_decomposition(decomposition, 999.0))

    def test_require_reconciled_raises_on_mismatch(self):
        decomposition = self._decomposition()
        with self.assertRaises(DecompositionReconciliationError):
            require_reconciled_decomposition(decomposition, 999.0)

    def test_require_reconciled_does_not_raise_when_unknown(self):
        decomposition = self._decomposition(tail_realization=None)
        require_reconciled_decomposition(decomposition, None)  # must not raise

    def test_require_reconciled_does_not_raise_on_match(self):
        decomposition = self._decomposition()
        require_reconciled_decomposition(decomposition, 23.0)  # must not raise

    def test_is_fully_known_requires_all_five_components(self):
        self.assertTrue(self._decomposition().is_fully_known())
        self.assertFalse(self._decomposition(sizing_effect=None).is_fully_known())


class CohortReportTests(unittest.TestCase):
    def _episode(self, episode_id, branch, dte_bucket, predicted, realized):
        return CohortEpisode(
            episode_id=episode_id,
            keys=(
                CohortKey(CohortDimension.STRATEGY_BRANCH, branch),
                CohortKey(CohortDimension.DTE_BUCKET, dte_bucket),
            ),
            prediction=PredictedVsRealized(predicted_ev=predicted, realized_pnl=realized),
            decomposition=PnLDecomposition(None, None, None, None, None),
        )

    def test_episode_contributes_to_every_dimension_it_carries(self):
        episodes = [self._episode("e1", "THETA_CONVENTIONAL", "25_35", 10.0, 15.0)]
        report = build_cohort_report(episodes)
        self.assertIn(CohortKey(CohortDimension.STRATEGY_BRANCH, "THETA_CONVENTIONAL"), report)
        self.assertIn(CohortKey(CohortDimension.DTE_BUCKET, "25_35"), report)

    def test_aggregate_means_only_over_known_values(self):
        episodes = [
            self._episode("e1", "THETA_CONVENTIONAL", "25_35", 10.0, 20.0),
            self._episode("e2", "THETA_CONVENTIONAL", "25_35", None, None),
        ]
        report = build_cohort_report(episodes)
        agg = report[CohortKey(CohortDimension.STRATEGY_BRANCH, "THETA_CONVENTIONAL")]
        self.assertEqual(agg.n, 2)
        self.assertEqual(agg.n_with_known_error, 1)
        self.assertAlmostEqual(agg.mean_predicted_ev, 10.0)
        self.assertAlmostEqual(agg.mean_realized_pnl, 20.0)
        self.assertAlmostEqual(agg.mean_error, 10.0)

    def test_empty_episode_list_produces_empty_report(self):
        self.assertEqual(build_cohort_report([]), {})


if __name__ == "__main__":
    unittest.main()
