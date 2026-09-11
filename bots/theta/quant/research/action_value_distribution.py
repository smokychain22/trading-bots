"""Action-value OUTCOME DISTRIBUTION contract (R6E items 8/9/14).

`models/management_action_value.py` already computes a POINT-ESTIMATE
utility per feasible action (HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY). This
module defines the DISTRIBUTIONAL contract R6E additionally requires: not
"this trade will make $143" but the full outcome distribution (expected,
median, tail quantiles, Expected Shortfall, probability of a positive
result) per feasible action, plus assignment probability/recovery
duration/capital-days/execution-cost/uncertainty alongside it.

Every field is Optional and None (never fabricated) until a real,
calibrated, empirically-fit model exists -- there is no synthetic
placeholder distribution anywhere in this module. This is CONTRACT/SHAPE
work: it specifies what a future calibrated model must produce, and is
exercised only against synthetic (hand-supplied, not fitted) fixtures.
`EV_MODEL_NOT_EMPIRICALLY_READY` remains unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from research.candidate_actions import CandidateAction


@dataclass(frozen=True)
class OutcomeDistribution:
    """A versioned result object for one feasible action's full outcome
    distribution -- R6E item 14's explicit requirement, distinct from any
    single point forecast. `distribution_version` exists so a later
    revision to what fields this carries (e.g. adding a new quantile) is
    traceable per `reproducibility.py`'s own versioning discipline."""

    distribution_version: str
    action: CandidateAction
    expected_pnl: Optional[float]
    median_pnl: Optional[float]
    p25_pnl: Optional[float]
    p5_pnl: Optional[float]
    expected_shortfall: Optional[float]  # ES at whatever alpha the caller's tail_risk_metrics.py computation used -- not re-specified here
    probability_positive: Optional[float]  # P(pnl > 0) -- a calibrated probability, never delta or N(d2) substituted for it
    expected_capital_days: Optional[float]
    assignment_probability: Optional[float]
    expected_recovery_duration_days: Optional[float]
    execution_cost: Optional[float]
    uncertainty: Optional[float]  # e.g. standard error of expected_pnl, or None if not computable

    def is_fully_known(self) -> bool:
        """True only if EVERY field above is known -- a caller must not
        treat a partially-known distribution as if unknown fields were
        zero; this is a convenience check for "do I have a complete
        picture," not a substitute for checking individual fields."""
        return all(
            value is not None
            for value in (
                self.expected_pnl, self.median_pnl, self.p25_pnl, self.p5_pnl,
                self.expected_shortfall, self.probability_positive, self.expected_capital_days,
                self.assignment_probability, self.expected_recovery_duration_days,
                self.execution_cost, self.uncertainty,
            )
        )


def unknown_distribution(distribution_version: str, action: CandidateAction) -> OutcomeDistribution:
    """The explicit, honest "nothing is known yet" distribution -- every
    field None. Used as the default until a real calibrated model exists,
    so a caller never has to construct an all-None distribution ad hoc
    (and risk typo-ing one field into a fabricated 0.0 by mistake)."""
    return OutcomeDistribution(
        distribution_version=distribution_version, action=action,
        expected_pnl=None, median_pnl=None, p25_pnl=None, p5_pnl=None,
        expected_shortfall=None, probability_positive=None, expected_capital_days=None,
        assignment_probability=None, expected_recovery_duration_days=None,
        execution_cost=None, uncertainty=None,
    )
