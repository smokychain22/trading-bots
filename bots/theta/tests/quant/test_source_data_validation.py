import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.source_data_validation import validate_source_export


def base_export(**overrides):
    export = {
        'schemaVersion': 'theta-r6-dataset-v6', 'sourceWindow': {'start': '2026-01-01T00:00:00+00:00', 'end': '2026-01-02T00:00:00+00:00'},
        'exportedAt': '2026-01-02T00:00:00+00:00', 'featureSetVersion': 'fv-1', 'strategyVersions': ['sv-1'],
        'rows': {'candidates': [{'candidateId': 'c1', 'decisionTime': '2026-01-01T12:00:00+00:00', 'contract': {'multiplier': 100}}]},
        'rowCounts': {'candidates': 1},
    }
    export.update(overrides)
    return export


def now():
    return datetime(2026, 6, 1, tzinfo=timezone.utc)


class SourceDataValidationTests(unittest.TestCase):
    def test_unknown_schema_version_flagged(self):
        report = validate_source_export(base_export(schemaVersion='theta-r6-dataset-v999'), now=now())
        self.assertIn('SCHEMA_VERSION_UNKNOWN:theta-r6-dataset-v999', report['findings'])

    def test_dataset_hash_mismatch_flagged(self):
        export = base_export()
        export['datasetHash'] = '0' * 64
        report = validate_source_export(export, now=now())
        self.assertIn('DATASET_HASH_MISMATCH', report['findings'])

    def test_future_timestamp_flagged(self):
        export = base_export(rows={'candidates': [{'candidateId': 'c1', 'decisionTime': '2099-01-01T00:00:00+00:00', 'contract': {'multiplier': 100}}]})
        report = validate_source_export(export, now=now())
        self.assertTrue(any(f.startswith('FUTURE_TIMESTAMP') for f in report['findings']))

    def test_duplicate_row_identity_flagged(self):
        export = base_export(rows={'candidates': [
            {'candidateId': 'c1', 'decisionTime': '2026-01-01T00:00:00+00:00', 'contract': {'multiplier': 100}},
            {'candidateId': 'c1', 'decisionTime': '2026-01-01T00:00:00+00:00', 'contract': {'multiplier': 100}},
        ]})
        report = validate_source_export(export, now=now())
        self.assertTrue(any('DUPLICATE_ROW_IDENTITY' in f for f in report['findings']))

    def test_unexpected_multiplier_flagged(self):
        export = base_export(rows={'candidates': [{'candidateId': 'c1', 'decisionTime': '2026-01-01T00:00:00+00:00', 'contract': {'multiplier': 10}}]})
        report = validate_source_export(export, now=now())
        self.assertTrue(any('UNEXPECTED_CONTRACT_MULTIPLIER' in f for f in report['findings']))

    def test_source_window_end_before_start_flagged(self):
        export = base_export(sourceWindow={'start': '2026-01-02T00:00:00+00:00', 'end': '2026-01-01T00:00:00+00:00'})
        report = validate_source_export(export, now=now())
        self.assertIn('SOURCE_WINDOW_END_BEFORE_START', report['findings'])

    def test_clean_export_with_correct_hash_passes(self):
        from research.production_export_loader import canonical_json, sha256_hex
        export = base_export()
        identity = {'schemaVersion': export['schemaVersion'], 'sourceWindow': export['sourceWindow'],
                    'featureSetVersion': export['featureSetVersion'], 'strategyVersions': sorted(set(export['strategyVersions'])),
                    'rows': export['rows'], 'rowCounts': export['rowCounts']}
        export['datasetHash'] = sha256_hex(canonical_json(identity))
        report = validate_source_export(export, now=now())
        self.assertEqual(report['state'], 'PASS')
        self.assertEqual(report['findings'], [])


if __name__ == '__main__':
    unittest.main()
