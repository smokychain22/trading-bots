"""Tests for bots/theta/quant/research/research_evidence_packet.py. Synthetic only."""

import dataclasses
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.research_evidence_packet import (  # noqa: E402
    LiveSmallEvidencePacket,
    ResearchEvidencePacket,
    research_eligible_for_live_small,
    research_ready_for_paper,
    unknown_live_small_packet,
    unknown_packet,
)


def _all_true_packet(**overrides):
    fields = {name: True for name in ResearchEvidencePacket.__dataclass_fields__}
    fields.update(overrides)
    return ResearchEvidencePacket(**fields)


def _all_true_live_small(**overrides):
    fields = {
        name: True for name in LiveSmallEvidencePacket.__dataclass_fields__ if name != "research_packet"
    }
    fields["research_packet"] = _all_true_packet()
    fields.update(overrides)
    return LiveSmallEvidencePacket(**fields)


class PacketShapeTests(unittest.TestCase):
    def test_research_packet_has_all_fourteen_required_dimensions(self):
        self.assertEqual(len(dataclasses.fields(ResearchEvidencePacket)), 14)

    def test_unknown_packet_has_every_dimension_unknown(self):
        packet = unknown_packet()
        self.assertTrue(all(value is None for value in packet.dimensions().values()))


class PaperGateTests(unittest.TestCase):
    def test_all_true_is_ready(self):
        result = research_ready_for_paper(_all_true_packet())
        self.assertTrue(result.ready)

    def test_current_unknown_state_is_never_ready(self):
        result = research_ready_for_paper(unknown_packet())
        self.assertFalse(result.ready)
        self.assertEqual(len(result.unknown_dimensions), 14)

    def test_a_single_false_dimension_blocks_readiness(self):
        result = research_ready_for_paper(_all_true_packet(tail_acceptable=False))
        self.assertFalse(result.ready)
        self.assertIn("tail_acceptable", result.unsatisfied_dimensions)

    def test_a_single_unknown_dimension_blocks_readiness_there_is_no_majority_vote(self):
        result = research_ready_for_paper(_all_true_packet(calibration_acceptable=None))
        self.assertFalse(result.ready)
        self.assertIn("calibration_acceptable", result.unknown_dimensions)

    def test_thirteen_of_fourteen_passing_is_still_not_ready(self):
        result = research_ready_for_paper(_all_true_packet(promotion_checker_pass=False))
        self.assertFalse(result.ready)

    def test_ready_result_states_that_activation_remains_codex_authority(self):
        result = research_ready_for_paper(_all_true_packet())
        self.assertTrue(any("Codex" in reason for reason in result.reasons))


class LiveSmallGateTests(unittest.TestCase):
    def test_all_true_is_eligible(self):
        result = research_eligible_for_live_small(_all_true_live_small())
        self.assertTrue(result.ready)

    def test_current_unknown_state_is_never_eligible(self):
        result = research_eligible_for_live_small(unknown_live_small_packet())
        self.assertFalse(result.ready)

    def test_a_failing_research_dimension_blocks_live_small_even_if_paper_evidence_is_perfect(self):
        packet = _all_true_live_small(research_packet=_all_true_packet(positive_oos_ev=False))
        result = research_eligible_for_live_small(packet)
        self.assertFalse(result.ready)
        self.assertIn("positive_oos_ev", result.unsatisfied_dimensions)

    def test_an_unresolved_reconciliation_defect_blocks_live_small(self):
        result = research_eligible_for_live_small(_all_true_live_small(no_unresolved_reconciliation_defects=False))
        self.assertFalse(result.ready)
        self.assertIn("no_unresolved_reconciliation_defects", result.unsatisfied_dimensions)

    def test_live_small_requires_strictly_more_than_the_paper_gate(self):
        # A packet whose research half fully passes is still not live-small
        # eligible while the Paper-era dimensions remain unknown.
        paper_only = LiveSmallEvidencePacket(
            research_packet=_all_true_packet(), historical_pit_evidence_acceptable=None,
            walk_forward_acceptable=None, untouched_oos_acceptable=None, paper_evidence_acceptable=None,
            paper_execution_acceptable=None, strategy_stability_acceptable=None,
            operational_reliability_acceptable=None, no_unresolved_reconciliation_defects=None,
            no_unresolved_lifecycle_defects=None,
        )
        self.assertTrue(research_ready_for_paper(paper_only.research_packet).ready)
        self.assertFalse(research_eligible_for_live_small(paper_only).ready)


if __name__ == "__main__":
    unittest.main()
