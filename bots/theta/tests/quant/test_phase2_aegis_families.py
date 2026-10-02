"""Phase 2 offline correctness: per-family AEGIS behaviour for all twelve families.

For every family: normal, boundary, veto, capacity-zero, unknown, stale (AEGIS has no clock, so stale evidence reaches
it ONLY as UNKNOWN/None -- tested as such), and invalid units. Plus: no family is bypassed by strategy identity, no
family's input contaminates an unrelated family, and worsening any true risk input is monotone EXCEPT the documented
versioned Paper cold-start applicability marker (see test_cold_start_marker_is_the_only_loosening).

Synthetic data only; uses the existing test_aegis helpers so the policy constants stay shared.
"""
import dataclasses
import math
import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_aegis import _clean_inputs, _policy
from models.aegis import (
    AEGIS_NUMERIC_FAMILY_FIELDS, AEGIS_STATE_FAMILY_FIELDS, AegisInputs, AegisPolicy, RiskFamily, RiskState,
    _STRICTNESS_ORDER, assess_aegis, is_action_permitted,
)

FULL, REDUCED, DEFINED, HOLD, VETO = (RiskState.ALLOW_FULL, RiskState.ALLOW_REDUCED, RiskState.DEFINED_RISK_ONLY,
                                      RiskState.HOLD_ONLY, RiskState.HARD_VETO)
NUMERIC = {  # family -> (input field, policy cap field)
    'UNDERLYING': ('ticker_concentration_pct', 'max_ticker_concentration_pct'),
    'SECTOR': ('sector_concentration_pct', 'max_sector_concentration_pct'),
    'CORRELATION': ('correlation_cluster_exposure_pct', 'max_correlation_cluster_pct'),
    'PORTFOLIO': ('portfolio_capital_at_risk_pct', 'max_portfolio_capital_at_risk_pct'),
    'INVENTORY': ('inventory_capacity_used_pct', 'max_inventory_capacity_pct'),
    'ASSIGNMENT': ('assignment_capacity_used_pct', 'max_assignment_capacity_pct'),
    'RECOVERY': ('recovery_capacity_used_pct', 'max_recovery_capacity_pct'),
}


def rank(state):
    return _STRICTNESS_ORDER.index(state)


def family_state(assessment, name):
    matches = [f for f in assessment.families if f.family.value == name]
    assert len(matches) == 1, f'family {name} must appear exactly once'
    return matches[0].state


def all_family_states(assessment):
    return {f.family.value: f.state for f in assessment.families}


class RegistryTests(unittest.TestCase):
    def test_exactly_twelve_distinct_families_are_always_evaluated(self):
        expected = {'PER_TRADE', 'UNDERLYING', 'SECTOR', 'CORRELATION', 'PORTFOLIO', 'INVENTORY', 'ASSIGNMENT',
                    'RECOVERY', 'LIQUIDITY', 'EXECUTION', 'PROVIDER', 'SYSTEM'}
        self.assertEqual({f.value for f in RiskFamily}, expected)
        assessment = assess_aegis(_policy(), _clean_inputs())
        self.assertEqual(len(assessment.families), 12)
        self.assertEqual(set(all_family_states(assessment)), expected)

    def test_clean_book_has_every_family_allow_full(self):
        assessment = assess_aegis(_policy(), _clean_inputs())
        self.assertTrue(all(state == FULL for state in all_family_states(assessment).values()))
        self.assertEqual(assessment.new_risk_state, FULL)

    def test_overall_state_is_the_strictest_family_never_a_blend(self):
        policy = _policy()
        for family, (field, cap_field) in NUMERIC.items():
            cap = getattr(policy, cap_field)
            mixed = replace(_clean_inputs(), **{field: cap, 'execution_quality_acceptable': False})
            assessment = assess_aegis(policy, mixed)
            states = all_family_states(assessment)
            self.assertEqual(states[family], REDUCED)
            self.assertEqual(states['EXECUTION'], DEFINED)
            self.assertEqual(assessment.new_risk_state, max(states.values(), key=rank))
            self.assertEqual(assessment.new_risk_state, DEFINED)


