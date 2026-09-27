import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.historical_export_dedupe import HistoricalExportEntry, deduplicate_historical_exports


def entry(path, dataset_hash='h1', candidate_ids=('c1',), manifest_text=None):
    dataset = {
        'datasetHash': dataset_hash,
        'sourceWindow': {'start': '2026-01-01T00:00:00Z', 'end': '2026-01-02T00:00:00Z'},
        'featureSetVersion': 'fv-1',
        'rows': {
            'candidateSets': [{'candidateSetId': f'cs-{dataset_hash}'}],
            'candidates': [{'candidateId': cid} for cid in candidate_ids],
            'executionEvidence': [{'quoteObservationId': f'q-{cid}'} for cid in candidate_ids],
        },
    }
    text = manifest_text if manifest_text is not None else f'manifest-for-{dataset_hash}'
    return HistoricalExportEntry(directory_path=path, manifest_text=text, dataset=dataset)


class HistoricalExportDedupeTests(unittest.TestCase):
    def test_empty_input(self):
        report = deduplicate_historical_exports([])
        self.assertEqual(report.raw_export_directory_count, 0)

    def test_identical_manifest_text_is_one_archive_copy(self):
        entries = [entry('daily/A/dir1', 'h1'), entry('daily/B/dir1', 'h1')]  # same manifest text, two backup snapshots
        report = deduplicate_historical_exports(entries)
        self.assertEqual(report.raw_export_directory_count, 2)
        self.assertEqual(report.unique_manifest_hash_count, 1)
        self.assertEqual(report.duplicate_archive_copy_count, 1)

    def test_distinct_snapshots_with_overlapping_candidate_ids_dedupe_at_candidate_level(self):
        entries = [
            entry('daily/A/dir1', 'h1', candidate_ids=('c1', 'c2')),
            entry('daily/A/dir2', 'h2', candidate_ids=('c2', 'c3'), manifest_text='manifest-for-h2'),
        ]
        report = deduplicate_historical_exports(entries)
        self.assertEqual(report.unique_dataset_hash_count, 2)
        self.assertEqual(report.unique_candidate_count, 3)  # c1, c2, c3 -- c2 not double-counted

    def test_falls_back_to_dataset_hash_when_manifest_text_empty(self):
        entries = [entry('daily/A/dir1', 'h1', manifest_text='')]
        report = deduplicate_historical_exports(entries)
        self.assertEqual(len(report.identity_fallbacks_used), 1)
        self.assertIn('FELL_BACK_TO_DATASET_HASH', report.identity_fallbacks_used[0])
        self.assertEqual(report.unique_manifest_hash_count, 1)

    def test_never_counts_same_archived_export_twice(self):
        entries = [entry('daily/A/dir1', 'h1') for _ in range(5)]  # 5 raw copies, all identical
        report = deduplicate_historical_exports(entries)
        self.assertEqual(report.raw_export_directory_count, 5)
        self.assertEqual(report.unique_manifest_hash_count, 1)
        self.assertEqual(report.duplicate_archive_copy_count, 4)


if __name__ == '__main__':
    unittest.main()
