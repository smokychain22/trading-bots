"""Tests for bots/theta/quant/models/recovery_decision.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.recovery_decision import (  # noqa: E402
    RecoveryCandidateInputs,
    RecoveryPolicy,
    evaluate_recovery,
)


def _policy(**overrides) -> RecoveryPolicy:
    defaults = dict(policy_version="TEST-RECOVERY-1", max_wait_days=60)
    defaults.update(overrides)
    return RecoveryPolicy(**defaults)


def _candidate(**overrides) -> RecoveryCandidateInputs:
    defaults = dict(
        days_in_recovery=10, recovery_summary=None, thesis_invalidated=False,
        covered_call_available=False, best_cc_utility=None,
    )
    defaults.update(overrides)
    return RecoveryCandidateInputs(**defaults)


class RecoveryBoundTests(unittest.TestCase):
    def test_within_bound_continues_waiting_by_default(self):
        result = evaluate_recovery(_policy(max_wait_days=60), _candidate(days_in_recovery=10))
        self.assertEqual(result.action, "RECOVERY_WAIT")
        self.assertFalse(result.bound_exceeded)

    def test_bound_exceeded_forces_sell_stock(self):
        # H-A-02: unconditional, unbounded waiting is never acceptable --
        # this module has no code path that allows it.
        result = evaluate_recovery(_policy(max_wait_days=60), _candidate(days_in_recovery=60))
        self.assertEqual(result.action, "SELL_STOCK")
        self.assertTrue(result.bound_exceeded)

    def test_thesis_invalidation_forces_exit_even_within_bound(self):
        result = evaluate_recovery(_policy(max_wait_days=60), _candidate(days_in_recovery=1, thesis_invalidated=True))
        self.assertEqual(result.action, "SELL_STOCK")


class NoAutomaticCoveredCallTests(unittest.TestCase):
    def test_recovery_wait_continues_when_no_positive_cc_utility_available(self):
        # H-C-02: never automatic CC -- RECOVERY_WAIT beats a non-positive CC.
        result = evaluate_recovery(
            _policy(), _candidate(covered_call_available=True, best_cc_utility=-5.0)
        )
        self.assertEqual(result.action, "RECOVERY_WAIT")

    def test_sell_cc_selected_only_when_utility_is_genuinely_positive(self):
        result = evaluate_recovery(
            _policy(), _candidate(covered_call_available=True, best_cc_utility=25.0)
        )
        self.assertEqual(result.action, "SELL_CC")

    def test_covered_call_not_available_never_forces_a_cc_decision(self):
        result = evaluate_recovery(_policy(), _candidate(covered_call_available=False, best_cc_utility=25.0))
        self.assertEqual(result.action, "RECOVERY_WAIT")


if __name__ == "__main__":
    unittest.main()