class NumericFamilyTests(unittest.TestCase):
    def test_normal_boundary_veto_for_every_numeric_family(self):
        policy = _policy()
        for family, (field, cap_field) in NUMERIC.items():
            cap = getattr(policy, cap_field)
            hard = cap * policy.hard_cap_multiplier
            cases = [
                (0.0, FULL), (math.nextafter(cap, 0.0), FULL), (cap, REDUCED),
                (math.nextafter(hard, 0.0), REDUCED), (hard, VETO), (hard * 10, VETO), (1.0, VETO),
            ]
            for value, expected in cases:
                with self.subTest(family=family, value=value):
                    got = family_state(assess_aegis(policy, replace(_clean_inputs(), **{field: value})), family)
                    self.assertEqual(got, expected)

    def test_unknown_numeric_input_is_hold_only_never_a_pass(self):
        for family, (field, _) in NUMERIC.items():
            with self.subTest(family=family):
                assessment = assess_aegis(_policy(), replace(_clean_inputs(), **{field: None}))
                self.assertEqual(family_state(assessment, family), HOLD)
                self.assertEqual(assessment.new_risk_state, HOLD)
                self.assertTrue(any(r.code == f'{family}_UNKNOWN' for r in assessment.reasons))

    def test_stale_evidence_is_only_representable_as_unknown_and_never_as_zero(self):
        # AEGIS carries no timestamps; staleness is the adapter's job and must arrive as None. A literal 0.0 is a
        # *known* zero-exposure claim and is the only value that may pass, so UNKNOWN must differ from 0.0.
        policy = _policy()
        for family, (field, _) in NUMERIC.items():
            zero = family_state(assess_aegis(policy, replace(_clean_inputs(), **{field: 0.0})), family)
            unknown = family_state(assess_aegis(policy, replace(_clean_inputs(), **{field: None})), family)
            self.assertEqual(zero, FULL)
            self.assertGreater(rank(unknown), rank(zero), family)

    def test_capacity_zero_policy_cap_fails_closed_to_hard_veto_even_at_zero_exposure(self):
        # A policy cap of exactly 0 means "no capacity in this family": 0 >= 0*mult, so even zero exposure vetoes.
        for family, (field, cap_field) in NUMERIC.items():
            with self.subTest(family=family):
                policy = _policy(**{cap_field: 0.0})
                assessment = assess_aegis(policy, replace(_clean_inputs(), **{field: 0.0}))
                self.assertEqual(family_state(assessment, family), VETO)
                self.assertEqual(assessment.new_risk_state, VETO)

    def test_exhausted_capacity_used_at_one_hundred_percent_is_hard_veto(self):
        for family in ('INVENTORY', 'ASSIGNMENT', 'RECOVERY'):
            field, _ = NUMERIC[family]
            got = assess_aegis(_policy(), replace(_clean_inputs(), **{field: 1.0}))
            self.assertEqual(family_state(got, family), VETO)

    def test_percent_scaled_instead_of_fraction_fails_closed(self):
        # 20 (meaning 20%) instead of 0.20 must be a veto, never a pass.
        for family, (field, _) in NUMERIC.items():
            got = assess_aegis(_policy(), replace(_clean_inputs(), **{field: 20}))
            self.assertEqual(family_state(got, family), VETO, family)

    def test_exposure_above_one_is_representable_and_vetoes(self):
        for family, (field, _) in NUMERIC.items():
            got = assess_aegis(_policy(), replace(_clean_inputs(), **{field: 1.7}))
            self.assertEqual(family_state(got, family), VETO)

    def test_invalid_units_are_rejected_loudly_not_coerced(self):
        bad_values = [-0.01, float('nan'), float('inf'), float('-inf'), True, False, '0.1', [0.1], object()]
        for family, (field, cap_field) in NUMERIC.items():
            for bad in bad_values:
                with self.subTest(family=family, field=field, bad=repr(bad)):
                    with self.assertRaises(ValueError):
                        assess_aegis(_policy(), replace(_clean_inputs(), **{field: bad}))
                with self.subTest(family=family, policy=cap_field, bad=repr(bad)):
                    with self.assertRaises(ValueError):
                        assess_aegis(_policy(**{cap_field: bad}), _clean_inputs())

    def test_policy_hard_cap_multiplier_and_hold_count_validation(self):
        for bad in (1, 1.0, 0.5, 0, -2, float('nan'), float('inf'), True, '1.5', None):
            with self.subTest(multiplier=bad):
                with self.assertRaises(ValueError):
                    assess_aegis(_policy(hard_cap_multiplier=bad), _clean_inputs())
        for bad in (0, 1, -1, 2.0, True, '2', None):
            with self.subTest(hold_count=bad):
                with self.assertRaises(ValueError):
                    assess_aegis(_policy(compound_stress_hold_count=bad), _clean_inputs())
        with self.assertRaises(ValueError):  # threshold overflow to inf
            assess_aegis(_policy(max_ticker_concentration_pct=1.7e308, hard_cap_multiplier=1.5), _clean_inputs())


