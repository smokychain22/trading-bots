"""Cost/slippage baseline (THETA long-run build, work package 36).

Real search performed first: `models/execution_quality.py`'s
`assess_execution_quality` already computes a real, tested, BBO-relative
per-share slippage concession (`expected_slippage_per_share` -- the
distance from the limit price to the executable side of the BBO). This
module does NOT duplicate that -- it is the genuinely missing piece:
a liquidity/DTE-aware SCALING factor on top of that per-share concession,
since the existing model's concession is purely BBO-relative and does not
widen with lower liquidity, more legs, or longer time-to-expiry (all real,
observable structural risk factors this repo's own AEGIS/liquidity
features already surface -- `features/liquidity.py`, this session's
LIQUIDITY feature). Always `MODELED_RESEARCH` -- never a real fill.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class CostSlippageScalingInputs:
    base_slippage_per_share: float  # from models/execution_quality.py's expected_slippage_per_share
    spread_pct: float
    quote_size: Optional[int]
    min_quote_size_for_full_confidence: int
    leg_count: int
    dte: int
    reference_dte: int  # the DTE at which the DTE scaling factor is 1.0 (neutral)


@dataclass(frozen=True)
class CostSlippageEstimate:
    scaled_slippage_per_share: float
    spread_scaling_factor: float
    liquidity_scaling_factor: float
    leg_scaling_factor: float
    dte_scaling_factor: float
    truth_class: str = "MODELED_RESEARCH"


def estimate_scaled_slippage(inputs: CostSlippageScalingInputs) -> CostSlippageEstimate:
    # Wider spread never IMPROVES (lowers) the modeled slippage -- it can
    # only widen or hold it, by construction (this factor never goes below
    # 1.0, and strictly increases with spread_pct).
    spread_scaling_factor = 1.0 + max(0.0, inputs.spread_pct)

    # Lower displayed size never improves (lowers) the modeled slippage.
    if inputs.quote_size is None:
        liquidity_scaling_factor = 1.5  # UNKNOWN size is treated conservatively, never as if size were ample
    else:
        size_ratio = min(1.0, max(0.0, inputs.quote_size / max(1, inputs.min_quote_size_for_full_confidence)))
        liquidity_scaling_factor = 1.0 + (1.0 - size_ratio) * 0.5  # thinner size -> up to 1.5x, never below 1.0x

    # More legs never improves (lowers) the modeled slippage -- each
    # additional leg beyond the first adds its own real execution risk.
    leg_scaling_factor = 1.0 + max(0, inputs.leg_count - 1) * 0.25

    # Longer time-to-expiry than the reference never improves (lowers) the
    # modeled slippage -- a longer-dated contract's quotes are typically
    # thinner/wider than a near-dated reference point.
    dte_scaling_factor = 1.0 + max(0.0, (inputs.dte - inputs.reference_dte) / max(1, inputs.reference_dte)) * 0.2

    scaled = (
        inputs.base_slippage_per_share
        * spread_scaling_factor * liquidity_scaling_factor * leg_scaling_factor * dte_scaling_factor
    )
    return CostSlippageEstimate(
        scaled_slippage_per_share=scaled, spread_scaling_factor=spread_scaling_factor,
        liquidity_scaling_factor=liquidity_scaling_factor, leg_scaling_factor=leg_scaling_factor,
        dte_scaling_factor=dte_scaling_factor,
    )
