import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "quant"))

from models.severe_drawdown_spec import DrawdownThresholdFamily, LabelStatus, SevereDrawdownLabelSpec
from research.severe_drawdown_dataset import (
    CorporateActionEvidence, HistoricalPriceObservation, PointInTimeFeatureSnapshot,
    SevereDrawdownEpisode, materialize_severe_drawdown_dataset,
)

SPEC = SevereDrawdownLabelSpec("owner-supplied-v1", 5, DrawdownThresholdFamily.PERCENT_FROM_ENTRY, 0.10)


def episode(identifier: str, day: int) -> SevereDrawdownEpisode:
    decision = date(2025, 1, day)
    return SevereDrawdownEpisode(identifier, "SPY", decision, 100.0, PointInTimeFeatureSnapshot(
        "SPY", decision, f"{decision.isoformat()}T20:00:00Z", "features-v1", {"rv20": 0.2}, (),
    ))


def price(day: int, value: float) -> HistoricalPriceObservation:
    return HistoricalPriceObservation("SPY", date(2025, 1, day), value, "ALPACA", "iex", "2025-02-01T00:00:00Z", "bars-v1", "SPLIT_ADJUSTED")


class SevereDrawdownDatasetTests(unittest.TestCase):
    def test_breach_survival_censoring_and_label_availability(self):
        breached = materialize_severe_drawdown_dataset([episode("breach", 1)], [price(1, 100), price(3, 89)], [], SPEC, date(2025, 1, 20), "dataset-v1").rows[0]
        self.assertEqual(breached.label.status, LabelStatus.BREACHED)
        self.assertEqual(breached.label_available_at, date(2025, 1, 3))
        survived = materialize_severe_drawdown_dataset([episode("survive", 1)], [price(1, 100), price(6, 95)], [], SPEC, date(2025, 1, 20), "dataset-v1").rows[0]
        self.assertEqual(survived.label.status, LabelStatus.SURVIVED)
        self.assertEqual(survived.label_available_at, date(2025, 1, 6))
        censored = materialize_severe_drawdown_dataset([episode("censor", 18)], [price(18, 100)], [], SPEC, date(2025, 1, 20), "dataset-v1").rows[0]
        self.assertEqual(censored.label.status, LabelStatus.CENSORED)
        self.assertIsNone(censored.label_available_at)

    def test_overlap_groups_are_deterministic_and_separate_non_overlapping_windows(self):
        result = materialize_severe_drawdown_dataset(
            [episode("a", 1), episode("b", 4), episode("c", 12)], [price(day, 100) for day in range(1, 18)],
            [], SPEC, date(2025, 1, 31), "dataset-v1",
        )
        self.assertEqual(result.rows[0].dependence_group, result.rows[1].dependence_group)
        self.assertNotEqual(result.rows[2].dependence_group, result.rows[1].dependence_group)
        repeated = materialize_severe_drawdown_dataset(
            [episode("c", 12), episode("b", 4), episode("a", 1)], [price(day, 100) for day in range(1, 18)],
            [], SPEC, date(2025, 1, 31), "dataset-v1",
        )
        self.assertEqual(result.content_hash, repeated.content_hash)

    def test_ambiguous_corporate_action_excludes_label_and_future_feature_is_rejected(self):
        action = CorporateActionEvidence("SPY", date(2025, 1, 3), "SPLIT", "AMBIGUOUS", "ALPACA", "2025-02-01T00:00:00Z")
        result = materialize_severe_drawdown_dataset([episode("a", 1)], [price(1, 100)], [action], SPEC, date(2025, 1, 31), "dataset-v1")
        self.assertIsNone(result.rows[0].label)
        self.assertEqual(result.rows[0].exclusion_reason, "CORPORATE_ACTION_AMBIGUOUS")
        item = episode("future", 1)
        leaked = SevereDrawdownEpisode(item.episode_id, item.underlying, item.decision_date, item.entry_price,
            PointInTimeFeatureSnapshot("SPY", item.decision_date, "2025-01-02T00:00:00Z", "features-v1", {}, ()))
        with self.assertRaisesRegex(ValueError, "FEATURE_AFTER_DECISION"):
            materialize_severe_drawdown_dataset([leaked], [price(1, 100)], [], SPEC, date(2025, 1, 31), "dataset-v1")


if __name__ == "__main__":
    unittest.main()
