import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _candidate_raw, _candidate_set_raw
from research.historical_v1_to_v6_bridge import convert_historical_export
from research.production_export_loader import DatasetLoadError, canonical_json, sha256_hex


def v1_export(candidates=None, candidate_sets=None, dataset_hash_override=None):
    rows = {
        'candidateSets': candidate_sets if candidate_sets is not None else [_candidate_set_raw()],
        'candidates': candidates if candidates is not None else [_candidate_raw()],
        'shadowCandidates': [], 'managementSnapshots': [], 'lifecycleOutcomes': [],
        'wholeChainOutcomes': [], 'executionEvidence': [],
    }
    sorted_rows = {k: sorted(v, key=canonical_json) for k, v in rows.items()}
    identity = {
        'schemaVersion': 'theta-r6-dataset-v1',
        'sourceWindow': {'start': '2026-01-01T00:00:00+00:00', 'end': '2026-01-02T00:00:00+00:00'},
        'featureSetVersion': 'fv-1', 'strategyVersions': ['sv-1'],
        'rows': sorted_rows, 'rowCounts': {k: len(v) for k, v in sorted_rows.items()},
    }
    dataset_hash = dataset_hash_override if dataset_hash_override is not None else sha256_hex(canonical_json(identity))
    export = dict(identity)
    export['exportedAt'] = '2026-01-02T00:00:00+00:00'
    export['datasetHash'] = dataset_hash
    return export


class HistoricalBridgeTests(unittest.TestCase):
    def test_valid_v1_load_is_hash_verified_and_originals_untouched(self):
        raw = v1_export()
        result = convert_historical_export(raw)
        self.assertTrue(result.source_hash_verified)
        self.assertEqual(len(result.candidates), 1)
        self.assertEqual(len(result.candidate_sets), 1)
        self.assertEqual(raw['schemaVersion'], 'theta-r6-dataset-v1')  # untouched

    def test_tampered_hash_is_reported_never_silently_accepted(self):
        raw = v1_export(dataset_hash_override='0' * 64)
        result = convert_historical_export(raw)
        self.assertFalse(result.source_hash_verified)
        # Still loads the rows -- lenient bridge, not a hard reject -- but never claims verified.
        self.assertEqual(len(result.candidates), 1)

    def test_deterministic_conversion(self):
        raw = v1_export()
        first = convert_historical_export(raw)
        second = convert_historical_export(raw)
        self.assertEqual(first.converted_content_hash, second.converted_content_hash)

    def test_v6_only_fields_absent_from_v1_are_named_unavailable_not_fabricated_empty(self):
        raw = v1_export()
        result = convert_historical_export(raw)
        self.assertIn('optionChainDecisions', result.unavailable_fields)
        self.assertIn('positionPathCheckpoints', result.unavailable_fields)
        self.assertIn('policyLearningRecords', result.unavailable_fields)

    def test_v3_source_makes_option_chain_decisions_available_not_unavailable(self):
        raw = v1_export()
        raw['schemaVersion'] = 'theta-r6-dataset-v3'
        raw['rows']['optionChainDecisions'] = []
        raw['rowCounts']['optionChainDecisions'] = 0
        raw['datasetHash'] = sha256_hex(canonical_json({
            'schemaVersion': raw['schemaVersion'], 'sourceWindow': raw['sourceWindow'],
            'featureSetVersion': raw['featureSetVersion'], 'strategyVersions': raw['strategyVersions'],
            'rows': raw['rows'], 'rowCounts': raw['rowCounts'],
        }))
        result = convert_historical_export(raw)
        self.assertTrue(result.source_hash_verified)
        self.assertNotIn('optionChainDecisions', result.unavailable_fields)
        self.assertIn('outcomeSubjects', result.unavailable_fields)  # still absent -- introduced at v4

    def test_unknown_schema_version_rejected(self):
        raw = v1_export()
        raw['schemaVersion'] = 'theta-r6-dataset-v999'
        with self.assertRaisesRegex(DatasetLoadError, 'UNKNOWN_SCHEMA_VERSION'):
            convert_historical_export(raw)

    def test_candidate_set_referencing_unknown_candidate_rejected(self):
        raw = v1_export(candidate_sets=[_candidate_set_raw(best='does-not-exist')])
        raw['datasetHash'] = sha256_hex(canonical_json({
            'schemaVersion': raw['schemaVersion'], 'sourceWindow': raw['sourceWindow'],
            'featureSetVersion': raw['featureSetVersion'], 'strategyVersions': raw['strategyVersions'],
            'rows': raw['rows'], 'rowCounts': raw['rowCounts'],
        }))
        with self.assertRaisesRegex(DatasetLoadError, 'REFERENCES_UNKNOWN_CANDIDATE'):
            convert_historical_export(raw)


if __name__ == '__main__':
    unittest.main()
