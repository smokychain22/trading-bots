import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.oos_manifest import assert_not_used_for_tuning, freeze_oos_manifest


def observed_at():
    return {'a': '2026-01-01T00:00:00Z', 'b': '2026-01-03T00:00:00Z', 'c': '2026-01-02T00:00:00Z'}


class OosManifestTests(unittest.TestCase):
    def test_freeze_records_provenance_and_date_bounds(self):
        manifest = freeze_oos_manifest(['a', 'b', 'c'], observed_at(), 'ds-hash', 'sha-1', 'split-v1')
        self.assertTrue(manifest['frozen'])
        self.assertEqual(manifest['finalOosIds'], ['a', 'b', 'c'])
        self.assertEqual(manifest['dateBounds']['start'], '2026-01-01T00:00:00+00:00')
        self.assertEqual(manifest['dateBounds']['end'], '2026-01-03T00:00:00+00:00')

    def test_deterministic_hash(self):
        m1 = freeze_oos_manifest(['a', 'b'], observed_at(), 'ds-hash', 'sha-1', 'split-v1')
        m2 = freeze_oos_manifest(['b', 'a'], observed_at(), 'ds-hash', 'sha-1', 'split-v1')
        self.assertEqual(m1, m2)

    def test_missing_provenance_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PROVENANCE_REQUIRED'):
            freeze_oos_manifest(['a'], observed_at(), '', 'sha-1', 'split-v1')

    def test_missing_observed_at_rejected(self):
        with self.assertRaisesRegex(ValueError, 'OBSERVED_AT_MISSING'):
            freeze_oos_manifest(['a', 'z'], observed_at(), 'ds-hash', 'sha-1', 'split-v1')

    def test_tuning_guard_raises_on_overlap(self):
        manifest = freeze_oos_manifest(['a', 'b'], observed_at(), 'ds-hash', 'sha-1', 'split-v1')
        with self.assertRaisesRegex(ValueError, 'TUNING_VIOLATION'):
            assert_not_used_for_tuning(['a', 'x'], manifest)

    def test_tuning_guard_passes_when_disjoint(self):
        manifest = freeze_oos_manifest(['a', 'b'], observed_at(), 'ds-hash', 'sha-1', 'split-v1')
        assert_not_used_for_tuning(['c', 'x'], manifest)  # no raise

    def test_unfrozen_manifest_rejected(self):
        with self.assertRaisesRegex(ValueError, 'NOT_FROZEN'):
            assert_not_used_for_tuning(['a'], {'finalOosIds': ['a'], 'frozen': False})


if __name__ == '__main__':
    unittest.main()
