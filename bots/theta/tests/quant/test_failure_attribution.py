import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.failure_attribution import attribute_failure


class FailureAttributionTests(unittest.TestCase):
    def test_no_evidence_is_unattributed_not_a_guess(self):
        result = attribute_failure({})
        self.assertEqual(result['labels'], ['UNATTRIBUTED'])
        self.assertEqual(result['state'], 'UNATTRIBUTED_NO_MATCHING_EVIDENCE')

    def test_stale_data_quality_attributes_data_quality(self):
        result = attribute_failure({'dataQuality': 'STALE'})
        self.assertIn('DATA_QUALITY', result['labels'])
        self.assertIn('dataQuality=STALE', result['reasons']['DATA_QUALITY'])

    def test_multi_label_when_multiple_causes_present(self):
        result = attribute_failure({'dataQuality': 'STALE', 'accountingReconciled': False, 'contractHardBlockers': ['X']})
        self.assertEqual(set(result['labels']), {'DATA_QUALITY', 'ACCOUNTING', 'CONTRACT'})

    def test_execution_attributed_only_when_latency_exceeds_policy(self):
        under = attribute_failure({'fillLatencySeconds': 1.0, 'fillLatencySecondsPolicyMax': 5.0})
        over = attribute_failure({'fillLatencySeconds': 10.0, 'fillLatencySecondsPolicyMax': 5.0})
        self.assertNotIn('EXECUTION', under['labels'])
        self.assertIn('EXECUTION', over['labels'])

    def test_deterministic_hash(self):
        evidence = {'dataQuality': 'STALE'}
        self.assertEqual(attribute_failure(evidence), attribute_failure(evidence))


if __name__ == '__main__':
    unittest.main()
