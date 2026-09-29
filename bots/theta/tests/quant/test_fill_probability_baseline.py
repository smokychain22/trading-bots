"""Tests for bots/theta/quant/models/fill_probability_baseline.py (work
package 37).
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.fill_probability_baseline import (  # noqa: E402
    FillLabelRow, fit_fill_probability_baseline, predict_fill_probability,
)


def _real_rows(n: int) -> list:
    rows = []
    for i in range(n):
        marketable = i % 2 == 0
        rows.append(FillLabelRow(
            bid=0.55, ask=0.60, limit_price=0.60 if marketable else 0.55, quote_size=50,
            filled=marketable, truth_class="BROKER_ACTUAL",
        ))
    return rows


class TestFitFillProbabilityBaseline(unittest.TestCase):
    def test_no_real_data_today_is_insufficient_sample(self):
        # This is the honest, current real-world state per WP24's finding:
        # zero real BROKER_ACTUAL fill labels exist anywhere in this repo.
        fit = fit_fill_probability_baseline([])
        self.assertEqual(fit.state, "INSUFFICIENT_SAMPLE")
        self.assertEqual(fit.sample_n, 0)

    def test_below_minimum_n_is_insufficient_sample(self):
        fit = fit_fill_probability_baseline(_real_rows(10), minimum_required_n=30)
        self.assertEqual(fit.state, "INSUFFICIENT_SAMPLE")
        self.assertEqual(fit.sample_n, 10)

    def test_modeled_research_labels_are_never_silently_included_in_the_fit(self):
        modeled_rows = [
            FillLabelRow(bid=0.55, ask=0.60, limit_price=0.60, quote_size=50, filled=True, truth_class="MODELED_RESEARCH")
            for _ in range(50)
        ]
        fit = fit_fill_probability_baseline(modeled_rows, minimum_required_n=30)
        self.assertEqual(fit.state, "INSUFFICIENT_SAMPLE")
        self.assertEqual(fit.sample_n, 0)  # none of the 50 modeled rows count toward real N

    def test_synthetic_fixture_labels_are_never_silently_included(self):
        synthetic_rows = [
            FillLabelRow(bid=0.55, ask=0.60, limit_price=0.60, quote_size=50, filled=True, truth_class="SYNTHETIC_FIXTURE")
            for _ in range(50)
        ]
        fit = fit_fill_probability_baseline(synthetic_rows, minimum_required_n=30)
        self.assertEqual(fit.sample_n, 0)

    def test_sufficient_real_labels_fit_and_predict(self):
        fit = fit_fill_probability_baseline(_real_rows(40), minimum_required_n=30)
        self.assertEqual(fit.state, "FITTED")
        self.assertEqual(fit.sample_n, 40)
        marketable_probability = predict_fill_probability(fit, bid=0.55, ask=0.60, limit_price=0.60, quote_size=50)
        passive_probability = predict_fill_probability(fit, bid=0.55, ask=0.60, limit_price=0.55, quote_size=50)
        self.assertGreater(marketable_probability, passive_probability)

    def test_prediction_from_unfitted_state_is_none(self):
        fit = fit_fill_probability_baseline([])
        self.assertIsNone(predict_fill_probability(fit, bid=0.55, ask=0.60, limit_price=0.60, quote_size=50))


if __name__ == "__main__":
    unittest.main()
