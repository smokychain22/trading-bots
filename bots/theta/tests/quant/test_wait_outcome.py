"""Tests for bots/theta/quant/research/wait_outcome.py (work package 35)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.wait_outcome import T0WaitDecision, build_matured_wait_outcome  # noqa: E402


def _decision(**overrides) -> T0WaitDecision:
    base = dict(
        underlying_symbol="SPY", decision_timestamp="2026-09-24T17:34:59Z",
        wait_reason_code="NO_QUALIFYING_CANDIDATE", best_rejected_candidate_id="c1",
        best_rejected_candidate_utility=0.05,
    )
    base.update(overrides)
    return T0WaitDecision(**base)


class TestT0WaitDecision(unittest.TestCase):
    def test_t0_decision_has_no_future_fields_structurally(self):
        decision = _decision()
        field_names = decision.__dataclass_fields__.keys()
        for forbidden in ("future_outcome", "matured", "actual_return", "opportunity_cost"):
            self.assertNotIn(forbidden, field_names)


class TestBuildMaturedWaitOutcome(unittest.TestCase):
    def test_real_horizon_return_and_opportunity_cost(self):
        decision = _decision()
        outcome = build_matured_wait_outcome(decision, 500.0, 510.0, "2026-09-25T17:34:59Z")
        self.assertAlmostEqual(outcome.horizon_return, 0.02)
        self.assertAlmostEqual(outcome.opportunity_cost_vs_best_rejected, 0.05 - 0.02)
        self.assertEqual(outcome.truth_class, "REAL_HISTORICAL")

    def test_maturation_at_or_before_decision_time_is_rejected_hindsight_leakage(self):
        decision = _decision()
        with self.assertRaises(ValueError):
            build_matured_wait_outcome(decision, 500.0, 510.0, "2026-09-24T17:34:59Z")  # same moment
        with self.assertRaises(ValueError):
            build_matured_wait_outcome(decision, 500.0, 510.0, "2026-09-24T10:00:00Z")  # before

    def test_unknown_price_at_decision_yields_none_horizon_return_never_fabricated(self):
        decision = _decision()
        outcome = build_matured_wait_outcome(decision, None, 510.0, "2026-09-25T17:34:59Z")
        self.assertIsNone(outcome.horizon_return)
        self.assertIsNone(outcome.opportunity_cost_vs_best_rejected)

    def test_unknown_best_rejected_utility_yields_none_opportunity_cost(self):
        decision = _decision(best_rejected_candidate_utility=None)
        outcome = build_matured_wait_outcome(decision, 500.0, 510.0, "2026-09-25T17:34:59Z")
        self.assertIsNotNone(outcome.horizon_return)
        self.assertIsNone(outcome.opportunity_cost_vs_best_rejected)

    def test_zero_price_at_decision_never_divides_by_zero(self):
        decision = _decision()
        outcome = build_matured_wait_outcome(decision, 0.0, 510.0, "2026-09-25T17:34:59Z")
        self.assertIsNone(outcome.horizon_return)


if __name__ == "__main__":
    unittest.main()
