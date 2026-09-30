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

    def test_cause_dimensions_require_explicit_dated_provenance(self):
        from research.failure_attribution import CAUSE_DIMENSIONS
        causes = [{'cause': c, 'evidenceId': c, 'reason': 'test-only reported observation', 'observedAt': '2026-01-01T12:00:00Z'} for c in CAUSE_DIMENSIONS]
        result = attribute_failure({'causeEvidence': causes})
        self.assertEqual(len(result['causeEvidence']), 21)
        self.assertEqual(result['scope'], 'REPORTED_CONTRIBUTING_FACTS_NOT_PROVEN_CAUSAL_EFFECT')
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_CAUSE'):
            attribute_failure({'causeEvidence': causes + causes})
        with self.assertRaisesRegex(ValueError, 'PROVENANCE_REQUIRED'):
            attribute_failure({'causeEvidence': [{'cause': 'EVENT'}]})
        with self.assertRaisesRegex(ValueError, 'LATENCY_INVALID'):
            attribute_failure({'fillLatencySeconds': float('nan')})

    def test_export_consumer_keeps_unknown_quality_unattributed(self):
        from research.failure_attribution import attribute_export_failures
        from research.production_export_loader import load_dataset_export
        from test_empirical_pipeline import _build_export, _candidate_raw
        for quality, labels in [('UNKNOWN', ['UNATTRIBUTED']), ('STALE', ['DATA_QUALITY'])]:
            candidate = _candidate_raw()
            candidate['providerProvenance'][0]['state'] = quality
            export = load_dataset_export(_build_export(candidates=[candidate]))
            result = attribute_export_failures(export)
            self.assertEqual(result['datasetHash'], export.dataset_hash)
            self.assertEqual(result['rows'][0]['attribution']['labels'], labels)

    def test_actual_cli_dispatches_attribution(self):
        from research.research_cli import _dispatch
        result = _dispatch('failure-attribution', {'accountingReconciled': False})
        self.assertEqual(result['labels'], ['ACCOUNTING'])
        self.assertFalse(result['brokerAuthority'])


if __name__ == '__main__':
    unittest.main()
