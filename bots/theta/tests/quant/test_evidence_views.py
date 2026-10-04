"""One logical dataset over two tiers: hot rows win on overlap, cold rows fill history, an unverified cold archive is refused."""
import gzip
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.evidence_views import attach_logical_datasets  # noqa: E402
from research.platform_parquet import PlatformParquetError, convert_archive  # noqa: E402

SHA = 'b' * 40


def write_chunk(directory: Path, rows):
    path = directory / 'chunk-00001.ndjson.gz'
    with gzip.open(path, 'wt', encoding='utf-8') as stream:
        for row in rows:
            stream.write(json.dumps(row, sort_keys=True) + '\n')
    return path


def rows(start, count, day):
    return [{'candidate_id': f'00000000-0000-4000-8000-{start + index:012d}', 'decision_time': f'2026-09-{day}T15:00:{index % 60:02d}+00:00', 'rank': index, 'detail_json': {'i': index}} for index in range(count)]


class EvidenceViewTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='theta-views-'))
        self.cold_rows = rows(0, 40, 21) + rows(40, 40, 22)
        self.chunk = write_chunk(self.root, self.cold_rows)
        self.parquet = self.root / 'parquet'
        convert_archive([self.chunk], self.parquet, dataset='candidates', time_column='decision_time', key_column='candidate_id', source_population_digest='d' * 64, producer_sha=SHA)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_cold_only_view_counts_every_archived_row(self):
        connection = duckdb.connect()
        self.assertEqual(attach_logical_datasets(connection, self.parquet, {}), ['candidates'])
        self.assertEqual(connection.execute("SELECT count(*), count(DISTINCT tier) FROM candidates").fetchone(), (80, 1))

    def test_hot_rows_win_on_overlap_and_new_rows_appear_once(self):
        connection = duckdb.connect()
        overlap = rows(60, 10, 22)    # the last ten cold rows are also still hot (an archived but not yet retired partition)
        fresh = rows(80, 15, 23)      # new data that is hot only
        hot = overlap + fresh
        connection.execute("CREATE TABLE hot_candidates(candidate_id UUID, decision_time TIMESTAMPTZ, rank BIGINT, detail_json JSON)")
        for row in hot:
            connection.execute("INSERT INTO hot_candidates VALUES (?, ?, ?, ?)", [row['candidate_id'], row['decision_time'], row['rank'] + 1000, json.dumps(row['detail_json'])])
        attach_logical_datasets(connection, self.parquet, {}, {'candidates': 'hot_candidates'})
        total, tiers = connection.execute("SELECT count(*), count(DISTINCT tier) FROM candidates").fetchone()
        self.assertEqual(total, 80 + 15)                          # 80 cold + 15 fresh; the 10 overlapping keys appear once
        self.assertEqual(tiers, 2)
        self.assertEqual(connection.execute("SELECT count(*) FROM (SELECT candidate_id FROM candidates GROUP BY 1 HAVING count(*) > 1)").fetchone()[0], 0)
        winner = connection.execute("SELECT tier, rank FROM candidates WHERE candidate_id = ?", [overlap[0]['candidate_id']]).fetchone()
        self.assertEqual(winner[0], 'HOT')
        self.assertGreaterEqual(winner[1], 1000)

    def test_an_unverified_cold_archive_is_refused(self):
        target = next((self.parquet / 'candidates').glob('dp_session_date=*/*.parquet'))
        data = bytearray(target.read_bytes())
        data[len(data) // 2] ^= 0xFF
        target.write_bytes(bytes(data))
        with self.assertRaisesRegex(PlatformParquetError, 'COLD_ARCHIVE_UNVERIFIED'):
            attach_logical_datasets(duckdb.connect(), self.parquet, {})


if __name__ == '__main__':
    unittest.main()
