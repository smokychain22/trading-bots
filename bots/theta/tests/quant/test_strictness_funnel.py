"""Tests for bots/theta/quant/features/strictness_funnel.py (work package 23)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.strictness_funnel import (  # noqa: E402
    StrictnessCategory, StrictnessRow, build_strictness_funnel, classify_reason_code,
)


class TestClassifyReasonCode(unittest.TestCase):
    def test_data_quality_codes(self):
        self.assertEqual(classify_reason_code("QUOTE_UNKNOWN"), StrictnessCategory.DATA_QUALITY)
        self.assertEqual(classify_reason_code("QUOTE_STALE"), StrictnessCategory.DATA_QUALITY)
        self.assertEqual(classify_reason_code("INVALID_QUOTE"), StrictnessCategory.DATA_QUALITY)

    def test_aegis_codes(self):
        self.assertEqual(classify_reason_code("AEGIS_HARD_VETO"), StrictnessCategory.AEGIS)

    def test_economic_codes(self):
        self.assertEqual(classify_reason_code("ECONOMIC_VALUE_INSUFFICIENT"), StrictnessCategory.ECONOMIC)

    def test_wait_codes(self):
        self.assertEqual(classify_reason_code("GLOBAL_WAIT"), StrictnessCategory.WAIT)

    def test_selected_codes(self):
        self.assertEqual(classify_reason_code("SELECTED_CANDIDATE"), StrictnessCategory.SELECTED)

    def test_safety_codes(self):
        self.assertEqual(classify_reason_code("SAFETY_GUARD_TRIPPED"), StrictnessCategory.SAFETY)

    def test_unclassified_real_code_is_other_typed_never_silently_dropped(self):
        self.assertEqual(classify_reason_code("SOME_BRAND_NEW_REAL_CODE_NOT_YET_MAPPED"), StrictnessCategory.OTHER_TYPED)


class TestStrictnessFunnel(unittest.TestCase):
    def test_counts_and_rates(self):
        rows = [
            StrictnessRow("THETA_Q", "2026-09-27", "AEGIS_HARD_VETO", "c1"),
            StrictnessRow("THETA_Q", "2026-09-27", "AEGIS_HARD_VETO", "c2"),
            StrictnessRow("THETA_Q", "2026-09-27", "SELECTED_CANDIDATE", "c3"),
        ]
        report = build_strictness_funnel(rows)
        self.assertEqual(report.total_count, 3)
        self.assertEqual(report.counts_by_category["AEGIS"], 2)
        self.assertAlmostEqual(report.rates_by_category["AEGIS"], 2 / 3)

    def test_by_strategy(self):
        rows = [
            StrictnessRow("THETA_Q", "d1", "AEGIS_HARD_VETO", None),
            StrictnessRow("THETA_D", "d1", "AEGIS_HARD_VETO", None),
        ]
        report = build_strictness_funnel(rows)
        self.assertEqual(report.counts_by_strategy_category["THETA_Q"]["AEGIS"], 1)
        self.assertEqual(report.counts_by_strategy_category["THETA_D"]["AEGIS"], 1)

    def test_by_date(self):
        rows = [
            StrictnessRow("THETA_Q", "2026-09-26", "AEGIS_HARD_VETO", None),
            StrictnessRow("THETA_Q", "2026-09-27", "AEGIS_HARD_VETO", None),
        ]
        report = build_strictness_funnel(rows)
        self.assertEqual(report.counts_by_date_category["2026-09-26"]["AEGIS"], 1)
        self.assertEqual(report.counts_by_date_category["2026-09-27"]["AEGIS"], 1)

    def test_unclassified_codes_are_surfaced_not_hidden(self):
        rows = [StrictnessRow("THETA_Q", "d1", "NOVEL_UNMAPPED_CODE", None)]
        report = build_strictness_funnel(rows)
        self.assertIn("NOVEL_UNMAPPED_CODE", report.other_typed_codes_seen)
        self.assertEqual(report.counts_by_category["OTHER_TYPED"], 1)

    def test_empty_input_is_zero_never_a_crash(self):
        report = build_strictness_funnel([])
        self.assertEqual(report.total_count, 0)
        self.assertEqual(report.rates_by_category, {})


if __name__ == "__main__":
    unittest.main()
