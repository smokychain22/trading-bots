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


def _row(day_offset: int, cohort: str, mae) -> CohortQuantileInputRow:
    return CohortQuantileInputRow(
        episode_id=f"e{day_offset}", cohort_key=cohort,
        decision_date=date(2026, 1, 1) + timedelta(days=day_offset), forward_mae=mae,
    )


class SevereDrawdownCohortQuantileBaselineTest(unittest.TestCase):
    def test_rows_before_the_minimum_prior_history_threshold_are_insufficient(self):
        rows = [_row(i, "EARNINGS", -0.01 * i) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE - 1)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        self.assertTrue(all(e.status == "INSUFFICIENT_PRIOR_HISTORY" for e in evaluations))

    def test_a_row_is_evaluated_once_enough_strictly_prior_same_cohort_rows_exist(self):
        rows = [_row(i, "EARNINGS", -0.01 * (i + 1)) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 5)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        evaluated = [e for e in evaluations if e.status == "EVALUATED"]
        self.assertTrue(len(evaluated) > 0)
        for e in evaluated:
            self.assertIsNotNone(e.predicted_p10)
            self.assertIsNotNone(e.predicted_p50)

    def test_never_uses_same_day_or_future_rows_to_predict_an_earlier_rows_quantile(self):
        # All rows on the SAME decision_date as the evaluated row must be excluded from its
        # own prediction, since "prior" means strictly before, not same-day.
        rows = [_row(0, "EARNINGS", -0.5) for _ in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 5)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        # Every row shares decision_date=day 0, so none has a strictly-prior row -> all insufficient.
        self.assertTrue(all(e.status == "INSUFFICIENT_PRIOR_HISTORY" for e in evaluations))

    def test_a_censored_or_excluded_row_with_none_mae_is_never_folded_into_cohort_history(self):
        rows = [_row(i, "EARNINGS", None) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 5)]
        rows.append(_row(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 6, "EARNINGS", -0.03))
        evaluations = evaluate_cohort_quantile_baseline(rows)
        last = evaluations[-1]
        # Despite 25 prior rows existing chronologically, none had a real forward_mae to fold in.
        self.assertEqual(last.status, "INSUFFICIENT_PRIOR_HISTORY")
        self.assertEqual(last.prior_n, 0)

    def test_different_cohorts_never_share_history(self):
        rows = [_row(i, "EARNINGS", -0.01) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 2)]
        rows.append(_row(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 3, "MACRO", -0.02))
        evaluations = evaluate_cohort_quantile_baseline(rows)
        macro_eval = [e for e in evaluations if e.cohort_key == "MACRO"][0]
        self.assertEqual(macro_eval.status, "INSUFFICIENT_PRIOR_HISTORY")
        self.assertEqual(macro_eval.prior_n, 0)

    def test_summarize_cohort_quantile_coverage_reports_empirical_hit_rates(self):
        rows = [_row(i, "EARNINGS", -0.01 * (i + 1)) for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 10)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        summary = summarize_cohort_quantile_coverage(evaluations)
        self.assertEqual(summary.total_rows, len(rows))
        self.assertGreater(summary.evaluated_rows, 0)
        self.assertIsNotNone(summary.p50_empirical_coverage)
        self.assertGreaterEqual(summary.p50_empirical_coverage, 0.0)
        self.assertLessEqual(summary.p50_empirical_coverage, 1.0)

    def test_summarize_cohort_quantile_coverage_handles_zero_evaluated_rows_without_dividing_by_zero(self):
        rows = [_row(i, "EARNINGS", -0.01 * i) for i in range(3)]
        evaluations = evaluate_cohort_quantile_baseline(rows)
        summary = summarize_cohort_quantile_coverage(evaluations)
        self.assertEqual(summary.evaluated_rows, 0)
        self.assertIsNone(summary.p10_empirical_coverage)


if __name__ == "__main__":
    unittest.main()
