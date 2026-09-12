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
    CensoringState,
    CompletenessState,
    DataQuality,
    EconomicEpisode,
    ExecutionEvidence,
    HardStatus,
    LifecycleEvent,
    ManagementActionValue,
    ManagementSnapshot,
    ObservationRole,
    ProviderProvenance,
    ShadowCandidate,
    SoftStatus,
    StrategyLineage,
    SubjectType,
    ThetaStrategyAction,
    ThetaStrategyBranch,
)


def _lineage(**overrides):
    defaults = dict(
        strategy_version="sv-1", risk_version="rv-1", feature_version="fv-1",
        cost_model_version="cm-1", regime_version="rg-1", execution_model_version="em-1",
    )
    defaults.update(overrides)
    return StrategyLineage(**defaults)


def _provenance(**overrides):
    defaults = dict(
        source="ALPACA", operation_alias="options.snapshots", provider_timestamp="2026-01-01T00:00:00+00:00",
        ingestion_timestamp="2026-01-01T00:00:01+00:00", as_of="2026-01-01T00:00:00+00:00",
        version="v1", state=DataQuality.GOOD,
    )
    defaults.update(overrides)
    return ProviderProvenance(**defaults)


def _candidate(**overrides):
    defaults = dict(
        candidate_id="c1", decision_id="d1", fusion_snapshot_id="fs1", decision_time="2026-01-01T00:00:00+00:00",
        branch=ThetaStrategyBranch.THETA_CONVENTIONAL, rank_at_decision=1, selected=True,
        hard_status=HardStatus.FEASIBLE, soft_status=SoftStatus.RANKED, rejection_reason=None,
        contract={}, market={}, volatility={}, technical={}, event={}, flow={}, ownership={},
        account={}, portfolio={}, aegis={}, execution={}, known_economics={},
        unknown_economics=(), hard_blockers=(), soft_evidence=(), provider_provenance=(_provenance(),),
        lineage=_lineage(), content_hash="a" * 64,
    )
    defaults.update(overrides)
    return Candidate(**defaults)


class ProviderProvenanceTests(unittest.TestCase):
    def test_provenance_carries_the_full_ts_schema_field_set(self):
        required = {"source", "operation_alias", "provider_timestamp", "ingestion_timestamp", "as_of", "version", "state"}
        field_names = {f.name for f in dataclasses.fields(ProviderProvenance)}
        self.assertEqual(field_names, required)


class CandidateSetTests(unittest.TestCase):
    def test_candidate_set_carries_selection_identity_directly_no_separate_selected_candidate_type(self):
        candidate_set = CandidateSet(
            candidate_set_id="cs1", decision_time="2026-01-01T00:00:00+00:00",
            universe_evaluated=("AAPL", "MSFT"), branches_considered=(ThetaStrategyBranch.THETA_CONVENTIONAL,),
            counts={"enumerated": 2}, best_candidate_id="c1", second_best_candidate_id="c2",
            best_rejected_candidate_id=None, completeness_state=CompletenessState.COMPLETE,
            missing_scope=(), content_hash="b" * 64,
        )
        self.assertEqual(candidate_set.best_candidate_id, "c1")
        self.assertEqual(candidate_set.second_best_candidate_id, "c2")

    def test_completeness_state_uses_the_exact_production_enum_values(self):
        self.assertEqual({s.value for s in CompletenessState}, {"COMPLETE", "PARTIAL", "UNKNOWN"})


class CandidateStatusTests(unittest.TestCase):
    def test_hard_status_uses_the_exact_production_enum_values(self):
        self.assertEqual({s.value for s in HardStatus}, {"FEASIBLE", "HARD_VETO", "INVALID", "DATA_INSUFFICIENT"})

    def test_soft_status_uses_the_exact_production_enum_values(self):
        self.assertEqual({s.value for s in SoftStatus}, {"RANKED", "REJECTED", "UNKNOWN"})

    def test_a_candidate_carries_selected_as_its_own_field_not_a_separate_record(self):
        candidate = _candidate(selected=True)
        self.assertTrue(candidate.selected)


