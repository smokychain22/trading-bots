"""Tests for bots/theta/quant/research/severe_drawdown_cohort_quantile_baseline.py."""

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.severe_drawdown_cohort_quantile_baseline import (  # noqa: E402
    MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE,
    CohortQuantileInputRow,
    evaluate_cohort_quantile_baseline,
    summarize_cohort_quantile_coverage,
)

HORIZON_DAYS = 5


def _row(day_offset: int, cohort: str, mae, matured=True) -> CohortQuantileInputRow:
    decision_date = date(2026, 1, 1) + timedelta(days=day_offset)
    label_available_at = None
    if matured and mae is not None:
        label_available_at = decision_date + timedelta(days=HORIZON_DAYS)
    return CohortQuantileInputRow(
        episode_id=f"e{day_offset}", cohort_key=cohort,
        decision_date=decision_date, label_available_at=label_available_at, forward_mae=mae,
    )


class SevereDrawdownCohortQuantileBaselineTest(unittest.TestCase):
    def test_rows_before_the_minimum_prior_history_threshold_are_insufficient(self):
        rows = [_row(i * (HORIZON_DAYS + 1), "EARNINGS", -0.01 * i) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE - 1)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        self.assertTrue(all(e.status == "INSUFFICIENT_PRIOR_HISTORY" for e in evaluations))

    def test_a_row_is_evaluated_once_enough_matured_prior_same_cohort_rows_exist(self):
        rows = [_row(i * (HORIZON_DAYS + 1), "EARNINGS", -0.01 * (i + 1)) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 5)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        evaluated = [e for e in evaluations if e.status == "EVALUATED"]
        self.assertTrue(len(evaluated) > 0)
        for e in evaluated:
            self.assertIsNotNone(e.predicted_p10)
            self.assertIsNotNone(e.predicted_p50)

    def test_never_uses_same_day_rows_to_predict_each_others_quantile(self):
        # All rows share the SAME decision_date -- none has a strictly-earlier decision, so none is eligible history for another.
        rows = [_row(0, "EARNINGS", -0.5) for _ in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 5)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        self.assertTrue(all(e.status == "INSUFFICIENT_PRIOR_HISTORY" for e in evaluations))

    def test_REPAIR_a_row_whose_own_decision_predates_another_but_whose_outcome_has_not_yet_matured_is_never_folded_into_history(self):
        # Codex A-D item B repair: "decision-date ordering is not enough when prior labels have not matured."
        # early_but_unmatured's decision predates the target's decision by a wide margin, but its
        # very long horizon means its label only matures AFTER the target's own decision date.
        early_but_unmatured = CohortQuantileInputRow(
            episode_id="early", cohort_key="EARNINGS", decision_date=date(2026, 1, 1),
            label_available_at=date(2027, 1, 1), forward_mae=-0.5,
        )
        # 20 other rows, all decided and matured comfortably before the target's decision (day 500+).
        matured_history = [_row(2 + i, "EARNINGS", -0.01 * (i + 1)) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE)]
        # Evaluated row: decided long after early_but_unmatured's decision_date, but still BEFORE its label_available_at.
        evaluated_row = CohortQuantileInputRow(
            episode_id="target", cohort_key="EARNINGS", decision_date=date(2026, 6, 1),
            label_available_at=date(2026, 6, 6), forward_mae=-0.02,
        )
        evaluations = evaluate_cohort_quantile_baseline([early_but_unmatured, *matured_history, evaluated_row])
        target_eval = [e for e in evaluations if e.episode_id == "target"][0]
        # prior_n must count only the MATURED history rows -- early_but_unmatured's -0.5 must never be folded in,
        # even though its decision_date (2026-01-01) is far earlier than the target's (2026-06-01).
        self.assertEqual(target_eval.prior_n, MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE)

    def test_a_row_whose_own_outcome_never_matured_is_always_insufficient_regardless_of_available_history(self):
        history = [_row(i * (HORIZON_DAYS + 1), "EARNINGS", -0.01 * (i + 1)) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE)]
        censored_row = CohortQuantileInputRow(
            episode_id="censored", cohort_key="EARNINGS",
            decision_date=date(2026, 1, 1) + timedelta(days=(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 5) * (HORIZON_DAYS + 1)),
            label_available_at=None, forward_mae=-0.9,  # partial/censored observed value, but never matured
        )
        evaluations = evaluate_cohort_quantile_baseline([*history, censored_row])
        censored_eval = [e for e in evaluations if e.episode_id == "censored"][0]
        self.assertEqual(censored_eval.status, "INSUFFICIENT_PRIOR_HISTORY")
        self.assertIsNone(censored_eval.actual_forward_mae)

    def test_a_censored_or_excluded_row_with_none_mae_is_never_folded_into_cohort_history(self):
        rows = [_row(i * (HORIZON_DAYS + 1), "EARNINGS", None) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 5)]
        rows.append(_row((MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 6) * (HORIZON_DAYS + 1), "EARNINGS", -0.03))
        evaluations = evaluate_cohort_quantile_baseline(rows)
        last = evaluations[-1]
        self.assertEqual(last.status, "INSUFFICIENT_PRIOR_HISTORY")
        self.assertEqual(last.prior_n, 0)

    def test_different_cohorts_never_share_history(self):
        rows = [_row(i * (HORIZON_DAYS + 1), "EARNINGS", -0.01) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 2)]
        rows.append(_row((MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 3) * (HORIZON_DAYS + 1), "MACRO", -0.02))
        evaluations = evaluate_cohort_quantile_baseline(rows)
        macro_eval = [e for e in evaluations if e.cohort_key == "MACRO"][0]
        self.assertEqual(macro_eval.status, "INSUFFICIENT_PRIOR_HISTORY")
        self.assertEqual(macro_eval.prior_n, 0)

    def test_summarize_cohort_quantile_coverage_reports_empirical_hit_rates(self):
        rows = [_row(i * (HORIZON_DAYS + 1), "EARNINGS", -0.01 * (i + 1)) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 10)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        summary = summarize_cohort_quantile_coverage(evaluations)
        self.assertEqual(summary.total_rows, len(rows))
        self.assertGreater(summary.evaluated_rows, 0)
        self.assertIsNotNone(summary.p50_empirical_coverage)
        self.assertGreaterEqual(summary.p50_empirical_coverage, 0.0)
        self.assertLessEqual(summary.p50_empirical_coverage, 1.0)

    def test_summarize_cohort_quantile_coverage_handles_zero_evaluated_rows_without_dividing_by_zero(self):
        rows = [_row(i * (HORIZON_DAYS + 1), "EARNINGS", -0.01 * i) for i in range(3)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        summary = summarize_cohort_quantile_coverage(evaluations)
        self.assertEqual(summary.evaluated_rows, 0)
        self.assertIsNone(summary.p10_empirical_coverage)


if __name__ == "__main__":
    unittest.main()
