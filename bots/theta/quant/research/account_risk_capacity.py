"""R3 fast-forward: account-level risk semantics and isolation research
contract (master account today, future follower accounts).

THETA v1 has exactly one Production account (`MASTER_THETA_PAPER`). This
module is RESEARCH preparation for the future multi-account (master +
follower) world the R4 sizing/copy-economics work depends on -- it does
not implement or activate any Production auth/account code (that remains
Codex's). It defines the account-isolation INVARIANT so a future follower
sizing engine cannot be built with a latent cross-account leak.

No I/O, no provider dependency -- pure functions over caller-supplied
per-account state, exercised only against synthetic fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional


class AccountRole(str, Enum):
    MASTER = "MASTER"
    FOLLOWER = "FOLLOWER"


@dataclass(frozen=True)
class AccountRiskCapacity:
    """One account's OWN risk capacities -- every field here must be
    derivable strictly from THIS account's own equity/positions/limits,
    never from another account's state. `account_id` exists specifically
    so `assert_account_isolation` can verify that."""

    account_id: str
    account_role: AccountRole
    equity: Optional[float]
    collateral_capacity: Optional[float]  # max $ this account may commit to new secured collateral
    assignment_capacity: Optional[float]  # max shares this account could absorb from assignment
    portfolio_tail_budget: Optional[float]  # max $ stress loss this account's own risk envelope tolerates
    concentration_capacity: Dict[str, float]  # symbol/sector/cluster key -> max $ exposure for THIS account
    custom_cap: Optional[float] = None  # an account-specific (e.g. owner-configured follower) override cap, never inferred from another account


def compute_account_qty_cap(
    capacity: AccountRiskCapacity,
    required_collateral_per_contract: Optional[float],
    stress_loss_per_contract: Optional[float],
    concentration_key: str,
    exposure_per_contract: Optional[float],
    assignment_shares_per_contract: float,
) -> int:
    """The per-account analogue of `models/sizing.py`'s own `Qty =
    min(...)` formalization -- reused conceptually, not duplicated: this
    function computes ONE account's own cap from ONE account's own
    capacity fields. It does not aggregate across accounts and does not
    replace `sizing.py`'s own AEGIS-aware Production sizing; it exists so
    a per-account cap can be computed BEFORE AEGIS/broker-capacity layers
    are applied, for research/planning purposes. Quantity zero is always
    a legitimate result -- never floored to 1."""
    caps: List[float] = []

    if capacity.collateral_capacity is None or required_collateral_per_contract is None or required_collateral_per_contract <= 0:
        return 0
    caps.append(capacity.collateral_capacity / required_collateral_per_contract)

    if capacity.assignment_capacity is None or assignment_shares_per_contract <= 0:
        return 0
    caps.append(capacity.assignment_capacity / assignment_shares_per_contract)

    if capacity.portfolio_tail_budget is None or stress_loss_per_contract is None or stress_loss_per_contract <= 0:
        return 0
    caps.append(capacity.portfolio_tail_budget / stress_loss_per_contract)

    remaining_concentration = capacity.concentration_capacity.get(concentration_key)
    if remaining_concentration is None or exposure_per_contract is None or exposure_per_contract <= 0:
        return 0
    caps.append(remaining_concentration / exposure_per_contract)

    if capacity.custom_cap is not None:
        caps.append(capacity.custom_cap)

    return max(0, int(min(caps)))


def assert_account_isolation(capacities: Dict[str, AccountRiskCapacity]) -> List[str]:
    """Structural isolation check: every `AccountRiskCapacity` in the
    mapping must be keyed by its OWN `account_id` (never accidentally
    keyed by, or duplicated from, another account's id), and no two
    DIFFERENT account_ids may share the exact same capacity object
    identity (a copy-paste bug that would silently make two accounts
    share one risk budget). Returns violations (empty = isolated)."""
    violations: List[str] = []
    seen_object_ids: Dict[int, str] = {}
    for key, capacity in capacities.items():
        if capacity.account_id != key:
            violations.append(f"capacity keyed as {key!r} but carries account_id={capacity.account_id!r}")
        object_id = id(capacity)
        if object_id in seen_object_ids:
            violations.append(f"accounts {seen_object_ids[object_id]!r} and {key!r} share the identical capacity object -- not isolated")
        seen_object_ids[object_id] = key
    return violations


def total_master_and_follower_exposure_never_shared(master: AccountRiskCapacity, follower: AccountRiskCapacity) -> bool:
    """A concrete, testable isolation property: the follower's own
    concentration_capacity dict must never be the SAME dict object as the
    master's (which would mean a write to one silently affects the
    other's remaining budget)."""
    return master.concentration_capacity is not follower.concentration_capacity


def unknown_capacity_never_increases_quantity(
    known: AccountRiskCapacity,
    with_unknown_field: AccountRiskCapacity,
    required_collateral_per_contract: float,
    stress_loss_per_contract: float,
    concentration_key: str,
    exposure_per_contract: float,
    assignment_shares_per_contract: float,
) -> bool:
    """R3 invariant: replacing any known capacity with UNKNOWN must never
    produce a LARGER quantity than the fully-known account. Unknown is a
    restriction, never a licence."""
    known_qty = compute_account_qty_cap(
        known, required_collateral_per_contract, stress_loss_per_contract,
        concentration_key, exposure_per_contract, assignment_shares_per_contract,
    )
    unknown_qty = compute_account_qty_cap(
        with_unknown_field, required_collateral_per_contract, stress_loss_per_contract,
        concentration_key, exposure_per_contract, assignment_shares_per_contract,
    )
    return unknown_qty <= known_qty


@dataclass(frozen=True)
class R3ExitCheck:
    """R3 research-side exit criteria. Each field is a property that must
    hold for the account-risk research contract to be considered closed."""

    every_account_has_isolated_capacities: bool
    no_follower_uses_master_state: bool
    quantity_is_min_of_feasible_capacities: bool
    zero_quantity_is_valid: bool
    unknown_capacity_cannot_increase_quantity: bool


def r3_quant_risk_contract(check: R3ExitCheck) -> str:
    """Returns "PASS" only when EVERY criterion holds; otherwise "FAIL"
    -- there is no partial pass. This is a research-side statement about
    the contract's completeness, never an authorization of anything."""
    return "PASS" if all(
        getattr(check, name) for name in check.__dataclass_fields__
    ) else "FAIL"
