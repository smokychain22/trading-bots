"""Tests for bots/theta/quant/research/optionomics_context_metrics.py. Synthetic fixtures only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.optionomics_context_metrics import (  # noqa: E402
    MetricValueState,
    parse_metrics_normalized,
    provider_reported_term_slope,
    provider_reported_vrp_20d,
)


def _known(value):
    return {"state": "KNOWN", "value": value, "reason": None, "units": "PROVIDER_REPORTED_UNVERIFIED"}


def _unknown(reason="PROVIDER_VALUE_MISSING_OR_NULL"):
    return {"state": "UNKNOWN", "value": None, "reason": reason, "units": "PROVIDER_REPORTED_UNVERIFIED"}


def _invalid(reason="PROVIDER_VALUE_NOT_FINITE_NUMBER"):
    return {"state": "INVALID", "value": None, "reason": reason, "units": "PROVIDER_REPORTED_UNVERIFIED"}


class ParseMetricsNormalizedTests(unittest.TestCase):
    def test_known_field_parses_with_its_value(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z", "a" * 64,
                                             {"termSlope": _known(0.015)})
        field = snapshot.get("termSlope")
        self.assertEqual(field.state, MetricValueState.KNOWN)
        self.assertAlmostEqual(field.value, 0.015)

    def test_zero_is_a_legitimate_known_value_not_dropped(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64,
                                             {"totalGex": _known(0.0)})
        field = snapshot.get("totalGex")
        self.assertEqual(field.state, MetricValueState.KNOWN)
        self.assertEqual(field.value, 0.0)

    def test_unknown_field_preserves_its_reason(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64,
                                             {"ivRank": _unknown()})
        field = snapshot.get("ivRank")
        self.assertEqual(field.state, MetricValueState.UNKNOWN)
        self.assertIsNone(field.value)
        self.assertEqual(field.reason, "PROVIDER_VALUE_MISSING_OR_NULL")

    def test_invalid_field_never_becomes_a_number(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64,
                                             {"maxPainStrike": _invalid()})
        field = snapshot.get("maxPainStrike")
        self.assertEqual(field.state, MetricValueState.INVALID)
        self.assertIsNone(field.value)

    def test_field_absent_entirely_reports_unknown_never_a_keyerror(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64, {})
        field = snapshot.get("putWall")
        self.assertEqual(field.state, MetricValueState.UNKNOWN)
        self.assertEqual(field.reason, "FIELD_NOT_PRESENT_IN_THIS_SNAPSHOT")

    def test_known_state_with_non_numeric_value_is_invalid_not_coerced(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64,
                                             {"termSlope": {"state": "KNOWN", "value": "not-a-number", "reason": None, "units": "x"}})
        field = snapshot.get("termSlope")
        self.assertEqual(field.state, MetricValueState.INVALID)

    def test_malformed_value_shape_is_invalid(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64,
                                             {"termSlope": "not-an-object"})
        field = snapshot.get("termSlope")
        self.assertEqual(field.state, MetricValueState.INVALID)


class ConvenienceExtractorTests(unittest.TestCase):
    def test_term_slope_extraction_returns_none_when_unknown(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64, {"termSlope": _unknown()})
        self.assertIsNone(provider_reported_term_slope(snapshot))

    def test_term_slope_extraction_returns_value_when_known(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64, {"termSlope": _known(0.02)})
        self.assertAlmostEqual(provider_reported_term_slope(snapshot), 0.02)

    def test_vrp_extraction_returns_none_when_field_absent(self):
        snapshot = parse_metrics_normalized("SPY", "2026-09-14T00:00:00Z", None, "a" * 64, {})
        self.assertIsNone(provider_reported_vrp_20d(snapshot))


if __name__ == "__main__":
    unittest.main()
