"""Tests for bots/theta/quant/research/severe_drawdown_continuous_target.py."""

import sys
import unittest
from datetime import date
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.severe_drawdown_continuous_target import (  # noqa: E402
    ContinuousTargetEpisode,
    materialize_continuous_target_dataset,
)
from research.severe_drawdown_dataset import (  # noqa: E402
    CorporateActionEvidence,
    HistoricalPriceObservation,
    PointInTimeFeatureSnapshot,
)


def _snapshot(decision: date) -> PointInTimeFeatureSnapshot:
    return PointInTimeFeatureSnapshot(
        underlying="AAPL", decision_date=decision, feature_available_at=decision.isoformat(),
        feature_version="v1", values={}, missing_features=(),
    )


def _obs(underlying: str, as_of: date, price: float) -> HistoricalPriceObservation:
    return HistoricalPriceObservation(
        underlying=underlying, as_of=as_of, adjusted_close=price, provider="ALPACA", feed="daily",
        retrieved_at=as_of.isoformat(), data_version="v1", adjustment="ALL_ADJUSTED",
    )


class SevereDrawdownContinuousTargetTest(unittest.TestCase):
    def test_forward_mae_and_time_to_mae_track_the_worst_observed_point_not_the_final_point(self):
        episode = ContinuousTargetEpisode(
            episode_id="e1", underlying="AAPL", decision_date=date(2026, 1, 1), entry_price=100.0,
            feature_snapshot=_snapshot(date(2026, 1, 1)), prior_realized_volatility=0.02, prior_expected_move=0.05,
        )
        observations = [
            _obs("AAPL", date(2026, 1, 2), 98.0),
            _obs("AAPL", date(2026, 1, 3), 90.0),  # worst point: -10%
            _obs("AAPL", date(2026, 1, 4), 95.0),  # recovers partially -- must not overwrite the worst
        ]
        rows = materialize_continuous_target_dataset(
            [episode], observations, [], horizon_days=10, dataset_cutoff=date(2026, 1, 15), dataset_version="v1",
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertAlmostEqual(row.forward_mae, -0.10)
        self.assertEqual(row.time_to_mae_days, 2)
        self.assertFalse(row.censored)
        self.assertIsNone(row.exclusion_reason)

    def test_volatility_and_expected_move_normalization_uses_only_prior_pit_inputs(self):
        episode = ContinuousTargetEpisode(
            episode_id="e1", underlying="AAPL", decision_date=date(2026, 1, 1), entry_price=100.0,
            feature_snapshot=_snapshot(date(2026, 1, 1)), prior_realized_volatility=0.05, prior_expected_move=0.10,
        )
        observations = [_obs("AAPL", date(2026, 1, 2), 90.0)]  # -10%
        rows = materialize_continuous_target_dataset(
            [episode], observations, [], horizon_days=10, dataset_cutoff=date(2026, 1, 10), dataset_version="v1",
        )
        row = rows[0]
        self.assertAlmostEqual(row.volatility_normalized_mae, -0.10 / 0.05)
        self.assertAlmostEqual(row.expected_move_normalized_mae, -0.10 / 0.10)

    def test_missing_prior_normalization_input_produces_none_never_a_fabricated_ratio(self):
        episode = ContinuousTargetEpisode(
            episode_id="e1", underlying="AAPL", decision_date=date(2026, 1, 1), entry_price=100.0,
            feature_snapshot=_snapshot(date(2026, 1, 1)), prior_realized_volatility=None, prior_expected_move=None,
        )
        observations = [_obs("AAPL", date(2026, 1, 2), 90.0)]
        rows = materialize_continuous_target_dataset(
            [episode], observations, [], horizon_days=10, dataset_cutoff=date(2026, 1, 10), dataset_version="v1",
        )
        row = rows[0]
        self.assertIsNotNone(row.forward_mae)
        self.assertIsNone(row.volatility_normalized_mae)
        self.assertIsNone(row.expected_move_normalized_mae)

    def test_horizon_extending_past_dataset_cutoff_is_censored_and_never_reads_past_the_cutoff(self):
        episode = ContinuousTargetEpisode(
            episode_id="e1", underlying="AAPL", decision_date=date(2026, 1, 1), entry_price=100.0,
            feature_snapshot=_snapshot(date(2026, 1, 1)), prior_realized_volatility=0.02, prior_expected_move=0.05,
        )
        observations = [
            _obs("AAPL", date(2026, 1, 3), 95.0),  # visible: before cutoff
            _obs("AAPL", date(2026, 1, 20), 1.0),  # AFTER cutoff and after horizon -- must never be read
        ]
        rows = materialize_continuous_target_dataset(
            [episode], observations, [], horizon_days=30, dataset_cutoff=date(2026, 1, 5), dataset_version="v1",
        )
        row = rows[0]
        self.assertTrue(row.censored)
        self.assertAlmostEqual(row.forward_mae, -0.05)  # only the pre-cutoff point is visible

    def test_ambiguous_corporate_action_excludes_the_row_and_reuses_the_binary_datasets_own_ambiguity_rule(self):
        episode = ContinuousTargetEpisode(
            episode_id="e1", underlying="AAPL", decision_date=date(2026, 1, 1), entry_price=100.0,
            feature_snapshot=_snapshot(date(2026, 1, 1)), prior_realized_volatility=0.02, prior_expected_move=0.05,
        )
        action = CorporateActionEvidence(
            underlying="AAPL", effective_date=date(2026, 1, 3), action_type="SPLIT",
            state="AMBIGUOUS", provider="OPTIONOMICS", known_at="2026-01-01T00:00:00Z",
        )
        observations = [_obs("AAPL", date(2026, 1, 2), 98.0)]
        rows = materialize_continuous_target_dataset(
            [episode], observations, [action], horizon_days=10, dataset_cutoff=date(2026, 1, 10), dataset_version="v1",
        )
        row = rows[0]
        self.assertEqual(row.exclusion_reason, "CORPORATE_ACTION_AMBIGUOUS")
        self.assertIsNone(row.forward_mae)

    def test_missing_price_path_excludes_the_row_rather_than_silently_defaulting_to_zero_drawdown(self):
        episode = ContinuousTargetEpisode(
            episode_id="e1", underlying="AAPL", decision_date=date(2026, 1, 1), entry_price=100.0,
            feature_snapshot=_snapshot(date(2026, 1, 1)), prior_realized_volatility=0.02, prior_expected_move=0.05,
        )
        rows = materialize_continuous_target_dataset(
            [episode], [], [], horizon_days=10, dataset_cutoff=date(2026, 1, 10), dataset_version="v1",
        )
        row = rows[0]
        self.assertEqual(row.exclusion_reason, "ADJUSTED_PRICE_PATH_UNAVAILABLE")
        self.assertIsNone(row.forward_mae)

    def test_dataset_version_and_positive_horizon_are_required(self):
        episode = ContinuousTargetEpisode(
            episode_id="e1", underlying="AAPL", decision_date=date(2026, 1, 1), entry_price=100.0,
            feature_snapshot=_snapshot(date(2026, 1, 1)), prior_realized_volatility=0.02, prior_expected_move=0.05,
        )
        with self.assertRaises(ValueError):
            materialize_continuous_target_dataset([episode], [], [], horizon_days=10, dataset_cutoff=date(2026, 1, 10), dataset_version="")
        with self.assertRaises(ValueError):
            materialize_continuous_target_dataset([episode], [], [], horizon_days=0, dataset_cutoff=date(2026, 1, 10), dataset_version="v1")


if __name__ == "__main__":
    unittest.main()
