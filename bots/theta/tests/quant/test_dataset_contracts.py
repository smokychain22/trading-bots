"""Tests for bots/theta/quant/research/dataset_contracts.py. Structural/synthetic only."""

import dataclasses
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.dataset_contracts import (  # noqa: E402
    Candidate,
    CandidateSet,
    EconomicEpisode,
    LifecycleEvent,
    ManagementActionSet,
    ManagementActionValue,
    ManagementSnapshot,
    RecordLineage,
    SelectedCandidate,
    ShadowCandidate,
    ThetaStrategyAction,
    ThetaStrategyBranch,
)


def _lineage(**overrides):
    defaults = dict(
        as_of="2026-01-01T00:00:00Z", provider_timestamp="2026-01-01T00:00:00Z",
        ingestion_timestamp="2026-01-01T00:00:01Z", strategy_version_id="sv-1",
        feature_set_version="fs-1", entry_model_version="em-1", management_policy_version="mp-1",
        cost_model_version="cm-1", risk_limit_version="rl-1", contract_identity="AAPL260117P00150000",
        lifecycle_chain_id="chain-1",
    )
    defaults.update(overrides)
    return RecordLineage(**defaults)


class LineagePresenceTests(unittest.TestCase):
    """R6G: 'every row must preserve' a fixed lineage field set -- checked
    structurally against every record dataclass, not just RecordLineage
    itself."""

    def test_record_lineage_has_every_required_field(self):
        required = {
            "as_of", "provider_timestamp", "ingestion_timestamp", "strategy_version_id",
            "feature_set_version", "entry_model_version", "management_policy_version",
            "cost_model_version", "risk_limit_version", "contract_identity", "lifecycle_chain_id",
        }
        field_names = {f.name for f in dataclasses.fields(RecordLineage)}
        self.assertEqual(field_names, required)

    def test_every_record_type_carries_a_lineage_field(self):
        record_types = [Candidate, CandidateSet, SelectedCandidate, ShadowCandidate,
                         ManagementSnapshot, ManagementActionSet, EconomicEpisode, LifecycleEvent]
        for record_type in record_types:
            field_names = {f.name for f in dataclasses.fields(record_type)}
            self.assertIn("lineage", field_names, f"{record_type.__name__} is missing a lineage field")


class CandidateSetTests(unittest.TestCase):
    def test_candidate_set_preserves_every_candidate_not_only_the_winner(self):
        lineage = _lineage()
        winner = Candidate(lineage, "c1", ThetaStrategyBranch.THETA_CONVENTIONAL, True, ThetaStrategyAction.OPEN_CSP, None, None, None, None)
        rejected = Candidate(lineage, "c2", ThetaStrategyBranch.THETA_CONVENTIONAL, True, None, None, None, None, None, hard_blockers=("SPREAD_TOO_WIDE",))
        candidate_set = CandidateSet(lineage, "snap-1", (winner, rejected))
        self.assertEqual(len(candidate_set.candidates), 2)

    def test_a_selected_candidate_of_none_represents_a_genuine_global_wait(self):
        selected = SelectedCandidate(_lineage(), "snap-1", candidate_id=None, second_best_candidate_id=None)
        self.assertIsNone(selected.candidate_id)


class EconomicEpisodeTests(unittest.TestCase):
    def test_an_unresolved_episode_reports_none_for_realized_economics_never_a_fabricated_number(self):
        episode = EconomicEpisode(
            lineage=_lineage(), branch=ThetaStrategyBranch.THETA_CONVENTIONAL, resolved=False,
            whole_chain_net_pnl=None, managed_episode_net_pnl=None, return_on_secured_capital=None,
            return_per_capital_day=None, max_drawdown_pct=None, max_adverse_excursion=None,
            expected_shortfall=None, severe_drawdown_event=None, assignment_occurred=None,
            recovery_duration_days=None, recovery_success=None, call_away_occurred=None, capital_lock_days=None,
        )
        self.assertFalse(episode.resolved)
        self.assertIsNone(episode.whole_chain_net_pnl)

    def test_a_resolved_episode_can_carry_real_economics(self):
        episode = EconomicEpisode(
            lineage=_lineage(), branch=ThetaStrategyBranch.THETA_CC, resolved=True,
            whole_chain_net_pnl=15.0, managed_episode_net_pnl=15.0, return_on_secured_capital=0.01,
            return_per_capital_day=0.0003, max_drawdown_pct=0.05, max_adverse_excursion=-30.0,
            expected_shortfall=-40.0, severe_drawdown_event=False, assignment_occurred=True,
            recovery_duration_days=12.0, recovery_success=True, call_away_occurred=True, capital_lock_days=45.0,
        )
        self.assertTrue(episode.resolved)
        self.assertAlmostEqual(episode.whole_chain_net_pnl, 15.0)


class ManagementActionSetTests(unittest.TestCase):
    def test_management_action_set_preserves_every_valuation_from_the_same_snapshot(self):
        lineage = _lineage()
        hold = ManagementActionValue(ThetaStrategyAction.HOLD, True, 0.0, None, None, None, 0.0, None)
        close = ManagementActionValue(ThetaStrategyAction.CLOSE_FULL, True, 45.0, 0.0, 0.0, 0.0, 1.0, 44.0)
        action_set = ManagementActionSet(lineage, "snap-2", (hold, close), selected_action=ThetaStrategyAction.CLOSE_FULL)
        self.assertEqual(len(action_set.valuations), 2)
        self.assertEqual(action_set.selected_action, ThetaStrategyAction.CLOSE_FULL)


class ChainGroupingTests(unittest.TestCase):
    def test_records_sharing_a_lifecycle_chain_id_can_be_reassembled(self):
        chain_id = "roll-chain-42"
        entry = LifecycleEvent(_lineage(lifecycle_chain_id=chain_id), "CSP_OPEN", "act-1", "CSP_OPEN")
        roll = LifecycleEvent(_lineage(lifecycle_chain_id=chain_id), "ROLL", "act-2", "CSP_OPEN")
        close = LifecycleEvent(_lineage(lifecycle_chain_id=chain_id), "CLOSE", "act-3", "CLOSED")
        events = [entry, roll, close]
        self.assertTrue(all(e.lineage.lifecycle_chain_id == chain_id for e in events))


if __name__ == "__main__":
    unittest.main()
