import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _candidate_raw
from research.production_export_loader import _load_candidate
from research.historical_coverage_report import build_historical_coverage_report


def candidate(cid='c1', selected=True, volatility=None):
    raw = _candidate_raw(candidate_id=cid, selected=selected)
    if volatility is not None:
        raw['volatility'] = volatility
    return _load_candidate(raw)


class HistoricalCoverageReportTests(unittest.TestCase):
    def test_selected_fraction(self):
        candidates = [candidate('c1', selected=True), candidate('c2', selected=False)]
        report = build_historical_coverage_report(candidates)
        self.assertEqual(report['selectedCandidateCount'], 1)
        self.assertAlmostEqual(report['selectedFraction'], 0.5)

    def test_branch_distribution(self):
        candidates = [candidate('c1'), candidate('c2')]
        report = build_historical_coverage_report(candidates)
        self.assertEqual(report['branchDistribution']['THETA_CONVENTIONAL'], 2)

    def test_feature_family_coverage_reflects_emptiness(self):
        candidates = [candidate('c1', volatility={'ivRank': 0.5}), candidate('c2', volatility={})]
        report = build_historical_coverage_report(candidates)
        self.assertEqual(report['featureFamilyNonEmptyCoverage']['volatility'], 1)

    def test_duplicate_candidate_id_rejected(self):
        candidates = [candidate('c1'), candidate('c1')]
        with self.assertRaisesRegex(ValueError, 'NOT_DEDUPED'):
            build_historical_coverage_report(candidates)

    def test_empty_input_reports_none_fraction(self):
        report = build_historical_coverage_report([])
        self.assertIsNone(report['selectedFraction'])
        self.assertEqual(report['uniqueCandidateCount'], 0)


if __name__ == '__main__':
    unittest.main()
