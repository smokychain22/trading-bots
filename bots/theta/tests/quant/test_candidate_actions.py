"""Tests for bots/theta/quant/research/candidate_actions.py.

Run with (from the repo root, once a Python toolchain is set up):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.candidate_actions import (  # noqa: E402
    RUNTIME_ENTRY_ACTION_EQUIVALENT,
    RUNTIME_MANAGEMENT_ACTION_EQUIVALENT,
    CandidateAction,
)
from research.registry import CANDIDATE_ACTIONS  # noqa: E402


class CandidateActionEnumTests(unittest.TestCase):
    def test_exactly_the_twelve_specified_actions(self):
        # CALL_AWAY was added alongside the Phase 2C management/AEGIS models:
        # the runtime schema docstring at the top of this module already
        # named it as a management_action value, but the enum itself had
        # omitted it -- a real gap, not a redefinition of the frozen schema.
        expected = {
            "WAIT",
            "OPEN_CSP",
            "HOLD",
            "CLOSE",
            "ROLL",
            "ASSIGN",
            "EXPIRE",
            "RECOVERY_WAIT",
            "SELL_CC",
            "CLOSE_STOCK",
            "CALL_AWAY",
            "REDEPLOY",
        }
        actual = {a.value for a in CandidateAction}
        self.assertEqual(actual, expected)

    def test_matches_the_set_the_research_registry_validates_against(self):
        # Guards against the enum and the registry's validation set (which
        # is intentionally duplicated for decoupling, see registry.py's
        # module docstring) drifting apart silently.
        actual = {a.value for a in CandidateAction}
        self.assertEqual(actual, CANDIDATE_ACTIONS)


class RuntimeEquivalenceMappingTests(unittest.TestCase):
    def test_assign_maps_to_accept_assignment_not_a_new_enum_value(self):
        self.assertEqual(
            RUNTIME_MANAGEMENT_ACTION_EQUIVALENT[CandidateAction.ASSIGN],
            "ACCEPT_ASSIGNMENT",
        )

    def test_wait_and_open_csp_map_to_entry_action_not_management_action(self):
        self.assertNotIn(CandidateAction.WAIT, RUNTIME_MANAGEMENT_ACTION_EQUIVALENT)
        self.assertNotIn(CandidateAction.OPEN_CSP, RUNTIME_MANAGEMENT_ACTION_EQUIVALENT)
        self.assertEqual(RUNTIME_ENTRY_ACTION_EQUIVALENT[CandidateAction.WAIT], "WAIT")
        self.assertEqual(RUNTIME_ENTRY_ACTION_EQUIVALENT[CandidateAction.OPEN_CSP], "TRADE")

    def test_call_away_maps_to_itself_as_a_management_action(self):
        self.assertEqual(
            RUNTIME_MANAGEMENT_ACTION_EQUIVALENT[CandidateAction.CALL_AWAY],
            "CALL_AWAY",
        )

    def test_recovery_wait_has_no_management_action_equivalent(self):
        # RECOVERY_WAIT is a lifecycle_state in the frozen schema, not an
        # action code -- it must not be silently mapped to one.
        self.assertNotIn(CandidateAction.RECOVERY_WAIT, RUNTIME_MANAGEMENT_ACTION_EQUIVALENT)
        self.assertNotIn(CandidateAction.RECOVERY_WAIT, RUNTIME_ENTRY_ACTION_EQUIVALENT)


if __name__ == "__main__":
    unittest.main()
