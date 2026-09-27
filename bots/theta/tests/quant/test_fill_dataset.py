import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export, _candidate_raw
from research.production_export_loader import load_dataset_export
from research.fill_dataset import build_fill_dataset


def policy(max_age=30):
    return {'version': 'theta-fill-dataset-policy-v1', 'policyId': 'DETERMINISTIC_TEST_ONLY',
        'evidenceClass': 'DETERMINISTIC_TEST', 'maxQuoteAgeSeconds': max_age}


def quote(quoted='2026-01-01T14:29:55Z', received='2026-01-01T14:29:56Z', candidate_id='c1'):
    return {'quoteObservationId': 'q1', 'candidateId': candidate_id, 'managementInputSnapshotId': None,
        'observationRole': 'DECISION', 'observedAt': received, 'providerTimestamp': quoted,
        'ingestionTimestamp': received, 'source': 'ALPACA', 'operationAlias': 'options.snapshots',
        'feed': 'indicative', 'contractVersion': 'test-only', 'bid': 1.0, 'ask': 1.1,
        'bidSize': 5, 'askSize': 5, 'proposedLimit': 1.05, 'dataQuality': 'GOOD', 'contentHash': 'c' * 64}


class FillDatasetTests(unittest.TestCase):
    def test_row_carries_arrival_evidence_with_fill_fields_explicitly_unknown(self):
        export = _build_export(candidates=[_candidate_raw()], executionEvidence=[quote()])
        result = build_fill_dataset(load_dataset_export(export), policy())
        row = result['rows'][0]
        self.assertAlmostEqual(row['spread'], 0.1)
        self.assertIsNone(row['filled'])
        self.assertEqual(row['truthClass'], 'UNKNOWN')
        self.assertIn('filled', row['futureIdentifiableFields'])
        self.assertEqual(result['brokerActualFillCount'], 0)

    def test_stale_quote_excluded_not_silently_included(self):
        export = _build_export(candidates=[_candidate_raw()],
            executionEvidence=[quote(quoted='2026-01-01T14:29:00Z', received='2026-01-01T14:29:56Z')])
        result = build_fill_dataset(load_dataset_export(export), policy(max_age=30))
        self.assertEqual(result['rowCount'], 0)
        self.assertIn('FILL_DATASET_QUOTE_AGE_OUT_OF_POLICY', result['excluded'][0]['reasons'])

    def test_unresolved_contract_identity_excluded(self):
        export = _build_export(candidates=[_candidate_raw()], executionEvidence=[quote(candidate_id='unknown')])
        result = build_fill_dataset(load_dataset_export(export), policy())
        self.assertEqual(result['rowCount'], 0)
        self.assertIn('FILL_DATASET_CONTRACT_IDENTITY_UNRESOLVED', result['excluded'][0]['reasons'])

    def test_deterministic_hash_and_roundtrip(self):
        data = load_dataset_export(_build_export(candidates=[_candidate_raw()], executionEvidence=[quote()]))
        self.assertEqual(build_fill_dataset(data, policy()), build_fill_dataset(data, policy()))

    def test_missing_policy_rejected(self):
        with self.assertRaisesRegex(ValueError, 'POLICY_REQUIRED'):
            build_fill_dataset(load_dataset_export(_build_export()), {'policyId': 'x', 'evidenceClass': 'DETERMINISTIC_TEST'})


if __name__ == '__main__':
    unittest.main()
