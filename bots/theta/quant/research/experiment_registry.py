"""Preconfigured, machine-readable experiment definitions.

The auto-empirical runner reads this registry rather than having its
experiment list hardcoded, so adding/removing a research slice is a data
change with a version bump, not a code rewrite. Nothing here contains a
result -- only the DEFINITION of an experiment that will run once real
evidence exists.

Every research bin below is a BIN, never a claim: the 25-60 DTE and
0.10-0.40 delta lattices are enumeration ranges (Codex's own decision
record uses exactly that language), and no sub-range is assumed superior.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

EXPERIMENT_REGISTRY_VERSION = "theta-experiment-registry-v1"


class ExperimentKind(str, Enum):
    DESCRIPTIVE = "DESCRIPTIVE"  # counts/distributions only; runs at DESCRIPTIVE_AUDIT_ONLY readiness
    SLICE_ECONOMICS = "SLICE_ECONOMICS"  # per-bin economics; requires resolved labels
    ENTRY_MODEL = "ENTRY_MODEL"
    OWNERSHIP_MODEL = "OWNERSHIP_MODEL"
    ASSIGNMENT_MODEL = "ASSIGNMENT_MODEL"
    MANAGEMENT_POLICY = "MANAGEMENT_POLICY"
    PROFIT_TAKING_POLICY = "PROFIT_TAKING_POLICY"
    LOSS_POLICY = "LOSS_POLICY"
    ROLL_EVALUATION = "ROLL_EVALUATION"
    FEATURE_ABLATION = "FEATURE_ABLATION"
    FLOW_ABLATION = "FLOW_ABLATION"
    STRICTNESS = "STRICTNESS"


class MinimumReadiness(str, Enum):
    """The LOWEST dataset-readiness state at which this experiment may
    run at all. The runner refuses anything above the dataset's own
    current state -- speed never comes from lowering this bar."""

    DESCRIPTIVE_AUDIT_ONLY = "DESCRIPTIVE_AUDIT_ONLY"
    MODEL_FIT_ELIGIBLE = "MODEL_FIT_ELIGIBLE"
    WALK_FORWARD_ELIGIBLE = "WALK_FORWARD_ELIGIBLE"
    OOS_EVALUATION_ELIGIBLE = "OOS_EVALUATION_ELIGIBLE"


@dataclass(frozen=True)
class ExperimentDefinition:
    experiment_id: str
    kind: ExperimentKind
    minimum_readiness: MinimumReadiness
    description: str
    hypothesis_id: Optional[str] = None  # links to hypotheses.json where one genuinely applies
    parameters: Dict[str, object] = field(default_factory=dict)


# --- Research lattices (bins, never claims) -------------------------------

DTE_BINS: Tuple[Tuple[int, int], ...] = ((25, 35), (36, 45), (46, 60))
DELTA_MAGNITUDE_BINS: Tuple[Tuple[float, float], ...] = (
    (0.10, 0.15), (0.15, 0.20), (0.20, 0.25), (0.25, 0.30), (0.30, 0.40),
)

# Per-slice metrics every SLICE_ECONOMICS experiment must report together
# -- never a headline win rate alone (TRD OUT-001..004).
SLICE_METRICS: Tuple[str, ...] = (
    "raw_n", "effective_n", "ev_net", "median_pnl", "probability_pnl_positive",
    "avg_win", "avg_loss", "profit_factor", "expected_shortfall", "max_drawdown",
    "return_on_secured_capital", "return_per_capital_day", "assignment_rate",
    "recovery_duration_days", "capital_lock_days",
)

FEATURE_ABLATION_FAMILIES: Tuple[str, ...] = (
    "UNDERLYING", "VOLATILITY", "CONTRACT", "FLOW", "EVENT",
    "OWNERSHIP", "PORTFOLIO", "EXECUTION", "REGIME", "EXPERT_PRIOR",
)

ABLATION_DELTA_METRICS: Tuple[str, ...] = (
    "delta_ev_net", "delta_return_per_capital_day", "delta_expected_shortfall",
    "delta_max_drawdown", "delta_brier", "delta_ece",
    "delta_assignment_burden", "delta_recovery_duration",
)

# Friend-bot flow ladder: one increment per rung, never all at once.
FLOW_ABLATION_LADDER: Tuple[str, ...] = (
    "BASELINE",
    "PLUS_FLOW_DIRECTION",
    "PLUS_PREMIUM_SIZE",
    "PLUS_SWEEP",
    "PLUS_VOLUME_OPEN_INTEREST",
    "PLUS_PERSISTENCE",
    "PLUS_OPENING_CONFIDENCE",
)

# Failure controls that must hold for any flow experiment to be valid at all.
FLOW_FAILURE_CONTROLS: Tuple[str, ...] = (
    "NO_HIGHEST_RETURN_LEAKAGE",
    "NO_SCORE_AS_PROBABILITY",
    "NO_UNKNOWN_FAIL_OPEN",
    "NO_SIMPLISTIC_CALL_PUT_DIRECTION",
)

PROFIT_TAKING_POLICIES: Tuple[str, ...] = (
    "FIXED_25", "FIXED_50", "FIXED_75", "TIME_EXIT", "DTE_EXIT",
    "DYNAMIC_REMAINING_EV", "DYNAMIC_EV_PLUS_HARD_RISK", "DYNAMIC_EV_PLUS_FLOW_INVALIDATION",
)

LOSS_POLICIES: Tuple[str, ...] = (
    "FIXED_OPTION_PREMIUM_STOP", "THESIS_INVALIDATION", "DYNAMIC_CONTINUATION_EV",
    "ROLL_WHEN_INCREMENTAL_EV_POSITIVE", "ASSIGN_WHEN_OWNERSHIP_EV_POSITIVE",
    "HYBRID_HARD_TAIL_LIMIT_PLUS_DYNAMIC",
)

ROLL_ALTERNATIVES: Tuple[str, ...] = ("HOLD", "CLOSE_FULL", "ROLL", "ACCEPT_ASSIGNMENT", "REDEPLOY")


def _definitions() -> Tuple[ExperimentDefinition, ...]:
    definitions: List[ExperimentDefinition] = [
        ExperimentDefinition(
            "DESC-FUNNEL-01", ExperimentKind.DESCRIPTIVE, MinimumReadiness.DESCRIPTIVE_AUDIT_ONLY,
            "Candidate funnel counts, hard/soft rejection distributions, WAIT reasons, provider quality, coverage.",
        ),
        ExperimentDefinition(
            "DESC-DISTRIBUTION-01", ExperimentKind.DESCRIPTIVE, MinimumReadiness.DESCRIPTIVE_AUDIT_ONLY,
            "DTE/delta/spread/IV/ownership/event/regime/capital-requirement distributions over enumerated candidates.",
        ),
        ExperimentDefinition(
            "STRICT-01", ExperimentKind.STRICTNESS, MinimumReadiness.DESCRIPTIVE_AUDIT_ONLY,
            "Candidate-survival and WAIT counts by gate. Economic comparison of GIANT_AND vs HARD_GATES_PLUS_SOFT_RANKING upgrades to SLICE_ECONOMICS once labels exist.",
        ),
        ExperimentDefinition(
            "ENTRY-LOGIT-01", ExperimentKind.ENTRY_MODEL, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            "Logistic baseline for P(net-positive managed episode | PIT state, candidate). Delta is never the target probability.",
            hypothesis_id="H-Q-01",
        ),
        ExperimentDefinition(
            "OWNERSHIP-01", ExperimentKind.OWNERSHIP_MODEL, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            "P(severe drawdown), recovery-time distribution, recovery success from PIT-safe underlying features only.",
            hypothesis_id="H-Q-01",
        ),
        ExperimentDefinition(
            "ASSIGNMENT-01", ExperimentKind.ASSIGNMENT_MODEL, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            "Assignment occurrence and post-assignment downside conditioned on moneyness/DTE/extrinsic/volatility/ex-dividend state. Delta is never literal assignment probability.",
            hypothesis_id="H-A-01",
        ),
        ExperimentDefinition(
            "MGMT-FRONTIER-01", ExperimentKind.MANAGEMENT_POLICY, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            "Action-value distributions for every feasible action from one shared decision timestamp; unknown economics stay None.",
            hypothesis_id="H-R-03",
        ),
        ExperimentDefinition(
            "ROLL-01", ExperimentKind.ROLL_EVALUATION, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            "Whether net roll credit predicts whole-chain outcome. Old realized P&L stays immutable; net credit is a feature, not success.",
            hypothesis_id="H-R-03", parameters={"alternatives": ROLL_ALTERNATIVES},
        ),
    ]

    for low, high in DTE_BINS:
        definitions.append(ExperimentDefinition(
            f"SLICE-DTE-{low}-{high}", ExperimentKind.SLICE_ECONOMICS, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            f"THETA_CONVENTIONAL economics for the {low}-{high} DTE research bin.",
            hypothesis_id="H-Q-01", parameters={"dte_min": low, "dte_max": high, "metrics": SLICE_METRICS},
        ))
    for low, high in DELTA_MAGNITUDE_BINS:
        definitions.append(ExperimentDefinition(
            f"SLICE-DELTA-{low}-{high}", ExperimentKind.SLICE_ECONOMICS, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            f"THETA_CONVENTIONAL economics for the {low}-{high} put-delta-magnitude research bin.",
            hypothesis_id="H-Q-02", parameters={"delta_min": low, "delta_max": high, "metrics": SLICE_METRICS},
        ))
    for policy in PROFIT_TAKING_POLICIES:
        definitions.append(ExperimentDefinition(
            f"EXIT-{policy}", ExperimentKind.PROFIT_TAKING_POLICY, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            f"Whole-episode economics under the {policy} profit-taking policy. Dynamic policies are not assumed superior.",
            hypothesis_id="H-R-01", parameters={"policy": policy},
        ))
    for policy in LOSS_POLICIES:
        definitions.append(ExperimentDefinition(
            f"LOSS-{policy}", ExperimentKind.LOSS_POLICY, MinimumReadiness.MODEL_FIT_ELIGIBLE,
            f"Whole-chain economics, tail, drawdown, recovery and capital lock under the {policy} loss policy.",
            hypothesis_id="H-R-02", parameters={"policy": policy},
        ))
    for family in FEATURE_ABLATION_FAMILIES:
        definitions.append(ExperimentDefinition(
            f"ABLATE-{family}", ExperimentKind.FEATURE_ABLATION, MinimumReadiness.WALK_FORWARD_ELIGIBLE,
            f"Paired BASELINE vs BASELINE+{family} ablation. A family adding no robust OOS value is zero-weighted or removed.",
            parameters={"family": family, "metrics": ABLATION_DELTA_METRICS, "paired": True},
        ))
    for index, rung in enumerate(FLOW_ABLATION_LADDER):
        if rung == "BASELINE":
            continue
        definitions.append(ExperimentDefinition(
            f"FLOW-LADDER-{index:02d}-{rung}", ExperimentKind.FLOW_ABLATION, MinimumReadiness.WALK_FORWARD_ELIGIBLE,
            f"Flow ladder rung {index}: {rung}, added one increment at a time over the previous rung.",
            parameters={"rung": rung, "previous_rung": FLOW_ABLATION_LADDER[index - 1],
                        "failure_controls": FLOW_FAILURE_CONTROLS},
        ))

    return tuple(definitions)


EXPERIMENTS: Tuple[ExperimentDefinition, ...] = _definitions()
EXPERIMENTS_BY_ID: Dict[str, ExperimentDefinition] = {e.experiment_id: e for e in EXPERIMENTS}

_READINESS_RANK: Dict[str, int] = {
    "DATASET_ABSENT": 0,
    "DATASET_PRESENT_UNUSABLE": 1,
    "DESCRIPTIVE_AUDIT_ONLY": 2,
    "MODEL_FIT_ELIGIBLE": 3,
    "WALK_FORWARD_ELIGIBLE": 4,
    "OOS_EVALUATION_ELIGIBLE": 5,
}


def experiments_eligible_at(readiness_state_value: str) -> List[ExperimentDefinition]:
    """Every experiment whose own `minimum_readiness` is satisfied by the
    dataset's current readiness state. Returns an empty list for
    DATASET_ABSENT/DATASET_PRESENT_UNUSABLE -- neither state permits any
    experiment, not even a descriptive one, because the data either does
    not exist or failed the integrity gate."""
    current = _READINESS_RANK.get(readiness_state_value, 0)
    if current < _READINESS_RANK["DESCRIPTIVE_AUDIT_ONLY"]:
        return []
    return [e for e in EXPERIMENTS if _READINESS_RANK[e.minimum_readiness.value] <= current]

