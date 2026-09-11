"""Fine-grained feature-role taxonomy for THETA (R6E).

Extends `docs/quant/phase6_router/HARD_GATE_VS_SOFT_FEATURE_REGISTRY.md`'s
existing coarse HARD_GATE / SOFT (soft feature) split into the eight-way
classification R6E requests, so a feature has an explicit destination role
rather than defaulting into "entry gating" simply because it exists. This
is the concrete mechanism against "25 independent AND conditions -> almost
zero candidates": a feature classified MANAGEMENT_ONLY_FEATURE or
EXECUTION_ONLY_FEATURE structurally CANNOT become a 26th entry-gate AND
condition, because nothing in this registry routes it there.

No I/O, no provider dependency -- a static registry plus lookup helpers,
exercised only against synthetic fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional


class FeatureRole(str, Enum):
    HARD_GATE = "HARD_GATE"  # rare, binary, blocks the decision from being evaluated at all (per HARD_GATE_VS_SOFT_FEATURE_REGISTRY.md's own "unsafe to evaluate" bar)
    SOFT_FEATURE = "SOFT_FEATURE"  # influences ranking/confidence continuously, never an automatic veto
    SOFT_PENALTY = "SOFT_PENALTY"  # a specific SOFT_FEATURE subtype that only ever subtracts from a score/utility, never adds
    SOFT_BONUS = "SOFT_BONUS"  # a specific SOFT_FEATURE subtype that only ever adds to a score/utility, never subtracts
    STRUCTURE_ROUTER_INPUT = "STRUCTURE_ROUTER_INPUT"  # feeds strategy_router.py's eligibility routing (which BRANCH may compete), never entry gating within a branch
    MANAGEMENT_ONLY_FEATURE = "MANAGEMENT_ONLY_FEATURE"  # feeds management_action_value.py-style HOLD/CLOSE/ROLL/ASSIGN valuation only -- never an entry gate
    RISK_ONLY_FEATURE = "RISK_ONLY_FEATURE"  # feeds AEGIS/sizing.py capacity constraints only -- never an entry gate or a ranking bonus
    EXECUTION_ONLY_FEATURE = "EXECUTION_ONLY_FEATURE"  # feeds execution_quality.py/execution_simulator.py fill/slippage modeling only -- never entry gating or management valuation


@dataclass(frozen=True)
class FeatureDestination:
    feature_name: str
    role: FeatureRole
    rationale: str
    evidence_status: str  # e.g. "AVAILABLE" (ablation.py's FeatureFamilyStatus), or a short note; not re-typed as an enum here to avoid a THIRD status vocabulary alongside ablation.py's


# The feature destination map (R6E item 5): every feature named across this
# phase's research corpus (friend-bot audit, flow comparison, GEX matrix,
# IV comparison, GitHub formula catalog, hypotheses.json) gets exactly one
# row. A feature not in this dict has no assigned destination YET -- that is
# a flagged gap, never silently defaulted to entry gating.
FEATURE_DESTINATION_MAP: Dict[str, FeatureDestination] = {
    # Hard gates (already implemented, per HARD_GATE_VS_SOFT_FEATURE_REGISTRY.md)
    "critical_data_validity": FeatureDestination(
        "critical_data_validity", FeatureRole.HARD_GATE,
        "Unsafe to evaluate at all with invalid/UNKNOWN quotes/contracts/timestamps/broker state.",
        "AVAILABLE",
    ),
    "aegis_hard_veto": FeatureDestination(
        "aegis_hard_veto", FeatureRole.HARD_GATE,
        "AEGIS aggregation already a hard, blanket exclusion.",
        "AVAILABLE",
    ),
    "spread_executability": FeatureDestination(
        "spread_executability", FeatureRole.HARD_GATE,
        "option-contract.ts's own executable=false on a wide/crossed spread -- unsafe to price at all, not merely less attractive.",
        "AVAILABLE",
    ),
    # Structure-router inputs (feed strategy_router.py, never entry gating within a branch)
    "lifecycle_state": FeatureDestination(
        "lifecycle_state", FeatureRole.STRUCTURE_ROUTER_INPUT,
        "Determines which strategy family may even compete this cycle (strategy_router.py Layer 1).",
        "AVAILABLE",
    ),
    "stock_shares_held": FeatureDestination(
        "stock_shares_held", FeatureRole.STRUCTURE_ROUTER_INPUT,
        "Gates THETA-C eligibility structurally (confirmed inventory required) -- a router input, not a CC entry-gate feature.",
        "AVAILABLE",
    ),
    "event_near": FeatureDestination(
        "event_near", FeatureRole.STRUCTURE_ROUTER_INPUT,
        "Excludes THETA-H eligibility (strategy_router.py) -- routing, not a per-candidate soft feature within THETA-Q.",
        "AVAILABLE",
    ),
    # Soft features (ranking/confidence, continuous)
    "ownership_acceptability": FeatureDestination(
        "ownership_acceptability", FeatureRole.SOFT_FEATURE,
        "Continuous [0,1] score with two different floors for THETA-Q/THETA-H -- a graded feature, not a single binary gate (though the FLOOR itself is a hard gate; the score above the floor is soft ranking input).",
        "AVAILABLE",
    ),
    "iv_rank": FeatureDestination(
        "iv_rank", FeatureRole.SOFT_FEATURE,
        "TRD UNIV-002 already forbids 'high IV alone is sufficient' as a hard rule -- IV rank/percentile is a ranking input, never a standalone gate.",
        "AVAILABLE",
    ),
    "rsi_trend_momentum": FeatureDestination(
        "rsi_trend_momentum", FeatureRole.SOFT_FEATURE,
        "R6E item 18: 'quality-first CSP engine' proposed RSI 40-60 as a hard rule -- reclassified here as a soft underlying-state feature, a hypothesis to ablate, never a mandatory band.",
        "NOT_TESTED",
    ),
    # Soft bonuses / penalties (a feature that structurally only ever pushes one direction)
    "sweep_classification": FeatureDestination(
        "sweep_classification", FeatureRole.SOFT_BONUS,
        "Friend-bot audit: sweep is evidence FOR conviction when present, never evidence against when absent -- structurally one-directional, so SOFT_BONUS not SOFT_FEATURE. Its incremental value is still an open hypothesis (FRIEND_OPTION_FLOW_BOT_AUDIT.md).",
        "NOT_IMPLEMENTED",
    ),
    "severe_drawdown_probability": FeatureDestination(
        "severe_drawdown_probability", FeatureRole.SOFT_PENALTY,
        "p_severe_drawdown only ever penalizes (tail_risk_penalty in management_action_value.py) -- never a bonus.",
        "AVAILABLE",
    ),
    # Management-only features
    "recovery_median": FeatureDestination(
        "recovery_median", FeatureRole.MANAGEMENT_ONLY_FEATURE,
        "Feeds recovery_spec.py/recovery_decision.py's RECOVERY_WAIT-vs-alternatives valuation only -- never an entry gate.",
        "AVAILABLE",
    ),
    "call_away_regret": FeatureDestination(
        "call_away_regret", FeatureRole.MANAGEMENT_ONLY_FEATURE,
        "covered_call_ranker.py's CCUtility component -- meaningless before stock is actually held, so it cannot be an entry feature by construction.",
        "AVAILABLE",
    ),
    # Risk-only features
    "concentration_cluster_exposure": FeatureDestination(
        "concentration_cluster_exposure", FeatureRole.RISK_ONLY_FEATURE,
        "correlation_metrics.py's cluster_concentration -- a portfolio-level capacity constraint (sizing.py's concentration_qty_cap), never a per-candidate ranking bonus.",
        "AVAILABLE",
    ),
    "assignment_capacity": FeatureDestination(
        "assignment_capacity", FeatureRole.RISK_ONLY_FEATURE,
        "account-exposure.ts's deriveAssignmentCapacity -- consumed by AEGIS/sizing.py only.",
        "AVAILABLE",
    ),
    # Execution-only features
    "quote_spread": FeatureDestination(
        "quote_spread", FeatureRole.EXECUTION_ONLY_FEATURE,
        "Feeds execution_quality.py's fill-probability/slippage estimate continuously below the hard max_acceptable_spread_pct cutoff -- never an entry ranking bonus on its own.",
        "AVAILABLE",
    ),
    "quote_freshness": FeatureDestination(
        "quote_freshness", FeatureRole.EXECUTION_ONLY_FEATURE,
        "data-freshness.ts's freshness gate is itself a HARD_GATE upstream of candidate economics; the continuous staleness measure below that threshold is execution-only context.",
        "AVAILABLE",
    ),
    "open_interest_volume": FeatureDestination(
        "open_interest_volume", FeatureRole.EXECUTION_ONLY_FEATURE,
        "theta_q_baseline.py's OI/volume floors are currently HARD_GATEs per the frozen TRD (see HARD_GATE_VS_SOFT_FEATURE_REGISTRY.md's flagged tension) -- classified here by its EXECUTION/liquidity role (fill quality), distinct from the separate, TRD-owned question of whether the floor itself should be hard or soft.",
        "AVAILABLE",
    ),
    "gex_zero_gamma": FeatureDestination(
        "gex_zero_gamma", FeatureRole.SOFT_FEATURE,
        "THETA_GEX_DEFINITION_MATRIX.md -- REFERENCE_ONLY, not implemented; would be a soft ranking/regime-context feature if ever built, never a gate (no real data exists to justify a hard threshold).",
        "NOT_IMPLEMENTED",
    ),
}


def classify(feature_name: str) -> Optional[FeatureDestination]:
    """Returns the registered destination for a feature name, or None if it
    has not yet been classified -- an unclassified feature must never be
    silently treated as entry-gate-eligible by a caller; None is the
    caller's signal to classify it explicitly before using it anywhere."""
    return FEATURE_DESTINATION_MAP.get(feature_name)


