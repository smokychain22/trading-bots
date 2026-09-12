"""R6G frozen research target definitions.

Names every canonical target THETA's empirical program measures, and points
to the EXISTING module that already computes it -- this file does not
reimplement any of them. It exists so "which quantity are we predicting/
measuring" is a single frozen list, never redefined ad hoc per experiment
(TargetDefinitionVersion below is the version stamp a `dataset_contracts.py`
record or `reproducibility.py` `ExperimentResultContract` cites).

No premium-only success label appears anywhere in this list, per the
standing constitutional rule (`THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_
SPEC_v1.0` section 1/40).
"""

from __future__ import annotations

from enum import Enum

TARGET_DEFINITION_VERSION = "theta-research-targets-v1"


class PrimaryTarget(str, Enum):
    WHOLE_CHAIN_NET_PNL = "WHOLE_CHAIN_NET_PNL"  # episode_economics.py::whole_episode_pnl
    MANAGED_EPISODE_NET_PNL = "MANAGED_EPISODE_NET_PNL"  # a defined sub-window of the whole chain -- same summation discipline, narrower scope, per THETA_EV_MODEL_SPEC.md
    RETURN_ON_SECURED_CAPITAL = "RETURN_ON_SECURED_CAPITAL"  # episode_economics.py::return_on_secured_capital
    RETURN_PER_CAPITAL_DAY = "RETURN_PER_CAPITAL_DAY"  # episode_economics.py::return_per_capital_day


class RiskTarget(str, Enum):
    MAX_DRAWDOWN = "MAX_DRAWDOWN"  # drawdown_metrics.py::compute_drawdown_summary().max_drawdown_pct
    MAX_ADVERSE_EXCURSION = "MAX_ADVERSE_EXCURSION"  # worst intra-episode mark-to-market, NOT yet its own module -- computed the same way drawdown_metrics.py tracks troughs, applied within one episode's own equity path rather than the whole account curve
    EXPECTED_SHORTFALL = "EXPECTED_SHORTFALL"  # tail_risk_metrics.py::compute_tail_risk_summary (frozen Loss = -PnL convention, explicit alpha)
    SEVERE_DRAWDOWN_EVENT = "SEVERE_DRAWDOWN_EVENT"  # a boolean derived from severe_drawdown_spec.py's own threshold, never invented here


class LifecycleTarget(str, Enum):
    ASSIGNMENT = "ASSIGNMENT"  # broker-reconciled fact (Codex-owned lifecycle evidence), consumed not computed here
    RECOVERY_DURATION = "RECOVERY_DURATION"  # recovery_spec.py's own distribution target
    RECOVERY_SUCCESS = "RECOVERY_SUCCESS"  # recovery_spec.py -- resolved within a stated horizon, per the spec's own definition
    CALL_AWAY = "CALL_AWAY"  # broker-reconciled fact
    CAPITAL_LOCK = "CAPITAL_LOCK"  # capital-days consumed by a specific episode -- episode_economics.py's capital_days input


class ExecutionTarget(str, Enum):
    FILL_OR_NO_FILL = "FILL_OR_NO_FILL"  # execution_simulator.py's structural eligibility -- FillOutcome; the REALIZED version is a broker-reconciled fact, not this module's own prediction
    SLIPPAGE = "SLIPPAGE"  # execution_simulator.py::SimulatedFillResult.modeled_slippage_per_unit (structural) vs. realized TCA (empirical, Codex-owned)
    SPREAD_CAPTURE = "SPREAD_CAPTURE"  # (fill_price - passive_touch) / spread -- not yet its own function; derivable directly from ExecutionEvidence's fill_price/limit_price/spread fields
    MARKOUT = "MARKOUT"  # post-fill price movement at a fixed horizon (1min/5min) -- a TCA-owned realized quantity, never fabricated here


ALL_TARGETS = (
    tuple(PrimaryTarget) + tuple(RiskTarget) + tuple(LifecycleTarget) + tuple(ExecutionTarget)
)


def target_definition_version() -> str:
    """The single version string every experiment result must cite
    (`reproducibility.py`'s `ExperimentResultContract.target_version`) --
    changing ANY target's definition (not just adding a new one) must bump
    this constant, never silently redefine a target under the same version
    string."""
    return TARGET_DEFINITION_VERSION
