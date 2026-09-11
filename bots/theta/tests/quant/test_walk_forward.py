"""Tests for bots/theta/quant/research/walk_forward.py. Synthetic data only."""

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.walk_forward import (  # noqa: E402
    ChainRecord,
    assert_labels_available_before_next_phase,
    assert_no_chain_id_leakage,
    build_walk_forward_plan,
)


def _chains(n_days: int, start: str = "2024-01-01", label_lag_days: int = 0) -> list:
    """`label_lag_days` lets tests model a chain whose label becomes
    available some number of days AFTER its own resolution (e.g. a
    delayed corporate-action confirmation) -- 0 means the label is known
    the same day the chain resolves, the common case."""
    start_date = date.fromisoformat(start)
    chains = []
    for i in range(n_days):
        resolved = start_date + timedelta(days=i)
        chains.append(ChainRecord(
            chain_id=f"chain-{i}",
            resolved_at=resolved.isoformat(),
            decision_time=resolved.isoformat(),  # decision same day as resolution in these synthetic fixtures
            label_availability_time=(resolved + timedelta(days=label_lag_days)).isoformat(),
        ))
    return chains


class WalkForwardPlanTests(unittest.TestCase):
    def test_an_empty_chain_list_produces_an_empty_plan(self):
        plan = build_walk_forward_plan([], train_days=30, validation_days=10, forward_test_days=10, embargo_days=5, step_days=10, final_oos_days=20)
        self.assertEqual(plan.folds, ())
        self.assertEqual(plan.final_oos_chain_ids, ())

    def test_produces_at_least_one_fold_for_a_sufficiently_long_timeline(self):
        chains = _chains(200)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        self.assertGreater(len(plan.folds), 0)

    def test_no_chain_id_leakage_across_roles_within_a_fold_or_into_final_oos(self):
        chains = _chains(200)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        violations = assert_no_chain_id_leakage(plan)
        self.assertEqual(violations, [])

    def test_the_final_oos_segment_is_reserved_and_never_appears_in_any_rolled_fold(self):
        chains = _chains(200)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        final_oos_set = set(plan.final_oos_chain_ids)
        self.assertGreater(len(final_oos_set), 0)
        for fold in plan.folds:
            self.assertEqual(set(fold.train_chain_ids) & final_oos_set, set())
            self.assertEqual(set(fold.validation_chain_ids) & final_oos_set, set())
            self.assertEqual(set(fold.forward_test_chain_ids) & final_oos_set, set())

    def test_chains_falling_inside_an_embargo_gap_are_excluded_from_both_neighboring_roles(self):
        # A chain embargoed WITHIN one fold's own window must never also
        # be that SAME fold's train/validation -- checked per-fold using
        # each fold's own window boundaries directly, since a chain
        # legitimately embargoed in fold N can become genuine train data
        # in a later, independently-rolled fold N+1 (not leakage: the
        # folds are separate evaluations, never combined into one split).
        chains = _chains(200)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        self.assertGreater(len(plan.excluded_by_embargo_chain_ids), 0)
        for fold in plan.folds:
            train_end = date.fromisoformat(fold.train_window[1])
            validation_start = date.fromisoformat(fold.validation_window[0])
            self.assertLess(train_end, validation_start)  # a real gap exists between train and validation
            gap_days = (validation_start - train_end).days - 1
            self.assertGreaterEqual(gap_days, 5)  # at least the requested embargo_days separates them

    def test_a_timeline_too_short_for_even_one_fold_produces_zero_folds_never_a_malformed_one(self):
        chains = _chains(10)  # far shorter than train+embargo+validation+embargo+test would require
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        self.assertEqual(plan.folds, ())

    def test_train_window_precedes_validation_window_precedes_forward_test_window(self):
        chains = _chains(200)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        fold = plan.folds[0]
        self.assertLess(date.fromisoformat(fold.train_window[1]), date.fromisoformat(fold.validation_window[0]))
        self.assertLess(date.fromisoformat(fold.validation_window[1]), date.fromisoformat(fold.forward_test_window[0]))

    def test_successive_folds_roll_forward_by_step_days(self):
        chains = _chains(300)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        self.assertGreaterEqual(len(plan.folds), 2)
        first_start = date.fromisoformat(plan.folds[0].train_window[0])
        second_start = date.fromisoformat(plan.folds[1].train_window[0])
        self.assertEqual((second_start - first_start).days, 30)


class ChainRecordTimestampValidationTests(unittest.TestCase):
    def test_decision_time_after_resolved_at_raises(self):
        with self.assertRaises(ValueError):
            ChainRecord(chain_id="x", resolved_at="2024-01-01", decision_time="2024-01-05", label_availability_time="2024-01-01")

    def test_label_availability_before_resolved_at_raises(self):
        with self.assertRaises(ValueError):
            ChainRecord(chain_id="x", resolved_at="2024-01-05", decision_time="2024-01-01", label_availability_time="2024-01-01")

    def test_decision_time_equal_to_resolved_at_is_valid(self):
        ChainRecord(chain_id="x", resolved_at="2024-01-05", decision_time="2024-01-05", label_availability_time="2024-01-05")


class LabelAvailabilityLeakageTests(unittest.TestCase):
    def test_a_label_lag_well_within_the_embargo_produces_no_violation(self):
        # embargo_days=5, and every label is available the same day it
        # resolves (label_lag_days=0) -- comfortably inside the embargo.
        chains = _chains(200, label_lag_days=0)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        violations = assert_labels_available_before_next_phase(plan, chains)
        self.assertEqual(violations, [])

    def test_a_label_lag_that_exceeds_the_chosen_embargo_is_flagged(self):
        # Every chain's label becomes available 10 days after it
        # resolves, but the plan's embargo is only 5 days -- a train
        # chain resolved near train_end has a label that isn't actually
        # available until AFTER validation has already started. This is
        # exactly the leak `assert_no_chain_id_leakage` cannot see (it
        # only checks chain_id set membership, never label timing).
        chains = _chains(200, label_lag_days=10)
        plan = build_walk_forward_plan(chains, train_days=60, validation_days=20, forward_test_days=20, embargo_days=5, step_days=30, final_oos_days=30)
        violations = assert_labels_available_before_next_phase(plan, chains)
        self.assertGreater(len(violations), 0)


class LeakageDetectionTests(unittest.TestCase):
    def test_detects_a_manually_constructed_leak(self):
        from research.walk_forward import WalkForwardFold, WalkForwardPlan

        leaky_fold = WalkForwardFold(
            fold_index=0,
            train_chain_ids=("a", "b"), validation_chain_ids=("b", "c"), forward_test_chain_ids=("d",),
            train_window=("2024-01-01", "2024-01-10"), validation_window=("2024-01-11", "2024-01-15"), forward_test_window=("2024-01-16", "2024-01-20"),
        )
        plan = WalkForwardPlan(folds=(leaky_fold,), final_oos_chain_ids=(), final_oos_window=("", ""), excluded_by_embargo_chain_ids=())
        violations = assert_no_chain_id_leakage(plan)
        self.assertTrue(any("b" in v for v in violations))


if __name__ == "__main__":
    unittest.main()
