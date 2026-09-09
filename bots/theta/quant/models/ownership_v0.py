"""Ownership v0 -- first interpretable (non-ML) ownership scoring model.

    Ownability = LiquidityQuality x StructuralQuality x RecoveryQuality
                 x TailQuality x EventAdjustment

This is a structural STARTING POINT, not a proven formula -- the
multiplicative decomposition and each component's internal weighting are
TEST hypotheses in their own right (see COMPONENT_STATUS below). Only a
short list of things are architectural requirements: that ownership is
scored at all rather than assumed (TRD UNIV-003), that a liquidity floor
exists, and that an event-proximity adjustment exists. Everything about
*how much* each component should matter, and whether multiplication is even
the right combinator versus e.g. a weighted sum or a gating structure, is
open and must be tested (see docs/STRATEGY_DNA.md's continuation plan).

Distinguishes three ownership questions explicitly, per the research brief:

- ``ownability_at_entry``: score computed before any position exists, from
  the candidate's current point-in-time state. This is what ``evaluate()``
  below computes directly.
- ``ownability_after_adverse_move``: the *same* formula and the *same*
  function, just re-invoked with the underlying's current (post-move)
  state as input -- this module does not need a separate code path for it,
  only a documented calling convention: call ``evaluate()`` again with
  fresh inputs whenever a held position needs re-evaluation (e.g. during
  RECOVERY_WAIT).
- ``thesis_invalidation``: architecturally NOT the same as "a lower
  score." A thesis-invalidating event (e.g. a structural/fundamental
  change) is a hard signal, not a soft continuous one, and this module
  surfaces it as its own boolean-driven reason code (THESIS_INVALIDATED)
  that a caller (the recovery-wait bound in recovery_spec.py) should treat
  as a hard trigger, not average into the numeric Ownability score.

No I/O, no provider dependency, no ML. Every threshold is a required
constructor argument on :class:`OwnershipPolicyV0` -- nothing here defaults
silently.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

from models.common import ReasonCode

# ---------------------------------------------------------------------------
# What is architecturally required vs. what is an open research question.
# Referenced by docs/STRATEGY_DNA.md and by callers deciding how much to
# trust a component before Phase 6 validation exists.
# ---------------------------------------------------------------------------

COMPONENT_STATUS = {
    "ownership_scored_at_all": "ARCHITECTURAL",  # TRD UNIV-003
    "liquidity_floor_exists": "ARCHITECTURAL",
    "event_adjustment_exists": "ARCHITECTURAL",
    "multiplicative_combination": "TEST",  # vs. weighted sum / gating -- unproven
    "LiquidityQuality_formula": "TEST",
    "StructuralQuality_formula": "TEST",
    "RecoveryQuality_formula": "TEST",  # additionally blocked on recovery_spec.py's model existing
    "TailQuality_formula": "TEST",  # additionally blocked on severe_drawdown_spec.py's model existing
    "EventAdjustment_decay_function": "TEST",
    "thesis_invalidation_is_a_hard_signal_not_a_score_input": "ARCHITECTURAL",
}


@dataclass(frozen=True)
class OwnershipInputs:
    """Point-in-time inputs. ``None`` means UNKNOWN -- never coerced to a
    neutral default. Field names align with
    bots/theta/quant/research/data/feature_families.json where a
    corresponding feature_family_id exists.
    """

    # Liquidity
    stock_avg_volume: Optional[float]
    option_open_interest: Optional[int]
    option_volume: Optional[int]
    spread_pct: Optional[float]

    # Structural / trend (1d/5d/20d/60d returns, MA relationships/slopes,
    # relative strength, realized vol at three horizons)
    ret_1d: Optional[float]
    ret_5d: Optional[float]
    ret_20d: Optional[float]
    ret_60d: Optional[float]
    ma20_rel: Optional[float]
    ma50_rel: Optional[float]
    ma200_rel: Optional[float]
    ma_slope: Optional[float]
    relative_strength: Optional[float]
    rv10: Optional[float]
    rv20: Optional[float]
    rv60: Optional[float]

    # Tail / drawdown
    drawdown: Optional[float]  # current drawdown from running peak, <= 0
    max_adverse_gap: Optional[float]  # worst single-session adverse gap magnitude, lookback-defined
    gap_frequency: Optional[float]  # adverse gaps per period, lookback-defined
    downside_semivariance: Optional[float]

    # Recovery/severe-drawdown history (a point-in-time PROXY only --
    # RecoveryQuality/TailQuality cannot use a fitted model until
    # severe_drawdown_spec.py / recovery_spec.py's models exist; until then
    # these raw historical-episode summaries are what's available)
    historical_recovery_median_days: Optional[float]
    historical_recovery_p95_days: Optional[float]
    severe_drawdown_episode_count: Optional[int]

    # Event proximity
    earnings_distance_days: Optional[int]
    ex_dividend_distance_days: Optional[int]
    known_event_distance_days: Optional[int]

    # Explicit hard signal -- never derived by this module, always supplied
    # by the caller (e.g. from a documented fundamental/structural change).
    thesis_invalidated: bool = False


@dataclass(frozen=True)
class OwnershipPolicyV0:
    """Versioned thresholds -- required, not defaulted (TRD section 51)."""

    policy_version: str
    min_stock_avg_volume: float
    min_option_open_interest: int
    min_option_volume: int
    max_spread_pct: float
    rv_normalization_ceiling: float  # RV value treated as "1.0 bad" for normalization
    downside_semivar_normalization_ceiling: float
    gap_frequency_normalization_ceiling: float
    event_decay_window_days: int  # distance beyond which EventAdjustment is fully 1.0 (no penalty)


@dataclass(frozen=True)
class ComponentScore:
    name: str
    value: Optional[float]  # None = UNKNOWN, never defaulted
    status: str  # COMPONENT_STATUS[...] for this component's formula
    reasons: List[ReasonCode]


@dataclass(frozen=True)
class OwnershipEvaluation:
    ownability: Optional[float]  # None if any required component is UNKNOWN
    components: List[ComponentScore]
    thesis_invalidated: bool
    reasons: List[ReasonCode]  # top-level reasons, e.g. THESIS_INVALIDATED


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _liquidity_quality(inputs: OwnershipInputs, policy: OwnershipPolicyV0) -> ComponentScore:
    reasons: List[ReasonCode] = []
    fields = (inputs.stock_avg_volume, inputs.option_open_interest, inputs.option_volume, inputs.spread_pct)
    if any(f is None for f in fields):
        reasons.append(ReasonCode("LIQUIDITY_UNKNOWN", -1, "One or more liquidity inputs is UNKNOWN."))
        return ComponentScore("LiquidityQuality", None, COMPONENT_STATUS["LiquidityQuality_formula"], reasons)

    volume_ok = inputs.stock_avg_volume >= policy.min_stock_avg_volume
    oi_ok = inputs.option_open_interest >= policy.min_option_open_interest
    opt_volume_ok = inputs.option_volume >= policy.min_option_volume
    spread_ok = inputs.spread_pct <= policy.max_spread_pct

    if not (volume_ok and oi_ok and opt_volume_ok and spread_ok):
        reasons.append(ReasonCode(
            "LIQUIDITY_BELOW_FLOOR", -1,
            f"stock_volume_ok={volume_ok} oi_ok={oi_ok} option_volume_ok={opt_volume_ok} spread_ok={spread_ok}",
        ))
        return ComponentScore("LiquidityQuality", 0.0, COMPONENT_STATUS["LiquidityQuality_formula"], reasons)

    # Transparent v0: floor-pass = 1.0. A graded score (e.g. scaling
    # continuously with distance above the floor) is a TEST refinement,
    # not asserted here.
    reasons.append(ReasonCode("LIQUIDITY_ACCEPTABLE", 1, "All liquidity floors met."))
    return ComponentScore("LiquidityQuality", 1.0, COMPONENT_STATUS["LiquidityQuality_formula"], reasons)


def _structural_quality(inputs: OwnershipInputs) -> ComponentScore:
    reasons: List[ReasonCode] = []
    fields = (inputs.ma20_rel, inputs.ma50_rel, inputs.ma200_rel, inputs.ma_slope, inputs.relative_strength)
    if any(f is None for f in fields):
        reasons.append(ReasonCode("STRUCTURAL_UNKNOWN", -1, "One or more trend/structure inputs is UNKNOWN."))
        return ComponentScore("StructuralQuality", None, COMPONENT_STATUS["StructuralQuality_formula"], reasons)

    # Transparent v0: reward price above its moving averages and a
    # non-negative slope; penalize below. This is an explicit, auditable
    # placeholder, not a fitted trend-quality model.
    above_count = sum(1 for x in (inputs.ma20_rel, inputs.ma50_rel, inputs.ma200_rel) if x > 0)
    trend_component = above_count / 3.0
    slope_component = 1.0 if inputs.ma_slope >= 0 else 0.0
    rs_component = _clip01(0.5 + inputs.relative_strength / 2.0)  # relative_strength in [-1, 1] -> [0, 1]

    score = (trend_component + slope_component + rs_component) / 3.0
    reasons.append(ReasonCode(
        "STRUCTURAL_SCORE", 1 if score >= 0.5 else -1,
        f"above_ma_count={above_count}/3, slope>=0={inputs.ma_slope >= 0}, relative_strength={inputs.relative_strength}",
    ))
    return ComponentScore("StructuralQuality", score, COMPONENT_STATUS["StructuralQuality_formula"], reasons)


def _tail_quality(inputs: OwnershipInputs, policy: OwnershipPolicyV0) -> ComponentScore:
    reasons: List[ReasonCode] = []
    fields = (inputs.downside_semivariance, inputs.gap_frequency, inputs.drawdown)
    if any(f is None for f in fields):
        reasons.append(ReasonCode("TAIL_UNKNOWN", -1, "One or more tail/drawdown inputs is UNKNOWN."))
        return ComponentScore("TailQuality", None, COMPONENT_STATUS["TailQuality_formula"], reasons)

    # Transparent v0 proxy (NOT the real severe-drawdown model -- see
    # severe_drawdown_spec.py, which requires a fitted dataset that does
    # not exist yet): penalize by normalized downside semivariance and gap
    # frequency. 1.0 = no observed tail stress, 0.0 = at/above the
    # normalization ceiling.
    semivar_penalty = _clip01(inputs.downside_semivariance / policy.downside_semivar_normalization_ceiling)
    gap_penalty = _clip01(inputs.gap_frequency / policy.gap_frequency_normalization_ceiling)
    score = 1.0 - max(semivar_penalty, gap_penalty)
    reasons.append(ReasonCode(
        "TAIL_SCORE", 1 if score >= 0.5 else -1,
        f"semivar_penalty={semivar_penalty:.3f} gap_penalty={gap_penalty:.3f} (proxy, not a fitted severe-drawdown model)",
    ))
    return ComponentScore("TailQuality", score, COMPONENT_STATUS["TailQuality_formula"], reasons)


def _recovery_quality(inputs: OwnershipInputs, policy: OwnershipPolicyV0) -> ComponentScore:
    reasons: List[ReasonCode] = []
    if inputs.historical_recovery_median_days is None:
        reasons.append(ReasonCode(
            "RECOVERY_HISTORY_UNKNOWN", -1,
            "No historical recovery-duration proxy available (real recovery model not yet fit -- recovery_spec.py).",
        ))
        return ComponentScore("RecoveryQuality", None, COMPONENT_STATUS["RecoveryQuality_formula"], reasons)

    # Transparent v0 proxy: shorter historical median recovery -> higher
    # score. Normalized against the event-decay window as a stand-in scale
    # (arbitrary choice, flagged TEST) until a real recovery model exists.
    score = _clip01(1.0 - (inputs.historical_recovery_median_days / (policy.event_decay_window_days * 4)))
    reasons.append(ReasonCode(
        "RECOVERY_HISTORY_PROXY", 1 if score >= 0.5 else -1,
        f"historical_recovery_median_days={inputs.historical_recovery_median_days} (proxy scale, TEST)",
    ))
    return ComponentScore("RecoveryQuality", score, COMPONENT_STATUS["RecoveryQuality_formula"], reasons)


def _event_adjustment(inputs: OwnershipInputs, policy: OwnershipPolicyV0) -> ComponentScore:
    reasons: List[ReasonCode] = []
    distances = [
        d for d in (inputs.earnings_distance_days, inputs.ex_dividend_distance_days, inputs.known_event_distance_days)
        if d is not None
    ]
    if not distances:
        reasons.append(ReasonCode("EVENT_DISTANCE_UNKNOWN", -1, "No event-distance inputs available."))
        return ComponentScore("EventAdjustment", None, COMPONENT_STATUS["EventAdjustment_decay_function"], reasons)

    nearest = min(distances)
    # Transparent v0: linear decay from 0.0 (event today) to 1.0 (event at
    # or beyond the decay window). A smoother/nonlinear decay is a TEST
    # refinement.
    factor = _clip01(nearest / policy.event_decay_window_days)
    reasons.append(ReasonCode(
        "EVENT_ADJUSTMENT", 1 if factor >= 0.8 else -1,
        f"nearest_event_distance_days={nearest}, decay_window={policy.event_decay_window_days}",
    ))
    return ComponentScore("EventAdjustment", factor, COMPONENT_STATUS["EventAdjustment_decay_function"], reasons)


def evaluate(inputs: OwnershipInputs, policy: OwnershipPolicyV0) -> OwnershipEvaluation:
    """Computes Ownability and its component breakdown. Returns
    ``ownability=None`` (UNKNOWN) if any component is UNKNOWN -- never
    substitutes a neutral/default value for a missing component."""
    components = [
        _liquidity_quality(inputs, policy),
        _structural_quality(inputs),
        _recovery_quality(inputs, policy),
        _tail_quality(inputs, policy),
        _event_adjustment(inputs, policy),
    ]

    top_reasons: List[ReasonCode] = []
    if inputs.thesis_invalidated:
        top_reasons.append(ReasonCode(
            "THESIS_INVALIDATED", -1,
            "Caller flagged thesis invalidation -- treat as a hard signal, not a lower score "
            "(see recovery_spec.py for the recovery-wait bound this should trigger).",
        ))

    if any(c.value is None for c in components):
        return OwnershipEvaluation(
            ownability=None,
            components=components,
            thesis_invalidated=inputs.thesis_invalidated,
            reasons=top_reasons,
        )

    ownability = 1.0
    for c in components:
        ownability *= c.value

    return OwnershipEvaluation(
        ownability=ownability,
        components=components,
        thesis_invalidated=inputs.thesis_invalidated,
        reasons=top_reasons,
    )
