import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.model_registry import ModelRegistry, build_registry_entry


def entry(model_version='v1', promotion_state='RESEARCH_FIT_NOT_PROMOTED', task='entry'):
    return build_registry_entry(
        task=task, model_version=model_version, source_sha='a' * 40, dataset_hash='b' * 64,
        feature_version='fv-1', label_version='lv-1', split_hash='c' * 64, hyperparam_hash='d' * 64,
        calibration={'PLATT': None}, metrics={'brier': 0.2}, promotion_state=promotion_state,
        created_at='2026-01-01T00:00:00Z',
    )


class ModelRegistryTests(unittest.TestCase):
    def test_nested_metadata_cannot_mutate_registered_identity(self):
        registry = ModelRegistry()
        original = entry()
        registry.register(original)
        original.metrics['brier'] = 0.9
        registry.get('entry', 'v1').metrics['brier'] = 0.8
        self.assertEqual(registry.get('entry', 'v1').metrics['brier'], 0.2)

    def test_register_and_get(self):
        registry = ModelRegistry()
        registry.register(entry())
        self.assertEqual(registry.get('entry', 'v1').model_version, 'v1')

    def test_version_is_immutable_once_registered(self):
        registry = ModelRegistry()
        registry.register(entry())
        with self.assertRaisesRegex(ValueError, 'IMMUTABLE'):
            registry.register(entry(promotion_state='MODEL_EMPIRICALLY_PROMOTED'))

    def test_reregistering_identical_entry_is_a_noop(self):
        registry = ModelRegistry()
        registry.register(entry())
        registry.register(entry())  # no raise -- identical hash

    def test_tampered_entry_hash_rejected(self):
        registry = ModelRegistry()
        tampered = entry()
        object.__setattr__(tampered, 'metrics', {'brier': 0.9})
        with self.assertRaisesRegex(ValueError, 'HASH_MISMATCH'):
            registry.register(tampered)

    def test_promoted_filters_by_state_and_task(self):
        registry = ModelRegistry()
        registry.register(entry(model_version='v1', promotion_state='RESEARCH_FIT_NOT_PROMOTED'))
        registry.register(entry(model_version='v2', promotion_state='MODEL_EMPIRICALLY_PROMOTED'))
        registry.register(entry(model_version='v3', promotion_state='MODEL_PAPER_RISK_ELIGIBLE', task='management'))
        self.assertEqual([e.model_version for e in registry.promoted('entry')], ['v2'])
        self.assertEqual(len(registry.promoted()), 2)

    def test_unsupported_promotion_state_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_PROMOTION_STATE'):
            entry(promotion_state='NOT_A_REAL_STATE')

    def test_missing_required_field_rejected(self):
        with self.assertRaisesRegex(ValueError, 'FIELD_REQUIRED'):
            build_registry_entry(task='', model_version='v1', source_sha='a', dataset_hash='b',
                feature_version='fv', label_version='lv', split_hash='sh', hyperparam_hash='hh',
                calibration={}, metrics={}, promotion_state='RESEARCH_FIT_NOT_PROMOTED', created_at='2026-01-01T00:00:00Z')


if __name__ == '__main__':
    unittest.main()
