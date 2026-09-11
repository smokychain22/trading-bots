"""Tests for bots/theta/quant/research/feature_taxonomy.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.feature_taxonomy import (  # noqa: E402
    FEATURE_DESTINATION_MAP,
    FeatureFamily,
    FeatureRole,
    classify,
    count_by_family,
    count_by_role,
    features_eligible_for_entry_gating,
)


class CountByFamilyTests(unittest.TestCase):
    def test_every_family_appears_in_the_count_even_if_zero(self):
        counts = count_by_family()
        for family in FeatureFamily:
            self.assertIn(family, counts)

    def test_family_counts_sum_to_the_total_registry_size(self):
        counts = count_by_family()
        self.assertEqual(sum(counts.values()), len(FEATURE_DESTINATION_MAP))

    def test_a_feature_carries_both_a_role_and_a_family(self):
        destination = classify("ownership_acceptability")
        self.assertEqual(destination.role, FeatureRole.SOFT_FEATURE)
        self.assertEqual(destination.family, FeatureFamily.OWNERSHIP)


class ClassifyTests(unittest.TestCase):
    def test_a_known_feature_returns_its_registered_destination(self):
        destination = classify("ownership_acceptability")
        self.assertIsNotNone(destination)
        self.assertEqual(destination.role, FeatureRole.SOFT_FEATURE)

    def test_an_unregistered_feature_returns_none_never_a_default_role(self):
        self.assertIsNone(classify("some_feature_never_classified"))


class CountByRoleTests(unittest.TestCase):
    def test_every_role_appears_in_the_count_even_if_zero(self):
        counts = count_by_role()
        for role in FeatureRole:
            self.assertIn(role, counts)

    def test_counts_sum_to_the_total_registry_size(self):
        counts = count_by_role()
        self.assertEqual(sum(counts.values()), len(FEATURE_DESTINATION_MAP))


class EntryGatingEligibilityTests(unittest.TestCase):
    def test_management_only_features_are_excluded_from_entry_gating(self):
        eligible = features_eligible_for_entry_gating()
        self.assertNotIn("recovery_median", eligible)  # MANAGEMENT_ONLY_FEATURE

    def test_risk_only_features_are_excluded_from_entry_gating(self):
        eligible = features_eligible_for_entry_gating()
        self.assertNotIn("concentration_cluster_exposure", eligible)  # RISK_ONLY_FEATURE

    def test_execution_only_features_are_excluded_from_entry_gating(self):
        eligible = features_eligible_for_entry_gating()
        self.assertNotIn("quote_spread", eligible)  # EXECUTION_ONLY_FEATURE

    def test_soft_features_are_included_in_entry_gating(self):
        eligible = features_eligible_for_entry_gating()
        self.assertIn("ownership_acceptability", eligible)

    def test_structure_router_inputs_are_included(self):
        eligible = features_eligible_for_entry_gating()
        self.assertIn("lifecycle_state", eligible)

    def test_entry_gating_eligible_set_is_strictly_smaller_than_the_full_registry(self):
        # The whole point of this taxonomy: not every registered feature
        # is entry-gate-eligible.
        eligible = features_eligible_for_entry_gating()
        self.assertLess(len(eligible), len(FEATURE_DESTINATION_MAP))


class SoftBonusPenaltyDirectionalityTests(unittest.TestCase):
    def test_a_soft_bonus_feature_is_documented_as_one_directional(self):
        destination = classify("sweep_classification")
        self.assertEqual(destination.role, FeatureRole.SOFT_BONUS)

    def test_a_soft_penalty_feature_is_documented_as_one_directional(self):
        destination = classify("severe_drawdown_probability")
        self.assertEqual(destination.role, FeatureRole.SOFT_PENALTY)


if __name__ == "__main__":
    unittest.main()
