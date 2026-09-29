import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.storage_classification import classify_artifact


class StorageClassificationTests(unittest.TestCase):
    def test_code_is_source_control(self):
        self.assertEqual(classify_artifact('CODE').storageClass, 'SOURCE_CONTROL')

    def test_converted_historical_rows_are_archive_never_source_control(self):
        self.assertEqual(classify_artifact('CONVERTED_HISTORICAL_ROWS').storageClass, 'ARCHIVE')

    def test_small_manifest_stays_source_control(self):
        result = classify_artifact('MANIFEST', size_bytes=2048)
        self.assertEqual(result.storageClass, 'SOURCE_CONTROL')

    def test_oversized_manifest_forced_to_archive_never_committed(self):
        result = classify_artifact('MANIFEST', size_bytes=5_000_000)
        self.assertEqual(result.storageClass, 'ARCHIVE')
        self.assertIn('NEVER_COMMITTED_TO_GIT', result.reason)

    def test_scratch_file_is_ephemeral(self):
        self.assertEqual(classify_artifact('SCRATCH_FILE').storageClass, 'EPHEMERAL')

    def test_db_handoff_manifest_classification(self):
        self.assertEqual(classify_artifact('DB_HANDOFF_MANIFEST').storageClass, 'COMPACT_DB_HANDOFF')

    def test_unknown_kind_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_ARTIFACT_KIND'):
            classify_artifact('NOT_A_REAL_KIND')


if __name__ == '__main__':
    unittest.main()
