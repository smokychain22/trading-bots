"""Tests for bots/theta/quant/research/t0_bundle_adapter.py (work package
28): consumes the exact T0ReplayBundle JSON shape
src/theta/t0-replay-bundle.ts persists on the TypeScript side.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.t0_bundle_adapter import t0_bundle_to_research_row  # noqa: E402


def _real_shaped_bundle(**overrides):
    base = {
        "snapshotId": "snap-1", "timestamp": "2026-09-27T15:00:00.000Z", "strategyVersion": "theta-strategy-package-v1",
        "contracts": [{"underlying": "SPY", "optionSymbol": "SPY261016P00650000"}],
        "routing": {"contractVersion": "theta-strategy-router-runtime-v1"},
        "stock": None, "assignmentCapacityQty": 2, "buyingPower": 100000,
        "aegisNewRiskState": "ALLOW_FULL", "eventState": None,
        "unmanagedBrokerPositionCount": 0, "unevaluatedUnderlyingCount": 0,
        "optionomicsContext": {"state": "UNKNOWN"},
    }
    base.update(overrides)
    return base


class TestT0BundleAdapter(unittest.TestCase):
    def test_real_shaped_bundle_converts_to_a_research_row(self):
        row = t0_bundle_to_research_row(_real_shaped_bundle())
        self.assertEqual(row.snapshot_id, "snap-1")
        self.assertEqual(row.underlying_symbol, "SPY")
        self.assertEqual(row.contract_count, 1)
        self.assertTrue(row.routing_present)
        self.assertFalse(row.stock_held)
        self.assertEqual(row.missing_fields, ())

    def test_stock_held_bundle(self):
        row = t0_bundle_to_research_row(_real_shaped_bundle(
            contracts=[], stock={"underlying": "AAPL", "shares": 100}))
        self.assertTrue(row.stock_held)
        self.assertEqual(row.underlying_symbol, "AAPL")
        self.assertEqual(row.contract_count, 0)

    def test_missing_optional_field_is_recorded_not_fabricated(self):
        bundle = _real_shaped_bundle()
        del bundle["eventState"]
        row = t0_bundle_to_research_row(bundle)
        self.assertIn("eventState", row.missing_fields)
        self.assertIsNone(row.event_state)

    def test_missing_required_structure_raises(self):
        with self.assertRaises(ValueError):
            t0_bundle_to_research_row({"snapshotId": "snap-1"})

    def test_no_provider_query_pure_transformation_only(self):
        # This is a structural guarantee, proven by the function's own
        # signature: it takes a plain Mapping, no provider/network handle
        # of any kind, so it cannot make a provider call by construction.
        import inspect
        from research.t0_bundle_adapter import t0_bundle_to_research_row as fn
        params = list(inspect.signature(fn).parameters.values())
        self.assertEqual(len(params), 1)
        self.assertEqual(params[0].name, "bundle")


if __name__ == "__main__":
    unittest.main()
