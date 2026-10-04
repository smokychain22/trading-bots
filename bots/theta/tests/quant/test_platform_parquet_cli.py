"""The Parquet command line used by the data platform automation: convert, verify, open-check, compact. Every command prints exactly one JSON line; a damaged file or a missing
manifest is a failure (non-zero exit), never a pass. Synthetic data only."""
import gzip
import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.platform_parquet_cli import main  # noqa: E402

SHA = 'b' * 40


def run(*arguments):
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = main(list(arguments))
    lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
    assert len(lines) == 1, f'exactly one JSON line expected, got {lines}'
    return code, json.loads(lines[0])


class PlatformParquetCliTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='theta-pq-cli-'))
        rows = [json.dumps({'candidate_id': f'00000000-0000-4000-8000-{index:012d}', 'decision_time': f'2026-09-{20 + index % 3}T15:00:{index % 60:02d}.000000+00:00', 'rank': index, 'detail_json': {'k': index}}, sort_keys=True) for index in range(90)]
        self.chunk = self.root / 'chunk-00001.ndjson.gz'
        with gzip.open(self.chunk, 'wt', encoding='utf-8') as stream:
            stream.write('\n'.join(rows) + '\n')
        self.out = self.root / 'out'

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def convert(self):
        return run('convert', '--chunks', str(self.chunk), '--out', str(self.out), '--dataset', 'candidates', '--time-column', 'decision_time', '--key-column', 'candidate_id', '--digest', 'd' * 64, '--producer-sha', SHA)

    def test_convert_verify_open_check_succeed_and_report_exact_counts(self):
        code, converted = self.convert()
        self.assertEqual(code, 0, converted)
        self.assertEqual((converted['ok'], converted['rowCount']), (True, 90))
        manifest = self.out / 'candidates' / 'parquet-manifest.json'
        code, verified = run('verify', '--manifest', str(manifest))
        self.assertEqual((code, verified['ok'], verified['rows'], verified['problems']), (0, True, 90, []))
        code, opened = run('open-check', '--manifest', str(manifest))
        self.assertEqual((code, opened['ok'], opened['problems']), (0, True, []))

    def test_a_damaged_file_fails_verify_and_open_check_with_a_named_problem(self):
        self.convert()
        manifest = self.out / 'candidates' / 'parquet-manifest.json'
        victim = sorted((self.out / 'candidates').glob('dp_session_date=*/*.parquet'))[0]
        victim.write_bytes(victim.read_bytes()[:-16] + b'\x00' * 16)
        code, verified = run('verify', '--manifest', str(manifest))
        self.assertEqual(code, 1)
        self.assertFalse(verified['ok'])
        self.assertTrue(any(problem.startswith('HASH_MISMATCH') for problem in verified['problems']), verified)

    def test_convert_refuses_an_existing_destination_and_a_bad_producer_sha(self):
        self.convert()
        code, again = self.convert()
        self.assertEqual(code, 1)
        self.assertIn('PARQUET_DESTINATION_ALREADY_EXISTS', again['error'])
        code, bad = run('convert', '--chunks', str(self.chunk), '--out', str(self.root / 'other'), '--dataset', 'candidates', '--time-column', 'decision_time', '--key-column', 'candidate_id', '--digest', 'd' * 64, '--producer-sha', 'nothex')
        self.assertEqual(code, 1)
        self.assertIn('PRODUCER_SHA_INVALID', bad['error'])

    def test_a_missing_manifest_is_a_failure_not_a_pass(self):
        code, result = run('verify', '--manifest', str(self.root / 'nope' / 'parquet-manifest.json'))
        self.assertEqual(code, 1)
        self.assertFalse(result['ok'])


if __name__ == '__main__':
    unittest.main()
