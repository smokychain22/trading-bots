"""Failure-DNA regression suite.

One test per KNOWN project failure mode -- the mistakes this codebase has
either already made once, or that the canonical documents explicitly
forbid. Each test asserts the failure is STRUCTURALLY prevented, not
merely discouraged by a comment. Synthetic fixtures only; no real data,
no fabricated performance.
"""

import dataclasses
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.aegis import RiskState  # noqa: E402
from models.sizing import SizingInputs, SizingPolicy, compute_sizing  # noqa: E402
from research.account_risk_capacity import (  # noqa: E402
    AccountRiskCapacity,
    AccountRole,
    assert_account_isolation,
    compute_account_qty_cap,
)
from research.action_value_distribution import unknown_distribution  # noqa: E402
from research.dataset_contracts import (  # noqa: E402
    CensoringState,
    EconomicEpisode,
    SubjectType,
    ThetaStrategyAction,
    ThetaStrategyBranch,
)
from research.dataset_readiness import (  # noqa: E402
    DatasetReadinessState,
    EvidenceSourceLabel,
    SufficiencyReport,
    classify_dataset_readiness,
    slice_by_branch,
)
from research.episode_economics import (  # noqa: E402
    SecuredCapitalInputs,
    premium_capture_fraction,
    return_on_secured_capital,
    secured_capital,
    whole_episode_pnl,
)
from research.execution_simulator import (  # noqa: E402
    FillProbability,
    OrderRequest,
    OrderSide,
    QuoteState,
    simulate_fill,
)
from research.follower_copy_economics import (  # noqa: E402
    CashflowDirection,
    ChainLifecycleEvent,
    CopyDecision,
    FollowerChainParticipation,
    FollowerSizingInputs,
    MasterConfirmation,
    assess_copyability,
    cashflow_direction_for_event,
    compute_follower_quantity,
    compute_price_deterioration,
    compute_price_deterioration_pct,
    follower_may_participate,
    master_confirmation_sufficient,
)
from research.management_policy import ActionEconomics, ManagementAction, management_utility  # noqa: E402
from research.paper_validation_analytics import (  # noqa: E402
    EvidenceSourceMismatch,
    require_paper_evidence,
)
from research.production_export_loader import DatasetLoadError, assert_no_future_labels  # noqa: E402
from research.promotion_checker import PromotionCheckInputs, PromotionResult, evaluate_promotion  # noqa: E402
from research.quant_explanation_contracts import validate_no_uncalibrated_confidence  # noqa: E402


def _sizing_policy(**overrides):
    defaults = dict(policy_version="DNA-1", risk_budget_qty_cap=5, collateral_qty_cap=10,
                     concentration_qty_cap=10, assignment_capacity_qty_cap=10, reduced_state_multiplier=0.5)
    defaults.update(overrides)
    return SizingPolicy(**defaults)


def _sizing_inputs(**overrides):
    defaults = dict(equity=50_000.0, cash=50_000.0, buying_power=50_000.0,
                     required_collateral_per_contract=5_000.0, broker_allowed_qty=10,
                     risk_state=RiskState.ALLOW_FULL)
    defaults.update(overrides)
    return SizingInputs(**defaults)


def _account(account_id="acct-1", role=AccountRole.MASTER, **overrides):
    defaults = dict(account_id=account_id, account_role=role, equity=100_000.0,
                     collateral_capacity=50_000.0, assignment_capacity=1000.0,
                     portfolio_tail_budget=10_000.0, concentration_capacity={"SPY": 20_000.0})
    defaults.update(overrides)
    return AccountRiskCapacity(**defaults)


