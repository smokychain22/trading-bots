"""Pairwise AEGIS monotonicity over random base vectors.

The existing property test worsens one input from a clean baseline. This one proves the stronger statement that makes
override layering safe: for ANY base input vector and ANY single field, moving that field to a value of higher
strictness rank can never produce a strictly more permissive AEGIS state. A Production override that is tighten-only
by this ranking therefore can never raise capacity, remove a hard veto, or turn an unknown into a pass.

The versioned Paper cold-start applicability marker is a deliberate, documented loosening and is held at REQUIRED here;
its eligibility (only BASELINE_ACCUMULATING with a valid, fresh current observation) is tested separately.
"""
import random
import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_aegis import _clean_inputs, _policy
from models.aegis import _STRICTNESS_ORDER, assess_aegis


def _rank(state):
    return _STRICTNESS_ORDER.index(state)


def _domains(policy):
    ok_provider = sorted(policy.provider_required_states)[0]
    numeric = {}
    for field, cap in (
        ('ticker_concentration_pct', policy.max_ticker_concentration_pct),
        ('sector_concentration_pct', policy.max_sector_concentration_pct),
        ('correlation_cluster_exposure_pct', policy.max_correlation_cluster_pct),
        ('portfolio_capital_at_risk_pct', policy.max_portfolio_capital_at_risk_pct),
        ('inventory_capacity_used_pct', policy.max_inventory_capacity_pct),
        ('assignment_capacity_used_pct', policy.max_assignment_capacity_pct),
        ('recovery_capacity_used_pct', policy.max_recovery_capacity_pct),
    ):
        # (value, strictness rank of the resulting family state): below cap < at cap (reduced) < unknown (hold) < hard cap (veto)
        numeric[field] = [(0.0, 0), (cap, 1), (None, 3), (cap * policy.hard_cap_multiplier, 4)]
    return {
        **numeric,
        'liquidity_acceptable': [(True, 0), (None, 3), (False, 4)],
        'execution_quality_acceptable': [(True, 0), (False, 2), (None, 3)],
        'provider_state': [(ok_provider, 0), ('SYNTHETIC_NOT_REQUIRED_STATE', 3), (None, 3), ('INVALID', 4)],
        'stress_gap_detected': [(False, 0), (True, 1), (None, 3)],
        'stress_iv_shock_detected': [(False, 0), (True, 1), (None, 3)],
        'stress_spread_widening_detected': [(False, 0), (True, 1), (None, 3)],
    }


class AegisPairwiseMonotonicityTests(unittest.TestCase):
    def test_a_higher_strictness_value_never_yields_a_more_permissive_state(self):
        policy = _policy()
        domains = _domains(policy)
        rng = random.Random(20261001)
        base = _clean_inputs()
        for case in range(3000):
            vector = replace(base, **{field: rng.choice(values)[0] for field, values in domains.items()})
            for field, values in domains.items():
                results = []
                for value, rank in values:
                    state = assess_aegis(policy, replace(vector, **{field: value})).new_risk_state
                    results.append((rank, _rank(state), value))
                for rank_a, state_a, value_a in results:
                    for rank_b, state_b, value_b in results:
                        if rank_a < rank_b:
                            self.assertLessEqual(state_a, state_b,
                                f'case {case} field {field}: {value_a!r}(rank {rank_a}) is stricter than {value_b!r}(rank {rank_b})')

    def test_adding_a_tighten_only_override_never_removes_a_veto_or_raises_permission(self):
        policy = _policy()
        rng = random.Random(7)
        domains = _domains(policy)
        base = _clean_inputs()
        for _ in range(2000):
            vector = replace(base, **{field: rng.choice(values)[0] for field, values in domains.items()})
            before = assess_aegis(policy, vector)
            field = rng.choice(sorted(domains))
            current_rank = next((rank for value, rank in domains[field] if value == getattr(vector, field)), 0)
            stricter = [value for value, rank in domains[field] if rank >= current_rank]
            after = assess_aegis(policy, replace(vector, **{field: rng.choice(stricter)}))
            self.assertGreaterEqual(_rank(after.new_risk_state), _rank(before.new_risk_state))
            if before.new_risk_state.value == 'HARD_VETO':
                self.assertEqual(after.new_risk_state.value, 'HARD_VETO')

    def test_unknown_is_never_more_permissive_than_the_known_safe_value_it_replaces(self):
        policy = _policy()
        domains = _domains(policy)
        base = _clean_inputs()
        for field, values in domains.items():
            safe = values[0][0]
            clean = assess_aegis(policy, replace(base, **{field: safe})).new_risk_state
            unknown = assess_aegis(policy, replace(base, **{field: None})).new_risk_state
            self.assertGreaterEqual(_rank(unknown), _rank(clean), field)


if __name__ == '__main__':
    unittest.main()
