import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.graduation_metric_engine import GRADUATION_METRIC_KEYS, assemble_graduation_metrics, expected_shortfall


class ExpectedShortfallTests(unittest.TestCase):
    def test_real_tail_average(self):
        losses = [1.0, 2.0, 3.0, 4.0, 10.0]
        result = expected_shortfall(losses, quantile=0.2)
        self.assertAlmostEqual(result, 10.0)  # worst 20% (1 of 5) is just the 10.0

    def test_empty_losses_is_none(self):
        self.assertIsNone(expected_shortfall([], quantile=0.2))

    def test_invalid_quantile_rejected(self):
        with self.assertRaisesRegex(ValueError, 'QUANTILE_INVALID'):
            expected_shortfall([1.0], quantile=1.5)

    def test_small_tail_rounds_up_to_at_least_one_observation(self):
        losses = [1.0, 2.0]
        result = expected_shortfall(losses, quantile=0.05)
        self.assertAlmostEqual(result, 2.0)  # tail_count = max(1, round(2*0.05)) = 1 -> worst single loss


class AssembleGraduationMetricsTests(unittest.TestCase):
    def test_complete_when_every_metric_present(self):
        sub_metrics = {key: 1.0 for key in GRADUATION_METRIC_KEYS}
        result = assemble_graduation_metrics(sub_metrics)
        self.assertEqual(result['state'], 'COMPLETE')
        self.assertEqual(result['missingMetrics'], [])
        self.assertEqual(result['liveAuthorization'], 'NOT_GRANTED')

    def test_partial_when_a_metric_missing(self):
        sub_metrics = {key: 1.0 for key in GRADUATION_METRIC_KEYS if key != 'expectedShortfall'}
        result = assemble_graduation_metrics(sub_metrics)
        self.assertEqual(result['state'], 'PARTIAL')
        self.assertIn('expectedShortfall', result['missingMetrics'])

    def test_never_grants_live_authorization(self):
        result = assemble_graduation_metrics({})
        self.assertEqual(result['liveAuthorization'], 'NOT_GRANTED')


if __name__ == '__main__':
    unittest.main()