class StateFamilyTests(unittest.TestCase):
    def test_per_trade_normal_veto_unknown(self):
        policy = _policy()
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(liquidity_acceptable=True)), 'PER_TRADE'), FULL)
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(liquidity_acceptable=False)), 'PER_TRADE'), VETO)
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(liquidity_acceptable=None)), 'PER_TRADE'), HOLD)

    def test_liquidity_family_is_book_level_spread_widening(self):
        policy = _policy()
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(stress_spread_widening_detected=False)), 'LIQUIDITY'), FULL)
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(stress_spread_widening_detected=True)), 'LIQUIDITY'), REDUCED)
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(stress_spread_widening_detected=None)), 'LIQUIDITY'), HOLD)

    def test_execution_normal_poor_unknown(self):
        policy = _policy()
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(execution_quality_acceptable=True)), 'EXECUTION'), FULL)
        got = assess_aegis(policy, _clean_inputs(execution_quality_acceptable=False))
        self.assertEqual(family_state(got, 'EXECUTION'), DEFINED)
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(execution_quality_acceptable=None)), 'EXECUTION'), HOLD)

    def test_provider_normal_insufficient_invalid_unknown(self):
        policy = _policy(provider_required_states=frozenset({'GOOD', 'DEGRADED_OK'}))
        for ok in ('GOOD', 'DEGRADED_OK'):
            self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(provider_state=ok)), 'PROVIDER'), FULL)
        for insufficient in ('STALE', 'DEGRADED', 'DOWN', 'good', ' GOOD'):
            self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(provider_state=insufficient)), 'PROVIDER'), HOLD,
                             insufficient)
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(provider_state='INVALID')), 'PROVIDER'), VETO)
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(provider_state=None)), 'PROVIDER'), HOLD)

    def test_provider_stale_is_not_in_required_set_unless_policy_says_so(self):
        # AEGIS never invents staleness tolerance: a provider reporting STALE only passes if the versioned policy lists it.
        self.assertEqual(family_state(assess_aegis(_policy(), _clean_inputs(provider_state='STALE')), 'PROVIDER'), HOLD)

    def test_provider_invalid_overrides_even_a_policy_that_lists_it_as_required(self):
        policy = _policy(provider_required_states=frozenset({'GOOD', 'INVALID'}))
        self.assertEqual(family_state(assess_aegis(policy, _clean_inputs(provider_state='INVALID')), 'PROVIDER'), VETO)

    def test_system_stress_counts_and_threshold(self):
        policy = _policy(compound_stress_hold_count=2)
        clean = _clean_inputs()
        self.assertEqual(family_state(assess_aegis(policy, clean), 'SYSTEM'), FULL)
        for field in ('stress_gap_detected', 'stress_iv_shock_detected', 'stress_spread_widening_detected'):
            self.assertEqual(family_state(assess_aegis(policy, replace(clean, **{field: True})), 'SYSTEM'), REDUCED, field)
            self.assertEqual(family_state(assess_aegis(policy, replace(clean, **{field: None})), 'SYSTEM'), HOLD, field)
        two = replace(clean, stress_gap_detected=True, stress_iv_shock_detected=True)
        self.assertEqual(family_state(assess_aegis(policy, two), 'SYSTEM'), HOLD)
        three_policy = _policy(compound_stress_hold_count=3)
        self.assertEqual(family_state(assess_aegis(three_policy, two), 'SYSTEM'), REDUCED)
        all_three = replace(two, stress_spread_widening_detected=True)
        self.assertEqual(family_state(assess_aegis(three_policy, all_three), 'SYSTEM'), HOLD)

    def test_system_unknown_beats_a_known_stress_count(self):
        got = assess_aegis(_policy(), _clean_inputs(stress_gap_detected=True, stress_iv_shock_detected=None))
        self.assertEqual(family_state(got, 'SYSTEM'), HOLD)
        self.assertTrue(any(r.code == 'SYSTEM_STRESS_STATE_UNKNOWN' for r in got.reasons))

    def test_invalid_units_for_boolean_and_provider_inputs_raise(self):
        for field in ('liquidity_acceptable', 'execution_quality_acceptable', 'stress_gap_detected',
                      'stress_iv_shock_detected', 'stress_spread_widening_detected'):
            for bad in (1, 0, 'true', 'False', 1.0, [], 'UNKNOWN'):
                with self.subTest(field=field, bad=repr(bad)):
                    with self.assertRaises(ValueError):
                        assess_aegis(_policy(), replace(_clean_inputs(), **{field: bad}))
        for bad in ('', '   ', 5, b'GOOD', ['GOOD']):
            with self.subTest(provider_state=repr(bad)):
                with self.assertRaises(ValueError):
                    assess_aegis(_policy(), _clean_inputs(provider_state=bad))
        for bad in (frozenset(), frozenset({''}), frozenset({' '}), frozenset({1})):
            with self.subTest(required=repr(bad)):
                with self.assertRaises(ValueError):
                    assess_aegis(_policy(provider_required_states=bad), _clean_inputs())
        for field in ('stress_iv_shock_applicability', 'stress_spread_widening_applicability'):
            for bad in ('', 'NOT_APPLICABLE', 'required', None, True):
                with self.subTest(field=field, bad=repr(bad)):
                    with self.assertRaises(ValueError):
                        assess_aegis(_policy(), replace(_clean_inputs(), **{field: bad}))


