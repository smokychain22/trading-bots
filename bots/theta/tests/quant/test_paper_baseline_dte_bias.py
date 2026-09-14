"""Tests for bots/theta/quant/research/paper_baseline_dte_bias.py. Synthetic fixtures only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.paper_baseline_dte_bias import (  # noqa: E402
    BaselineReceiptCandidateRecord,
    NearMissRecord,
    build_dte_bias_report,
    bucket_for_dte,
)


def _cand(cid, dte, eligible=True, frontier=True, selected=False, ret=0.01):
    return BaselineReceiptCandidateRecord(cid, dte, eligible, frontier, selected, ret)


class BucketAssignmentTests(unittest.TestCase):
    def test_boundaries_are_inclusive(self):
        self.assertEqual(bucket_for_dte(2), "2_5")
        self.assertEqual(bucket_for_dte(5), "2_5")
        self.assertEqual(bucket_for_dte(25), "25_35")
        self.assertEqual(bucket_for_dte(35), "25_35")
        self.assertEqual(bucket_for_dte(61), "60_PLUS")

    def test_non_positive_dte_is_unbucketed(self):
        self.assertIsNone(bucket_for_dte(0))
        self.assertIsNone(bucket_for_dte(-1))


class InsufficientReceiptsTests(unittest.TestCase):
    def test_below_minimum_receipts_reports_no_conclusion(self):
        receipts = [[_cand("c1", 5, selected=True)]]
        report = build_dte_bias_report(receipts, [[]], minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        self.assertFalse(report.sufficient_receipts)
        self.assertIsNone(report.skew_detected)
        self.assertIsNone(report.selected_share_short_dte)


class SkewDetectionTests(unittest.TestCase):
    def test_detects_a_genuine_skew_toward_short_dte_selections(self):
        # Raw candidates spread evenly across buckets, but selections concentrate in short DTE.
        receipts = []
        for i in range(20):
            receipts.append([
                _cand(f"c{i}a", 4, selected=True),   # short DTE, always selected
                _cand(f"c{i}b", 30, selected=False),  # target cohort, never selected
                _cand(f"c{i}c", 50, selected=False),
            ])
        report = build_dte_bias_report(receipts, [[] for _ in receipts], minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        self.assertTrue(report.sufficient_receipts)
        self.assertAlmostEqual(report.selected_share_short_dte, 1.0)
        self.assertTrue(report.skew_detected)

    def test_no_skew_when_selection_share_matches_raw_share(self):
        receipts = []
        for i in range(20):
            # Only one candidate per receipt, uniformly rotating through buckets -- selection share == raw share.
            dte = [4, 30, 50][i % 3]
            receipts.append([_cand(f"c{i}", dte, selected=True)])
        report = build_dte_bias_report(receipts, [[] for _ in receipts], minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        self.assertTrue(report.sufficient_receipts)
        self.assertFalse(report.skew_detected)

    def test_near_miss_counts_are_tallied_per_bucket(self):
        receipts = [[_cand("c1", 30, selected=True)] for _ in range(10)]
        near_misses = [[NearMissRecord("nm1", 4), NearMissRecord("nm2", 4)] for _ in range(10)]
        report = build_dte_bias_report(receipts, near_misses, minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        short_bucket = next(b for b in report.buckets if b.bucket == "2_5")
        self.assertEqual(short_bucket.near_miss_count, 20)

    def test_target_cohort_share_reports_25_35_and_36_45_combined(self):
        receipts = [[_cand("c1", 30, selected=True), _cand("c2", 40, selected=True), _cand("c3", 4, selected=True)] for _ in range(10)]
        report = build_dte_bias_report(receipts, [[] for _ in receipts], minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        self.assertAlmostEqual(report.selected_share_target_cohort, 2 / 3)


if __name__ == "__main__":
    unittest.main()
