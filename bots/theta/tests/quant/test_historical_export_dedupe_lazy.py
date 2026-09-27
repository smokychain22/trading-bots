import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.historical_export_dedupe import LazyHistoricalExportEntry, deduplicate_historical_exports_lazy


def make_dataset(dataset_hash, candidate_ids):
    return {
        'datasetHash': dataset_hash,
        'sourceWindow': {'start': '2026-01-01T00:00:00Z', 'end': '2026-01-02T00:00:00Z'},
        'featureSetVersion': 'fv-1',
        'rows': {
            'candidateSets': [{'candidateSetId': f'cs-{dataset_hash}'}],
            'candidates': [{'candidateId': cid} for cid in candidate_ids],
            'executionEvidence': [{'quoteObservationId': f'q-{cid}'} for cid in candidate_ids],
        },
    }


class LoadTracker:
    def __init__(self, dataset):
        self.dataset = dataset
        self.call_count = 0

    def __call__(self):
        self.call_count += 1
        return self.dataset


class HistoricalExportDedupeLazyTests(unittest.TestCase):
    def test_known_duplicate_never_triggers_dataset_load(self):
        tracker1 = LoadTracker(make_dataset('h1', ['c1']))
        tracker2 = LoadTracker(make_dataset('h1', ['c1']))  # duplicate manifest text -> never loaded
        entries = [
            LazyHistoricalExportEntry('dir1', 'manifest-for-h1', tracker1),
            LazyHistoricalExportEntry('dir2', 'manifest-for-h1', tracker2),
        ]
        report = deduplicate_historical_exports_lazy(entries)
        self.assertEqual(report.raw_export_directory_count, 2)
        self.assertEqual(report.unique_manifest_hash_count, 1)
        self.assertEqual(report.duplicate_archive_copy_count, 1)
        self.assertEqual(tracker1.call_count, 1)
        self.assertEqual(tracker2.call_count, 0)  # the whole point of this module

    def test_distinct_entries_both_loaded_and_tallied(self):
        tracker1 = LoadTracker(make_dataset('h1', ['c1', 'c2']))
        tracker2 = LoadTracker(make_dataset('h2', ['c2', 'c3']))
        entries = [
            LazyHistoricalExportEntry('dir1', 'manifest-for-h1', tracker1),
            LazyHistoricalExportEntry('dir2', 'manifest-for-h2', tracker2),
        ]
        report = deduplicate_historical_exports_lazy(entries)
        self.assertEqual(report.unique_candidate_count, 3)  # c1, c2, c3 -- c2 not double-counted
        self.assertEqual(tracker1.call_count, 1)
        self.assertEqual(tracker2.call_count, 1)

    def test_empty_manifest_falls_back_to_loading_dataset(self):
        tracker = LoadTracker(make_dataset('h1', ['c1']))
        entries = [LazyHistoricalExportEntry('dir1', '', tracker)]
        report = deduplicate_historical_exports_lazy(entries)
        self.assertEqual(tracker.call_count, 1)
        self.assertIn('FELL_BACK_TO_DATASET_HASH', report.identity_fallbacks_used[0])

    def test_empty_input(self):
        report = deduplicate_historical_exports_lazy([])
        self.assertEqual(report.raw_export_directory_count, 0)

    def test_matches_eager_result_for_equivalent_input(self):
        from research.historical_export_dedupe import HistoricalExportEntry, deduplicate_historical_exports
        dataset = make_dataset('h1', ['c1', 'c2'])
        eager_report = deduplicate_historical_exports([HistoricalExportEntry('dir1', 'manifest-for-h1', dataset)])
        lazy_report = deduplicate_historical_exports_lazy([LazyHistoricalExportEntry('dir1', 'manifest-for-h1', LoadTracker(dataset))])
        self.assertEqual(eager_report.unique_candidate_count, lazy_report.unique_candidate_count)
        self.assertEqual(eager_report.duplicate_archive_copy_count, lazy_report.duplicate_archive_copy_count)


if __name__ == '__main__':
    unittest.main()
