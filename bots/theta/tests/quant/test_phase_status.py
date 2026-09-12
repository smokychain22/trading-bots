"""Tests for bots/theta/quant/research/phase_status.py. Structural only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.phase_status import (  # noqa: E402
    PHASE_STATUS,
    PhaseState,
    blockers,
    get,
    items_in_state,
    validate_manifest,
)


class ManifestValidityTests(unittest.TestCase):
    def test_manifest_is_structurally_valid(self):
        self.assertEqual(validate_manifest(), [])

    def test_every_named_module_actually_exists_on_disk(self):
        research_dir = _QUANT_DIR / "research"
        for item in PHASE_STATUS.values():
            for module in item.modules:
                self.assertTrue((research_dir / module).exists(), f"{item.key} names missing module {module}")

    def test_every_blocked_item_names_an_exact_blocker(self):
        for item in items_in_state(PhaseState.BLOCKED_ON_DATA):
            self.assertIsNotNone(item.blocker)
            self.assertGreater(len(item.blocker), 20, f"{item.key} blocker is too vague")

    def test_no_item_is_left_partial_without_a_blocker(self):
        for item in items_in_state(PhaseState.PARTIAL):
            self.assertIsNotNone(item.blocker, f"{item.key} is PARTIAL with no blocker -- 'mostly done' is not allowed")


class PhaseContentTests(unittest.TestCase):
    def test_r6_research_engineering_items_are_complete(self):
        for key in ("R6_DATASET_CONTRACTS", "R6_EXPORT_LOADER", "R6_PIT_FIREWALL", "R6_TARGETS",
                     "R6_DEPENDENCE", "R6_READINESS_ENGINE", "R6_EXPERIMENT_DEFINITIONS",
                     "R6_PROMOTION_CONTRACT", "R6_AUTO_PIPELINE"):
            self.assertEqual(get(key).state, PhaseState.COMPLETE, f"{key} should be COMPLETE")

    def test_r6_empirical_items_are_blocked_on_data_not_complete(self):
        for key in ("R6_REAL_PIT_DATA", "R6_MODEL_FIT", "R6_WALK_FORWARD", "R6_OOS",
                     "R6_CALIBRATION_EMPIRICAL", "R6_GATE_REGRET", "R6_ACTION_REGRET"):
            self.assertEqual(get(key).state, PhaseState.BLOCKED_ON_DATA, f"{key} must not claim completion without data")

    def test_superseded_items_are_marked_so_a_future_session_never_rebuilds_them(self):
        superseded = {item.key for item in items_in_state(PhaseState.SUPERSEDED)}
        self.assertIn("RESEARCH_STRATEGY_REGISTRY", superseded)
        self.assertIn("RESEARCH_FEATURE_TAXONOMY", superseded)

    def test_blockers_are_discoverable_in_one_call(self):
        current = blockers()
        self.assertIn("R6_REAL_PIT_DATA", current)
        self.assertIn("zero", current["R6_REAL_PIT_DATA"].lower())


if __name__ == "__main__":
    unittest.main()
