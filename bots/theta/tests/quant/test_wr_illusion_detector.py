"""Tests for bots/theta/quant/research/wr_illusion_detector.py. Synthetic fixtures only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.wr_illusion_detector import (  # noqa: E402
    IllusionPattern,
    WrIllusionInputs,
    any_illusion_confirmed,
    check_closed_only_sample_excludes_losers,
    check_event_period_cherry_picking,
    check_many_small_wins_few_unresolved_losses,
    check_open_inventory_excluded_from_denominator,
    check_roll_loss_erasure,
    run_all_illusion_checks,
)


def _inputs(**overrides):
    defaults = dict(
        closed_trade_win_rate=None, whole_chain_win_rate=None, open_chain_count=None, total_chain_count=None,
        avg_win_amount=None, avg_loss_amount=None, unresolved_large_loss_count=None,
        reported_pnl_includes_roll_history=None, sample_window_excludes_known_stress_period=None,
    )
    defaults.update(overrides)
    return WrIllusionInputs(**defaults)


class ManySmallWinsCheckTests(unittest.TestCase):
    def test_unknown_inputs_report_none_never_false(self):
        finding = check_many_small_wins_few_unresolved_losses(_inputs(), large_loss_count_floor=2)
        self.assertIsNone(finding.detected)

    def test_detects_the_classic_pattern(self):
        finding = check_many_small_wins_few_unresolved_losses(
            _inputs(unresolved_large_loss_count=3, avg_win_amount=50.0, avg_loss_amount=500.0),
            large_loss_count_floor=2,
        )
        self.assertTrue(finding.detected)

    def test_below_the_floor_does_not_trigger(self):
        finding = check_many_small_wins_few_unresolved_losses(
            _inputs(unresolved_large_loss_count=1, avg_win_amount=50.0, avg_loss_amount=500.0),
            large_loss_count_floor=2,
        )
        self.assertFalse(finding.detected)


class ClosedOnlySampleCheckTests(unittest.TestCase):
    def test_unknown_inputs_report_none(self):
        finding = check_closed_only_sample_excludes_losers(_inputs(), divergence_threshold=0.1)
        self.assertIsNone(finding.detected)

    def test_large_divergence_is_detected(self):
        finding = check_closed_only_sample_excludes_losers(
            _inputs(closed_trade_win_rate=0.85, whole_chain_win_rate=0.55), divergence_threshold=0.1,
        )
        self.assertTrue(finding.detected)

    def test_small_divergence_is_not_detected(self):
        finding = check_closed_only_sample_excludes_losers(
            _inputs(closed_trade_win_rate=0.70, whole_chain_win_rate=0.68), divergence_threshold=0.1,
        )
        self.assertFalse(finding.detected)


class OpenInventoryExcludedCheckTests(unittest.TestCase):
    def test_open_chains_with_zero_total_sample_is_detected(self):
        finding = check_open_inventory_excluded_from_denominator(_inputs(open_chain_count=5, total_chain_count=0))
        self.assertTrue(finding.detected)

    def test_open_chains_properly_included_is_not_detected(self):
        finding = check_open_inventory_excluded_from_denominator(_inputs(open_chain_count=5, total_chain_count=50))
        self.assertFalse(finding.detected)


class RollLossErasureCheckTests(unittest.TestCase):
    def test_reporting_path_that_excludes_roll_history_is_detected(self):
        finding = check_roll_loss_erasure(_inputs(reported_pnl_includes_roll_history=False))
        self.assertTrue(finding.detected)

    def test_reporting_path_that_includes_roll_history_is_not_detected(self):
        finding = check_roll_loss_erasure(_inputs(reported_pnl_includes_roll_history=True))
        self.assertFalse(finding.detected)


class EventPeriodCherryPickingCheckTests(unittest.TestCase):
    def test_passes_through_the_callers_own_determination(self):
        self.assertTrue(check_event_period_cherry_picking(_inputs(sample_window_excludes_known_stress_period=True)).detected)
        self.assertFalse(check_event_period_cherry_picking(_inputs(sample_window_excludes_known_stress_period=False)).detected)


class RunAllChecksTests(unittest.TestCase):
    def test_runs_exactly_five_checks(self):
        findings = run_all_illusion_checks(_inputs(), large_loss_count_floor=2, divergence_threshold=0.1)
        self.assertEqual(len(findings), 5)
        self.assertEqual({f.pattern for f in findings}, set(IllusionPattern))

    def test_any_confirmed_is_none_when_all_unresolved(self):
        findings = run_all_illusion_checks(_inputs(), large_loss_count_floor=2, divergence_threshold=0.1)
        self.assertIsNone(any_illusion_confirmed(findings))

    def test_any_confirmed_is_true_when_one_check_detects(self):
        findings = run_all_illusion_checks(
            _inputs(reported_pnl_includes_roll_history=False), large_loss_count_floor=2, divergence_threshold=0.1,
        )
        self.assertTrue(any_illusion_confirmed(findings))

    def test_any_confirmed_is_false_when_all_resolved_and_clean(self):
        findings = run_all_illusion_checks(
            _inputs(
                closed_trade_win_rate=0.70, whole_chain_win_rate=0.69, open_chain_count=5, total_chain_count=50,
                avg_win_amount=100.0, avg_loss_amount=150.0, unresolved_large_loss_count=0,
                reported_pnl_includes_roll_history=True, sample_window_excludes_known_stress_period=False,
            ),
            large_loss_count_floor=2, divergence_threshold=0.1,
        )
        self.assertFalse(any_illusion_confirmed(findings))


if __name__ == "__main__":
    unittest.main()
