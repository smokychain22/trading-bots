"""Tests for bots/theta/quant/research/chain_resolution.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.chain_resolution import (  # noqa: E402
    ChainResolutionInputs,
    ChainResolutionStatus,
    classify_chain_resolution,
)


def _inputs(**overrides):
    defaults = dict(
        has_unresolved_open_positions=False, whole_chain_pnl_known=True, valuation_issues=[],
        data_integrity_valid=True, data_integrity_issues=[],
        external_activity_detected=False, external_activity_detail=None,
    )
    defaults.update(overrides)
    return ChainResolutionInputs(**defaults)


class ResolutionTests(unittest.TestCase):
    def test_a_fully_closed_chain_with_known_valuation_is_resolved(self):
        result = classify_chain_resolution(_inputs())
        self.assertEqual(result.status, ChainResolutionStatus.RESOLVED)

    def test_an_open_chain_is_censored_never_a_terminal_outcome(self):
        result = classify_chain_resolution(_inputs(has_unresolved_open_positions=True, whole_chain_pnl_known=False))
        self.assertEqual(result.status, ChainResolutionStatus.CENSORED_OPEN)

    def test_a_closed_chain_with_an_unknown_valuation_component_is_still_censored(self):
        # Every leg/lot closed, but e.g. a dividend-lot reference was
        # unresolvable -- the chain cannot be scored even though nothing
        # is technically still "open."
        result = classify_chain_resolution(_inputs(
            has_unresolved_open_positions=False, whole_chain_pnl_known=False,
            valuation_issues=["DIVIDEND_LOT_UNAVAILABLE"],
        ))
        self.assertEqual(result.status, ChainResolutionStatus.CENSORED_OPEN)
        self.assertTrue(any("DIVIDEND_LOT_UNAVAILABLE" in r.code for r in result.reasons))

    def test_invalid_data_takes_precedence_over_everything_else(self):
        result = classify_chain_resolution(_inputs(
            data_integrity_valid=False, data_integrity_issues=["NEGATIVE_SHARE_COUNT"],
            external_activity_detected=True,  # even with contamination ALSO present
            has_unresolved_open_positions=True,
        ))
        self.assertEqual(result.status, ChainResolutionStatus.INVALID_DATA)

    def test_external_activity_contamination_takes_precedence_over_open_vs_resolved(self):
        result = classify_chain_resolution(_inputs(
            external_activity_detected=True, external_activity_detail="Manual order detected outside THETA policy.",
            has_unresolved_open_positions=False, whole_chain_pnl_known=True,
        ))
        self.assertEqual(result.status, ChainResolutionStatus.EXTERNAL_ACTIVITY_CONTAMINATED)

    def test_a_resolved_chain_never_carries_a_censored_or_contamination_reason(self):
        result = classify_chain_resolution(_inputs())
        codes = [r.code for r in result.reasons]
        self.assertNotIn("CHAIN_STILL_OPEN", codes)
        self.assertNotIn("EXTERNAL_ACTIVITY_DETECTED", codes)

    def test_invalid_data_with_no_specific_issue_still_reports_a_named_reason_never_a_silent_status(self):
        result = classify_chain_resolution(_inputs(data_integrity_valid=False, data_integrity_issues=[]))
        self.assertEqual(result.status, ChainResolutionStatus.INVALID_DATA)
        self.assertTrue(len(result.reasons) > 0)


if __name__ == "__main__":
    unittest.main()
