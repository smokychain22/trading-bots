"""Mechanical policy implementations for the canonical benchmark IDs beyond
B0 (work package 59 completion, V4 section 5).

Each function here is a pure, deterministic mechanic -- it takes exactly
the inputs its benchmark needs and returns a real result when given real
data, or raises a named `ValueError` when a required input is missing.
Whether real historical data actually SUPPLIES those inputs today is a
separate question, decided by `benchmark_runner.py`'s dispatch layer, not
here. No mechanic silently substitutes a synthetic/assumed value for a
missing real one.
"""
from __future__ import annotations

import random
from typing import Dict, Optional, Sequence, Tuple


def select_by_metric(
    candidates: Sequence[Dict[str, object]], metric_key: str, higher_is_better: bool = True,
) -> Optional[Dict[str, object]]:
    """B(Q-1)/BQ-3-style selection: pick the candidate maximizing (or
    minimizing) a named, already-present metric. Raises if any eligible
    candidate is missing the metric -- never silently skips it."""
    eligible = [c for c in candidates if c.get('hardStatus') == 'FEASIBLE']
    if not eligible:
        return None
    missing = [c.get('candidateId') for c in eligible if metric_key not in c or c[metric_key] is None]
    if missing:
        raise ValueError(f'BENCHMARK_MECHANIC_METRIC_MISSING:{metric_key}:{missing[0]}')
    return (max if higher_is_better else min)(eligible, key=lambda c: c[metric_key])


def random_eligible_selection(candidates: Sequence[Dict[str, object]], seed: int) -> Optional[Dict[str, object]]:
    """B5: deterministic seeded random pick among FEASIBLE candidates,
    matched by ticker/DTE/structure/size per benchmarks.json's own
    description -- this function performs the random draw only; matching
    is the caller's responsibility since it depends on the archetype."""
    eligible = sorted((c for c in candidates if c.get('hardStatus') == 'FEASIBLE'), key=lambda c: c.get('candidateId', ''))
    if not eligible:
        return None
    return random.Random(seed).choice(eligible)


def fixed_capture_exit(entry_credit: float, price_path: Sequence[Tuple[str, float]], capture_fraction: float) -> Optional[dict]:
    """B3 (25/50/75%) / BR-2 (fixed 50%): first point in a post-entry price
    path where the captured fraction of entry_credit is realized. `None`
    if the path never reaches it (position held to its natural end)."""
    if not (0 < capture_fraction < 1):
        raise ValueError('BENCHMARK_MECHANIC_CAPTURE_FRACTION_INVALID')
    if entry_credit <= 0:
        raise ValueError('BENCHMARK_MECHANIC_ENTRY_CREDIT_MUST_BE_POSITIVE')
    target_debit = entry_credit * (1 - capture_fraction)
    for timestamp, close_debit_price in price_path:
        if close_debit_price <= target_debit:
            realized = entry_credit - close_debit_price
            return {'exitTimestamp': timestamp, 'realizedPnl': realized, 'captureFraction': capture_fraction}
    return None


def fixed_time_exit(price_path: Sequence[Tuple[str, float]], entry_credit: float, hold_bars: int) -> Optional[dict]:
    """B4: exit at a fixed number of observation bars after entry,
    regardless of profit level. `None` if the path is shorter than
    hold_bars (position never reaches the fixed exit point in this path)."""
    if hold_bars <= 0:
        raise ValueError('BENCHMARK_MECHANIC_HOLD_BARS_INVALID')
    if len(price_path) < hold_bars:
        return None
    timestamp, close_debit_price = price_path[hold_bars - 1]
    return {'exitTimestamp': timestamp, 'realizedPnl': entry_credit - close_debit_price}


def hold_to_expiry_outcome(entry_credit: float, underlying_price_at_expiration: float, strike: float) -> dict:
    """BR-1: never roll, never close early -- the option settles at
    expiration. Deliberately does NOT infer assignment from moneyness (the
    charter's own non-negotiable rule): this returns the OPTION's
    settlement value only, tagged so a caller must not treat it as an
    assignment determination."""
    intrinsic = max(strike - underlying_price_at_expiration, 0.0)
    return {'realizedOptionPnl': entry_credit - intrinsic, 'itmAtExpiration': underlying_price_at_expiration < strike,
            'assignmentDetermination': 'NOT_INFERRED_FROM_MONEYNESS_SEE_ASSIGNMENT_LABELS_MODULE'}


def mechanical_assignment_response(assigned: bool, policy: str) -> str:
    """BA-1 (mechanical close-before-assignment) / BA-3 (unconditional
    assignment acceptance): both are deliberately bad, mechanical extremes
    -- this function only encodes the mechanical rule, never a real
    decision. `policy` must be one of the two named extremes."""
    if policy not in ('BA1_CLOSE_BEFORE_ASSIGNMENT', 'BA3_UNCONDITIONAL_ACCEPT'):
        raise ValueError('BENCHMARK_MECHANIC_UNKNOWN_ASSIGNMENT_POLICY')
    if policy == 'BA1_CLOSE_BEFORE_ASSIGNMENT':
        return 'CLOSED_BEFORE_ASSIGNMENT_EVENT'  # throws away recoverable optionality, by design
    return 'ACCEPTED' if assigned else 'NOT_APPLICABLE_NOT_ASSIGNED'


def unconditional_hold_to_basis_recovery(original_basis: float, current_price: float) -> dict:
    """BA-2: hold assigned stock unconditionally until price recovers to
    original cost basis, regardless of how long that takes or what better
    alternatives existed meanwhile."""
    return {'recovered': current_price >= original_basis, 'gapToBasis': original_basis - current_price}


def covered_call_max_yield_selection(candidates: Sequence[Dict[str, object]]) -> Optional[Dict[str, object]]:
    """BC-1: always the maximum-annualized-yield covered call, ignoring
    every other qualitative factor."""
    eligible = [c for c in candidates if c.get('hardStatus') == 'FEASIBLE']
    missing = [c.get('candidateId') for c in eligible if c.get('annualizedYield') is None]
    if missing:
        raise ValueError(f'BENCHMARK_MECHANIC_ANNUALIZED_YIELD_MISSING:{missing[0]}')
    return max(eligible, key=lambda c: c['annualizedYield']) if eligible else None


def immediate_cc_after_assignment(assigned: bool) -> str:
    """BC-2: sell a covered call immediately after every assignment,
    regardless of ownership quality or regime -- a direct test of the
    charter's own non-negotiable "assignment is a modeled lifecycle
    transition, never automatic" rule, by being the counterfactual that
    ignores it on purpose."""
    return 'SELL_CC_IMMEDIATELY' if assigned else 'NOT_APPLICABLE_NOT_ASSIGNED'


def buy_and_hold_return(entry_price: float, exit_price: float) -> float:
    """B6: passive buy-and-hold of the assigned underlying, no active
    management at all."""
    if entry_price <= 0:
        raise ValueError('BENCHMARK_MECHANIC_ENTRY_PRICE_MUST_BE_POSITIVE')
    return (exit_price - entry_price) / entry_price
