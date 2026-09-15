"""Dynamic profit-preservation and continuation-value research module.

Answers, structurally: from the CURRENT state of an open position, is
holding still better than closing -- never "has this position reached a
fixed percentage yet." Built for the R7 "DYNAMIC PROFIT PRESERVATION +
STRATEGY SWITCHING" directive's sections 2-3.

Every function here is pure arithmetic on caller-supplied observations. No
function fabricates a probability, a forward distribution, or an
expected-value estimate -- price/quantity-derived facts (PROFIT_CAPTURE_RATIO,
PROFIT_GIVEBACK, GIVEBACK_RATIO, REMAINING_REWARD) are computed directly;
anything that would require a forward probabilistic model (continuation
value, close-vs-hold comparison, redeploy value) is returned as an explicit
`ContinuationValueRequirement` naming exactly what model input is missing,
tagged `MODEL_REQUIRED` or `EMPIRICAL_REQUIRED` -- never a fabricated number,
per this directive's own explicit instruction (section 3).

None of this is a universal exit threshold. `experiment_registry.py`'s
`PROFIT_TAKING_POLICIES` (now 19 entries, including the new
`DYNAMIC_PROFIT_GIVEBACK` policy this module exists to support) treats every
fixed percentage AND every dynamic policy as a competing challenger to be
tested, never a default.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


def _positive_finite(value: Optional[float]) -> bool:
    return value is not None and value == value and value not in (float("inf"), float("-inf")) and value > 0


def _finite(value: Optional[float]) -> bool:
    return value is not None and value == value and value not in (float("inf"), float("-inf"))


# ---------------------------------------------------------------------------
# Section A/B: profit-capture and profit-giveback -- pure arithmetic on
# caller-observed unrealized P&L, never a fabricated forward estimate.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProfitCaptureState:
    """Snapshot facts about one open position's unrealized-P&L path so far.
    `max_favorable_credit_or_debit` is the position's own economic ceiling
    (e.g. the full credit received for a short option, or the maximum
    theoretical gain for a defined-risk structure) -- a caller-supplied
    structural fact, never modeled."""

    current_unrealized_pnl: Optional[float]
    peak_unrealized_pnl: Optional[float]
    max_favorable_credit_or_debit: Optional[float]


class ProfitCaptureEvidenceState(str, Enum):
    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"  # a required input is missing
    INVALID = "INVALID"  # a required input is present but structurally impossible (e.g. peak < current)


@dataclass(frozen=True)
class ProfitCaptureResult:
    state: ProfitCaptureEvidenceState
    profit_capture_ratio: Optional[float]  # current_unrealized_pnl / max_favorable_credit_or_debit
    peak_capture_ratio: Optional[float]  # peak_unrealized_pnl / max_favorable_credit_or_debit
    profit_giveback: Optional[float]  # max(0, peak - current), in the same $ units as the inputs
    giveback_ratio: Optional[float]  # profit_giveback / peak_unrealized_pnl, only when peak > 0
    reason: Optional[str]


def compute_profit_capture(state: ProfitCaptureState) -> ProfitCaptureResult:
    """PROFIT_CAPTURE_RATIO = current_unrealized_pnl / max_favorable_credit_or_debit.
    PROFIT_GIVEBACK = max(0, peak_unrealized_pnl - current_unrealized_pnl).
    GIVEBACK_RATIO = profit_giveback / peak_unrealized_pnl, defined ONLY when
    peak_unrealized_pnl > 0 (a position that was never profitable has no
    "giveback" to measure -- UNKNOWN, not zero, since zero would falsely
    read as 'no giveback occurred' rather than 'the ratio has no defined
    denominator')."""
    if not _finite(state.current_unrealized_pnl) or not _finite(state.peak_unrealized_pnl) \
            or not _positive_finite(state.max_favorable_credit_or_debit):
        return ProfitCaptureResult(ProfitCaptureEvidenceState.UNKNOWN, None, None, None, None, "REQUIRED_INPUT_MISSING")
    current = state.current_unrealized_pnl
    peak = state.peak_unrealized_pnl
    ceiling = state.max_favorable_credit_or_debit
    if peak < current:
        return ProfitCaptureResult(ProfitCaptureEvidenceState.INVALID, None, None, None, None, "PEAK_BELOW_CURRENT_IMPOSSIBLE")
    profit_giveback = max(0.0, peak - current)
    giveback_ratio = (profit_giveback / peak) if peak > 0 else None
    return ProfitCaptureResult(
        ProfitCaptureEvidenceState.KNOWN,
        profit_capture_ratio=current / ceiling,
        peak_capture_ratio=peak / ceiling,
        profit_giveback=profit_giveback,
        giveback_ratio=giveback_ratio,
        reason=None,
    )


# ---------------------------------------------------------------------------
# Section C: remaining reward -- what is structurally still available to
# capture, independent of any probability of capturing it.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RemainingRewardState:
    max_favorable_credit_or_debit: Optional[float]
    current_unrealized_pnl: Optional[float]
    remaining_capital_days: Optional[float]  # caller-computed: capital locked x days remaining, or equivalent
    downside_tail_estimate: Optional[float]  # caller-supplied, e.g. a stress-test or ES/CVaR-style loss estimate; MODEL_REQUIRED if absent


@dataclass(frozen=True)
class RemainingRewardResult:
    state: ProfitCaptureEvidenceState
    remaining_reward: Optional[float]  # max_favorable_credit_or_debit - current_unrealized_pnl
    remaining_reward_per_capital_day: Optional[float]
    remaining_reward_to_risk: Optional[float]  # remaining_reward / downside_tail_estimate; MODEL_REQUIRED without a tail estimate
    reason: Optional[str]


def compute_remaining_reward(state: RemainingRewardState) -> RemainingRewardResult:
    """REMAINING_REWARD = max_favorable_credit_or_debit - current_unrealized_pnl
    (the additional profit structurally still available if the position
    resolved at its economic ceiling from here). This is a STRUCTURAL bound,
    never a probability-weighted expectation -- it says nothing about how
    LIKELY reaching that ceiling is."""
    if not _finite(state.current_unrealized_pnl) or not _positive_finite(state.max_favorable_credit_or_debit):
        return RemainingRewardResult(ProfitCaptureEvidenceState.UNKNOWN, None, None, None, "REQUIRED_INPUT_MISSING")
    remaining_reward = state.max_favorable_credit_or_debit - state.current_unrealized_pnl
    per_capital_day = None
    if _positive_finite(state.remaining_capital_days):
        per_capital_day = remaining_reward / state.remaining_capital_days
    reward_to_risk = None
    reason = None
    if state.downside_tail_estimate is None:
        reason = "MODEL_REQUIRED:downside_tail_estimate"
    elif _positive_finite(state.downside_tail_estimate):
        reward_to_risk = remaining_reward / state.downside_tail_estimate
    return RemainingRewardResult(
        ProfitCaptureEvidenceState.KNOWN, remaining_reward, per_capital_day, reward_to_risk, reason,
    )


# ---------------------------------------------------------------------------
# Section: CLOSE_NOW_VALUE / HOLD_CONTINUATION_VALUE / CLOSE_AND_REDEPLOY_VALUE
# -- these genuinely require a forward model (an expected value over an
# uncertain future path). This module never fabricates that model; it
# returns the exact named requirement instead, per the directive's explicit
# instruction to mark such terms MODEL_REQUIRED / EMPIRICAL_REQUIRED.
# ---------------------------------------------------------------------------


class ContinuationValueBlocker(str, Enum):
    FORWARD_EV_MODEL_REQUIRED = "FORWARD_EV_MODEL_REQUIRED"
    EMPIRICAL_CALIBRATION_REQUIRED = "EMPIRICAL_CALIBRATION_REQUIRED"
    REDEPLOY_OPPORTUNITY_SET_REQUIRED = "REDEPLOY_OPPORTUNITY_SET_REQUIRED"


@dataclass(frozen=True)
class ContinuationValueRequirement:
    """Names exactly what a future calibrated selector would need to compute
    CLOSE_NOW_VALUE / HOLD_CONTINUATION_VALUE / CLOSE_AND_REDEPLOY_VALUE.
    This function computes nothing -- per this directive's own instruction,
    fabricating a probability or expected value here would be exactly the
    violation it warns against."""

    close_now_value: str  # always a known, certain quantity in principle (realized P&L if closed now) -- but
    # even this requires a real closing price/cost estimate, so this module still classifies its blocker below
    hold_continuation_value_blocker: ContinuationValueBlocker
    close_and_redeploy_value_blocker: ContinuationValueBlocker
    note: str


def continuation_value_requirements() -> ContinuationValueRequirement:
    return ContinuationValueRequirement(
        close_now_value=(
            "CLOSE_NOW_VALUE = current realized P&L if closed at the current executable price, "
            "MINUS estimated closing transaction cost/slippage. This is the one term in this triad "
            "that is a CERTAIN, PIT-observable quantity given a real executable quote -- not a model "
            "output -- but still requires that quote (EMPIRICAL_REQUIRED:executable_close_quote when absent)."
        ),
        hold_continuation_value_blocker=ContinuationValueBlocker.FORWARD_EV_MODEL_REQUIRED,
        close_and_redeploy_value_blocker=ContinuationValueBlocker.REDEPLOY_OPPORTUNITY_SET_REQUIRED,
        note=(
            "HOLD_CONTINUATION_VALUE requires a calibrated forward distribution of this position's "
            "outcome from the current state (an entry-model-style P(net-positive future path) or a "
            "full outcome-distribution model per TRD MODEL-003) -- FORWARD_EV_MODEL_REQUIRED until "
            "R6's entry/management models are fit and calibrated on real data. "
            "CLOSE_AND_REDEPLOY_VALUE additionally requires a real candidate set of alternative "
            "opportunities available RIGHT NOW with their own EV estimates -- "
            "REDEPLOY_OPPORTUNITY_SET_REQUIRED, since 'what else could I do with this capital' is "
            "itself an empirical question this repository does not fabricate an answer to. "
            "Until both are available, HOLD vs CLOSE vs CLOSE_AND_REDEPLOY remains a CHALLENGER-POLICY "
            "comparison (see PROFIT_TAKING_POLICIES), never a calibrated optimal choice."
        ),
    )
