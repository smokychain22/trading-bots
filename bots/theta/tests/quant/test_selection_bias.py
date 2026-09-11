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

    def test_tied_oos_scores_use_symmetric_average_rank_not_an_order_dependent_position(self):
        # A: wins IS split 1, ties with B for worst OOS in that split.
        # C: wins IS split 2, ties with B for worst OOS in that split.
        # The two splits are symmetric by construction (each IS-winner
        # ties for worst-OOS with the same middle candidate B) -- a
        # correct, order-independent rank must treat both splits
        # identically. An earlier version of this function broke the tie
        # by raw sort-stability position, which favored whichever
        # candidate happened to sit at a lower original index and
        # produced a different (and wrong) PBO of 0.5 instead of 1.0 for
        # this exact matrix.
        matrix = [
            [10.0, 2.0],
            [1.0, 2.0],
            [1.0, 8.0],
        ]
        result = probability_of_backtest_overfitting(matrix)
        self.assertAlmostEqual(result.probability_of_overfitting, 1.0)
        self.assertEqual(len(result.logit_values), 2)
        for logit in result.logit_values:
            self.assertAlmostEqual(logit, 0.0)  # relative_rank=0.5 exactly for both symmetric splits


class DsrNumericalFixtureTests(unittest.TestCase):
    """Independently-computed expected values -- these tests reimplement
    the DSR formula inline (via math.erf directly, never calling the
    module's own _normal_inverse_cdf/_normal_cdf helpers) so a bug shared
    between the implementation and a monotonic-only test cannot hide."""

    def test_dsr_matches_an_independently_computed_value_with_no_multiple_testing(self):
        import math

        sr, n, skew, kurt = 0.8, 60, -0.3, 4.5
        variance_term = (1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr) / (n - 1)
        se = math.sqrt(variance_term)
        expected_dsr = 0.5 * (1.0 + math.erf((sr / se) / math.sqrt(2.0)))

        result = deflated_sharpe_ratio(_dsr_inputs(observed_sharpe=sr, n_observations=n, skewness=skew, kurtosis=kurt, n_trials=1))
        self.assertAlmostEqual(result.deflated_sharpe_ratio, expected_dsr, places=9)

    def test_expected_max_sharpe_scales_with_standard_deviation_not_variance(self):
        # Regression test for the variance-vs-standard-deviation bug: the
        # expected-max-Sharpe hurdle must scale by sqrt(variance), so
        # quadrupling variance_of_trial_sharpes (1.0 -> 4.0) must exactly
        # DOUBLE the hurdle, not quadruple it.
        base = deflated_sharpe_ratio(_dsr_inputs(n_trials=100, variance_of_trial_sharpes=1.0))
        quadrupled_variance = deflated_sharpe_ratio(_dsr_inputs(n_trials=100, variance_of_trial_sharpes=4.0))
        ratio = quadrupled_variance.expected_max_sharpe_under_multiple_testing / base.expected_max_sharpe_under_multiple_testing
        self.assertAlmostEqual(ratio, 2.0, places=9)


if __name__ == "__main__":
    unittest.main()
