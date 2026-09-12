"""Tests for bots/theta/quant/research/research_targets.py. Structural only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.research_targets import (  # noqa: E402
    ALL_TARGETS,
    ExecutionTarget,
    LifecycleTarget,
    PrimaryTarget,
    RiskTarget,
    target_definition_version,
)


class TargetRegistryTests(unittest.TestCase):
    def test_no_premium_only_target_exists_anywhere(self):
        names = {t.value for t in ALL_TARGETS}
        for forbidden in ("PREMIUM", "PREMIUM_ONLY", "PREMIUM_CAPTURE_ONLY"):
            self.assertNotIn(forbidden, names)

    def test_primary_targets_cover_the_four_required_metrics(self):
        expected = {"WHOLE_CHAIN_NET_PNL", "MANAGED_EPISODE_NET_PNL", "RETURN_ON_SECURED_CAPITAL", "RETURN_PER_CAPITAL_DAY"}
        self.assertEqual({t.value for t in PrimaryTarget}, expected)

    def test_risk_targets_cover_the_five_required_metrics(self):
        expected = {"MAX_DRAWDOWN", "MAX_ADVERSE_EXCURSION", "MAX_FAVORABLE_EXCURSION", "EXPECTED_SHORTFALL", "SEVERE_DRAWDOWN_EVENT"}
        self.assertEqual({t.value for t in RiskTarget}, expected)

    def test_lifecycle_targets_cover_the_five_required_metrics(self):
        expected = {"ASSIGNMENT", "RECOVERY_DURATION", "RECOVERY_SUCCESS", "CALL_AWAY", "CAPITAL_LOCK"}
        self.assertEqual({t.value for t in LifecycleTarget}, expected)

    def test_execution_targets_cover_the_four_required_metrics(self):
        expected = {"FILL_OR_NO_FILL", "SLIPPAGE", "SPREAD_CAPTURE", "MARKOUT"}
        self.assertEqual({t.value for t in ExecutionTarget}, expected)

    def test_all_targets_has_no_duplicate_values_across_categories(self):
        values = [t.value for t in ALL_TARGETS]
        self.assertEqual(len(values), len(set(values)))

    def test_target_definition_version_is_a_stable_non_empty_string(self):
        version = target_definition_version()
        self.assertIsInstance(version, str)
        self.assertGreater(len(version), 0)
        self.assertEqual(version, target_definition_version())


if __name__ == "__main__":
    unittest.main()
