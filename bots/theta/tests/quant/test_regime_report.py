"""Tests for bots/theta/quant/research/regime_report.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.regime_report import (  # noqa: E402
    EpisodeRecord,
    build_regime_report,
    count_distinct_chains,
    count_same_key_clusters,
)


class BuildRegimeReportTests(unittest.TestCase):
    def test_groups_episodes_by_the_supplied_cell_key(self):
        episodes = [
            EpisodeRecord("c1", 100.0, 30.0),
            EpisodeRecord("c2", -50.0, 20.0),
            EpisodeRecord("c3", 80.0, 25.0),
        ]
        cells = build_regime_report(episodes, cell_key_fn=lambda e: "bull" if e.pnl > 0 else "bear", min_independent_chain_n=1)
        keys = {c.cell_key for c in cells}
        self.assertEqual(keys, {"bull", "bear"})

    def test_independent_chain_n_counts_distinct_chains_not_raw_rows(self):
        # Three EpisodeRecords, but only 2 distinct chains -- raw_n=3,
        # independent_chain_n=2. This is the exact distinction the
        # directive requires ("10 SPY trades on one event day is not 10
        # independent observations").
        episodes = [
            EpisodeRecord("chain-A", 10.0, 5.0),
            EpisodeRecord("chain-A", 15.0, 5.0),  # same chain observed twice
            EpisodeRecord("chain-B", -5.0, 5.0),
        ]
        cells = build_regime_report(episodes, cell_key_fn=lambda e: "all", min_independent_chain_n=1)
        self.assertEqual(cells[0].raw_n, 3)
        self.assertEqual(cells[0].independent_chain_n, 2)

    def test_a_cell_below_the_minimum_independent_n_reports_n_but_withholds_every_metric(self):
        episodes = [EpisodeRecord("chain-A", 100.0, 10.0)]
        cells = build_regime_report(episodes, cell_key_fn=lambda e: "tiny_cell", min_independent_chain_n=30)
        cell = cells[0]
        self.assertTrue(cell.insufficient_n)
        self.assertEqual(cell.raw_n, 1)
        self.assertEqual(cell.independent_chain_n, 1)
        self.assertIsNone(cell.ev_net)
        self.assertIsNone(cell.return_per_capital_day)
        self.assertIsNone(cell.win_rate)

    def test_a_sufficiently_sized_cell_reports_real_metrics(self):
        episodes = [EpisodeRecord(f"chain-{i}", 10.0 if i % 2 == 0 else -5.0, 10.0) for i in range(40)]
        cells = build_regime_report(episodes, cell_key_fn=lambda e: "big_cell", min_independent_chain_n=30)
        cell = cells[0]
        self.assertFalse(cell.insufficient_n)
        self.assertIsNotNone(cell.ev_net)
        self.assertIsNotNone(cell.win_rate)
        self.assertIsNotNone(cell.avg_win)
        self.assertIsNotNone(cell.avg_loss)

    def test_avg_win_is_none_when_a_sufficiently_sized_cell_has_zero_wins(self):
        episodes = [EpisodeRecord(f"chain-{i}", -5.0, 10.0) for i in range(40)]
        cells = build_regime_report(episodes, cell_key_fn=lambda e: "all_losses", min_independent_chain_n=30)
        self.assertIsNone(cells[0].avg_win)
        self.assertIsNotNone(cells[0].avg_loss)


class DependenceCountingTests(unittest.TestCase):
    def test_count_distinct_chains_deduplicates_repeated_chain_ids(self):
        episodes = [EpisodeRecord("c1", 1.0, 1.0), EpisodeRecord("c1", 2.0, 1.0), EpisodeRecord("c2", 3.0, 1.0)]
        self.assertEqual(count_distinct_chains(episodes), 2)

    def test_same_day_same_underlying_clustering_reduces_effective_count(self):
        # 10 raw items, but only 2 distinct (date, underlying) clusters --
        # the exact "10 SPY trades on one event day" scenario.
        items = [("2024-03-15", "SPY") for _ in range(8)] + [("2024-03-16", "SPY") for _ in range(2)]
        cluster_count = count_same_key_clusters(items, cluster_key_fn=lambda x: x)
        self.assertEqual(cluster_count, 2)
        self.assertLess(cluster_count, len(items))


if __name__ == "__main__":
    unittest.main()
