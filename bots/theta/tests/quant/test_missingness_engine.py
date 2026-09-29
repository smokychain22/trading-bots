import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.missingness_engine import build_missingness_report


def records():
    return [
        {'value': 0.5, 'feature': 'IV', 'date': '2026-01-01', 'strategy': 'THETA_CONVENTIONAL', 'provider': 'ALPACA'},
        {'value': None, 'feature': 'IV', 'date': '2026-01-01', 'strategy': 'THETA_CONVENTIONAL', 'provider': 'ALPACA'},
        {'value': 0.6, 'feature': 'SKEW', 'date': '2026-01-02', 'strategy': 'THETA_HOLD_STRIKE', 'provider': 'OPTIONOMICS'},
    ]


class MissingnessEngineTests(unittest.TestCase):
    def test_overall_missing_fraction(self):
        report = build_missingness_report(records(), value_key='value')
        self.assertEqual(report['totalRecords'], 3)
        self.assertEqual(report['missingTotal'], 1)
        self.assertAlmostEqual(report['missingFraction'], 1 / 3)

    def test_by_feature_dimension(self):
        report = build_missingness_report(records(), value_key='value', dimensions=['feature'])
        self.assertEqual(report['byDimension']['feature']['IV'], {'present': 1, 'missing': 1})
        self.assertEqual(report['byDimension']['feature']['SKEW'], {'present': 1, 'missing': 0})

    def test_unknown_dimension_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_DIMENSION'):
            build_missingness_report(records(), value_key='value', dimensions=['not_a_real_dimension'])

    def test_empty_dimensions_rejected(self):
        with self.assertRaisesRegex(ValueError, 'NO_DIMENSIONS_REQUESTED'):
            build_missingness_report(records(), value_key='value', dimensions=[])

    def test_empty_records_reports_none_fraction_not_zero(self):
        report = build_missingness_report([], value_key='value')
        self.assertIsNone(report['missingFraction'])

    def test_missing_dimension_value_labeled_explicitly(self):
        report = build_missingness_report([{'value': 1.0}], value_key='value', dimensions=['feature'])
        self.assertIn('UNKNOWN_DIMENSION_VALUE', report['byDimension']['feature'])


if __name__ == '__main__':
    unittest.main()