def _promotion_inputs(**overrides):
    defaults = dict(
        used_point_in_time_joins=True, leakage_violations=[], only_resolved_chains_used=True,
        execution_model_is_direction_aware=True, final_oos_touched_exactly_once=True,
        training_dataset_hash="train-1", evaluation_dataset_hash="eval-1", model_version="mv-1",
        roll_accounting_verified=True, return_denominator_verified=True,
        fill_probability_is_fabricated=False, feature_provenance_recorded=True,
        independent_chain_n=500, min_independent_chain_n=300, deflated_sharpe_ratio=0.97,
        min_acceptable_dsr=0.95, probability_of_backtest_overfitting=0.1, max_acceptable_pbo=0.3,
        final_oos_ci_excludes_zero=True, calibration_acceptable=True, oos_ev_net=25.0,
        es_regression_pct=0.02, max_acceptable_es_regression_pct=0.10, drawdown_regression_pct=0.01,
        max_acceptable_drawdown_regression_pct=0.10, catastrophic_subgroup_collapse=False,
        ablation_result="IMPROVES", regime_stability_verified=True,
        edge_survives_realistic_execution=True,
    )
    defaults.update(overrides)
    return PromotionCheckInputs(**defaults)


class DeltaIsNotProbabilityTests(unittest.TestCase):
    """FAILURE DNA: treating option delta as a win/assignment probability."""

    def test_no_research_module_exposes_delta_as_a_probability_field(self):
        from research import action_value_distribution, dataset_contracts

        for module in (action_value_distribution, dataset_contracts):
            for name in dir(module):
                self.assertNotIn("delta_as_probability", name.lower())
                self.assertNotIn("delta_probability", name.lower())

    def test_probability_positive_is_its_own_field_never_derived_from_delta(self):
        distribution = unknown_distribution("v1", ThetaStrategyAction.HOLD)
        # An unfitted distribution carries no probability at all -- there
        # is no path that populates it from a contract greek.
        self.assertIsNone(distribution.probability_positive)


class QuantityFloorTests(unittest.TestCase):
    """FAILURE DNA: forcing quantity >= 1 ("never max(1, qty)")."""

    def test_production_sizing_returns_zero_when_a_cap_binds_to_zero(self):
        self.assertEqual(compute_sizing(_sizing_policy(risk_budget_qty_cap=0), _sizing_inputs()).quantity, 0)

    def test_account_capacity_sizing_returns_zero_rather_than_one(self):
        self.assertEqual(compute_account_qty_cap(
            _account(collateral_capacity=0.0), 5_000.0, 100.0, "SPY", 1_000.0, 100.0), 0)

    def test_follower_sizing_returns_zero_rather_than_one(self):
        inputs = FollowerSizingInputs(
            follower_capacity=_account("follower-1", AccountRole.FOLLOWER, collateral_capacity=0.0),
            required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0,
            assignment_shares_per_contract=100.0, master_quantity=5,
        )
        self.assertEqual(compute_follower_quantity(inputs), 0)


