"""Synthetic tests only -- no real Command-5A observation data exists yet."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.horizon_adapters import build_horizon_observation, scheduled_at_for_horizon


class ScheduledAtForHorizonTests(unittest.TestCase):
    def test_fixed_offsets_computed_correctly(self):
        decision = '2026-01-01T00:00:00+00:00'
        self.assertEqual(scheduled_at_for_horizon(decision, '+15m'), '2026-01-01T00:15:00+00:00')
        self.assertEqual(scheduled_at_for_horizon(decision, '+1d'), '2026-01-02T00:00:00+00:00')

    def test_eod_has_no_fixed_offset(self):
        self.assertIsNone(scheduled_at_for_horizon('2026-01-01T00:00:00+00:00', 'EOD'))

    def test_unknown_horizon_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_HORIZON'):
            scheduled_at_for_horizon('2026-01-01T00:00:00+00:00', '+999y')


class BuildHorizonObservationTests(unittest.TestCase):
    def test_no_captured_evidence_is_explicit_unknown_never_fabricated(self):
        result = build_horizon_observation('e1', 'c1', '+1h', '2026-01-01T00:00:00+00:00', captured=None)
        self.assertEqual(result.truth_class, 'UNKNOWN')
        self.assertIsNone(result.underlying_price)
        self.assertEqual(result.missing_reason, 'NOT_YET_CAPTURED')

    def test_synthetic_captured_evidence_is_normalized(self):
        captured = {'observedAt': '2026-01-01T01:00:05+00:00', 'providerTimestamp': '2026-01-01T01:00:00+00:00',
                    'truthClass': 'MARKET_OBSERVED', 'underlyingPrice': 101.0, 'bid': 1.0, 'ask': 1.1,
                    'iv': 0.2, 'greeks': {'delta': -0.22}}
        result = build_horizon_observation('e1', 'c1', '+1h', '2026-01-01T00:00:00+00:00', captured)
        self.assertEqual(result.truth_class, 'MARKET_OBSERVED')
        self.assertEqual(result.underlying_price, 101.0)
        self.assertEqual(result.greeks, {'delta': -0.22})

    def test_observation_before_decision_rejected(self):
        captured = {'observedAt': '2025-12-31T00:00:00+00:00', 'truthClass': 'MARKET_OBSERVED'}
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_BEFORE_DECISION'):
            build_horizon_observation('e1', 'c1', '+1h', '2026-01-01T00:00:00+00:00', captured)

    def test_unknown_truth_class_rejected(self):
        captured = {'observedAt': '2026-01-01T01:00:00+00:00', 'truthClass': 'NOT_A_REAL_CLASS'}
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_TRUTH_CLASS'):
            build_horizon_observation('e1', 'c1', '+1h', '2026-01-01T00:00:00+00:00', captured)

    def test_deterministic_hash(self):
        first = build_horizon_observation('e1', 'c1', '+1h', '2026-01-01T00:00:00+00:00', None)
        second = build_horizon_observation('e1', 'c1', '+1h', '2026-01-01T00:00:00+00:00', None)
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
