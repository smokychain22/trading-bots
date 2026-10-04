"""Compaction of small Parquet files: exact row parity, lineage, atomicity (a crash leaves sources untouched and nothing half-published), tamper detection."""
import gzip
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research import platform_parquet_compaction as compaction  # noqa: E402
from research.platform_parquet import PlatformParquetError, convert_archive, load_manifest, verify_files  # noqa: E402

SHA = 'c' * 40


def make_archive(root: Path, days):
    rows = []
    for day_index, day in enumerate(days):
        for index in range(40):
            rows.append(json.dumps({
                'candidate_id': f'00000000-0000-4000-8000-{day_index * 100 + index:012d}', 'decision_time': f'{day}T15:{index % 60:02d}:00.250000+00:00', 'rank': index,
                'strike': 400 + index * 0.5, 'reason': None if index % 3 else 'X', 'detail_json': {'d': day, 'i': index},
            }, sort_keys=True))
    root.mkdir(parents=True, exist_ok=True)
    path = root / 'chunk-00001.ndjson.gz'
    with gzip.open(path, 'wt', encoding='utf-8') as stream:
        for row in rows:
            stream.write(row + '\n')
    out = root / 'parquet'
    convert_archive([path], out, dataset='cands', time_column='decision_time', key_column='candidate_id', source_population_digest='d' * 64, producer_sha=SHA)
    return out / 'cands', len(rows)


class CompactionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='theta-compact-'))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_many_small_date_files_become_month_files_with_exact_parity_and_lineage(self):
        dataset, total = make_archive(self.root, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-10-01', '2026-10-02'])
        source_files = len(load_manifest(dataset / 'parquet-manifest.json')['files'])
        self.assertEqual(source_files, 5)
        manifest_path = compaction.compact_small_files(dataset, producer_sha=SHA)
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        self.assertEqual(manifest['rowCount'], total)
        self.assertEqual(manifest['partitioning'], 'HIVE:dp_session_month')
        self.assertEqual(manifest['fileCount'], 2, 'two months')
        self.assertEqual(len(manifest['sourceFiles']), source_files)
        self.assertEqual(len(manifest['sourceManifestSha256']), 64)
        self.assertEqual(compaction.verify_compaction(manifest_path), (total, []))
        # sources are untouched and still verify
        self.assertEqual(verify_files(dataset / 'parquet-manifest.json', dataset.parent)[1], [])

    def test_a_crash_during_compaction_leaves_sources_untouched_and_publishes_nothing(self):
        dataset, _ = make_archive(self.root, ['2026-09-21', '2026-09-22'])
        with mock.patch.object(compaction, '_sha256_file', side_effect=RuntimeError('PROCESS_CRASH')):
            with self.assertRaises(RuntimeError):
                compaction.compact_small_files(dataset, producer_sha=SHA)
        self.assertFalse((dataset / 'compacted').exists())
        self.assertEqual([path.name for path in dataset.glob('theta-pq-compact-*')], [], 'no scratch directory is left behind')
        self.assertEqual(verify_files(dataset / 'parquet-manifest.json', dataset.parent)[1], [])
        compaction.compact_small_files(dataset, producer_sha=SHA)  # a clean retry succeeds
        self.assertTrue((dataset / 'compacted' / 'compaction-manifest.json').exists())

    def test_tampering_and_unverified_sources_are_refused(self):
        dataset, _ = make_archive(self.root, ['2026-09-21', '2026-09-22'])
        manifest_path = compaction.compact_small_files(dataset, producer_sha=SHA)
        merged = next((dataset / 'compacted').glob('dp_session_month=*/*.parquet'))
        data = bytearray(merged.read_bytes())
        data[len(data) // 2] ^= 0xFF
        merged.write_bytes(bytes(data))
        self.assertTrue(any(problem.startswith('HASH_MISMATCH') for problem in compaction.verify_compaction(manifest_path)[1]))
        other, _ = make_archive(self.root / 'second', ['2026-09-21'])
        source = next(other.glob('dp_session_date=*/*.parquet'))
        corrupted = bytearray(source.read_bytes())
        corrupted[len(corrupted) // 2] ^= 0xFF
        source.write_bytes(bytes(corrupted))
        with self.assertRaisesRegex(PlatformParquetError, 'SOURCE_UNVERIFIED'):
            compaction.compact_small_files(other, producer_sha=SHA)
        with self.assertRaisesRegex(PlatformParquetError, 'COMPACTED_DESTINATION_ALREADY_EXISTS'):
            compaction.compact_small_files(dataset, producer_sha=SHA)
        with self.assertRaisesRegex(PlatformParquetError, 'PRODUCER_SHA_INVALID'):
            compaction.compact_small_files(dataset, producer_sha='bad')


if __name__ == '__main__':
    unittest.main()