class RollAccountingTests(unittest.TestCase):
    """FAILURE DNA: a roll resetting/erasing the old leg's realized loss."""

    def test_the_canonical_roll_example_sums_to_fifteen_not_one_ninety_five(self):
        self.assertAlmostEqual(whole_episode_pnl([200.0, -350.0, 180.0, -15.0]), 15.0)

    def test_a_roll_never_drops_the_old_realized_loss(self):
        with_old_loss = whole_episode_pnl([200.0, -350.0, 180.0])
        without_old_loss = whole_episode_pnl([180.0])
        self.assertNotAlmostEqual(with_old_loss, without_old_loss)

    def test_promotion_is_blocked_when_roll_accounting_is_invalid(self):
        result = evaluate_promotion(_promotion_inputs(roll_accounting_verified=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)


class MidpointFillTests(unittest.TestCase):
    """FAILURE DNA: assuming a midpoint fill."""

    def test_a_zero_fill_ratio_lands_at_the_passive_touch_not_the_midpoint(self):
        quote = QuoteState(bid=1.00, ask=1.10, bid_size=50.0, ask_size=50.0, quote_age_seconds=1.0, session_open=True)
        buy = simulate_fill(OrderRequest(OrderSide.BUY_TO_OPEN, 1.0, None, 30.0), quote, fill_ratio=0.0)
        self.assertAlmostEqual(buy.fill_price, 1.00)  # the bid, not 1.05

    def test_buying_and_selling_diverge_in_opposite_directions(self):
        quote = QuoteState(bid=1.00, ask=1.10, bid_size=50.0, ask_size=50.0, quote_age_seconds=1.0, session_open=True)
        buy = simulate_fill(OrderRequest(OrderSide.BUY_TO_OPEN, 1.0, None, 30.0), quote, fill_ratio=0.75)
        sell = simulate_fill(OrderRequest(OrderSide.SELL_TO_OPEN, 1.0, None, 30.0), quote, fill_ratio=0.75)
        self.assertGreater(buy.fill_price, sell.fill_price)

    def test_promotion_is_blocked_by_a_midpoint_execution_model(self):
        result = evaluate_promotion(_promotion_inputs(execution_model_is_direction_aware=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)


class UnknownToZeroTests(unittest.TestCase):
    """FAILURE DNA: silently converting UNKNOWN to zero."""

    def test_unknown_tail_risk_makes_management_utility_unknown(self):
        econ = ActionEconomics(ManagementAction.HOLD, remaining_ev=50.0, tail_risk=None,
                                capital_days_consumed=1.0, execution_cost=0.0)
        self.assertIsNone(management_utility(econ, 1.0, 1.0, 1.0, opportunity_cost=0.0))

    def test_unknown_multiplier_makes_secured_capital_unknown_never_one_hundred(self):
        self.assertIsNone(secured_capital(SecuredCapitalInputs(strike=150.0, contracts=1.0, multiplier=None)))

    def test_unknown_capital_makes_return_on_capital_unknown(self):
        self.assertIsNone(return_on_secured_capital(200.0, None))

    def test_unknown_collateral_in_production_sizing_yields_zero_not_a_guess(self):
        result = compute_sizing(_sizing_policy(), _sizing_inputs(required_collateral_per_contract=None))
        self.assertEqual(result.quantity, 0)
        self.assertEqual(result.binding_constraint, "UNKNOWN_INPUT")


class MissingFeesTests(unittest.TestCase):
    """FAILURE DNA: a missing fee silently becoming a zero cost."""

    def test_an_unresolved_episode_reports_none_economics_never_zero(self):
        episode = EconomicEpisode(
            outcome_label_id="ol1", subject_type=SubjectType.WHOLE_CHAIN, subject_id="chain-1",
            label_available_at="2026-01-01T00:00:00+00:00", label_version="lv-1",
            censoring_state=CensoringState.RIGHT_CENSORED, whole_chain_net_pnl=None,
            managed_episode_pnl=None, return_on_secured_capital=None, return_per_capital_day=None,
            max_adverse_excursion=None, max_favorable_excursion=None, recovery_duration_days=None,
            realized_execution_cost=None, outcomes={}, provenance={}, content_hash="c" * 64,
        )
        self.assertIsNone(episode.realized_execution_cost)
        self.assertIsNone(episode.whole_chain_net_pnl)


class StaleQuoteTests(unittest.TestCase):
    """FAILURE DNA: a stale quote passing as executable."""

    def test_a_stale_quote_is_rejected(self):
        quote = QuoteState(bid=1.00, ask=1.10, bid_size=50.0, ask_size=50.0, quote_age_seconds=100.0, session_open=True)
        result = simulate_fill(OrderRequest(OrderSide.BUY_TO_OPEN, 1.0, None, 5.0), quote, fill_ratio=0.5)
        self.assertEqual(result.outcome.value, "REJECTED_STALE_QUOTE")

    def test_an_unknown_quote_age_is_never_assumed_fresh(self):
        quote = QuoteState(bid=1.00, ask=1.10, bid_size=50.0, ask_size=50.0, quote_age_seconds=None, session_open=True)
        result = simulate_fill(OrderRequest(OrderSide.BUY_TO_OPEN, 1.0, None, 30.0), quote, fill_ratio=0.5)
        self.assertEqual(result.outcome.value, "REJECTED_STALE_QUOTE")


class SoftSignalAsHiddenHardGateTests(unittest.TestCase):
    """FAILURE DNA: a soft feature acting as a hidden veto."""

    def test_management_and_risk_features_cannot_enter_entry_gating(self):
        from research.feature_taxonomy import features_eligible_for_entry_gating

        eligible = features_eligible_for_entry_gating()
        for management_or_risk_feature in ("recovery_median", "call_away_regret",
                                            "concentration_cluster_exposure", "assignment_capacity",
                                            "quote_spread", "capital_days"):
            self.assertNotIn(management_or_risk_feature, eligible)


class PartialScanTests(unittest.TestCase):
    """FAILURE DNA: a partial candidate set treated as complete."""

    def test_a_partial_scan_never_supports_best_in_market_claims(self):
        from research.dataset_contracts import CandidateSet, CompletenessState
        from research.empirical_pipeline import assess_cross_symbol_completeness

        class _Export:
            candidate_sets = [CandidateSet(
                candidate_set_id="cs1", decision_time="2026-01-01T00:00:00+00:00",
                universe_evaluated=("AAPL",), branches_considered=(ThetaStrategyBranch.THETA_CONVENTIONAL,),
                counts={}, best_candidate_id=None, second_best_candidate_id=None,
                best_rejected_candidate_id=None, completeness_state=CompletenessState.PARTIAL,
                missing_scope=("universe",), content_hash="b" * 64,
            )]

        assessment = assess_cross_symbol_completeness(_Export())
        self.assertFalse(assessment.usable_for_best_in_market_claims)


class ResearchBranchExecutabilityTests(unittest.TestCase):
    """FAILURE DNA: a research-only branch becoming executable."""

    def test_the_research_registry_marks_defined_risk_disabled(self):
        import json

        registry_path = _QUANT_DIR / "research" / "data" / "strategy_registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        states = {b["strategy_id"]: b["promotion_state"] for b in registry["branches"]}
        self.assertEqual(states["THETA_DEFINED_RISK"], "DISABLED")

    def test_no_branch_claims_empirical_readiness(self):
        import json

        registry_path = _QUANT_DIR / "research" / "data" / "strategy_registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        for branch in registry["branches"]:
            self.assertEqual(branch["empirical_readiness"], "EV_MODEL_NOT_EMPIRICALLY_READY")


class FollowerLifecycleTests(unittest.TestCase):
    """FAILURE DNA: a follower copying lifecycle events for a chain it
    never entered, or copying the master's size directly."""

    def test_a_follower_that_skipped_entry_cannot_copy_a_close(self):
        may, reason = follower_may_participate(
            FollowerChainParticipation(chain_id="chain-1", entered=False), ChainLifecycleEvent.CLOSE)
        self.assertFalse(may)
        self.assertIn("NEVER_ENTERED_CHAIN", reason)

    def test_a_follower_never_copies_master_quantity_beyond_its_own_capacity(self):
        inputs = FollowerSizingInputs(
            follower_capacity=_account("follower-1", AccountRole.FOLLOWER, collateral_capacity=10_000.0),
            required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0,
            assignment_shares_per_contract=100.0, master_quantity=99,
        )
        self.assertEqual(compute_follower_quantity(inputs), 2)

    def test_an_account_isolation_violation_is_an_unconditional_skip(self):
        inputs = FollowerSizingInputs(
            follower_capacity=_account("follower-1", AccountRole.FOLLOWER),
            required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0,
            assignment_shares_per_contract=100.0, master_quantity=1,
        )
        assessment = assess_copyability(inputs, branch_compatible=True, quote_fresh=True,
                                         account_isolation_violations=["shared capacity object"])
        self.assertEqual(assessment.decision, CopyDecision.SKIP)


class MasterSelfCopyTests(unittest.TestCase):
    """FAILURE DNA: the master account copying itself."""

    def test_two_entries_sharing_one_capacity_object_are_flagged_as_not_isolated(self):
        shared = _account("master-1", AccountRole.MASTER)
        violations = assert_account_isolation({"master-1": shared, "follower-1": shared})
        self.assertTrue(any("share the identical capacity object" in v for v in violations))


class UncalibratedProbabilityTests(unittest.TestCase):
    """FAILURE DNA: showing an uncalibrated confidence percentage."""

    def test_a_probability_without_calibration_confirmation_is_blocked(self):
        from research.action_value_distribution import OutcomeDistribution

        distribution = OutcomeDistribution(
            distribution_version="v1", action=ThetaStrategyAction.HOLD, expected_pnl=1.0, median_pnl=1.0,
            p25_pnl=0.0, p5_pnl=-1.0, expected_shortfall=-2.0, probability_positive=0.93,
            expected_capital_days=1.0, assignment_probability=0.1, expected_recovery_duration_days=1.0,
            execution_cost=0.1, uncertainty=0.1,
        )
        self.assertIsNotNone(validate_no_uncalibrated_confidence(distribution, calibration_confirmed=False))


class EvidenceClassMixingTests(unittest.TestCase):
    """FAILURE DNA: pooling Paper evidence with shadow evidence."""

    def test_paper_analytics_refuse_shadow_evidence(self):
        with self.assertRaises(EvidenceSourceMismatch):
            require_paper_evidence(EvidenceSourceLabel.LIVE_SHADOW)

    def test_paper_analytics_refuse_historical_replay_evidence(self):
        with self.assertRaises(EvidenceSourceMismatch):
            require_paper_evidence(EvidenceSourceLabel.HISTORICAL_REPLAY)


class FutureLabelInFeaturesTests(unittest.TestCase):
    """FAILURE DNA: an outcome label hiding inside a feature payload."""

    def test_a_nested_outcome_key_is_rejected(self):
        with self.assertRaises(DatasetLoadError):
            assert_no_future_labels({"ctx": {"deep": {"whole_chain_net_pnl": 1.0}}})

    def test_a_bare_pnl_key_is_rejected(self):
        with self.assertRaises(DatasetLoadError):
            assert_no_future_labels({"pnl": 1.0})

    def test_a_key_inside_a_list_is_rejected(self):
        with self.assertRaises(DatasetLoadError):
            assert_no_future_labels({"items": [{"future_return": 0.1}]})


class OpenChainCountedAsWinTests(unittest.TestCase):
    """FAILURE DNA: an open/censored chain scored as a resolved win."""

    def test_censored_episodes_are_bucketed_separately_from_resolved(self):
        def _episode(label_id, state, pnl=None):
            return EconomicEpisode(
                outcome_label_id=label_id, subject_type=SubjectType.WHOLE_CHAIN, subject_id=f"chain-{label_id}",
                label_available_at="2026-01-01T00:00:00+00:00", label_version="lv-1", censoring_state=state,
                whole_chain_net_pnl=pnl, managed_episode_pnl=pnl, return_on_secured_capital=None,
                return_per_capital_day=None, max_adverse_excursion=None, max_favorable_excursion=None,
                recovery_duration_days=None, realized_execution_cost=None, outcomes={}, provenance={},
                content_hash="d" * 64,
            )

        slices = slice_by_branch({ThetaStrategyBranch.THETA_CONVENTIONAL: [
            _episode("e1", CensoringState.RESOLVED, 10.0),
            _episode("e2", CensoringState.RIGHT_CENSORED),
        ]})
        branch_slice = slices[ThetaStrategyBranch.THETA_CONVENTIONAL]
        self.assertEqual(len(branch_slice.resolved_episodes), 1)
        self.assertEqual(len(branch_slice.censored_episodes), 1)
        self.assertIsNone(branch_slice.censored_episodes[0].whole_chain_net_pnl)


class PremiumDenominatorTests(unittest.TestCase):
    """FAILURE DNA: profit/premium reported as investment return."""

    def test_premium_capture_and_return_on_capital_are_different_numbers(self):
        capital = secured_capital(SecuredCapitalInputs(strike=150.0, contracts=1.0, multiplier=100))
        capture = premium_capture_fraction(200.0, 200.0)
        roc = return_on_secured_capital(200.0, capital)
        self.assertAlmostEqual(capture, 1.0)
        self.assertAlmostEqual(roc, 200.0 / 15_000.0)
        self.assertNotAlmostEqual(capture, roc)

    def test_promotion_is_blocked_by_a_premium_based_return_denominator(self):
        result = evaluate_promotion(_promotion_inputs(return_denominator_verified=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)


class FabricatedFillProbabilityTests(unittest.TestCase):
    """FAILURE DNA: inventing a fill probability."""

    def test_the_simulator_always_reports_fill_probability_unknown(self):
        quote = QuoteState(bid=1.00, ask=1.10, bid_size=50.0, ask_size=50.0, quote_age_seconds=1.0, session_open=True)
        for side in OrderSide:
            result = simulate_fill(OrderRequest(side, 1.0, None, 30.0), quote, fill_ratio=0.5)
            self.assertEqual(result.fill_probability, FillProbability.UNKNOWN)

    def test_promotion_is_blocked_by_a_fabricated_fill_probability(self):
        result = evaluate_promotion(_promotion_inputs(fill_probability_is_fabricated=True))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)


class DuplicateExperimentResultTests(unittest.TestCase):
    """FAILURE DNA: silently overwriting a prior experiment result."""

    def test_a_repeated_experiment_run_refuses_to_overwrite(self):
        import tempfile

        from research.dataset_readiness import ExperimentConfig
        from research.empirical_pipeline import run_theta_empirical_pipeline
        from research.production_export_loader import DATASET_SCHEMA_VERSION, canonical_json, sha256_hex

        rows = {
            "candidateSets": [], "candidates": [], "shadowCandidates": [], "managementSnapshots": [],
            "lifecycleOutcomes": [], "wholeChainOutcomes": [], "executionEvidence": [],
        }
        identity = {
            "schemaVersion": DATASET_SCHEMA_VERSION,
            "sourceWindow": {"start": "2026-01-01T00:00:00+00:00", "end": "2026-01-02T00:00:00+00:00"},
            "featureSetVersion": "fv-1",
            "strategyVersions": [], "rows": rows, "rowCounts": {k: 0 for k in rows},
        }
        export = dict(identity)
        export["exportedAt"] = "2026-01-02T00:00:00+00:00"
        export["datasetHash"] = sha256_hex(canonical_json(identity))
        config = ExperimentConfig(
            dataset_hash="h1", target_version="tv1", feature_version="fv-1",
            strategy_branch=ThetaStrategyBranch.THETA_CONVENTIONAL, cost_model_version="cm-1",
            split_definition="sd-1", experiment_id="DESC-FUNNEL-01", hypothesis_id=None,
            evidence_source=EvidenceSourceLabel.LIVE_SHADOW,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_theta_empirical_pipeline(export, config, output_root=root)
            with self.assertRaises(FileExistsError):
                run_theta_empirical_pipeline(export, config, output_root=root)


class ReadinessBypassTests(unittest.TestCase):
    """FAILURE DNA: reaching an OOS evaluation without the prior gates."""

    def test_untouched_oos_flag_alone_cannot_skip_walk_forward(self):
        state = classify_dataset_readiness(
            "fake-export", SufficiencyReport(eligible=True, reasons=[]),
            walk_forward_plan_valid=False, final_oos_untouched=True,
        )
        self.assertEqual(state, DatasetReadinessState.MODEL_FIT_ELIGIBLE)

    def test_insufficient_sample_never_reaches_model_fit(self):
        state = classify_dataset_readiness(
            "fake-export", SufficiencyReport(eligible=False, reasons=["too small"]),
            walk_forward_plan_valid=True, final_oos_untouched=True,
        )
        self.assertEqual(state, DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY)


class MartingaleTests(unittest.TestCase):
    """FAILURE DNA: loss-conditioned position scaling."""

    def test_sizing_has_no_input_representing_recent_losses(self):
        field_names = {f.name for f in dataclasses.fields(_sizing_inputs())}
        for forbidden in ("recent_losses", "loss_streak", "consecutive_losses", "drawdown_recovery_multiplier"):
            self.assertNotIn(forbidden, field_names)

    def test_account_capacity_has_no_loss_conditioned_input(self):
        field_names = {f.name for f in dataclasses.fields(_account())}
        for forbidden in ("recent_losses", "loss_streak", "consecutive_losses"):
            self.assertNotIn(forbidden, field_names)


class DirectionAgnosticCopyPricingTests(unittest.TestCase):
    """FAILURE DNA: scoring copy price deterioration with one
    direction-agnostic subtraction.

    `follower - master` is correct ONLY for a debit. THETA is a premium
    SELLER, so most of its events are credits, where receiving LESS is
    worse -- the opposite arithmetic. The original formula therefore
    scored adverse credit fills as improvements and improvements as
    adverse, inverting every limit built on it."""

    def test_credit_receiving_less_is_adverse_and_positive(self):
        # master sold for 2.00, follower only got 1.90 -> genuinely worse.
        self.assertAlmostEqual(
            compute_price_deterioration(2.00, 1.90, CashflowDirection.CREDIT), 0.10)

    def test_credit_receiving_more_is_an_improvement_and_negative(self):
        self.assertAlmostEqual(
            compute_price_deterioration(2.00, 2.10, CashflowDirection.CREDIT), -0.10)

    def test_debit_paying_more_is_adverse_and_positive(self):
        self.assertAlmostEqual(
            compute_price_deterioration(1.00, 1.10, CashflowDirection.DEBIT), 0.10)

    def test_debit_paying_less_is_an_improvement_and_negative(self):
        self.assertAlmostEqual(
            compute_price_deterioration(1.00, 0.90, CashflowDirection.DEBIT), -0.10)

    def test_the_two_directions_disagree_on_identical_numbers(self):
        # The regression itself: one formula cannot serve both.
        credit = compute_price_deterioration(2.00, 1.90, CashflowDirection.CREDIT)
        debit = compute_price_deterioration(2.00, 1.90, CashflowDirection.DEBIT)
        self.assertAlmostEqual(credit, -debit)
        self.assertGreater(credit, 0)
        self.assertLess(debit, 0)

    def test_roll_legs_carry_opposite_cash_directions(self):
        self.assertEqual(
            cashflow_direction_for_event(ChainLifecycleEvent.ROLL_CLOSE_OLD), CashflowDirection.DEBIT)
        self.assertEqual(
            cashflow_direction_for_event(ChainLifecycleEvent.ROLL_OPEN_NEW), CashflowDirection.CREDIT)

    def test_short_put_and_covered_call_opens_are_credits_and_closes_are_debits(self):
        self.assertEqual(cashflow_direction_for_event(ChainLifecycleEvent.ENTRY), CashflowDirection.CREDIT)
        self.assertEqual(cashflow_direction_for_event(ChainLifecycleEvent.SELL_CC), CashflowDirection.CREDIT)
        self.assertEqual(cashflow_direction_for_event(ChainLifecycleEvent.CLOSE), CashflowDirection.DEBIT)

    def test_non_transaction_lifecycle_events_have_no_guessed_direction(self):
        self.assertIsNone(cashflow_direction_for_event(ChainLifecycleEvent.ASSIGNMENT))
        self.assertIsNone(cashflow_direction_for_event(ChainLifecycleEvent.CALL_AWAY))

    def test_zero_master_price_makes_the_percentage_undefined_not_zero(self):
        self.assertIsNone(compute_price_deterioration_pct(0.0, 1.00, CashflowDirection.CREDIT))

    def test_unknown_master_price_makes_the_percentage_undefined_not_zero(self):
        self.assertIsNone(compute_price_deterioration_pct(None, 1.00, CashflowDirection.DEBIT))

    def test_percentage_preserves_the_sign_convention(self):
        self.assertAlmostEqual(
            compute_price_deterioration_pct(2.00, 1.90, CashflowDirection.CREDIT), 0.05)
        self.assertAlmostEqual(
            compute_price_deterioration_pct(2.00, 2.10, CashflowDirection.CREDIT), -0.05)

    def _copy_inputs(self):
        return FollowerSizingInputs(
            follower_capacity=_account("follower-1", AccountRole.FOLLOWER, collateral_capacity=1_000_000.0,
                                       assignment_capacity=1_000_000.0, portfolio_tail_budget=1_000_000.0,
                                       concentration_capacity={"SPY": 1_000_000.0}),
            required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0,
            assignment_shares_per_contract=100.0, master_quantity=1,
        )

    def test_copyability_blocks_adverse_credit_deterioration(self):
        adverse = compute_price_deterioration(2.00, 1.80, CashflowDirection.CREDIT)
        assessment = assess_copyability(
            self._copy_inputs(), branch_compatible=True, quote_fresh=True,
            account_isolation_violations=[], price_deterioration=adverse,
            max_price_deterioration=0.10)
        self.assertEqual(assessment.decision, CopyDecision.SKIP)
        self.assertTrue(any("ADVERSE_PRICE_DETERIORATION" in r for r in assessment.reasons))

    def test_copyability_never_blocks_a_credit_price_improvement(self):
        improvement = compute_price_deterioration(2.00, 2.50, CashflowDirection.CREDIT)
        assessment = assess_copyability(
            self._copy_inputs(), branch_compatible=True, quote_fresh=True,
            account_isolation_violations=[], price_deterioration=improvement,
            max_price_deterioration=0.10)
        self.assertEqual(assessment.decision, CopyDecision.COPY_ELIGIBLE)

    def test_copyability_never_blocks_a_debit_price_improvement(self):
        improvement = compute_price_deterioration(1.00, 0.50, CashflowDirection.DEBIT)
        assessment = assess_copyability(
            self._copy_inputs(), branch_compatible=True, quote_fresh=True,
            account_isolation_violations=[], price_deterioration=improvement,
            max_price_deterioration=0.10)
        self.assertEqual(assessment.decision, CopyDecision.COPY_ELIGIBLE)

    def test_unknown_deterioration_under_an_active_limit_is_refused_not_waved_through(self):
        assessment = assess_copyability(
            self._copy_inputs(), branch_compatible=True, quote_fresh=True,
            account_isolation_violations=[], price_deterioration=None,
            max_price_deterioration=0.10)
        self.assertEqual(assessment.decision, CopyDecision.SKIP)
        self.assertTrue(any("UNKNOWN_UNDER_ACTIVE_LIMIT" in r for r in assessment.reasons))


class MasterIntentIsNotConfirmationTests(unittest.TestCase):
    """FAILURE DNA: copying a master ORDER the master never actually got
    filled on, manufacturing follower positions from intent alone."""

    def test_an_unfilled_master_order_cannot_be_copied(self):
        sufficient, reason = master_confirmation_sufficient(MasterConfirmation(
            event=ChainLifecycleEvent.ENTRY, master_fill_id="fill-1",
            master_filled_quantity=0, broker_activity_fact_id=None))
        self.assertFalse(sufficient)
        self.assertEqual(reason, "MASTER_FILL_REQUIRED_BEFORE_COPY")

    def test_a_missing_master_fill_id_cannot_be_copied(self):
        sufficient, _ = master_confirmation_sufficient(MasterConfirmation(
            event=ChainLifecycleEvent.ROLL_OPEN_NEW, master_fill_id=None,
            master_filled_quantity=1, broker_activity_fact_id=None))
        self.assertFalse(sufficient)

    def test_a_confirmed_master_fill_is_sufficient(self):
        sufficient, _ = master_confirmation_sufficient(MasterConfirmation(
            event=ChainLifecycleEvent.ENTRY, master_fill_id="fill-1",
            master_filled_quantity=1, broker_activity_fact_id=None))
        self.assertTrue(sufficient)

    def test_assignment_requires_a_broker_activity_fact_not_a_fill(self):
        sufficient, reason = master_confirmation_sufficient(MasterConfirmation(
            event=ChainLifecycleEvent.ASSIGNMENT, master_fill_id=None,
            master_filled_quantity=0, broker_activity_fact_id=None))
        self.assertFalse(sufficient)
        self.assertEqual(reason, "MASTER_BROKER_CONFIRMATION_REQUIRED")
        sufficient, _ = master_confirmation_sufficient(MasterConfirmation(
            event=ChainLifecycleEvent.ASSIGNMENT, master_fill_id=None,
            master_filled_quantity=0, broker_activity_fact_id="activity-1"))
        self.assertTrue(sufficient)


if __name__ == "__main__":
    unittest.main()
