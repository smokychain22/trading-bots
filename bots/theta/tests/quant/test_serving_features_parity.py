import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from features.serving_parity import (serving_parity_gap_frequency, serving_parity_max_adverse_gap,
                                     serving_parity_trend_slope)

FIXTURE = Path(__file__).resolve().parents[4] / 'tests' / 'fixtures' / 'serving-features-parity.json'


class ServingFeatureParityTests(unittest.TestCase):
    def test_all_three_features_match_the_typescript_production_values(self):
        cases = json.loads(FIXTURE.read_text(encoding='utf-8'))['cases']
        self.assertGreaterEqual(len(cases), 11)
        for case in cases:
            label = f"{case['name']} window={case['window']}"
            actual = {
                'trendSlope': serving_parity_trend_slope(case['closes'], case['window']),
                'gapFrequency': serving_parity_gap_frequency(case['opens'], case['closes'], case['window'], case['gapThreshold']),
                'maxAdverseGap': serving_parity_max_adverse_gap(case['opens'], case['closes'], case['window']),
            }
            for key, expected in case['expected'].items():
                if expected is None:
                    self.assertIsNone(actual[key], f'{label} {key}')
                else:
                    self.assertIsNotNone(actual[key], f'{label} {key}')
                    self.assertAlmostEqual(actual[key], expected, places=12, msg=f'{label} {key}')

    def test_unknown_inputs_stay_unknown_never_zero(self):
        self.assertIsNone(serving_parity_trend_slope([1.0, None, 3.0, 4.0], 3))
        self.assertIsNone(serving_parity_trend_slope([1.0, 2.0], 5))
        self.assertIsNone(serving_parity_max_adverse_gap([1.0], [1.0], 5))
        self.assertIsNone(serving_parity_gap_frequency([1.0, 1.0], [1.0, 1.0, 1.0], 1, 0.02))


if __name__ == '__main__':
    unittest.main()
