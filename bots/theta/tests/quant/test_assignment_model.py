"""Tests for bots/theta/quant/models/assignment_model.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.assignment_model import (  # noqa: E402
    AssignmentCandidateInputs,
    AssignmentPolicy,
    evaluate_assignment,
)


def _policy(**overrides) -> AssignmentPolicy:
    defaults = dict(policy_version="TEST-ASSIGN-1", ownership_acceptability_floor=0.5, tail_risk_penalty_weight=1.0)
    defaults.update(overrides)
    return AssignmentPolicy(**defaults)


def _candidate(**overrides) -> AssignmentCandidateInputs:
    defaults = dict(
        strike=50.0, multiplier=100.0, entry_premium_per_share=0.60,
        ownership_acceptability=0.8, p_severe_drawdown=0.05,
        mechanical_close_debit_per_share=0.90, capital_committed=5000.0,
    )
    defaults.update(overrides)
    return AssignmentCandidateInputs(**defaults)


class AssignmentRecommendationTests(unittest.TestCase):
    def test_ownership_acceptable_recommends_accept_assignment(self):
        result = evaluate_assignment(_policy(), _candidate())
        self.assertEqual(result.recommendation, "ACCEPT_ASSIGNMENT")
        self.assertTrue(result.ownership_acceptable)

    def test_ownership_unacceptable_recommends_close_stock(self):
        result = evaluate_assignment(_policy(), _candidate(ownership_acceptability=0.1))
        self.assertEqual(result.recommendation, "CLOSE_STOCK")
        self.assertFalse(result.ownership_acceptable)

    def test_unknown_ownership_never_defaults_to_a_recommendation(self):
        result = evaluate_assignment(_policy(), _candidate(ownership_acceptability=None))
        self.assertEqual(result.recommendation, "UNKNOWN")
        self.assertIsNone(result.ownership_acceptable)

    def test_unknown_tail_risk_blocks_accept_recommendation(self):
        result = evaluate_assignment(_policy(), _candidate(p_severe_drawdown=None))
        self.assertEqual(result.recommendation, "UNKNOWN")

    def test_unacceptable_ownership_with_unknown_close_quote_is_unknown_not_close(self):
        result = evaluate_assignment(_policy(), _candidate(ownership_acceptability=0.1, mechanical_close_debit_per_share=None))
        self.assertEqual(result.recommendation, "UNKNOWN")

    def test_economic_basis_matches_assignment_economic_basis_formula(self):
        result = evaluate_assignment(_policy(), _candidate(strike=50.0, entry_premium_per_share=0.60))
        self.assertAlmostEqual(result.economics.economic_basis_per_share, 49.40, places=6)


if __name__ == "__main__":
    unittest.main()
