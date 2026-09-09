"""Regime v0 -- interpretable, rule-based regime baseline (before any HMM).

Per instruction, this does NOT collapse trend/volatility/event/liquidity/
stress into one arbitrary combined score -- TRD's own regime_state shape
(section 42) is already a tuple of independent axes, and this module
returns exactly that: five separate classifications plus a confidence
note, never one blended "regime number." Orthogonal axes are the right
structure here specifically because a market can simultaneously be, say,
trending up (BULL-like) while carrying elevated event risk -- forcing that
into one label would destroy information a caller (AEGIS, the ownership
model, position sizing) may need independently.

How this would later be challenged by clustering/HMM (documented, not
implemented): a future challenger would replace ONE axis at a time (most
plausibly volatility_state or stress_state, since those are the axes where
latent-state structure is most often argued for) and would only be
promoted if it beats this rule-based v0 on untouched-OOS economic value
(TRD REG-003: "HMM or other latent-state models are challengers only; the
production regime model must beat an interpretable baseline OOS before
promotion"). It would not replace trend_state or event_state, which are
observable/rule-derivable almost by definition and don't need a latent
model.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from models.common import ReasonCode


class TrendState(str, Enum):
    BULL = "BULL"
    RANGE = "RANGE"
    BEAR = "BEAR"


class VolatilityState(str, Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    SHOCK = "SHOCK"


class EventState(str, Enum):
    NONE = "NONE"
    EARNINGS_NEAR = "EARNINGS_NEAR"
    CORPORATE_ACTION = "CORPORATE_ACTION"
    MACRO_RISK = "MACRO_RISK"
    OTHER_KNOWN = "OTHER_KNOWN"


class LiquidityState(str, Enum):
    NORMAL = "NORMAL"
    THIN = "THIN"
    DISLOCATED = "DISLOCATED"


class StressState(str, Enum):
    NORMAL = "NORMAL"
    CORRECTION = "CORRECTION"
    CRISIS = "CRISIS"


@dataclass(frozen=True)
class RegimePolicyV0:
    """Versioned thresholds -- required, not defaulted."""

    policy_version: str
    bull_ma_slope_floor: float
    bear_ma_slope_ceiling: float  # <= this is BEAR; between the two floors/ceilings is RANGE
    rv_low_ceiling: float
    rv_high_floor: float
    rv_shock_floor: float  # >= this (or a realized gap-shock trigger) is SHOCK
    max_adverse_gap_shock_threshold: float
    liquidity_thin_spread_pct_floor: float
    liquidity_dislocated_spread_pct_floor: float
    correction_drawdown_ceiling: float  # drawdown <= this (more negative) is at least CORRECTION
    crisis_drawdown_ceiling: float  # drawdown <= this is CRISIS


@dataclass(frozen=True)
class RegimeInputs:
    ma_slope: Optional[float]
    rv20: Optional[float]
    max_adverse_gap: Optional[float]
    earnings_distance_days: Optional[int]
    corporate_action_pending: bool
    macro_risk_flag: bool
    spread_pct: Optional[float]
    portfolio_or_market_drawdown: Optional[float]  # negative-or-zero fraction


@dataclass(frozen=True)
class RegimeSnapshot:
    trend_state: Optional[TrendState]
    volatility_state: Optional[VolatilityState]
    event_state: Optional[EventState]
    liquidity_state: Optional[LiquidityState]
    stress_state: Optional[StressState]
    confidence: float  # fraction of the five axes that were resolvable (not UNKNOWN)
    reasons: List[ReasonCode]


def _trend_state(inputs: RegimeInputs, policy: RegimePolicyV0) -> tuple:
    if inputs.ma_slope is None:
        return None, ReasonCode("TREND_UNKNOWN", -1, "ma_slope is UNKNOWN.")
    if inputs.ma_slope >= policy.bull_ma_slope_floor:
        return TrendState.BULL, ReasonCode("TREND_BULL", 1, f"ma_slope={inputs.ma_slope} >= bull floor")
    if inputs.ma_slope <= policy.bear_ma_slope_ceiling:
        return TrendState.BEAR, ReasonCode("TREND_BEAR", -1, f"ma_slope={inputs.ma_slope} <= bear ceiling")
    return TrendState.RANGE, ReasonCode("TREND_RANGE", 0, f"ma_slope={inputs.ma_slope} between bull/bear thresholds")


def _volatility_state(inputs: RegimeInputs, policy: RegimePolicyV0) -> tuple:
    if inputs.rv20 is None:
        return None, ReasonCode("VOLATILITY_UNKNOWN", -1, "rv20 is UNKNOWN.")
    shock = (
        inputs.rv20 >= policy.rv_shock_floor
        or (inputs.max_adverse_gap is not None and inputs.max_adverse_gap >= policy.max_adverse_gap_shock_threshold)
    )
    if shock:
        return VolatilityState.SHOCK, ReasonCode("VOLATILITY_SHOCK", -1, f"rv20={inputs.rv20} or gap shock triggered")
    if inputs.rv20 >= policy.rv_high_floor:
        return VolatilityState.HIGH, ReasonCode("VOLATILITY_HIGH", -1, f"rv20={inputs.rv20} >= high floor")
    if inputs.rv20 <= policy.rv_low_ceiling:
        return VolatilityState.LOW, ReasonCode("VOLATILITY_LOW", 1, f"rv20={inputs.rv20} <= low ceiling")
    return VolatilityState.NORMAL, ReasonCode("VOLATILITY_NORMAL", 0, f"rv20={inputs.rv20} between low/high thresholds")


def _event_state(inputs: RegimeInputs, policy: RegimePolicyV0) -> tuple:
    # Priority order documented explicitly rather than left implicit:
    # macro risk and corporate actions are treated as more urgent than a
    # scheduled earnings date, which is itself more urgent than "no event."
    if inputs.macro_risk_flag:
        return EventState.MACRO_RISK, ReasonCode("EVENT_MACRO_RISK", -1, "macro_risk_flag is set.")
    if inputs.corporate_action_pending:
        return EventState.CORPORATE_ACTION, ReasonCode("EVENT_CORPORATE_ACTION", -1, "corporate_action_pending is set.")
    if inputs.earnings_distance_days is not None and inputs.earnings_distance_days <= 5:
        return EventState.EARNINGS_NEAR, ReasonCode(
            "EVENT_EARNINGS_NEAR", -1, f"earnings_distance_days={inputs.earnings_distance_days}"
        )
    if inputs.earnings_distance_days is None:
        return None, ReasonCode("EVENT_UNKNOWN", -1, "earnings_distance_days is UNKNOWN and no other event flag is set.")
    return EventState.NONE, ReasonCode("EVENT_NONE", 1, "No known event within the near-term window.")


def _liquidity_state(inputs: RegimeInputs, policy: RegimePolicyV0) -> tuple:
    if inputs.spread_pct is None:
        return None, ReasonCode("LIQUIDITY_STATE_UNKNOWN", -1, "spread_pct is UNKNOWN.")
    if inputs.spread_pct >= policy.liquidity_dislocated_spread_pct_floor:
        return LiquidityState.DISLOCATED, ReasonCode(
            "LIQUIDITY_DISLOCATED", -1, f"spread_pct={inputs.spread_pct} >= dislocated floor"
        )
    if inputs.spread_pct >= policy.liquidity_thin_spread_pct_floor:
        return LiquidityState.THIN, ReasonCode("LIQUIDITY_THIN", -1, f"spread_pct={inputs.spread_pct} >= thin floor")
    return LiquidityState.NORMAL, ReasonCode("LIQUIDITY_NORMAL", 1, f"spread_pct={inputs.spread_pct} below thin floor")


def _stress_state(inputs: RegimeInputs, policy: RegimePolicyV0) -> tuple:
    if inputs.portfolio_or_market_drawdown is None:
        return None, ReasonCode("STRESS_UNKNOWN", -1, "portfolio_or_market_drawdown is UNKNOWN.")
    if inputs.portfolio_or_market_drawdown <= policy.crisis_drawdown_ceiling:
        return StressState.CRISIS, ReasonCode(
            "STRESS_CRISIS", -1, f"drawdown={inputs.portfolio_or_market_drawdown} <= crisis ceiling"
        )
    if inputs.portfolio_or_market_drawdown <= policy.correction_drawdown_ceiling:
        return StressState.CORRECTION, ReasonCode(
            "STRESS_CORRECTION", -1, f"drawdown={inputs.portfolio_or_market_drawdown} <= correction ceiling"
        )
    return StressState.NORMAL, ReasonCode("STRESS_NORMAL", 1, f"drawdown={inputs.portfolio_or_market_drawdown} above correction ceiling")


def classify(inputs: RegimeInputs, policy: RegimePolicyV0) -> RegimeSnapshot:
    trend, trend_reason = _trend_state(inputs, policy)
    vol, vol_reason = _volatility_state(inputs, policy)
    event, event_reason = _event_state(inputs, policy)
    liquidity, liquidity_reason = _liquidity_state(inputs, policy)
    stress, stress_reason = _stress_state(inputs, policy)

    reasons = [trend_reason, vol_reason, event_reason, liquidity_reason, stress_reason]
    axes = [trend, vol, event, liquidity, stress]
    confidence = sum(1 for a in axes if a is not None) / len(axes)

    return RegimeSnapshot(
        trend_state=trend,
        volatility_state=vol,
        event_state=event,
        liquidity_state=liquidity,
        stress_state=stress,
        confidence=confidence,
        reasons=reasons,
    )
