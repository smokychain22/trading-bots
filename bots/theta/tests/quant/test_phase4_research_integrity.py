"""Phase 4 research-integrity properties: the truth-class firewall over the whole class space, the dependence-group effective-sample-size proxy
(it must never be inflated by repeated scans or relabelled decision ids), and randomized point-in-time leakage across the feature families.
Seeded and deterministic."""
import itertools
import random
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.truth_firewall import FORBIDDEN_SILENT_TRANSITIONS, assert_truth_class_transition_allowed
from research.dataset_readiness import DependenceGroupKey, build_dependence_groups, effective_sample_size
from research.pit_leakage_harness import assert_pit_invariant
from features.trend import moving_average_slope
from features.momentum import horizon_return
from features.realized_volatility import (
    close_to_close_realized_volatility, close_to_close_realized_volatility_result, ewma_volatility, parkinson_realized_volatility,
)

TRUTH_CLASSES = ('MARKET_OBSERVED', 'DERIVED_FROM_OBSERVED', 'MODELED_RESEARCH', 'SYNTHETIC_FIXTURE', 'RECONSTRUCTED', 'REAL_HISTORICAL',
                 'RESEARCH_BASELINE', 'BROKER_ACTUAL', 'PRODUCTION_CANONICAL')
COMPLETE_EVIDENCE = {'promotedBy': 'owner', 'promotedAt': '2026-01-01T00:00:00Z', 'evidenceReference': 'doc', 'promotionDecisionId': 'd1'}


class TruthFirewallExhaustiveTests(unittest.TestCase):
    def test_every_ordered_class_pair_only_the_forbidden_four_are_blocked_without_evidence(self):
        blocked = set()
        for source, target in itertools.product(TRUTH_CLASSES, repeat=2):
            try:
                self.assertIs(assert_truth_class_transition_allowed(source, target), True)
            except ValueError as error:
                self.assertIn('SILENT_PROMOTION_BLOCKED', str(error))
                blocked.add((source, target))
        self.assertEqual(blocked, set(FORBIDDEN_SILENT_TRANSITIONS))

    def test_no_single_missing_or_blank_evidence_field_unlocks_a_forbidden_transition(self):
        rng = random.Random(4001)
        for source, target in FORBIDDEN_SILENT_TRANSITIONS:
            for field in COMPLETE_EVIDENCE:
                for bad in (None, '', 0, False):
                    evidence = dict(COMPLETE_EVIDENCE)
                    evidence[field] = bad
                    with self.assertRaisesRegex(ValueError, 'PROMOTION_EVIDENCE_INCOMPLETE'):
                        assert_truth_class_transition_allowed(source, target, evidence)
            for _ in range(50):  # a truthy flag or unrelated keys are not evidence
                junk = {rng.choice(['approved', 'ok', 'force', 'promoted']): rng.choice([True, 1, 'yes']) for _ in range(3)}
                with self.assertRaises(ValueError):
                    assert_truth_class_transition_allowed(source, target, junk)
                with self.assertRaises(ValueError):
                    assert_truth_class_transition_allowed(source, target, {})
            self.assertIs(assert_truth_class_transition_allowed(source, target, COMPLETE_EVIDENCE), True)


def key(chain=None, episode=None, underlying=None, session=None, cluster=None):
    return DependenceGroupKey(chain, episode, underlying, session, cluster)


