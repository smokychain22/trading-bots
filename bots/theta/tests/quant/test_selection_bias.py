"""Tests for bots/theta/quant/research/selection_bias.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.selection_bias import (  # noqa: E402
    DsrInputs,
    deflated_sharpe_ratio,
    probability_of_backtest_overfitting,
)


def _dsr_inputs(**overrides):
    defaults = dict(
        observed_sharpe=1.0, n_observations=252, skewness=0.0, kurtosis=3.0,  # kurtosis=3.0 is the normal-distribution baseline (Pearson convention)
        n_trials=1, variance_of_trial_sharpes=None,
    )
    defaults.update(overrides)
    return DsrInputs(**defaults)


class DsrTests(unittest.TestCase):
    def test_single_trial_no_deflation_applied(self):
        result = deflated_sharpe_ratio(_dsr_inputs(n_trials=1))
        self.assertEqual(result.expected_max_sharpe_under_multiple_testing, 0.0)
        self.assertIsNotNone(result.deflated_sharpe_ratio)

    def test_identical_strategy_repeated_many_times_is_penalized(self):
        # The SAME observed Sharpe, searched across a large number of
        # "trials" with real variance among them, must produce a LOWER
        # DSR than the single-trial case -- the multiple-testing hurdle
        # rises with n_trials.
        single_trial = deflated_sharpe_ratio(_dsr_inputs(n_trials=1))
        many_trials = deflated_sharpe_ratio(_dsr_inputs(n_trials=1000, variance_of_trial_sharpes=0.5))
        self.assertLess(many_trials.deflated_sharpe_ratio, single_trial.deflated_sharpe_ratio)

    def test_more_searched_variants_raise_the_hurdle_further(self):
        few_trials = deflated_sharpe_ratio(_dsr_inputs(n_trials=10, variance_of_trial_sharpes=0.5))
        many_trials = deflated_sharpe_ratio(_dsr_inputs(n_trials=10000, variance_of_trial_sharpes=0.5))
        self.assertLess(many_trials.deflated_sharpe_ratio, few_trials.deflated_sharpe_ratio)
        self.assertGreater(many_trials.expected_max_sharpe_under_multiple_testing, few_trials.expected_max_sharpe_under_multiple_testing)

    def test_a_higher_real_sharpe_improves_dsr_all_else_equal(self):
        lower = deflated_sharpe_ratio(_dsr_inputs(observed_sharpe=0.5))
        higher = deflated_sharpe_ratio(_dsr_inputs(observed_sharpe=2.0))
        self.assertGreater(higher.deflated_sharpe_ratio, lower.deflated_sharpe_ratio)

    def test_a_short_sample_receives_less_confidence_than_a_long_one(self):
        short = deflated_sharpe_ratio(_dsr_inputs(n_observations=20))
        long = deflated_sharpe_ratio(_dsr_inputs(n_observations=2000))
        # A short sample has a larger standard error, pulling DSR toward
        # 0.5 (less confident) versus a long sample's tighter estimate.
        self.assertLess(abs(short.deflated_sharpe_ratio - 0.5), abs(long.deflated_sharpe_ratio - 0.5) + 1e-9)

    def test_pathological_skew_kurtosis_fails_closed_rather_than_crashing(self):
        # A large positive skew combined with a high observed Sharpe and
        # minimal (platykurtic, kurt=1.0) kurtosis drives the Mertens
        # variance term negative -- must report None, never raise or
        # return a numerically garbage confidence.
        result = deflated_sharpe_ratio(_dsr_inputs(observed_sharpe=10.0, skewness=50.0, kurtosis=1.0, n_observations=10))
        self.assertIsNone(result.deflated_sharpe_ratio)
        self.assertTrue(len(result.reasons) > 0)

    def test_invalid_n_observations_fails_closed(self):
        result = deflated_sharpe_ratio(_dsr_inputs(n_observations=1))
        self.assertIsNone(result.deflated_sharpe_ratio)

    def test_invalid_n_trials_fails_closed(self):
        result = deflated_sharpe_ratio(_dsr_inputs(n_trials=0))
        self.assertIsNone(result.deflated_sharpe_ratio)

    def test_multiple_trials_without_a_variance_estimate_fails_closed_never_assumes_zero_variance(self):
        result = deflated_sharpe_ratio(_dsr_inputs(n_trials=50, variance_of_trial_sharpes=None))
        self.assertIsNone(result.deflated_sharpe_ratio)


class PboTests(unittest.TestCase):
    def test_a_stable_genuinely_superior_candidate_has_low_pbo(self):
        # Candidate 0 is uniformly and substantially better in EVERY
        # partition -- it should rank best both IS and OOS in every
        # combinatorial split.
        matrix = [
            [10.0, 11.0, 9.0, 10.5, 10.2, 9.8],  # candidate 0: consistently strong
            [1.0, -1.0, 2.0, -2.0, 0.5, -0.5],   # candidate 1: consistently weak/noisy
            [2.0, 1.0, -1.0, 0.0, 1.5, -2.0],    # candidate 2: consistently weak/noisy
        ]
        result = probability_of_backtest_overfitting(matrix)
        self.assertIsNotNone(result.probability_of_overfitting)
        self.assertLess(result.probability_of_overfitting, 0.3)

    def test_randomly_mined_candidates_with_no_real_edge_have_higher_pbo(self):
        # Candidates whose relative ranking flips unpredictably across
        # partitions (no real, persistent edge) should show a
        # meaningfully higher PBO than the stable-winner case above.
        matrix = [
            [5.0, -3.0, 4.0, -2.0, 1.0, -1.0],
            [-2.0, 4.0, -3.0, 5.0, -1.0, 2.0],
            [1.0, 1.0, -1.0, -1.0, 3.0, -3.0],
            [-1.0, -1.0, 1.0, 1.0, -3.0, 3.0],
        ]
        stable = probability_of_backtest_overfitting([
            [10.0, 11.0, 9.0, 10.5, 10.2, 9.8],
            [1.0, -1.0, 2.0, -2.0, 0.5, -0.5],
            [2.0, 1.0, -1.0, 0.0, 1.5, -2.0],
        ])
        mined = probability_of_backtest_overfitting(matrix)
        self.assertGreater(mined.probability_of_overfitting, stable.probability_of_overfitting)

    def test_an_is_best_candidate_that_inverts_oos_has_high_pbo(self):
        # Candidate 0 wins every IS half but LOSES every OOS half by
        # construction -- a textbook inverted-ranking overfitting case.
        matrix = [
            [10.0, 10.0, 10.0, -10.0, -10.0, -10.0],
            [0.0, 0.0, 0.0, 10.0, 10.0, 10.0],
        ]
        result = probability_of_backtest_overfitting(matrix)
        self.assertIsNotNone(result.probability_of_overfitting)
        self.assertGreater(result.probability_of_overfitting, 0.5)

    def test_insufficient_candidate_count_is_unknown_not_a_fabricated_zero(self):
        result = probability_of_backtest_overfitting([[1.0, 2.0, 3.0, 4.0]], min_candidates=2)
        self.assertIsNone(result.probability_of_overfitting)

    def test_insufficient_time_partitions_is_unknown(self):
        result = probability_of_backtest_overfitting([[1.0], [2.0]], min_partitions=2)
        self.assertIsNone(result.probability_of_overfitting)

    def test_odd_number_of_partitions_is_unknown_never_silently_truncated(self):
        matrix = [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
        result = probability_of_backtest_overfitting(matrix)
        self.assertIsNone(result.probability_of_overfitting)


if __name__ == "__main__":
    unittest.main()
