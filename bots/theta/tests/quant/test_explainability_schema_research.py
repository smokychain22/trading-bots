"""Tests for research/explainability_schema_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.explainability_schema_research import (  # noqa: E402
    ActionInactionRiskSummary,
    AlternativeAction,
    ExplanationEvidence,
    MissingDataItem,
    MissingDataSeverity,
    render_explanation_text,
)


def _risk(**overrides):
    defaults = dict(action_tail_risk=None, action_execution_cost=None, inaction_cost_kind=None, inaction_cost_estimate=None)
    defaults.update(overrides)
    return ActionInactionRiskSummary(**defaults)


class RenderExplanationTextTests(unittest.TestCase):
    def test_minimal_evidence_renders_all_none_placeholders(self):
        evidence = ExplanationEvidence(
            selected_action="WAIT", alternatives=[], win_reason_codes=[], missing_data=[],
            time_state=None, position_path_summary=None, provider_facts=[], risk=_risk(),
        )
        result = render_explanation_text(evidence)
        self.assertIn("DECISION: WAIT", result.text)
        self.assertIn("No other actions were feasible", result.text)
        self.assertIn("No missing data.", result.text)
        self.assertIn("Time state: UNKNOWN.", result.text)
        self.assertIn("No open-position path history", result.text)
        self.assertIn("No provider facts attached", result.text)

    def test_feasible_alternatives_are_listed_with_reasons(self):
        evidence = ExplanationEvidence(
            selected_action="HOLD",
            alternatives=[AlternativeAction("CLOSE", True, "remaining reward still favorable"),
                          AlternativeAction("ROLL", False, None)],
            win_reason_codes=["HOLD_JUSTIFIED_CONTINUATION_VALUE"], missing_data=[],
            time_state=None, position_path_summary=None, provider_facts=[], risk=_risk(),
        )
        result = render_explanation_text(evidence)
        self.assertIn("CLOSE: feasible, not selected because remaining reward still favorable", result.text)
        self.assertIn("ROLL: not feasible", result.text)

    def test_required_and_optional_missing_data_reported_separately(self):
        evidence = ExplanationEvidence(
            selected_action="WAIT", alternatives=[], win_reason_codes=[],
            missing_data=[
                MissingDataItem("exact_contract_id", MissingDataSeverity.REQUIRED_UNKNOWN, "no OCC symbol resolved"),
                MissingDataItem("flow_state", MissingDataSeverity.OPTIONAL_UNKNOWN, "no spot-scan run this cycle"),
            ],
            time_state=None, position_path_summary=None, provider_facts=[], risk=_risk(),
        )
        result = render_explanation_text(evidence)
        self.assertIn("REQUIRED DATA MISSING", result.text)
        self.assertIn("exact_contract_id (no OCC symbol resolved)", result.text)
        self.assertIn("OPTIONAL DATA MISSING", result.text)
        self.assertIn("flow_state (no spot-scan run this cycle)", result.text)

    def test_risk_of_acting_and_not_acting_both_rendered(self):
        evidence = ExplanationEvidence(
            selected_action="CLOSE", alternatives=[], win_reason_codes=[], missing_data=[],
            time_state="REGULAR_SESSION", position_path_summary="PEAK +340, now +120, giveback 220",
            provider_facts=["Optionomics GEX: PROVIDER_REPORTED_UNVERIFIED, -1.2B"],
            risk=_risk(action_tail_risk=50.0, action_execution_cost=5.0,
                       inaction_cost_kind="PROFIT_GIVEBACK_EXPOSURE", inaction_cost_estimate=220.0),
        )
        result = render_explanation_text(evidence)
        self.assertIn("RISK OF ACTING: tail_risk=50.0, execution_cost=5.0", result.text)
        self.assertIn("RISK OF NOT ACTING: PROFIT_GIVEBACK_EXPOSURE=220.0", result.text)
        self.assertIn("TIME STATE: REGULAR_SESSION", result.text)
        self.assertIn("POSITION PATH: PEAK +340, now +120, giveback 220", result.text)
        self.assertIn("PROVIDER FACTS: Optionomics GEX: PROVIDER_REPORTED_UNVERIFIED, -1.2B", result.text)

    def test_unknown_risk_fields_render_as_unknown_not_zero(self):
        evidence = ExplanationEvidence(
            selected_action="OPEN", alternatives=[], win_reason_codes=[], missing_data=[],
            time_state=None, position_path_summary=None, provider_facts=[], risk=_risk(),
        )
        result = render_explanation_text(evidence)
        self.assertIn("tail_risk=UNKNOWN", result.text)
        self.assertIn("execution_cost=UNKNOWN", result.text)
        self.assertIn("RISK OF NOT ACTING: UNKNOWN=UNKNOWN", result.text)

    def test_rendering_is_deterministic_for_identical_evidence(self):
        evidence = ExplanationEvidence(
            selected_action="ROLL", alternatives=[AlternativeAction("CLOSE", True, "smaller remaining reward")],
            win_reason_codes=["ROLL_PRESERVES_THETA"], missing_data=[], time_state="LATE_SESSION",
            position_path_summary=None, provider_facts=[], risk=_risk(),
        )
        first = render_explanation_text(evidence)
        second = render_explanation_text(evidence)
        self.assertEqual(first.text, second.text)


if __name__ == "__main__":
    unittest.main()
