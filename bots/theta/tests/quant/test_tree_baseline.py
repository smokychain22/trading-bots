import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.tree_baseline import TreeTrainingRow, fit_tree_baseline, predict_probability


def separable_rows(n=40):
    rows = []
    for i in range(n):
        x = float(i)
        label = 1 if x >= n / 2 else 0
        rows.append(TreeTrainingRow((x,), label))
    return rows


class TreeBaselineTests(unittest.TestCase):
    def test_insufficient_sample_below_minimum_n(self):
        result = fit_tree_baseline(separable_rows(10), minimum_required_n=30)
        self.assertEqual(result.state, "INSUFFICIENT_SAMPLE")
        self.assertIsNone(result.root)

    def test_single_class_is_insufficient_sample_not_a_degenerate_fit(self):
        rows = [TreeTrainingRow((float(i),), 0) for i in range(40)]
        result = fit_tree_baseline(rows, minimum_required_n=30)
        self.assertEqual(result.state, "INSUFFICIENT_SAMPLE")

    def test_perfectly_separable_data_fits_and_predicts_correctly(self):
        rows = separable_rows(40)
        result = fit_tree_baseline(rows, minimum_required_n=30, max_depth=3, minimum_leaf_n=2)
        self.assertEqual(result.state, "FITTED")
        for row in rows:
            prediction = predict_probability(result.root, row.features)
            self.assertEqual(round(prediction), row.label)

    def test_deterministic_refit_is_byte_identical(self):
        rows = separable_rows(40)
        first = fit_tree_baseline(rows, minimum_required_n=30, minimum_leaf_n=2)
        second = fit_tree_baseline(rows, minimum_required_n=30, minimum_leaf_n=2)
        self.assertEqual(first, second)

    def test_feature_vector_length_mismatch_rejected(self):
        rows = separable_rows(40) + [TreeTrainingRow((1.0, 2.0), 1)]
        with self.assertRaisesRegex(ValueError, "FEATURE_VECTOR_LENGTH_MISMATCH"):
            fit_tree_baseline(rows, minimum_required_n=30, minimum_leaf_n=2)

    def test_invalid_config_rejected(self):
        with self.assertRaisesRegex(ValueError, "CONFIG_INVALID"):
            fit_tree_baseline(separable_rows(40), max_depth=0)


if __name__ == '__main__':
    unittest.main()