class IsolationTests(unittest.TestCase):
    """No family bypassed by strategy identity; no unrelated-family veto contamination."""

    def test_aegis_contract_carries_no_strategy_identity_so_it_cannot_be_bypassed_by_one(self):
        forbidden = ('strategy', 'branch', 'archetype', 'bot', 'family_override', 'bypass', 'skip', 'exempt', 'waive')
        names = [f.name for f in dataclasses.fields(AegisInputs)] + [f.name for f in dataclasses.fields(AegisPolicy)]
        names += list(assess_aegis.__code__.co_varnames[:assess_aegis.__code__.co_argcount])
        for name in names:
            self.assertFalse(any(token in name.lower() for token in forbidden), name)
        self.assertEqual(assess_aegis.__code__.co_argcount, 2)

    def test_every_family_still_vetoes_the_same_way_regardless_of_policy_version_label(self):
        # The only identity-like field is policy_version; it is a label and must never change a verdict.
        base_inputs = _clean_inputs(liquidity_acceptable=False, provider_state='INVALID', ticker_concentration_pct=1.0)
        reference = all_family_states(assess_aegis(_policy(), base_inputs))
        for label in ('THETA_Q', 'THETA_H', 'THETA_D', 'THETA_C', 'THETA_A', 'THETA_R', 'PULSE', ''):
            self.assertEqual(all_family_states(assess_aegis(_policy(policy_version=label), base_inputs)), reference, label)

    def test_exit_supremacy_holds_under_every_state_and_vetoed_state_opens_nothing(self):
        for state in RiskState:
            for action in ('CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'):
                self.assertTrue(is_action_permitted(state, action))
        for state in (HOLD, VETO):
            for action in ('OPEN_CSP', 'OPEN_CSP_REDUCED', 'SELL_CC', 'ROLL', 'OPEN_DEFINED_RISK_SPREAD'):
                self.assertFalse(is_action_permitted(state, action), (state, action))

    def test_worsening_one_input_changes_only_the_families_that_declare_that_input(self):
        policy = _policy()
        declared = {}
        for family, (inp, _cap) in AEGIS_NUMERIC_FAMILY_FIELDS.items():
            declared.setdefault(_snake(inp), set()).add(family)
        for family, fields in AEGIS_STATE_FAMILY_FIELDS.items():
            for camel in fields:
                if camel.endswith('Applicability'):
                    continue
                declared.setdefault(_snake(camel), set()).add(family)
        worst = {
            'ticker_concentration_pct': 1.0, 'sector_concentration_pct': 1.0, 'correlation_cluster_exposure_pct': 1.0,
            'portfolio_capital_at_risk_pct': 1.0, 'inventory_capacity_used_pct': 1.0,
            'assignment_capacity_used_pct': 1.0, 'recovery_capacity_used_pct': 1.0,
            'liquidity_acceptable': False, 'execution_quality_acceptable': False, 'provider_state': 'INVALID',
            'stress_gap_detected': True, 'stress_iv_shock_detected': True, 'stress_spread_widening_detected': True,
        }
        base = all_family_states(assess_aegis(policy, _clean_inputs()))
        for field, value in worst.items():
            after = all_family_states(assess_aegis(policy, replace(_clean_inputs(), **{field: value})))
            changed = {name for name in base if after[name] != base[name]}
            self.assertTrue(changed, f'{field} worst value must be visible in at least one family')
            self.assertLessEqual(changed, declared[field], f'{field} contaminated undeclared families {changed - declared[field]}')

    def test_a_vetoed_family_does_not_rewrite_other_families_states(self):
        policy = _policy()
        vetoed = all_family_states(assess_aegis(policy, _clean_inputs(provider_state='INVALID')))
        self.assertEqual(vetoed['PROVIDER'], VETO)
        self.assertTrue(all(state == FULL for name, state in vetoed.items() if name != 'PROVIDER'), vetoed)

    def test_reasons_never_list_all_families_allow_full_when_any_family_restricts(self):
        got = assess_aegis(_policy(), _clean_inputs(execution_quality_acceptable=False))
        self.assertFalse(any(r.code == 'ALL_FAMILIES_ALLOW_FULL' for r in got.reasons))
        self.assertTrue(any(r.code == 'EXECUTION_QUALITY_POOR' for r in got.reasons))


