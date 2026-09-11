"""Tests for bots/theta/quant/research/reproducibility.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.reproducibility import (  # noqa: E402
    ExperimentResultContract,
    hash_dataset,
    hash_feature_set,
)


def _contract(**overrides):
    defaults = dict(
        model_id="theta-q-v1", dataset_hash="d1", feature_set_hash="f1",
        target_version="target-v1", split_plan_hash="s1", source_code_sha="abc123",
        ev_net=10.0, win_probability=0.55, calibration_ece=0.02, expected_shortfall=-50.0,
        value_at_risk=-30.0, max_drawdown_pct=0.15, return_per_capital_day=0.001,
        assignment_rate=0.2, model_uncertainty=2.0,
    )
    defaults.update(overrides)
    return ExperimentResultContract(**defaults)


class FeatureSetHashTests(unittest.TestCase):
    def test_hash_is_invariant_to_input_order(self):
        h1 = hash_feature_set(["iv_rank", "delta", "dte"])
        h2 = hash_feature_set(["dte", "iv_rank", "delta"])
        self.assertEqual(h1, h2)

    def test_hash_is_invariant_to_duplicate_entries(self):
        h1 = hash_feature_set(["iv_rank", "delta"])
        h2 = hash_feature_set(["iv_rank", "delta", "delta"])
        self.assertEqual(h1, h2)

    def test_a_different_feature_set_produces_a_different_hash(self):
        h1 = hash_feature_set(["iv_rank", "delta"])
        h2 = hash_feature_set(["iv_rank", "delta", "gex"])
        self.assertNotEqual(h1, h2)


class DatasetHashTests(unittest.TestCase):
    def test_hash_is_invariant_to_row_order(self):
        rows = [{"chain_id": "a", "pnl": 10.0}, {"chain_id": "b", "pnl": -5.0}]
        h1 = hash_dataset(rows)
        h2 = hash_dataset(list(reversed(rows)))
        self.assertEqual(h1, h2)

    def test_changing_a_single_record_changes_the_hash(self):
        rows_a = [{"chain_id": "a", "pnl": 10.0}, {"chain_id": "b", "pnl": -5.0}]
        rows_b = [{"chain_id": "a", "pnl": 10.0}, {"chain_id": "b", "pnl": -5.01}]
        self.assertNotEqual(hash_dataset(rows_a), hash_dataset(rows_b))

    def test_adding_a_record_changes_the_hash(self):
        rows_a = [{"chain_id": "a", "pnl": 10.0}]
        rows_b = [{"chain_id": "a", "pnl": 10.0}, {"chain_id": "b", "pnl": -5.0}]
        self.assertNotEqual(hash_dataset(rows_a), hash_dataset(rows_b))


class ExperimentFingerprintTests(unittest.TestCase):
    def test_identical_identity_fields_produce_the_identical_fingerprint(self):
        a = _contract()
        b = _contract(ev_net=999.0, win_probability=0.99)  # metrics differ, identity fields don't
        self.assertEqual(a.experiment_fingerprint(), b.experiment_fingerprint())

    def test_a_changed_feature_set_hash_changes_the_fingerprint(self):
        a = _contract()
        b = _contract(feature_set_hash="f2")
        self.assertNotEqual(a.experiment_fingerprint(), b.experiment_fingerprint())

    def test_a_changed_target_version_changes_the_fingerprint(self):
        a = _contract()
        b = _contract(target_version="target-v2")
        self.assertNotEqual(a.experiment_fingerprint(), b.experiment_fingerprint())

    def test_a_changed_split_plan_hash_changes_the_fingerprint(self):
        a = _contract()
        b = _contract(split_plan_hash="s2")
        self.assertNotEqual(a.experiment_fingerprint(), b.experiment_fingerprint())

    def test_a_changed_dataset_hash_changes_the_fingerprint(self):
        a = _contract()
        b = _contract(dataset_hash="d2")
        self.assertNotEqual(a.experiment_fingerprint(), b.experiment_fingerprint())

    def test_a_changed_source_code_sha_changes_the_fingerprint(self):
        a = _contract()
        b = _contract(source_code_sha="def456")
        self.assertNotEqual(a.experiment_fingerprint(), b.experiment_fingerprint())


if __name__ == "__main__":
    unittest.main()
