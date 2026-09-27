import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.cohort_calibration import cohort_calibration_report


class CohortCalibrationTests(unittest.TestCase):
    def test_tiny_cohort_is_insufficient_sample_not_a_fabricated_verdict(self):
        report = cohort_calibration_report(['DTE_0_7', 'DTE_0_7'], [0.5, 0.6], [1, 0], bin_count=2, minimum_cohort_n=10)
        self.assertEqual(report['DTE_0_7']['state'], 'INSUFFICIENT_SAMPLE')
        self.assertIsNone(report['DTE_0_7']['metrics'])

    def test_sufficient_cohort_reuses_existing_calibration_metrics(self):
        cohorts = ['DTE_8_21'] * 10
        probabilities = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.5]
        labels = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
        report = cohort_calibration_report(cohorts, probabilities, labels, bin_count=5, minimum_cohort_n=5)
        self.assertEqual(report['DTE_8_21']['state'], 'EVALUATED')
        self.assertEqual(report['DTE_8_21']['metrics'].sample_size, 10)

    def test_cohorts_graded_independently(self):
        cohorts = ['A'] * 3 + ['B'] * 10
        probabilities = [0.5, 0.5, 0.5] + [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.5]
        labels = [1, 0, 1] + [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
        report = cohort_calibration_report(cohorts, probabilities, labels, bin_count=5, minimum_cohort_n=5)
        self.assertEqual(report['A']['state'], 'INSUFFICIENT_SAMPLE')
        self.assertEqual(report['B']['state'], 'EVALUATED')

    def test_length_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, 'LENGTH_MISMATCH'):
            cohort_calibration_report(['A'], [0.5, 0.6], [1, 0], bin_count=2, minimum_cohort_n=1)


if __name__ == '__main__':
    unittest.main()
