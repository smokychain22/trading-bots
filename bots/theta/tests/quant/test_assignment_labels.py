"""Tests for bots/theta/quant/research/assignment_labels.py (work package 40)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.assignment_labels import (  # noqa: E402
    AssignmentEvidenceInput, AssignmentLabel, AssignmentTruthSource, build_assignment_label,
)


def _evidence(**overrides) -> AssignmentEvidenceInput:
    base = dict(
        option_symbol="SPY261016P00650000", broker_assignment_event_observed=None,
        documented_stock_position_traces_to_contract=None, contract_has_matured=True,
    )
    base.update(overrides)
    return AssignmentEvidenceInput(**base)


class TestBuildAssignmentLabel(unittest.TestCase):
    def test_broker_actual_assignment_is_highest_priority(self):
        result = build_assignment_label(_evidence(broker_assignment_event_observed=True))
        self.assertEqual(result.label, AssignmentLabel.ASSIGNED)
        self.assertEqual(result.truth_source, AssignmentTruthSource.BROKER_ACTUAL)

    def test_broker_actual_not_assigned(self):
        result = build_assignment_label(_evidence(
            broker_assignment_event_observed=False, documented_stock_position_traces_to_contract=False))
        self.assertEqual(result.label, AssignmentLabel.NOT_ASSIGNED)
        self.assertEqual(result.truth_source, AssignmentTruthSource.BROKER_ACTUAL)

    def test_documented_lifecycle_evidence_when_no_direct_broker_event(self):
        result = build_assignment_label(_evidence(
            broker_assignment_event_observed=None, documented_stock_position_traces_to_contract=True))
        self.assertEqual(result.label, AssignmentLabel.ASSIGNED)
        self.assertEqual(result.truth_source, AssignmentTruthSource.DOCUMENTED_LIFECYCLE_EVIDENCE)

    def test_no_evidence_at_all_matured_contract_is_unknown_never_not_assigned_by_default(self):
        result = build_assignment_label(_evidence(contract_has_matured=True))
        self.assertEqual(result.label, AssignmentLabel.UNKNOWN)
        self.assertGreater(len(result.future_identifiable_fields), 0)

    def test_unmatured_contract_with_no_evidence_is_censored_not_unknown(self):
        result = build_assignment_label(_evidence(contract_has_matured=False))
        self.assertEqual(result.label, AssignmentLabel.CENSORED)

    def test_strike_crossing_alone_never_infers_assignment(self):
        # This module's own signature proves it: there is no "strike" or
        # "moneyness" field on AssignmentEvidenceInput at all -- assignment
        # cannot be inferred from it because it isn't even an input.
        field_names = AssignmentEvidenceInput.__dataclass_fields__.keys()
        self.assertNotIn("strike", field_names)
        self.assertNotIn("moneyness", field_names)
        self.assertNotIn("underlying_price_at_expiration", field_names)

    def test_future_identifiable_fields_named_when_unresolved(self):
        result = build_assignment_label(_evidence(contract_has_matured=False))
        self.assertIn("broker_assignment_event_observed", result.future_identifiable_fields)


if __name__ == "__main__":
    unittest.main()
