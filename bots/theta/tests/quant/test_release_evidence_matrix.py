import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.release_evidence_matrix import build_release_evidence_matrix, classify_release_criterion


class ClassifyReleaseCriterionTests(unittest.TestCase):
    def test_not_applicable(self):
        result = classify_release_criterion('C1', evidence=None, is_external_runtime=False, is_applicable=False)
        self.assertEqual(result['state'], 'NOT_APPLICABLE')

    def test_external_runtime_required(self):
        result = classify_release_criterion('C1', evidence=None, is_external_runtime=True, is_applicable=True)
        self.assertEqual(result['state'], 'EXTERNAL_RUNTIME_REQUIRED')

    def test_insufficient_data_when_no_evidence(self):
        result = classify_release_criterion('C1', evidence=None, is_external_runtime=False, is_applicable=True)
        self.assertEqual(result['state'], 'INSUFFICIENT_DATA')

    def test_pass_when_evidence_meets_check(self):
        result = classify_release_criterion('C1', evidence=0.9, is_external_runtime=False, is_applicable=True, pass_check=lambda v: v > 0.5)
        self.assertEqual(result['state'], 'PASS_EVIDENCE_PRESENT')

    def test_fail_when_evidence_fails_check(self):
        result = classify_release_criterion('C1', evidence=0.1, is_external_runtime=False, is_applicable=True, pass_check=lambda v: v > 0.5)
        self.assertEqual(result['state'], 'FAIL')

    def test_missing_pass_check_with_evidence_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PASS_CHECK_REQUIRED'):
            classify_release_criterion('C1', evidence=0.9, is_external_runtime=False, is_applicable=True)


class BuildReleaseEvidenceMatrixTests(unittest.TestCase):
    def test_overall_pass_when_all_pass_or_not_applicable(self):
        result = build_release_evidence_matrix({
            'C1': dict(evidence=0.9, is_external_runtime=False, is_applicable=True, pass_check=lambda v: v > 0.5),
            'C2': dict(evidence=None, is_external_runtime=False, is_applicable=False),
        })
        self.assertEqual(result['overallState'], 'PASS_EVIDENCE_PRESENT')

    def test_overall_fail_when_any_fail(self):
        result = build_release_evidence_matrix({
            'C1': dict(evidence=0.1, is_external_runtime=False, is_applicable=True, pass_check=lambda v: v > 0.5),
        })
        self.assertEqual(result['overallState'], 'FAIL')

    def test_overall_insufficient_data(self):
        result = build_release_evidence_matrix({'C1': dict(evidence=None, is_external_runtime=False, is_applicable=True)})
        self.assertEqual(result['overallState'], 'INSUFFICIENT_DATA')


if __name__ == '__main__':
    unittest.main()