class EconomicEpisodeCensoringTests(unittest.TestCase):
    def test_censoring_state_uses_the_exact_production_enum_values(self):
        self.assertEqual({s.value for s in CensoringState}, {"RESOLVED", "RIGHT_CENSORED", "INVALIDATED"})

    def test_a_right_censored_episode_reports_none_for_realized_economics_never_a_fabricated_number(self):
        episode = EconomicEpisode(
            outcome_label_id="ol1", subject_type=SubjectType.WHOLE_CHAIN, subject_id="chain-1",
            label_available_at="2026-01-01T00:00:00+00:00", label_version="lv-1",
            censoring_state=CensoringState.RIGHT_CENSORED,
            whole_chain_net_pnl=None, managed_episode_pnl=None, return_on_secured_capital=None,
            return_per_capital_day=None, max_adverse_excursion=None, max_favorable_excursion=None,
            recovery_duration_days=None, realized_execution_cost=None, outcomes={}, provenance={},
            content_hash="c" * 64,
        )
        self.assertEqual(episode.censoring_state, CensoringState.RIGHT_CENSORED)
        self.assertIsNone(episode.whole_chain_net_pnl)

    def test_a_resolved_episode_can_carry_real_economics(self):
        episode = EconomicEpisode(
            outcome_label_id="ol2", subject_type=SubjectType.WHOLE_CHAIN, subject_id="chain-2",
            label_available_at="2026-01-01T00:00:00+00:00", label_version="lv-1",
            censoring_state=CensoringState.RESOLVED,
            whole_chain_net_pnl=15.0, managed_episode_pnl=15.0, return_on_secured_capital=0.01,
            return_per_capital_day=0.0003, max_adverse_excursion=-30.0, max_favorable_excursion=20.0,
            recovery_duration_days=12.0, realized_execution_cost=1.5, outcomes={}, provenance={},
            content_hash="d" * 64,
        )
        self.assertAlmostEqual(episode.whole_chain_net_pnl, 15.0)


class ManagementSnapshotTests(unittest.TestCase):
    def test_management_snapshot_carries_its_own_action_frontier_inline(self):
        hold = ManagementActionValue(ThetaStrategyAction.HOLD, True, 0.0, None, None, None, 0.0, None)
        close = ManagementActionValue(ThetaStrategyAction.CLOSE_FULL, True, 45.0, 0.0, 0.0, 0.0, 1.0, 44.0)
        snapshot = ManagementSnapshot(
            management_input_snapshot_id="mis1", fusion_snapshot_id="fs1", chain_id="chain-1",
            observed_at="2026-01-01T00:00:00+00:00", lifecycle_state="CSP_OPEN", input_fields={},
            unknown_fields=(), change_fields={}, content_hash="e" * 64,
            actions=(hold, close), selected_action=ThetaStrategyAction.CLOSE_FULL,
            second_best_action=ThetaStrategyAction.HOLD, decision_state="DECIDED", reason_codes=(),
        )
        self.assertEqual(len(snapshot.actions), 2)
        self.assertEqual(snapshot.selected_action, ThetaStrategyAction.CLOSE_FULL)


class ExecutionEvidenceTests(unittest.TestCase):
    def test_data_quality_uses_the_exact_production_enum_values(self):
        expected = {"GOOD", "DEGRADED", "STALE", "UNKNOWN", "INVALID", "NOT_ENTITLED"}
        self.assertEqual({s.value for s in DataQuality}, expected)

    def test_observation_role_uses_the_exact_production_enum_values(self):
        self.assertEqual({s.value for s in ObservationRole}, {"DECISION", "SUBSEQUENT", "BROKER_FILL"})


class ChainGroupingTests(unittest.TestCase):
    def test_lifecycle_events_sharing_a_chain_id_can_be_reassembled(self):
        chain_id = "roll-chain-42"
        entry = LifecycleEvent("la1", "ek1", chain_id, "CSP_OPEN", None, (), "2026-01-01T00:00:00+00:00", "h1", {})
        roll = LifecycleEvent("la2", "ek2", chain_id, "ROLL", None, (), "2026-01-02T00:00:00+00:00", "h2", {})
        close = LifecycleEvent("la3", "ek3", chain_id, "CLOSE", None, (), "2026-01-03T00:00:00+00:00", "h3", {})
        events = [entry, roll, close]
        self.assertTrue(all(e.chain_id == chain_id for e in events))


class ShadowCandidateTests(unittest.TestCase):
    def test_shadow_candidate_carries_the_exported_shadow_opportunity_fields(self):
        shadow = ShadowCandidate(
            opportunity_id="op1", fusion_snapshot_id="fs1", observed_at="2026-01-01T00:00:00+00:00",
            underlying="AAPL", contract_symbol="AAPL260117P00150000", strategy_branch=ThetaStrategyBranch.THETA_CONVENTIONAL,
            ev_net=None, tail_adjusted_ev=None, return_per_capital_day=None, capital_required=15000.0,
            uncertainty=None, aegis_state="ALLOW_FULL", recommended_quantity=0.0,
            execution_quality_acceptable=True, outcome=None, wait_reason=None,
            rejection_category="SPREAD_TOO_WIDE", reasons=(), policy_version="pv-1", model_versions={},
        )
        self.assertEqual(shadow.underlying, "AAPL")
        self.assertIsNone(shadow.ev_net)


if __name__ == "__main__":
    unittest.main()
