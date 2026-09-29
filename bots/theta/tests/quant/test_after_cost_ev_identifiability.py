"""Tests for bots/theta/quant/research/after_cost_ev_identifiability.py
(work package 38).
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.after_cost_ev_identifiability import AfterCostEvIngredients, classify_after_cost_ev  # noqa: E402


def _ingredients(**overrides) -> AfterCostEvIngredients:
    base = dict(
        probability_favorable=0.6, gross_outcome_if_favorable=100.0, gross_outcome_if_unfavorable=-50.0,
        total_cost=5.0, probability_source="entry_model_v1",
    )
    base.update(overrides)
    return AfterCostEvIngredients(**base)


class TestClassifyAfterCostEv(unittest.TestCase):
    def test_all_ingredients_present_is_identifiable(self):
        result = classify_after_cost_ev(_ingredients())
        self.assertEqual(result.identifiability, "IDENTIFIABLE")
        expected = 0.6 * 100.0 + 0.4 * -50.0 - 5.0
        self.assertAlmostEqual(result.after_cost_ev, expected)
        self.assertEqual(result.missing_components, [])

    def test_missing_probability_is_partial_with_named_component(self):
        result = classify_after_cost_ev(_ingredients(probability_favorable=None))
        self.assertEqual(result.identifiability, "PARTIAL")
        self.assertIn("probability_favorable", result.missing_components)
        self.assertIsNone(result.after_cost_ev)

    def test_out_of_range_probability_is_flagged_not_silently_used(self):
        result = classify_after_cost_ev(_ingredients(probability_favorable=1.5))
        self.assertEqual(result.identifiability, "PARTIAL")
        self.assertIn("probability_favorable_out_of_range", result.missing_components)

    def test_nothing_present_is_not_identifiable(self):
        result = classify_after_cost_ev(AfterCostEvIngredients(
            probability_favorable=None, gross_outcome_if_favorable=None,
            gross_outcome_if_unfavorable=None, total_cost=None, probability_source=None,
        ))
        self.assertEqual(result.identifiability, "NOT_IDENTIFIABLE")
        self.assertEqual(len(result.missing_components), 4)

    def test_never_null_without_a_reason_missing_components_always_explains_partial_or_not_identifiable(self):
        result = classify_after_cost_ev(_ingredients(total_cost=None))
        self.assertIsNone(result.after_cost_ev)
        self.assertTrue(len(result.missing_components) > 0)

    def test_probability_source_is_always_named_when_present(self):
        result = classify_after_cost_ev(_ingredients())
        self.assertEqual(result.probability_source, "entry_model_v1")


if __name__ == "__main__":
    unittest.main()
