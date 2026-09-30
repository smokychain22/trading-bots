import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.research_cli import _dispatch
from research.production_export_loader import assert_no_future_labels, DatasetLoadError


def fixture():
    dates = ['2026-01-05T21:00:00Z', '2026-01-06T21:00:00Z', '2026-01-07T21:00:00Z']
    return {'version': 'theta-future-volatility-input-v1', 'truthClass': 'SYNTHETIC_TEST',
        'subjectId': 'test', 'underlying': 'SPY', 'policyVersion': 'test', 'calendarVersion': 'test-grid',
        'ivMethod': 'explicit-test-contract', 'decisionAt': dates[0], 'labelAsOf': '2026-01-07T22:00:00Z',
        'expectedObservationTimes': dates, 'policyFrozenAt': '2026-01-01T00:00:00Z',
        'units': 'DECIMAL_ANNUALIZED_VOLATILITY', 'periodsPerYear': 252,
        'ivAtDecision': .2, 'ivEvidenceId': 'iv-test', 'ivAvailableAt': dates[0],
        'observations': [{'observedAt': t, 'availableAt': t, 'underlying': 'SPY', 'evidenceId': str(i), 'price': p}
                         for i, (t, p) in enumerate(zip(dates, [100, 101, 100]))]}


class FutureVolatilityLabelTests(unittest.TestCase):
    def test_existing_rv_estimator_executes_via_cli_with_distinct_label_truth(self):
        value = _dispatch('future-volatility-label', fixture())
        self.assertEqual(value['state'], 'MATURED_LABEL')
        self.assertEqual(value['role'], 'FUTURE_LABEL_ONLY')
        self.assertEqual(value['truthClass'], 'SYNTHETIC_TEST')
        self.assertFalse(value['empiricalPromotion'])
        self.assertAlmostEqual(value['ivMinusSubsequentRv'], .2-value['subsequentRealizedVolatility'])
        self.assertEqual(value, _dispatch('future-volatility-label', fixture()))

    def test_missing_marks_or_iv_remain_insufficient_not_zero(self):
        for change in ({'observations': []}, {'ivAtDecision': None}):
            value = _dispatch('future-volatility-label', {**fixture(), **change})
            self.assertEqual(value['state'], 'INSUFFICIENT_EVIDENCE')
            self.assertIsNone(value['subsequentRealizedVolatility'])

    def test_future_labels_rejected_from_feature_payload(self):
        for key in ('subsequentRealizedVolatility', 'futureRealizedVolatility', 'futureVolatilityLabel'):
            with self.assertRaises(DatasetLoadError):
                assert_no_future_labels({'volatility': {key: .1}}, 'candidate')

    def test_wrong_units_identity_future_iv_and_duplicate_marks_fail_closed(self):
        for change in ({'units': 'PERCENT'}, {'ivAvailableAt': '2026-01-06T21:00:00Z'},
                       {'periodsPerYear': float('nan')}, {'truthClass': 'BROKER_ACTUAL'}, {'ivAtDecision': 1e300}):
            with self.assertRaises(ValueError):
                _dispatch('future-volatility-label', {**fixture(), **change})
        for change in ({'underlying': 'SQQQ'}, {'price': -1}, {'availableAt': '2026-01-08T21:00:00Z'}):
            raw = fixture()
            raw['observations'][0].update(change)
            with self.assertRaises(ValueError):
                _dispatch('future-volatility-label', raw)
        raw = fixture()
        raw['observations'].append(copy.deepcopy(raw['observations'][0]))
        with self.assertRaises(ValueError):
            _dispatch('future-volatility-label', raw)
