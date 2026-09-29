import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.reproducibility_bundle import build_reproducibility_bundle, verify_reproducibility_bundle


def fields(**overrides):
    base = dict(sourceSha='a' * 40, datasetHash='b' * 64, configHash='c' * 64, featureVersion='fv-1',
        labelVersion='lv-1', modelVersion='mv-1', splitHash='d' * 64, seed=42,
        experimentId='EXP-1', metricHash='e' * 64)
    base.update(overrides)
    return base


class ReproducibilityBundleTests(unittest.TestCase):
    def test_builds_and_verifies(self):
        bundle = build_reproducibility_bundle(**fields())
        self.assertTrue(verify_reproducibility_bundle(bundle))

    def test_missing_field_rejected(self):
        values = fields(); values.pop('datasetHash')
        with self.assertRaisesRegex(ValueError, 'FIELD_REQUIRED:datasetHash'):
            build_reproducibility_bundle(**values)

    def test_non_int_seed_rejected(self):
        with self.assertRaisesRegex(ValueError, 'SEED_MUST_BE_INT'):
            build_reproducibility_bundle(**fields(seed=42.0))

    def test_tampered_bundle_fails_verification(self):
        bundle = build_reproducibility_bundle(**fields())
        tampered = {**bundle, 'metricHash': 'f' * 64}
        self.assertFalse(verify_reproducibility_bundle(tampered))

    def test_deterministic_hash(self):
        self.assertEqual(build_reproducibility_bundle(**fields()), build_reproducibility_bundle(**fields()))


if __name__ == '__main__':
    unittest.main()
