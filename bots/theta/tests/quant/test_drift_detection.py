import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.drift_detection import detect_distribution_drift


class DriftDetectionTests(unittest.TestCase):
    def test_insufficient_sample_below_minimum_n(self):
        result = detect_distribution_drift('FEATURE', [1.0, 2.0], [1.0, 2.0], minimum_n=10,
            baseline_window_bounds=('2026-01-01', '2026-01-05'), current_window_bounds=('2026-02-01', '2026-02-05'),
            meaningful_effect_size=0.1)
        self.assertEqual(result['state'], 'INSUFFICIENT_SAMPLE')
        self.assertIsNone(result['driftDetected'])

    def test_no_drift_when_shift_below_effect_size(self):
        baseline = [1.0] * 20
        current = [1.02] * 20
        result = detect_distribution_drift('PREDICTION', baseline, current, minimum_n=10,
            baseline_window_bounds=('a', 'b'), current_window_bounds=('c', 'd'), meaningful_effect_size=0.1)
        self.assertEqual(result['state'], 'EVALUATED')
        self.assertFalse(result['driftDetected'])

    def test_drift_detected_when_shift_exceeds_effect_size(self):
        baseline = [1.0] * 20
        current = [5.0] * 20
        result = detect_distribution_drift('LABEL', baseline, current, minimum_n=10,
            baseline_window_bounds=('a', 'b'), current_window_bounds=('c', 'd'), meaningful_effect_size=0.1)
        self.assertTrue(result['driftDetected'])
        self.assertAlmostEqual(result['meanShift'], 4.0)

    def test_all_five_drift_kinds_accepted(self):
        for kind in ('FEATURE', 'PREDICTION', 'CALIBRATION', 'REGIME_MIX', 'LABEL'):
            result = detect_distribution_drift(kind, [1.0] * 10, [1.0] * 10, minimum_n=5,
                baseline_window_bounds=('a', 'b'), current_window_bounds=('c', 'd'), meaningful_effect_size=0.1)
            self.assertEqual(result['driftKind'], kind)

    def test_unknown_kind_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_KIND'):
            detect_distribution_drift('NOT_A_REAL_KIND', [1.0] * 10, [1.0] * 10, minimum_n=5,
                baseline_window_bounds=('a', 'b'), current_window_bounds=('c', 'd'), meaningful_effect_size=0.1)

    def test_invalid_minimum_n_rejected(self):
        with self.assertRaisesRegex(ValueError, 'MINIMUM_N_INVALID'):
            detect_distribution_drift('FEATURE', [1.0], [1.0], minimum_n=0,
                baseline_window_bounds=('a', 'b'), current_window_bounds=('c', 'd'), meaningful_effect_size=0.1)


if __name__ == '__main__':
    unittest.main()