def _snake(camel):
    out = ''
    for ch in camel:
        out += ('_' + ch.lower()) if ch.isupper() else ch
    return out.replace('_pct', '_pct')


class MonotonicityDocumentationTests(unittest.TestCase):
    def test_worse_input_is_never_more_permissive_for_every_single_field_chain(self):
        policy = _policy()
        chains = {
            'liquidity_acceptable': [True, None, False],
            'execution_quality_acceptable': [True, False, None],
            'provider_state': ['GOOD', 'STALE', 'INVALID'],
            'stress_gap_detected': [False, True, None],
            'stress_iv_shock_detected': [False, True, None],
            'stress_spread_widening_detected': [False, True, None],
        }
        for family, (field, cap_field) in NUMERIC.items():
            cap = getattr(policy, cap_field)
            chains[field] = [0.0, cap, None, cap * policy.hard_cap_multiplier]
        for field, chain in chains.items():
            ranks = [rank(assess_aegis(policy, replace(_clean_inputs(), **{field: v})).new_risk_state) for v in chain]
            self.assertEqual(ranks, sorted(ranks), f'{field}: {ranks}')

    def test_unknown_is_ranked_between_known_bad_and_known_good_by_design_for_boolean_families(self):
        # Intentional ordering, not an exception: unknown liquidity (HOLD_ONLY) is *less* strict than known-failed
        # liquidity (HARD_VETO) because UNKNOWN is missing evidence (recoverable by waiting), a failed check is a finding.
        policy = _policy()
        failed = assess_aegis(policy, _clean_inputs(liquidity_acceptable=False)).new_risk_state
        unknown = assess_aegis(policy, _clean_inputs(liquidity_acceptable=None)).new_risk_state
        passed = assess_aegis(policy, _clean_inputs(liquidity_acceptable=True)).new_risk_state
        self.assertLess(rank(passed), rank(unknown))
        self.assertLess(rank(unknown), rank(failed))

    def test_cold_start_marker_is_the_only_loosening(self):
        """DOCUMENTED INTENTIONAL NON-MONOTONIC EXCEPTION.

        Switching stress_spread_widening_applicability / stress_iv_shock_applicability from REQUIRED to
        PAPER_COLD_START_NOT_APPLICABLE is a versioned *applicability* decision (historical baseline still
        accumulating), not a worsening of a risk input. It may make the result MORE permissive. Everything else in
        the contract is monotone, and the marker (a) never converts UNKNOWN to False, (b) never touches PER_TRADE
        (current liquidity), (c) never touches the gap detector, (d) rejects any other marker spelling.
        """
        policy = _policy()
        marker = 'PAPER_COLD_START_NOT_APPLICABLE'
        strictly_looser = []
        for detected in (False, True, None):
            required = assess_aegis(policy, _clean_inputs(stress_spread_widening_detected=detected))
            cold = assess_aegis(policy, _clean_inputs(stress_spread_widening_detected=detected,
                                                      stress_spread_widening_applicability=marker))
            self.assertLessEqual(rank(cold.new_risk_state), rank(required.new_risk_state))
            if rank(cold.new_risk_state) < rank(required.new_risk_state):
                strictly_looser.append(detected)
            self.assertEqual(family_state(cold, 'LIQUIDITY'), FULL)
        self.assertEqual(set(strictly_looser), {True, None}, 'the loosening exists exactly for stress-present/unknown')
        # (a)+(b): current per-trade liquidity still binds under the marker.
        for liquidity, expected in ((False, VETO), (None, HOLD)):
            got = assess_aegis(policy, _clean_inputs(liquidity_acceptable=liquidity,
                                                     stress_spread_widening_detected=None,
                                                     stress_spread_widening_applicability=marker))
            self.assertEqual(family_state(got, 'PER_TRADE'), expected)
            self.assertEqual(got.new_risk_state, expected)
        # (c) gap detector unaffected, even with both markers.
        got = assess_aegis(policy, _clean_inputs(stress_gap_detected=None, stress_iv_shock_detected=None,
                                                 stress_spread_widening_detected=None,
                                                 stress_iv_shock_applicability=marker,
                                                 stress_spread_widening_applicability=marker))
        self.assertEqual(family_state(got, 'SYSTEM'), HOLD)
        got = assess_aegis(policy, _clean_inputs(stress_gap_detected=True, stress_iv_shock_detected=None,
                                                 stress_spread_widening_detected=None,
                                                 stress_iv_shock_applicability=marker,
                                                 stress_spread_widening_applicability=marker))
        self.assertEqual(family_state(got, 'SYSTEM'), REDUCED)
        # (d) only the exact versioned marker is honoured.
        with self.assertRaises(ValueError):
            assess_aegis(policy, _clean_inputs(stress_spread_widening_applicability='COLD_START'))
        # The marker never relaxes any non-stress family.
        for family, (field, _) in NUMERIC.items():
            got = assess_aegis(policy, replace(_clean_inputs(stress_spread_widening_applicability=marker,
                                                             stress_iv_shock_applicability=marker), **{field: 1.0}))
            self.assertEqual(family_state(got, family), VETO)
            self.assertEqual(got.new_risk_state, VETO)


