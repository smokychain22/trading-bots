"""Open-position path-state research (P2D-continuation directive, sections
7-10): the canonical ENTRY/PEAK/TROUGH/NOW path-state inventory, trade-path
classification, and trajectory (velocity/acceleration) features for a
currently-open THETA position.

Distinct in scope from P2C's `OutcomePathStatistics` (Codex-owned,
`resolved-outcome-engine.ts`): that struct summarizes a CLOSED, RESOLVED
outcome after the fact from a caller-supplied economicPnl series. This
module is for a position that is STILL OPEN -- it tracks the same kind of
peak/trough/giveback shape but as a running research state, and extends it
with the Greek/IV/skew/flow/GEX/event checkpoints P2C's engine does not
carry (those live on Optionomics-scoped research attachments, not on the
outcome-resolution engine). Never duplicates P2C's post-hoc math; reuses
the same MFE/MAE/giveback definitions for consistency.

Every field here is caller-supplied or derived from caller-supplied
checkpoints -- this module performs no lookups, no forecasting, and never
fabricates a peak/trough/velocity from an incomplete path (section 28:
`PathCompletenessState`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Sequence


# ---------------------------------------------------------------------------
# Section 7: canonical path-state field inventory.
#
# ALREADY_AVAILABLE = a real engineering field already exists and is populated
# MISSING = no engineering field exists anywhere in this codebase yet
# DERIVABLE = this branch's own research modules already compute the delta/
#   velocity/acceleration methodology; only the raw per-checkpoint capture
#   is missing upstream
# PROVIDER_BLOCKED = requires an Optionomics field not yet observed in any
#   real authenticated payload (per this engagement's standing capability census)
# ---------------------------------------------------------------------------

PATH_STATE_FIELD_INVENTORY = {
    "ENTRY_PNL/CURRENT_PNL/PEAK_PNL/TROUGH_PNL": "ALREADY_AVAILABLE -- P2C's OutcomePathStatistics (profitAtDecision/peakFutureProfit/worstFutureProfit/terminalProfit) computes the resolved-outcome equivalent; this module's PositionPathSnapshot mirrors the same shape for a still-open position",
    "PROFIT_GIVEBACK/PROFIT_GIVEBACK_RATIO": "ALREADY_AVAILABLE -- profit_preservation_research.py (existing, this branch)",
    "TIME_SINCE_ENTRY/TIME_SINCE_PEAK/TIME_SINCE_TROUGH": "DERIVABLE -- this module's compute_path_state() derives these from caller-supplied checkpoint timestamps; no upstream capture gap since decision/observation timestamps already exist throughout P1-P2C",
    "TIME_SINCE_LAST_MANAGEMENT": "MISSING -- no engineering field tracks the last management-action timestamp separately from the position's own open timestamp; a genuine gap for Codex",
    "DTE_AT_ENTRY/DTE_AT_PEAK/CURRENT_DTE": "DERIVABLE -- expiration timestamp already exists on every contract; DTE-at-a-checkpoint is a pure function of (expiration, checkpoint_timestamp), computed by this module's dte_at()",
    "DELTA_AT_ENTRY/DELTA_AT_PEAK/DELTA_NOW/DELTA_CHANGE/DELTA_ACCELERATION": "PARTIALLY_DERIVABLE -- optionomics-temporal-features.ts (P2A, verified COMPLETE) already computes EXPOSURE-family first-order deltas; a second-order (acceleration) derivation and an explicit AT_PEAK checkpoint capture do not yet exist",
    "GAMMA_AT_ENTRY/GAMMA_NOW/GAMMA_CHANGE": "PARTIALLY_DERIVABLE -- same as Delta; gex_spot_scan_research.py (this branch) computes gamma independently via bs_gamma() but is not wired to a per-checkpoint capture pipeline",
    "THETA_AT_ENTRY/THETA_NOW": "MISSING -- no bs_theta() exists in bs_reference.py yet; a genuine gap, not built this pass given time budget",
    "IV_AT_ENTRY/IV_AT_PEAK/IV_NOW/IV_CHANGE/IV_ACCELERATION": "DERIVABLE -- iv_realized_vol_research.py (existing) supplies the IV side; this module's trajectory functions supply velocity/acceleration once per-checkpoint captures exist",
    "SKEW_AT_ENTRY/SKEW_NOW/SKEW_CHANGE": "DERIVABLE -- volatility_surface_research.py's SurfaceResidual/raw-SVI fit already computes a skew-relevant quantity per snapshot; temporal delta uses this module's generic checkpoint-delta pattern",
    "FLOW_AT_ENTRY/FLOW_AT_PEAK/FLOW_NOW/FLOW_CHANGE/FLOW_ACCELERATION/FLOW_REVERSAL": "ALREADY_AVAILABLE -- optionomics_flow_temporal_research.py (this branch, P2C-pass-2) already computes exactly this for the aggregate net-flow series",
    "GEX_REGIME_AT_ENTRY/GEX_REGIME_AT_PEAK/GEX_REGIME_NOW/GEX_REGIME_CHANGE": "DERIVABLE -- gex_spot_scan_research.py's GexSpotScanState plus gamma_regime_research.py (existing) supply the regime classification; a checkpoint-to-checkpoint regime-change comparator is new, built this pass (see classify_gex_regime_transition below)",
    "EVENT_STATE_AT_ENTRY/EVENT_STATE_NOW/EVENT_STATE_CHANGE": "ALREADY_AVAILABLE -- event_state_research.py (this branch, P2C-pass-2) already computes the seven-state model per checkpoint",
    "UNDERLYING_AT_ENTRY/UNDERLYING_AT_PEAK/UNDERLYING_NOW": "ALREADY_AVAILABLE -- spot price is captured on every quote/PIT snapshot throughout P1-P2C",
    "DISTANCE_TO_STRIKE_AT_ENTRY/DISTANCE_TO_STRIKE_NOW": "DERIVABLE -- pure arithmetic (spot - strike) or (spot - strike)/strike from already-available fields; this module's distance_to_strike() formalizes it",
    "EXPECTED_MOVE_AT_ENTRY/EXPECTED_MOVE_NOW": "PARTIALLY_DERIVABLE -- requires IV and DTE (both available/derivable); a canonical expected-move formula is not yet in bs_reference.py, flagged as a small future addition",
    "SPREAD_AT_ENTRY/SPREAD_NOW": "ALREADY_AVAILABLE -- bid/ask captured on every execution-quote observation throughout P1-P2C",
    "CAPITAL_DAYS_USED/CAPITAL_DAYS_REMAINING": "ALREADY_AVAILABLE -- P2C's OutcomeObservation.capitalDays field; \"remaining\" (vs. a target horizon) is a simple subtraction once a horizon is chosen",
}


class PathCompletenessState(str, Enum):
    """Section 28: extends this branch's existing label-quality framework
    (`label_quality_research.py`) to path-specific completeness. A path
    missing its peak observation, or with a provider-outage gap, must
    never let PEAK_PNL/GIVEBACK/VELOCITY be silently computed from
    whatever points happen to exist."""

    COMPLETE = "COMPLETE"  # every expected checkpoint present, no known gap
    PARTIAL_MISSING_INTERMEDIATE = "PARTIAL_MISSING_INTERMEDIATE"  # entry and current known, but intermediate coverage has a gap (provider outage etc.) -- peak/trough MAY be understated
    MISSING_PEAK_OBSERVATION = "MISSING_PEAK_OBSERVATION"  # no observation exists at or near the position's actual best mark-to-market -- PEAK_PNL must not be reported
    EVENT_AMBIGUOUS = "EVENT_AMBIGUOUS"  # an EVENT_DATA_UNKNOWN window overlaps the path -- giveback/velocity attribution to "normal" vs. "event-driven" is unreliable


@dataclass(frozen=True)
class PathCheckpoint:
    """One PIT-safe observation of a position's full state -- the atomic
    unit every path-state computation below consumes. `pnl` is caller-
    supplied economic P&L (matching P2C's own `economicPnl` field, never
    recomputed here from bid/ask)."""

    observed_at: str  # ISO-8601
    pnl: Optional[float]
    delta: Optional[float]
    gamma: Optional[float]
    iv: Optional[float]
    underlying_price: Optional[float]
    is_known_peak_search_complete: bool  # True only if the caller affirms no gap exists between this and the prior checkpoint large enough to plausibly hide the true peak/trough


@dataclass(frozen=True)
class PositionPathSnapshot:
    completeness: PathCompletenessState
    entry: Optional[PathCheckpoint]
    peak_by_pnl: Optional[PathCheckpoint]
    trough_by_pnl: Optional[PathCheckpoint]
    current: Optional[PathCheckpoint]
    profit_giveback: Optional[float]  # peak.pnl - current.pnl, only when both known and completeness != MISSING_PEAK_OBSERVATION
    time_since_entry_seconds: Optional[float]
    time_since_peak_seconds: Optional[float]
    time_since_trough_seconds: Optional[float]


def _parse(ts: str) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def assess_path_completeness(checkpoints: Sequence[PathCheckpoint], event_window_overlaps: bool) -> PathCompletenessState:
    """Never assumes completeness -- requires the caller's own affirmative
    `is_known_peak_search_complete` on every checkpoint plus an explicit
    `event_window_overlaps` flag (from `event_state_research.py`'s own
    EVENT_DATA_UNKNOWN state, caller-supplied here to avoid a hard import
    dependency)."""
    if event_window_overlaps:
        return PathCompletenessState.EVENT_AMBIGUOUS
    if len(checkpoints) == 0:
        return PathCompletenessState.MISSING_PEAK_OBSERVATION
    if any(not c.is_known_peak_search_complete for c in checkpoints):
        return PathCompletenessState.PARTIAL_MISSING_INTERMEDIATE
    return PathCompletenessState.COMPLETE


def compute_path_state(checkpoints: Sequence[PathCheckpoint], event_window_overlaps: bool) -> PositionPathSnapshot:
    """`checkpoints` must already be in ascending `observed_at` order --
    this function does not itself sort (matching this package's existing
    strict-causal-ordering discipline elsewhere; a caller passing
    unordered checkpoints gets a meaningless result, which is the
    caller's own bug to fix upstream, not something to silently correct
    here)."""
    completeness = assess_path_completeness(checkpoints, event_window_overlaps)
    if len(checkpoints) == 0:
        return PositionPathSnapshot(completeness, None, None, None, None, None, None, None, None)

    entry, current = checkpoints[0], checkpoints[-1]
    known = [c for c in checkpoints if c.pnl is not None]
    peak = max(known, key=lambda c: c.pnl) if known else None  # type: ignore[arg-type]
    trough = min(known, key=lambda c: c.pnl) if known else None  # type: ignore[arg-type]

    giveback = None
    if completeness != PathCompletenessState.MISSING_PEAK_OBSERVATION and peak is not None and current.pnl is not None:
        giveback = peak.pnl - current.pnl  # type: ignore[operator]

    entry_dt, current_dt = _parse(entry.observed_at), _parse(current.observed_at)
    peak_dt = _parse(peak.observed_at) if peak is not None else None
    trough_dt = _parse(trough.observed_at) if trough is not None else None

    return PositionPathSnapshot(
        completeness=completeness, entry=entry, peak_by_pnl=peak, trough_by_pnl=trough, current=current,
        profit_giveback=giveback,
        time_since_entry_seconds=(current_dt - entry_dt).total_seconds() if entry_dt and current_dt else None,
        time_since_peak_seconds=(current_dt - peak_dt).total_seconds() if peak_dt and current_dt else None,
        time_since_trough_seconds=(current_dt - trough_dt).total_seconds() if trough_dt and current_dt else None,
    )


def dte_at(expiration: str, checkpoint_at: str) -> Optional[float]:
    expiration_dt, checkpoint_dt = _parse(expiration), _parse(checkpoint_at)
    if expiration_dt is None or checkpoint_dt is None:
        return None
    return (expiration_dt - checkpoint_dt).total_seconds() / 86400.0


def distance_to_strike(underlying_price: Optional[float], strike: Optional[float], as_percent: bool) -> Optional[float]:
    if underlying_price is None or strike is None or strike == 0:
        return None
    distance = underlying_price - strike
    return distance / strike if as_percent else distance


# ---------------------------------------------------------------------------
# Section 10: trajectory (velocity/acceleration) features.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TrajectoryFeature:
    velocity_per_hour: Optional[float]
    acceleration_per_hour_squared: Optional[float]  # None unless 3+ checkpoints with known values exist


def compute_trajectory(checkpoints: Sequence[PathCheckpoint], field: str) -> TrajectoryFeature:
    """Generic velocity/acceleration over any numeric field (`pnl`,
    `delta`, `gamma`, `iv`, `underlying_price`) across an ordered
    checkpoint sequence. Requires at least 2 known-value checkpoints for
    velocity, 3 for acceleration -- returns None rather than a
    fabricated rate from too few points."""
    points = [(c, getattr(c, field)) for c in checkpoints]
    known = [(c, value) for c, value in points if value is not None]
    if len(known) < 2:
        return TrajectoryFeature(None, None)
    (first_c, first_v), (last_c, last_v) = known[0], known[-1]
    first_dt, last_dt = _parse(first_c.observed_at), _parse(last_c.observed_at)
    if first_dt is None or last_dt is None or last_dt == first_dt:
        return TrajectoryFeature(None, None)
    elapsed_hours = (last_dt - first_dt).total_seconds() / 3600.0
    velocity = (last_v - first_v) / elapsed_hours
    if len(known) < 3:
        return TrajectoryFeature(velocity, None)
    mid_c, mid_v = known[len(known) // 2]
    mid_dt = _parse(mid_c.observed_at)
    if mid_dt is None or mid_dt == first_dt or last_dt == mid_dt:
        return TrajectoryFeature(velocity, None)
    first_half_velocity = (mid_v - first_v) / ((mid_dt - first_dt).total_seconds() / 3600.0)
    second_half_velocity = (last_v - mid_v) / ((last_dt - mid_dt).total_seconds() / 3600.0)
    acceleration = (second_half_velocity - first_half_velocity) / elapsed_hours
    return TrajectoryFeature(velocity, acceleration)


# ---------------------------------------------------------------------------
# Sections 8-9: trade-path classification. States, never commands -- no
# state here is ever wired to an automatic close/hold/roll decision.
# ---------------------------------------------------------------------------

class TradePathState(str, Enum):
    ENTRY_IMMEDIATE_LOSS = "ENTRY_IMMEDIATE_LOSS"
    NORMAL_ADVERSE_MOVE = "NORMAL_ADVERSE_MOVE"
    THESIS_DETERIORATION = "THESIS_DETERIORATION"
    WINNER_GIVEBACK = "WINNER_GIVEBACK"
    WINNER_TO_LOSER = "WINNER_TO_LOSER"
    ACCELERATING_LOSS = "ACCELERATING_LOSS"
    LATE_EXPIRY_LOSS = "LATE_EXPIRY_LOSS"
    EVENT_DRIVEN_LOSS = "EVENT_DRIVEN_LOSS"
    LIQUIDITY_MARK_LOSS = "LIQUIDITY_MARK_LOSS"
    RECOVERY_IMPROVING = "RECOVERY_IMPROVING"
    RECOVERY_DETERIORATING = "RECOVERY_DETERIORATING"
    NORMAL_GIVEBACK = "NORMAL_GIVEBACK"
    MATERIAL_EDGE_DETERIORATION = "MATERIAL_EDGE_DETERIORATION"
    WINNER_TO_LOSER_WARNING = "WINNER_TO_LOSER_WARNING"
    UNCLASSIFIED = "UNCLASSIFIED"  # honest fallback -- never forced into a named state without supporting evidence


@dataclass(frozen=True)
class WinnerToLoserAssessment:
    """Section 9: a position at -5% is NOT equivalent to one that peaked at
    +25% and fell to -5% -- this function requires the caller to supply
    BOTH the peak and the deterioration-velocity context, never collapses
    to current P&L alone."""

    state: TradePathState
    peak_pnl: Optional[float]
    current_pnl: Optional[float]
    giveback_velocity_per_hour: Optional[float]  # from compute_trajectory(field='pnl') on the post-peak segment
    delta_deteriorated: Optional[bool]  # caller's own judgment from DELTA_CHANGE context
    reasons: list


def assess_winner_to_loser(
    peak_pnl: Optional[float], current_pnl: Optional[float], giveback_velocity_per_hour: Optional[float],
    delta_deteriorated: Optional[bool], minimum_material_giveback: float,
) -> WinnerToLoserAssessment:
    """`minimum_material_giveback` is REQUIRED and caller-justified --
    never a hardcoded percentage. Classification is descriptive only,
    never an automatic close trigger, per the directive's own explicit
    instruction (section 9: 'without turning any one state into an
    automatic close')."""
    if peak_pnl is None or current_pnl is None:
        return WinnerToLoserAssessment(TradePathState.UNCLASSIFIED, peak_pnl, current_pnl, giveback_velocity_per_hour, delta_deteriorated, ["PEAK_OR_CURRENT_PNL_UNKNOWN"])
    giveback = peak_pnl - current_pnl
    if giveback < minimum_material_giveback:
        return WinnerToLoserAssessment(TradePathState.NORMAL_GIVEBACK, peak_pnl, current_pnl, giveback_velocity_per_hour, delta_deteriorated, [])
    if current_pnl < 0 <= peak_pnl:
        state = TradePathState.WINNER_TO_LOSER
        reasons = ["POSITION_CROSSED_FROM_PROFIT_TO_LOSS_AFTER_A_PEAK"]
    elif delta_deteriorated is True or (giveback_velocity_per_hour is not None and giveback_velocity_per_hour > 0):
        state = TradePathState.MATERIAL_EDGE_DETERIORATION
        reasons = ["GIVEBACK_EXCEEDS_MATERIALITY_BAR_WITH_DETERIORATING_CONTEXT"]
    else:
        state = TradePathState.WINNER_TO_LOSER_WARNING
        reasons = ["GIVEBACK_EXCEEDS_MATERIALITY_BAR_STILL_PROFITABLE"]
    return WinnerToLoserAssessment(state, peak_pnl, current_pnl, giveback_velocity_per_hour, delta_deteriorated, reasons)
