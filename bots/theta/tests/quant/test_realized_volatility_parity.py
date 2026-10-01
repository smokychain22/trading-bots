import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from features.realized_volatility import close_to_close_realized_volatility, serving_parity_realized_volatility

FIXTURE = Path(__file__).resolve().parents[4] / 'tests' / 'fixtures' / 'realized-volatility-parity.json'


class ServingParityTests(unittest.TestCase):
    def test_matches_the_typescript_production_values(self):
        cases = json.loads(FIXTURE.read_text(encoding='utf-8'))['cases']
        self.assertGreaterEqual(len(cases), 10)
        for case in cases:
            actual = serving_parity_realized_volatility(case['closes'], case['window'])
            if case['expected'] is None:
                self.assertIsNone(actual, case['name'])
            else:
                self.assertIsNotNone(actual, case['name'])
                self.assertAlmostEqual(actual, case['expected'], places=12, msg=f"{case['name']} window={case['window']}")

    def test_sample_baseline_differs_by_the_known_factor_so_it_is_never_mistaken_for_serving(self):
        case = next(c for c in json.loads(FIXTURE.read_text(encoding='utf-8'))['cases'] if c['name'] == 'volatile-60' and c['window'] == 20)
        closes = case['closes']
        sample = close_to_close_realized_volatility(closes[len(closes) - 21:], min_periods=20)
        serving = serving_parity_realized_volatility(closes, 20)
        self.assertAlmostEqual(sample / serving, (20 / 19) ** 0.5, places=9)


if __name__ == '__main__':
    unittest.main()
