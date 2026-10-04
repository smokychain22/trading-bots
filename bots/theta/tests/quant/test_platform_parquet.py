"""Platform Parquet archive: lossless typed columnar conversion with exact row parity, text fallback for non-round-tripping scalars, date partitioning,
small-file accounting and tamper detection. Synthetic data only."""
import gzip
import json
import shutil
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.platform_parquet import PlatformParquetError, convert_archive, load_manifest, verify_files  # noqa: E402

SHA = 'a' * 40


def write_chunks(directory: Path, rows, per_chunk=50):
    paths = []
    for index in range(0, len(rows), per_chunk):
        path = directory / f'chunk-{index // per_chunk + 1:05d}.ndjson.gz'
        with gzip.open(path, 'wt', encoding='utf-8') as stream:
            for row in rows[index:index + per_chunk]:
                stream.write(row + '\n')
        paths.append(path)
    return paths


def make_rows(count=300):
    rows = []
    for index in range(count):
        day = 20 + index % 4
        rows.append(json.dumps({
            'candidate_id': f'00000000-0000-4000-8000-{index:012d}',
            'decision_time': f'2026-09-{day}T15:{index % 60:02d}:00.123456+00:00',
            'rank': index,
            'strike': 400 + (index % 50) * 2.5,
            'premium': f'{index}.12500000' if False else index + 0.125,
            'ok': index % 2 == 0,
            'reason': None if index % 5 else 'SPREAD_TOO_WIDE',
            'notes': 'unicode-é-日本' if index % 7 == 0 else 'plain',
            'detail_json': {'legs': [{'k': index, 'v': 'x' * 20}], 'nested': {'a': [1, 2, {'b': None}]}, 'amount': index * 3.5},
        }, sort_keys=True))
    return rows


class PlatformParquetTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='theta-pq-'))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def convert(self, rows, **overrides):
        chunks = write_chunks(self.root, rows)
        out = self.root / 'out'
        return convert_archive(chunks, out, dataset='candidates', time_column='decision_time', key_column='candidate_id',
                               source_population_digest='d' * 64, producer_sha=SHA, **overrides), out

    def test_round_trip_is_exact_typed_partitioned_zstd_and_verifiable(self):
        manifest_path, out = self.convert(make_rows())
        manifest = load_manifest(manifest_path)
        self.assertEqual(manifest['rowCount'], 300)
        self.assertEqual(manifest['compression'], 'ZSTD')
        self.assertEqual(manifest['partitioning'], 'HIVE:dp_session_date')
        self.assertEqual(manifest['fileCount'], 4)  # four session dates
        types = {entry['column']: entry['type'] for entry in manifest['schema']}
        self.assertEqual(types['rank'], 'BIGINT')
        self.assertEqual(types['ok'], 'BOOLEAN')
        self.assertEqual(types['detail_json'], 'JSON')
        self.assertTrue(types['decision_time'].startswith('TIMESTAMP'))
        rows, problems = verify_files(manifest_path, out)
        self.assertEqual((rows, problems), (300, []))
        self.assertTrue(all(entry['small'] for entry in manifest['files']), 'tiny test files are accounted as small files')
        self.assertEqual(manifest['smallFileCount'], manifest['fileCount'])
        self.assertFalse(manifest['tradingAuthority'])

    def test_a_decimal_that_cannot_round_trip_as_double_is_stored_as_text_not_rounded(self):
        rows = make_rows(120)
        wide = [json.dumps({**json.loads(row), 'precise': Decimal('0.123456789012345678901234')}, default=str) for row in rows]
        # build the JSON by hand so the long decimal stays a JSON number
        wide = [row[:-1] + ', "precise": 0.123456789012345678901234}' for row in rows]
        manifest_path, out = self.convert(wide)
        manifest = load_manifest(manifest_path)
        self.assertIn('precise', manifest['textColumns'])
        self.assertEqual(verify_files(manifest_path, out), (120, []))

    def test_tampering_with_a_parquet_file_is_detected(self):
        manifest_path, out = self.convert(make_rows(80))
        manifest = load_manifest(manifest_path)
        target = out / manifest['files'][0]['file']
        data = bytearray(target.read_bytes())
        data[len(data) // 2] ^= 0xFF
        target.write_bytes(bytes(data))
        _, problems = verify_files(manifest_path, out)
        self.assertTrue(any(problem.startswith('HASH_MISMATCH') for problem in problems))
        manifest_text = manifest_path.read_text(encoding='utf-8').replace('"rowCount": 80', '"rowCount": 81')
        manifest_path.write_text(manifest_text, encoding='utf-8')
        with self.assertRaisesRegex(PlatformParquetError, 'MANIFEST_HASH_MISMATCH'):
            load_manifest(manifest_path)

    def test_columnar_storage_is_smaller_than_the_json_archive_for_tabular_data(self):
        rows = make_rows(3000)
        chunks = write_chunks(self.root, rows, per_chunk=1000)
        json_bytes = sum(path.stat().st_size for path in chunks)
        manifest_path = convert_archive(chunks, self.root / 'out', dataset='c', time_column='decision_time', key_column='candidate_id', source_population_digest='d' * 64, producer_sha=SHA)
        self.assertLess(load_manifest(manifest_path)['totalBytes'], json_bytes * 1.2)

    def test_refuses_an_existing_destination_a_bad_producer_sha_and_no_input(self):
        manifest_path, out = self.convert(make_rows(30))
        with self.assertRaisesRegex(PlatformParquetError, 'ALREADY_EXISTS'):
            convert_archive(write_chunks(self.root / 'out', make_rows(10)), out, dataset='candidates', time_column='decision_time', key_column='candidate_id', source_population_digest='d' * 64, producer_sha=SHA)
        with self.assertRaisesRegex(PlatformParquetError, 'PRODUCER_SHA_INVALID'):
            convert_archive([manifest_path], self.root / 'x', dataset='d', time_column='decision_time', key_column='k', source_population_digest='d' * 64, producer_sha='short')
        with self.assertRaisesRegex(PlatformParquetError, 'NO_ARCHIVE_CHUNKS'):
            convert_archive([], self.root / 'y', dataset='d', time_column='decision_time', key_column='k', source_population_digest='d' * 64, producer_sha=SHA)


if __name__ == '__main__':
    unittest.main()
