"""Tests for bots/theta/quant/research/strategy_config.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.strategy_config import StrategyConfig  # noqa: E402


def _config(**overrides):
    defaults = dict(
        strategy_id="THETA_CONVENTIONAL", strategy_version="1.0.0", status="SHADOW",
        providers=("ALPACA", "OPTIONOMICS"), entry_model_version="v1", ownership_model_version="v1",
        management_model_version="v1", regime_model_version="v1", execution_model_version="v1",
        cost_model_version="v1", risk_limit_version="v1", feature_set_version="v1",
        candidate_lattice_dte=(25, 60), candidate_lattice_delta_bins=((0.20, 0.25), (0.25, 0.30)),
        event_policy="exclude_earnings", hard_rules=("known_multiplier", "fresh_broker_state"),
        soft_features=("trend", "iv_context"), management_policy_id="mgmt-v1", promotion_evidence_hash="evidence-v1",
    )
    defaults.update(overrides)
    return StrategyConfig(**defaults)


class StrategyConfigHashTests(unittest.TestCase):
    def test_identical_configs_hash_identically(self):
        self.assertEqual(_config().config_hash(), _config().config_hash())

    def test_a_changed_strategy_version_changes_the_hash(self):
        a, b = _config(), _config(strategy_version="1.0.1")
        self.assertNotEqual(a.config_hash(), b.config_hash())

    def test_a_changed_model_version_changes_the_hash(self):
        a, b = _config(), _config(entry_model_version="v2")
        self.assertNotEqual(a.config_hash(), b.config_hash())

    def test_a_changed_candidate_lattice_changes_the_hash(self):
        a, b = _config(), _config(candidate_lattice_dte=(30, 60))
        self.assertNotEqual(a.config_hash(), b.config_hash())

    def test_a_changed_hard_rule_changes_the_hash(self):
        a, b = _config(), _config(hard_rules=("known_multiplier",))
        self.assertNotEqual(a.config_hash(), b.config_hash())

    def test_hard_rules_hash_is_order_invariant(self):
        a = _config(hard_rules=("known_multiplier", "fresh_broker_state"))
        b = _config(hard_rules=("fresh_broker_state", "known_multiplier"))
        self.assertEqual(a.config_hash(), b.config_hash())

    def test_a_changed_promotion_evidence_hash_changes_the_config_hash(self):
        a, b = _config(), _config(promotion_evidence_hash="evidence-v2")
        self.assertNotEqual(a.config_hash(), b.config_hash())


if __name__ == "__main__":
    unittest.main()
