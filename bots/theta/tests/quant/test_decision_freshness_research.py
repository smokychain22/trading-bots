"""Tests for research/decision_freshness_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.decision_freshness_research import (  # noqa: E402
    DecisionContext,
    DecisionFreshnessBounds,
    DecisionFreshnessObservation,
    InvalidationReason,
    assess_decision_freshness,
)


def _context(**overrides):
    defaults = dict(decision_created_at="2026-01-01T09:00:00Z", spot_price=100.0, iv=0.25,
                     delta_regime="MODERATE", flow_direction="BULLISH", gex_regime="POSITIVE",
                     session_state="REGULAR_SESSION", event_state="NO_KNOWN_EVENT",
                     portfolio_fingerprint="hash-1", expiration="2026-02-01T20:00:00Z")
    defaults.update(overrides)
    return DecisionContext(**defaults)


def _observation(**overrides):
    defaults = dict(observed_at="2026-01-01T09:30:00Z", quote_age_seconds=5.0, spot_price=100.0, iv=0.25,
                     delta_regime="MODERATE", flow_direction="BULLISH", gex_regime="POSITIVE",
                     session_state="REGULAR_SESSION", event_state="NO_KNOWN_EVENT",
                     portfolio_fingerprint="hash-1")
    defaults.update(overrides)
    return DecisionFreshnessObservation(**defaults)


class AssessDecisionFreshnessTests(unittest.TestCase):
    def test_identical_state_stays_fresh(self):
        result = assess_decision_freshness(_context(), _observation(), DecisionFreshnessBounds(
            max_quote_age_seconds=60.0, max_spot_move_fraction=0.01, max_iv_move_absolute=0.02))
        self.assertTrue(result.still_fresh)
        self.assertEqual(result.invalidation_reasons, [])
        self.assertIsNone(result.decision_invalidated_at)

    def test_quote_age_beyond_bound_invalidates(self):
        result = assess_decision_freshness(_context(), _observation(quote_age_seconds=120.0),
                                            DecisionFreshnessBounds(max_quote_age_seconds=60.0))
        self.assertFalse(result.still_fresh)
        self.assertIn(InvalidationReason.QUOTE_AGE_EXCEEDED, result.invalidation_reasons)

    def test_spot_move_beyond_bound_invalidates(self):
        result = assess_decision_freshness(_context(spot_price=100.0), _observation(spot_price=103.0),
                                            DecisionFreshnessBounds(max_spot_move_fraction=0.01))
        self.assertIn(InvalidationReason.SPOT_MOVED_BEYOND_BOUND, result.invalidation_reasons)

    def test_iv_move_beyond_bound_invalidates(self):
        result = assess_decision_freshness(_context(iv=0.25), _observation(iv=0.35),
                                            DecisionFreshnessBounds(max_iv_move_absolute=0.05))
        self.assertIn(InvalidationReason.IV_MOVED_BEYOND_BOUND, result.invalidation_reasons)

    def test_delta_regime_change_invalidates_even_with_no_numeric_bounds_set(self):
        result = assess_decision_freshness(_context(delta_regime="MODERATE"), _observation(delta_regime="EXTREME"),
                                            DecisionFreshnessBounds())
        self.assertIn(InvalidationReason.DELTA_REGIME_CHANGED, result.invalidation_reasons)

    def test_flow_reversal_invalidates(self):
        result = assess_decision_freshness(_context(flow_direction="BULLISH"), _observation(flow_direction="BEARISH"),
                                            DecisionFreshnessBounds())
        self.assertIn(InvalidationReason.FLOW_REVERSED, result.invalidation_reasons)

    def test_gex_regime_change_invalidates(self):
        result = assess_decision_freshness(_context(gex_regime="POSITIVE"), _observation(gex_regime="NEGATIVE"),
                                            DecisionFreshnessBounds())
        self.assertIn(InvalidationReason.GEX_REGIME_CHANGED, result.invalidation_reasons)

    def test_session_transition_invalidates(self):
        result = assess_decision_freshness(_context(session_state="REGULAR_SESSION"), _observation(session_state="CLOSING_WINDOW"),
                                            DecisionFreshnessBounds())
        self.assertIn(InvalidationReason.SESSION_STATE_TRANSITIONED, result.invalidation_reasons)

    def test_event_state_transition_invalidates(self):
        result = assess_decision_freshness(_context(event_state="NO_KNOWN_EVENT"), _observation(event_state="EVENT_IMMINENT"),
                                            DecisionFreshnessBounds())
        self.assertIn(InvalidationReason.EVENT_STATE_TRANSITIONED, result.invalidation_reasons)

    def test_portfolio_change_invalidates(self):
        result = assess_decision_freshness(_context(portfolio_fingerprint="a"), _observation(portfolio_fingerprint="b"),
                                            DecisionFreshnessBounds())
        self.assertIn(InvalidationReason.PORTFOLIO_CHANGED, result.invalidation_reasons)

    def test_multiple_reasons_all_reported_not_just_the_first(self):
        result = assess_decision_freshness(
            _context(spot_price=100.0, iv=0.25), _observation(spot_price=110.0, iv=0.4),
            DecisionFreshnessBounds(max_spot_move_fraction=0.01, max_iv_move_absolute=0.02))
        self.assertIn(InvalidationReason.SPOT_MOVED_BEYOND_BOUND, result.invalidation_reasons)
        self.assertIn(InvalidationReason.IV_MOVED_BEYOND_BOUND, result.invalidation_reasons)
        self.assertEqual(len(result.invalidation_reasons), 2)

    def test_unset_bounds_are_never_checked(self):
        # No bounds configured at all -- only categorical equality checks apply,
        # and those match, so the decision stays fresh despite large moves.
        result = assess_decision_freshness(_context(spot_price=100.0), _observation(spot_price=999.0), DecisionFreshnessBounds())
        self.assertTrue(result.still_fresh)

    def test_time_decay_bound_sets_a_valid_until_timestamp(self):
        result = assess_decision_freshness(_context(), _observation(observed_at="2026-01-01T09:05:00Z"),
                                            DecisionFreshnessBounds(max_time_decay_seconds=3600.0))
        self.assertIsNotNone(result.decision_valid_until)
        self.assertTrue(result.still_fresh)

    def test_time_decay_exceeded_invalidates(self):
        result = assess_decision_freshness(_context(), _observation(observed_at="2026-01-01T11:00:00Z"),
                                            DecisionFreshnessBounds(max_time_decay_seconds=3600.0))
        self.assertIn(InvalidationReason.TIME_DECAY_EXCEEDED, result.invalidation_reasons)


if __name__ == "__main__":
    unittest.main()
