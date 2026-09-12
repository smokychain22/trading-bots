"""Tests for bots/theta/quant/research/paper_validation_analytics.py. Synthetic only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.dataset_readiness import EvidenceSourceLabel  # noqa: E402
from research.paper_validation_analytics import (  # noqa: E402
    DriftObservation,
    EvidenceSourceMismatch,
    OperationalIncidentTally,
    StabilityRecommendation,
    assess_strategy_stability,
    empty_paper_summary,
    require_paper_evidence,
)


def _no_incidents(**overrides):
    fields = {name: 0 for name in OperationalIncidentTally.__dataclass_fields__}
    fields.update(overrides)
    return OperationalIncidentTally(**fields)


def _no_drift(**overrides):
    fields = {name: False for name in DriftObservation.__dataclass_fields__}
    fields.update(overrides)
    return DriftObservation(**fields)


class EvidenceSourceGuardTests(unittest.TestCase):
    def test_paper_evidence_is_accepted(self):
        require_paper_evidence(EvidenceSourceLabel.PAPER_EXECUTION)  # must not raise

    def test_shadow_evidence_is_refused(self):
        with self.assertRaises(EvidenceSourceMismatch):
            require_paper_evidence(EvidenceSourceLabel.LIVE_SHADOW)

    def test_historical_replay_is_refused(self):
        with self.assertRaises(EvidenceSourceMismatch):
            require_paper_evidence(EvidenceSourceLabel.HISTORICAL_REPLAY)

    def test_stability_assessment_refuses_non_paper_evidence(self):
        import dataclasses

        summary = dataclasses.replace(empty_paper_summary(), evidence_source=EvidenceSourceLabel.LIVE_SHADOW)
        with self.assertRaises(EvidenceSourceMismatch):
            assess_strategy_stability(summary, _no_drift(), _no_incidents(), sample_confidence_acceptable=True)


class EmptyPaperSummaryTests(unittest.TestCase):
    def test_every_economic_field_is_unknown_and_every_count_is_zero(self):
        summary = empty_paper_summary()
        self.assertIsNone(summary.whole_chain_pnl)
        self.assertIsNone(summary.win_rate)
        self.assertIsNone(summary.expected_shortfall)
        self.assertEqual(summary.sample_size, 0)
        self.assertEqual(summary.duplicate_order_count, 0)


class IncidentTallyTests(unittest.TestCase):
    def test_blocking_incidents_exclude_ordinary_market_friction(self):
        friction_only = _no_incidents(partial_fills=5, stale_quotes=3, provider_outages=1)
        self.assertEqual(friction_only.blocking_incidents(), 0)
        self.assertEqual(friction_only.total(), 9)

    def test_duplicate_submission_is_a_blocking_defect(self):
        self.assertEqual(_no_incidents(duplicate_submissions=1).blocking_incidents(), 1)

    def test_reconciliation_drift_is_a_blocking_defect(self):
        self.assertEqual(_no_incidents(reconciliation_drift=2).blocking_incidents(), 2)


class StabilityAssessmentTests(unittest.TestCase):
    def _assess(self, drift=None, incidents=None, sample_ok=True):
        return assess_strategy_stability(
            empty_paper_summary(), drift or _no_drift(), incidents or _no_incidents(),
            sample_confidence_acceptable=sample_ok,
        )

    def test_clean_measured_state_is_normal(self):
        self.assertEqual(self._assess().recommendation, StabilityRecommendation.NORMAL)

    def test_a_blocking_operational_defect_outranks_positive_pnl(self):
        result = self._assess(incidents=_no_incidents(duplicate_submissions=1))
        self.assertEqual(result.recommendation, StabilityRecommendation.HOLD_ONLY)
        self.assertTrue(any("outrank" in r for r in result.reasons))

    def test_ev_deterioration_is_degraded(self):
        result = self._assess(drift=_no_drift(ev_deteriorating=True))
        self.assertEqual(result.recommendation, StabilityRecommendation.DEGRADED)

    def test_tail_deterioration_is_degraded(self):
        result = self._assess(drift=_no_drift(tail_deteriorating=True))
        self.assertEqual(result.recommendation, StabilityRecommendation.DEGRADED)

    def test_ev_tail_and_calibration_together_recommend_retirement(self):
        result = self._assess(drift=_no_drift(ev_deteriorating=True, tail_deteriorating=True, calibration_deteriorating=True))
        self.assertEqual(result.recommendation, StabilityRecommendation.RETIRE_RECOMMENDED)

    def test_secondary_deterioration_alone_is_watch(self):
        result = self._assess(drift=_no_drift(feature_drift=True))
        self.assertEqual(result.recommendation, StabilityRecommendation.WATCH)

    def test_unmeasured_drift_is_watch_never_normal(self):
        result = self._assess(drift=_no_drift(regime_breakdown=None))
        self.assertEqual(result.recommendation, StabilityRecommendation.WATCH)
        self.assertTrue(any("not looking is not evidence" in r for r in result.reasons))

    def test_unconfirmed_sample_confidence_is_watch(self):
        self.assertEqual(self._assess(sample_ok=None).recommendation, StabilityRecommendation.WATCH)


if __name__ == "__main__":
    unittest.main()