class EffectiveSampleSizeProperties(unittest.TestCase):
    def test_repeated_scans_of_one_symbol_session_never_inflate_n(self):
        for rows in (1, 10, 500, 5000):
            self.assertEqual(effective_sample_size([key(underlying='SPY', session='2026-10-01') for _ in range(rows)]), 1)

    def test_n_is_bounded_by_rows_and_invariant_to_order(self):
        rng = random.Random(4002)
        for _ in range(100):
            keys = [key(chain=rng.choice([None, 'c1', 'c2', 'c3']), episode=rng.choice([None, 'e1', 'e2']), underlying=rng.choice(['SPY', 'QQQ', None]),
                        session=rng.choice(['2026-10-01', '2026-10-02', None]), cluster=rng.choice([None, 'k1'])) for _ in range(rng.randint(1, 40))]
            n = effective_sample_size(keys)
            self.assertTrue(1 <= n <= len(keys))
            shuffled = list(keys)
            rng.shuffle(shuffled)
            self.assertEqual(effective_sample_size(shuffled), n)
            groups = build_dependence_groups(keys)
            self.assertEqual(sorted(i for members in groups.values() for i in members), list(range(len(keys))))

    def test_unidentified_rows_are_one_dependency_group_never_independent(self):
        self.assertEqual(effective_sample_size([key() for _ in range(1000)]), 1)

    def test_a_shared_chain_links_otherwise_distinct_sessions(self):
        keys = [key(chain='c1', underlying='SPY', session=f'2026-10-{day:02d}') for day in range(1, 11)]
        self.assertEqual(effective_sample_size(keys), 1)

    def test_distinct_everything_is_fully_independent(self):
        keys = [key(chain=f'c{i}', episode=f'e{i}', underlying=f'U{i}', session=f'2026-10-{i + 1:02d}', cluster=f'k{i}') for i in range(20)]
        self.assertEqual(effective_sample_size(keys), 20)

    def test_adding_a_row_never_increases_n_by_more_than_one(self):
        rng = random.Random(4003)
        keys = []
        previous = 0
        for _ in range(200):
            keys.append(key(chain=rng.choice([None] + [f'c{i}' for i in range(30)]), underlying=rng.choice(['SPY', 'QQQ', 'IWM', None]),
                            session=rng.choice([f'2026-10-{d:02d}' for d in range(1, 8)])))
            n = effective_sample_size(keys)
            self.assertLessEqual(n, previous + 1)
            previous = n


def random_series(rng, length=60):
    series = [100.0]
    for _ in range(length - 1):
        series.append(max(1.0, series[-1] * (1 + rng.uniform(-0.03, 0.03))))
    return series


class RandomizedPitLeakage(unittest.TestCase):
    """For 40 random series and random decision points, replacing every bar strictly after the decision point leaves the T0 result unchanged."""

    def test_trend_momentum_and_realized_volatility_over_random_series(self):
        rng = random.Random(4004)
        for _ in range(40):
            closes = random_series(rng)
            as_of = rng.randint(30, 45)
            mutated = list(closes)
            for index in range(as_of + 1, len(mutated)):
                mutated[index] = rng.choice([0.01, 1e6, closes[index] * rng.uniform(0.1, 10)])
            assert_pit_invariant(moving_average_slope, before_args=(closes, as_of, 10, 5, 100), after_args=(tuple(mutated), as_of, 10, 5, 100))
            assert_pit_invariant(horizon_return, before_args=(closes, as_of, 5, 100), after_args=(tuple(mutated), as_of, 5, 100))
            assert_pit_invariant(close_to_close_realized_volatility_result, before_args=(closes, as_of, 10, 252.0, 100),
                                 after_args=(tuple(mutated), as_of, 10, 252.0, 100))

    def test_window_estimators_given_only_the_visible_history_ignore_nothing_they_were_not_given(self):
        # The close-to-close, EWMA and Parkinson estimators take a plain trailing window: the caller slices at T0. Slicing at T0 must make the
        # result independent of any later bar, and a LATER bar must change a full-series result (proving the slice, not the estimator, is the guard).
        rng = random.Random(4005)
        for _ in range(40):
            closes = random_series(rng, 80)
            highs = [value * 1.01 for value in closes]
            lows = [value * 0.99 for value in closes]
            as_of = rng.randint(40, 60)
            visible = closes[:as_of + 1]
            future_changed = closes[:as_of + 1] + [rng.uniform(1, 500) for _ in range(len(closes) - as_of - 1)]
            assert_pit_invariant(lambda series: close_to_close_realized_volatility(series[:as_of + 1], 252.0, 10), before_args=(closes,), after_args=(future_changed,))
            assert_pit_invariant(lambda series: ewma_volatility(series[:as_of + 1]), before_args=(closes,), after_args=(future_changed,))
            assert_pit_invariant(lambda hi, lo: parkinson_realized_volatility(hi[:as_of + 1], lo[:as_of + 1], 252.0, 10), before_args=(highs, lows),
                                 after_args=(highs[:as_of + 1] + [900.0] * 5, lows[:as_of + 1] + [1.0] * 5))
            self.assertNotEqual(close_to_close_realized_volatility(future_changed, 252.0, 10), close_to_close_realized_volatility(visible, 252.0, 10))


if __name__ == '__main__':
    unittest.main()
