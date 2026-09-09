"""Unit tests for bots/theta/quant/expert_priors/weighting.py.

Run with (from the repo root, once a Python toolchain is set up):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
or point pytest at bots/theta/tests/quant/. Stdlib unittest only -- no
pytest dependency required.
"""

import sys
import unittest
from pathlib import Path

# Path-based import so this test does not depend on however the Python
# package/build tooling (Phase 0, Codex-owned) ends up wiring imports.
_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from expert_priors.weighting import (  # noqa: E402
    ExpertWeightFactors,
    WeightedExpertOpinion,
    expert_prior,
    raw_expert_weight,
    shrunk_weight,
)


class RawExpertWeightTests(unittest.TestCase):
    def test_all_ones_gives_one(self):
        factors = ExpertWeightFactors(1.0, 1.0, 1.0, 1.0, 1.0, 1.0)
        self.assertEqual(raw_expert_weight(factors), 1.0)

    def test_product_of_six_factors(self):
        factors = ExpertWeightFactors(
            data_quality=0.8,
            sample_confidence=0.5,
            regime_fit=0.9,
            recency=1.0,
            independence=0.7,
            transferability=0.6,
        )
        self.assertAlmostEqual(raw_expert_weight(factors), 0.1512, places=10)

    def test_negative_factor_rejected(self):
        with self.assertRaises(ValueError):
            ExpertWeightFactors(-0.1, 1.0, 1.0, 1.0, 1.0, 1.0)

    def test_zero_factor_is_allowed_and_zeroes_the_product(self):
        factors = ExpertWeightFactors(0.0, 1.0, 1.0, 1.0, 1.0, 1.0)
        self.assertEqual(raw_expert_weight(factors), 0.0)


class ShrunkWeightTests(unittest.TestCase):
    def test_shrinkage_reduces_weight_for_small_n(self):
        self.assertAlmostEqual(shrunk_weight(1.0, n=10, k_shrink=5), 10 / 15)

    def test_exact_value(self):
        self.assertAlmostEqual(shrunk_weight(0.1512, n=50, k_shrink=10), 0.126, places=10)

    def test_large_n_approaches_raw_weight(self):
        result = shrunk_weight(1.0, n=1_000_000, k_shrink=5)
        self.assertGreater(result, 0.999)

    def test_k_shrink_must_be_positive(self):
        with self.assertRaises(ValueError):
            shrunk_weight(1.0, n=10, k_shrink=0)
        with self.assertRaises(ValueError):
            shrunk_weight(1.0, n=10, k_shrink=-1)

    def test_negative_raw_weight_rejected(self):
        with self.assertRaises(ValueError):
            shrunk_weight(-0.1, n=10, k_shrink=5)

    def test_negative_n_rejected(self):
        with self.assertRaises(ValueError):
            shrunk_weight(1.0, n=-1, k_shrink=5)

    def test_no_hardcoded_default_for_k_shrink(self):
        # shrunk_weight has no default value for k_shrink -- calling without
        # it must be a TypeError, not a silently-applied constant.
        with self.assertRaises(TypeError):
            shrunk_weight(1.0, n=10)  # type: ignore[call-arg]


class ExpertPriorTests(unittest.TestCase):
    def test_two_expert_blend(self):
        opinions = [
            WeightedExpertOpinion("expert_a", shrunk_weight=0.6, p_action=0.7),
            WeightedExpertOpinion("expert_b", shrunk_weight=0.4, p_action=0.3),
        ]
        self.assertAlmostEqual(expert_prior(opinions), 0.54, places=10)

    def test_unknown_opinion_excluded_not_zeroed(self):
        opinions = [
            WeightedExpertOpinion("expert_a", shrunk_weight=0.5, p_action=None),
            WeightedExpertOpinion("expert_b", shrunk_weight=0.5, p_action=0.8),
        ]
        # If the UNKNOWN opinion were coerced to 0.0 instead of excluded, this
        # would come out to 0.4, not 0.8.
        self.assertAlmostEqual(expert_prior(opinions), 0.8, places=10)

    def test_no_usable_evidence_returns_none_not_zero(self):
        opinions = [
            WeightedExpertOpinion("expert_a", shrunk_weight=0.0, p_action=0.9),
            WeightedExpertOpinion("expert_b", shrunk_weight=0.5, p_action=None),
        ]
        self.assertIsNone(expert_prior(opinions))

    def test_empty_opinions_returns_none(self):
        self.assertIsNone(expert_prior([]))


if __name__ == "__main__":
    unittest.main()
