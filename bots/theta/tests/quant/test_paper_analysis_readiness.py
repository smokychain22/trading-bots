import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.paper_analysis_readiness import PAPER_ADAPTER_KINDS, build_paper_readiness_adapter, readiness_report


class PaperAnalysisReadinessTests(unittest.TestCase):
    def test_no_evidence_is_explicit_not_yet_captured(self):
        result = build_paper_readiness_adapter('FILLS', None)
        self.assertEqual(result['state'], 'NOT_YET_CAPTURED_NO_REAL_PAPER_DATA')
        self.assertFalse(result['realPaperClaim'])

    def test_synthetic_evidence_normalized(self):
        result = build_paper_readiness_adapter('TCA', {'truthClass': 'SYNTHETIC_FIXTURE', 'slippage': 0.02})
        self.assertEqual(result['state'], 'EVIDENCE_NORMALIZED')
        self.assertFalse(result['realPaperClaim'])

    def test_broker_actual_claim_requires_execution_enabled_evidence(self):
        with self.assertRaisesRegex(ValueError, 'BROKER_ACTUAL_CLAIM_WITHOUT_EXECUTION_ENABLED_EVIDENCE'):
            build_paper_readiness_adapter('FILLS', {'truthClass': 'BROKER_ACTUAL'})

    def test_broker_actual_claim_allowed_with_execution_enabled_evidence(self):
        result = build_paper_readiness_adapter('FILLS', {'truthClass': 'BROKER_ACTUAL', 'masterPaperExecutionEnabled': True})
        self.assertTrue(result['realPaperClaim'])

    def test_unknown_adapter_kind_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_ADAPTER_KIND'):
            build_paper_readiness_adapter('NOT_A_REAL_KIND', None)

    def test_readiness_report_covers_every_kind(self):
        report = readiness_report({})
        self.assertEqual(set(report.keys()), set(PAPER_ADAPTER_KINDS))
        self.assertTrue(all(r['state'] == 'NOT_YET_CAPTURED_NO_REAL_PAPER_DATA' for r in report.values()))


if __name__ == '__main__':
    unittest.main()