def count_by_role() -> Dict[FeatureRole, int]:
    counts: Dict[FeatureRole, int] = {role: 0 for role in FeatureRole}
    for destination in FEATURE_DESTINATION_MAP.values():
        counts[destination.role] += 1
    return counts


def features_eligible_for_entry_gating() -> Dict[str, FeatureDestination]:
    """The ONLY roles a feature may occupy to legitimately participate in
    entry-candidate gating/ranking: HARD_GATE (as an actual gate, sparingly),
    SOFT_FEATURE, SOFT_PENALTY, SOFT_BONUS, and STRUCTURE_ROUTER_INPUT (which
    gates at the BRANCH level, not within a branch's own candidate ranking --
    included here since it still legitimately shapes which candidates get
    generated at all). MANAGEMENT_ONLY_FEATURE, RISK_ONLY_FEATURE, and
    EXECUTION_ONLY_FEATURE are explicitly EXCLUDED -- this is the concrete
    mechanism preventing a management/risk/execution feature from silently
    becoming a 26th entry-gate AND condition."""
    entry_eligible_roles = {
        FeatureRole.HARD_GATE, FeatureRole.SOFT_FEATURE, FeatureRole.SOFT_PENALTY,
        FeatureRole.SOFT_BONUS, FeatureRole.STRUCTURE_ROUTER_INPUT,
    }
    return {name: d for name, d in FEATURE_DESTINATION_MAP.items() if d.role in entry_eligible_roles}