class CapacityZeroVersusHardVetoSemanticsTests(unittest.TestCase):
    """Canonical resolution (see report): a *valid* candidate on an account that cannot size one contract is
    QUANTITY ZERO (sizing outcome), not an AEGIS HARD_VETO. AEGIS HARD_VETO is reserved for a family cap breach or a
    failed/invalid safety input. AEGIS has no quantity: it returns the new-risk state only, and capacity *exposure*
    inputs at/after the hard cap are the only capacity-flavoured path to HARD_VETO."""

    def test_aegis_has_no_quantity_and_clean_inputs_say_allow_full_irrespective_of_account_size(self):
        got = assess_aegis(_policy(), _clean_inputs())
        self.assertFalse(hasattr(got, 'quantity'))
        self.assertEqual(got.new_risk_state, FULL)

    def test_hard_veto_requires_a_veto_family_state_not_merely_zero_headroom(self):
        # Used capacity just under the hard cap leaves positive-but-small headroom: REDUCED, never VETO.
        policy = _policy()
        for family, (field, cap_field) in NUMERIC.items():
            hard = getattr(policy, cap_field) * policy.hard_cap_multiplier
            got = assess_aegis(policy, replace(_clean_inputs(), **{field: math.nextafter(hard, 0.0)}))
            self.assertEqual(got.new_risk_state, REDUCED, family)


if __name__ == '__main__':
    unittest.main()
