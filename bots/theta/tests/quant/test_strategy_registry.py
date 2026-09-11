"""Tests for bots/theta/quant/research/data/strategy_registry.json. Structural consistency only."""

import json
import unittest
from pathlib import Path

_REGISTRY_PATH = Path(__file__).resolve().parents[2] / "quant" / "research" / "data" / "strategy_registry.json"

_EXPECTED_BRANCH_IDS = {
    "THETA_CONVENTIONAL", "THETA_HOLD_STRIKE", "THETA_RECOVERY", "THETA_CC", "THETA_DEFINED_RISK",
}
_REQUIRED_FIELDS = {
    "strategy_id", "purpose", "lifecycle_applicability", "required_data", "optional_evidence",
    "candidate_lattice", "action_set", "hard_constraints", "soft_features", "management_policy_family",
    "promotion_state", "empirical_readiness", "supporting_evidence", "contradictory_evidence",
    "unresolved_assumptions",
}


def _load_registry():
    with open(_REGISTRY_PATH, encoding="utf-8") as f:
        return json.load(f)


class StrategyRegistryConsistencyTests(unittest.TestCase):
    def test_registry_file_is_valid_json(self):
        registry = _load_registry()
        self.assertIn("branches", registry)

    def test_exactly_the_five_canonical_runtime_branches_are_present(self):
        registry = _load_registry()
        branch_ids = {b["strategy_id"] for b in registry["branches"]}
        self.assertEqual(branch_ids, _EXPECTED_BRANCH_IDS)

    def test_every_branch_has_every_required_field(self):
        registry = _load_registry()
        for branch in registry["branches"]:
            missing = _REQUIRED_FIELDS - set(branch.keys())
            self.assertEqual(missing, set(), f"{branch.get('strategy_id')} is missing fields: {missing}")

    def test_no_branch_claims_empirical_readiness_is_ready(self):
        # EV_MODEL_NOT_EMPIRICALLY_READY must hold for every branch --
        # no branch record may silently claim otherwise.
        registry = _load_registry()
        for branch in registry["branches"]:
            self.assertEqual(branch["empirical_readiness"], "EV_MODEL_NOT_EMPIRICALLY_READY")

    def test_defined_risk_is_the_only_disabled_branch(self):
        registry = _load_registry()
        promotion_states = {b["strategy_id"]: b["promotion_state"] for b in registry["branches"]}
        self.assertEqual(promotion_states["THETA_DEFINED_RISK"], "DISABLED")
        for branch_id, state in promotion_states.items():
            if branch_id != "THETA_DEFINED_RISK":
                self.assertNotEqual(state, "DISABLED")


if __name__ == "__main__":
    unittest.main()
