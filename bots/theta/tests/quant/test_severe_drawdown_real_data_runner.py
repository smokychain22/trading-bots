"""Tests for bots/theta/quant/research/severe_drawdown_real_data_runner.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.severe_drawdown_real_data_runner import (  # noqa: E402
    BINARY_LABEL_EXPORT_CONTRACT_VERSION,
    CONTINUOUS_TARGET_EXPORT_CONTRACT_VERSION,
    MIN_ROWS_FOR_LOGISTIC_BASELINE,
    run_cohort_quantile_real_data_study,
    run_logistic_baseline_real_data_study,
)
from research.severe_drawdown_cohort_quantile_baseline import MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE  # noqa: E402


class RunCohortQuantileRealDataStudyTest(unittest.TestCase):
    def test_reports_awaiting_real_export_when_none_supplied(self):
        result = run_cohort_quantile_real_data_study(None)
        self.assertEqual(result.status, "AWAITING_REAL_EXPORT")
        self.assertIsNone(result.evidence_lineage)

    def test_rejects_a_wrong_contract_version(self):
        result = run_cohort_quantile_real_data_study({
            "exportContractVersion": "wrong", "sanitized": True, "sourceDescription": "x",
            "rowCount": 0, "rows": [],
        })
        self.assertEqual(result.status, "EXPORT_CONTRACT_INVALID")

    def test_rejects_a_row_count_mismatch(self):
        result = run_cohort_quantile_real_data_study({
            "exportContractVersion": CONTINUOUS_TARGET_EXPORT_CONTRACT_VERSION, "sanitized": True,
            "sourceDescription": "x", "rowCount": 5, "rows": [],
        })
        self.assertEqual(result.status, "EXPORT_ROW_COUNT_MISMATCH")

    def test_runs_the_real_study_and_tags_evidence_lineage_real_export(self):
        rows = [
            {"episodeId": f"e{i}", "cohortKey": "EARNINGS", "decisionDate": f"2026-01-{(i % 28) + 1:02d}", "forwardMae": -0.01 * (i + 1)}
            for i in range(MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE + 10)
        ]
        # Ensure distinct decision dates across the whole set to allow prior-history accumulation.
        # labelAvailableAt == decisionDate here (matures same day) since this test targets plain
        # chronological accumulation, not the embargo mechanism (covered separately in
        # test_severe_drawdown_cohort_quantile_baseline.py).
        rows = [
            {**row, "decisionDate": f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}",
             "labelAvailableAt": f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}"}
            for i, row in enumerate(rows)
        ]
        export = {
            "exportContractVersion": CONTINUOUS_TARGET_EXPORT_CONTRACT_VERSION, "sanitized": True,
            "sourceDescription": "fixture", "rowCount": len(rows), "rows": rows,
        }
        result = run_cohort_quantile_real_data_study(export)
        self.assertEqual(result.status, "COMPLETED")
        self.assertEqual(result.evidence_lineage, "REAL_EXPORT")
        self.assertEqual(result.total_rows, len(rows))
        self.assertGreater(result.evaluated_rows, 0)


class RunLogisticBaselineRealDataStudyTest(unittest.TestCase):
    def test_reports_awaiting_real_export_when_none_supplied(self):
        result = run_logistic_baseline_real_data_study(None)
        self.assertEqual(result.status, "AWAITING_REAL_EXPORT")

    def test_reports_temporal_history_insufficient_below_the_minimum_row_count(self):
        rows = [
            {"decisionDate": f"2026-01-{i + 1:02d}T00:00:00Z", "labelAvailableAt": f"2026-01-{i + 1:02d}T00:00:00Z",
             "features": [float(i)], "label": i % 2}
            for i in range(MIN_ROWS_FOR_LOGISTIC_BASELINE - 1)
        ]
        export = {
            "exportContractVersion": BINARY_LABEL_EXPORT_CONTRACT_VERSION, "sanitized": True,
            "sourceDescription": "fixture", "rowCount": len(rows), "rows": rows,
        }
        result = run_logistic_baseline_real_data_study(export)
        self.assertEqual(result.status, "TEMPORAL_HISTORY_INSUFFICIENT")
        self.assertEqual(result.evidence_lineage, "REAL_EXPORT")

    def test_runs_the_real_study_with_a_chronological_split_and_reports_oos_calibration(self):
        rows = []
        for i in range(MIN_ROWS_FOR_LOGISTIC_BASELINE + 20):
            x = (i - 30) / 30.0
            label = 1 if x > 0 else 0
            decision_date = f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}T00:00:00Z"
            rows.append({"decisionDate": decision_date, "labelAvailableAt": decision_date, "features": [x], "label": label})
        export = {
            "exportContractVersion": BINARY_LABEL_EXPORT_CONTRACT_VERSION, "sanitized": True,
            "sourceDescription": "fixture", "rowCount": len(rows), "rows": rows,
        }
        result = run_logistic_baseline_real_data_study(export)
        self.assertEqual(result.status, "COMPLETED")
        self.assertEqual(result.evidence_lineage, "REAL_EXPORT")
        self.assertGreater(result.train_n, 0)
        self.assertGreater(result.test_n, 0)
        self.assertIsNotNone(result.oos_brier_score)
        self.assertGreaterEqual(result.oos_brier_score, 0.0)


if __name__ == "__main__":
    unittest.main()
