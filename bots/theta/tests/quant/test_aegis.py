"""Tests for bots/theta/quant/models/aegis.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.aegis import (  # noqa: E402
    AegisInputs,
    AegisPolicy,
    RiskState,
    RISK_REDUCING_ACTIONS,
    assess_aegis,
    is_action_permitted,
)


def _policy(**overrides) -> AegisPolicy:
    defaults = dict(
        policy_version="TEST-AEGIS-1",
        max_ticker_concentration_pct=0.20,
        max_sector_concentration_pct=0.35,
        max_correlation_cluster_pct=0.40,
        max_portfolio_capital_at_risk_pct=0.60,
        max_inventory_capacity_pct=0.50,
        max_assignment_capacity_pct=0.50,
        max_recovery_capacity_pct=0.30,
        provider_required_states=frozenset({"GOOD"}),
    )
    defaults.update(overrides)
    return AegisPolicy(**defaults)


def _clean_inputs(**overrides) -> AegisInputs:
    defaults = dict(
        ticker_concentration_pct=0.05,
        sector_concentration_pct=0.10,
        correlation_cluster_exposure_pct=0.10,
        portfolio_capital_at_risk_pct=0.20,
        inventory_capacity_used_pct=0.10,
        assignment_capacity_used_pct=0.10,
        recovery_capacity_used_pct=0.05,
        liquidity_acceptable=True,
        execution_quality_acceptable=True,
        provider_state="GOOD",
        stress_gap_detected=False,
        stress_iv_shock_detected=False,
        stress_spread_widening_detected=False,
    )
    defaults.update(overrides)
    return AegisInputs(**defaults)


class AllowFullTests(unittest.TestCase):
    def test_clean_book_state_allows_full_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs())
        self.assertEqual(assessment.new_risk_state, RiskState.ALLOW_FULL)


class HardVetoTests(unittest.TestCase):
    def test_hard_veto_blocks_new_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs(liquidity_acceptable=False))
        self.assertEqual(assessment.new_risk_state, RiskState.HARD_VETO)

    def test_provider_invalid_is_hard_veto(self):
        assessment = assess_aegis(_policy(), _clean_inputs(provider_state="INVALID"))
        self.assertEqual(assessment.new_risk_state, RiskState.HARD_VETO)

    def test_severely_exceeded_portfolio_risk_is_hard_veto(self):
        assessment = assess_aegis(_policy(), _clean_inputs(portfolio_capital_at_risk_pct=0.95))
        self.assertEqual(assessment.new_risk_state, RiskState.HARD_VETO)


class ExitSupremacyTests(unittest.TestCase):
    def test_hard_veto_does_not_block_close(self):
        self.assertTrue(is_action_permitted(RiskState.HARD_VETO, "CLOSE"))

    def test_hold_only_does_not_block_reconcile_or_cancel(self):
        self.assertTrue(is_action_permitted(RiskState.HOLD_ONLY, "RECONCILE"))
        self.assertTrue(is_action_permitted(RiskState.HOLD_ONLY, "CANCEL"))

    def test_hold_only_blocks_new_entries(self):
        self.assertFalse(is_action_permitted(RiskState.HOLD_ONLY, "OPEN_CSP"))

    def test_hard_veto_blocks_new_entries(self):
        self.assertFalse(is_action_permitted(RiskState.HARD_VETO, "OPEN_CSP"))

    def test_every_risk_reducing_action_is_permitted_in_every_state(self):
        for state in RiskState:
            for action in RISK_REDUCING_ACTIONS:
                self.assertTrue(is_action_permitted(state, action), f"{action} must be permitted under {state}")

    def test_defined_risk_only_permits_only_the_defined_risk_structure(self):
        self.assertTrue(is_action_permitted(RiskState.DEFINED_RISK_ONLY, "OPEN_DEFINED_RISK_SPREAD"))
        self.assertFalse(is_action_permitted(RiskState.DEFINED_RISK_ONLY, "OPEN_CSP"))


class ConcentrationTests(unittest.TestCase):
    def test_sector_concentration_exceeded_reduces_new_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs(sector_concentration_pct=0.40))
        self.assertEqual(assessment.new_risk_state, RiskState.ALLOW_REDUCED)

    def test_correlation_cluster_exceeded_reduces_new_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs(correlation_cluster_exposure_pct=0.50))
        self.assertEqual(assessment.new_risk_state, RiskState.ALLOW_REDUCED)


class ProviderAndStalenessTests(unittest.TestCase):
    def test_unknown_provider_state_blocks_new_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs(provider_state=None))
        self.assertEqual(assessment.new_risk_state, RiskState.HOLD_ONLY)

    def test_stale_provider_state_blocks_new_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs(provider_state="STALE"))
        self.assertEqual(assessment.new_risk_state, RiskState.HOLD_ONLY)


class ExecutionQualityFamilyTests(unittest.TestCase):
    def test_poor_execution_quality_restricts_to_defined_risk_only(self):
        assessment = assess_aegis(_policy(), _clean_inputs(execution_quality_acceptable=False))
        self.assertEqual(assessment.new_risk_state, RiskState.DEFINED_RISK_ONLY)


class StressTests(unittest.TestCase):
    def test_single_stress_signal_reduces_new_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs(stress_gap_detected=True))
        self.assertEqual(assessment.new_risk_state, RiskState.ALLOW_REDUCED)

    def test_compound_stress_holds_new_risk(self):
        assessment = assess_aegis(_policy(), _clean_inputs(stress_gap_detected=True, stress_iv_shock_detected=True))
        self.assertEqual(assessment.new_risk_state, RiskState.HOLD_ONLY)


if __name__ == "__main__":
    unittest.main()
