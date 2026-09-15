"""Fill-model sensitivity and TCA (transaction-cost-analysis) research
(P2C pass 2, directive sections 11-13). Shadow-execution assumptions for
research/backtest use, distinct from THETA's actual Production execution
safety (Codex-owned, `bots/theta/app/`) -- this module NEVER submits or
sizes an order, it only models what a fill MIGHT have looked like for
research purposes, always labeled with its own bias direction so no single
model is mistaken for ground truth.

Directive's own instruction, upheld throughout: "recommend sensitivity
bands, not one magic fill model." `estimate_fill_across_models` always
returns every model's estimate side by side, never picks a winner.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Sequence


class FillModel(str, Enum):
    MID = "MID"
    BID_SIDE = "BID_SIDE"  # the conservative side for a SELLER (worse for the seller than mid)
    ASK_SIDE = "ASK_SIDE"  # the conservative side for a BUYER
    SPREAD_FRACTION = "SPREAD_FRACTION"  # mid +/- a caller-supplied fraction of the spread
    LIQUIDITY_ADJUSTED = "LIQUIDITY_ADJUSTED"  # concession scales with order size relative to caller-supplied available liquidity
    PER_LEG_SLIPPAGE = "PER_LEG_SLIPPAGE"  # applies a caller-supplied per-leg slippage estimate on top of a base model


class FillModelBias(str, Enum):
    OPTIMISTIC = "OPTIMISTIC"  # tends to overstate achievable economics
    PESSIMISTIC = "PESSIMISTIC"  # tends to understate achievable economics
    NEUTRAL_BUT_UNVERIFIED = "NEUTRAL_BUT_UNVERIFIED"  # no directional bias by construction, but never proven to match real fills


FILL_MODEL_BIAS: Dict[FillModel, FillModelBias] = {
    FillModel.MID: FillModelBias.OPTIMISTIC,
    FillModel.BID_SIDE: FillModelBias.PESSIMISTIC,
    FillModel.ASK_SIDE: FillModelBias.PESSIMISTIC,
    FillModel.SPREAD_FRACTION: FillModelBias.NEUTRAL_BUT_UNVERIFIED,
    FillModel.LIQUIDITY_ADJUSTED: FillModelBias.NEUTRAL_BUT_UNVERIFIED,
    FillModel.PER_LEG_SLIPPAGE: FillModelBias.NEUTRAL_BUT_UNVERIFIED,
}


class FillQuoteState(str, Enum):
    NORMAL = "NORMAL"
    ZERO_BID = "ZERO_BID"  # a real, meaningful market state (worthless-option or broken-quote territory) -- never treated as a data error
    WIDE_MARKET = "WIDE_MARKET"  # spread-to-mid ratio exceeds a caller-supplied threshold
    INVALID_QUOTE = "INVALID_QUOTE"  # bid > ask, or a nonpositive ask


@dataclass(frozen=True)
class Quote:
    bid: Optional[float]
    ask: Optional[float]


def classify_quote_state(quote: Quote, wide_market_spread_to_mid_ratio: float) -> FillQuoteState:
    """`wide_market_spread_to_mid_ratio` is REQUIRED and caller-justified --
    this module never hardcodes what counts as "wide" for a given
    underlying/liquidity tier."""
    if quote.bid is None or quote.ask is None or quote.ask <= 0:
        return FillQuoteState.INVALID_QUOTE
    if quote.bid > quote.ask:
        return FillQuoteState.INVALID_QUOTE
    if quote.bid == 0.0:
        return FillQuoteState.ZERO_BID
    mid = (quote.bid + quote.ask) / 2.0
    spread = quote.ask - quote.bid
    if mid > 0 and (spread / mid) > wide_market_spread_to_mid_ratio:
        return FillQuoteState.WIDE_MARKET
    return FillQuoteState.NORMAL


@dataclass(frozen=True)
class FillEstimate:
    model: FillModel
    bias: FillModelBias
    price: Optional[float]
    reason: Optional[str]


def estimate_fill_across_models(
    quote: Quote,
    side: str,  # "buy" | "sell"
    wide_market_spread_to_mid_ratio: float,
    spread_fraction: Optional[float] = None,
    order_size: Optional[float] = None,
    available_liquidity: Optional[float] = None,
    liquidity_concession_per_unit_oversize: Optional[float] = None,
    per_leg_slippage: Optional[float] = None,
) -> List[FillEstimate]:
    """Returns every requested model's estimate side by side -- callers use
    this as a SENSITIVITY BAND (best case vs. worst case vs. middle),
    never a single number. A model whose required inputs are missing
    returns `price=None` with a reason, rather than silently omitting
    itself from the list (so a caller always sees which models could not
    be evaluated, not just the ones that could)."""
    state = classify_quote_state(quote, wide_market_spread_to_mid_ratio)
    if state == FillQuoteState.INVALID_QUOTE:
        return [FillEstimate(model, FILL_MODEL_BIAS[model], None, "INVALID_QUOTE") for model in FillModel]
    if state == FillQuoteState.ZERO_BID and side == "sell":
        # A seller facing a zero bid has no modeled fill under ANY of these
        # models -- reported honestly, never defaulted to a fabricated
        # small positive price.
        return [FillEstimate(model, FILL_MODEL_BIAS[model], None, "ZERO_BID_NO_SELL_FILL_MODELED") for model in FillModel]

    bid, ask = quote.bid, quote.ask
    mid = (bid + ask) / 2.0
    spread = ask - bid
    results: List[FillEstimate] = []

    results.append(FillEstimate(FillModel.MID, FILL_MODEL_BIAS[FillModel.MID], mid, None))
    results.append(FillEstimate(FillModel.BID_SIDE, FILL_MODEL_BIAS[FillModel.BID_SIDE], bid, None))
    results.append(FillEstimate(FillModel.ASK_SIDE, FILL_MODEL_BIAS[FillModel.ASK_SIDE], ask, None))

    # Concession sign: a SELLER'S modeled fill moves DOWN from mid (worse for
    # them), a BUYER'S modeled fill moves UP from mid (worse for them) --
    # concession is always a cost, applied in the direction that disfavors
    # the trader's own side.
    unfavorable_sign = -1.0 if side == "sell" else 1.0

    if spread_fraction is None:
        results.append(FillEstimate(FillModel.SPREAD_FRACTION, FILL_MODEL_BIAS[FillModel.SPREAD_FRACTION], None, "MISSING_SPREAD_FRACTION"))
    else:
        concession = spread * spread_fraction * unfavorable_sign
        results.append(FillEstimate(FillModel.SPREAD_FRACTION, FILL_MODEL_BIAS[FillModel.SPREAD_FRACTION], mid + concession, None))

    if order_size is None or available_liquidity is None or liquidity_concession_per_unit_oversize is None:
        results.append(FillEstimate(FillModel.LIQUIDITY_ADJUSTED, FILL_MODEL_BIAS[FillModel.LIQUIDITY_ADJUSTED], None, "MISSING_LIQUIDITY_INPUTS"))
    elif available_liquidity <= 0:
        results.append(FillEstimate(FillModel.LIQUIDITY_ADJUSTED, FILL_MODEL_BIAS[FillModel.LIQUIDITY_ADJUSTED], None, "NO_AVAILABLE_LIQUIDITY"))
    else:
        oversize = max(0.0, (order_size - available_liquidity) / available_liquidity)
        concession = spread * oversize * liquidity_concession_per_unit_oversize * unfavorable_sign
        results.append(FillEstimate(FillModel.LIQUIDITY_ADJUSTED, FILL_MODEL_BIAS[FillModel.LIQUIDITY_ADJUSTED], mid + concession, None))

    if per_leg_slippage is None:
        results.append(FillEstimate(FillModel.PER_LEG_SLIPPAGE, FILL_MODEL_BIAS[FillModel.PER_LEG_SLIPPAGE], None, "MISSING_PER_LEG_SLIPPAGE"))
    else:
        adjustment = per_leg_slippage * unfavorable_sign
        results.append(FillEstimate(FillModel.PER_LEG_SLIPPAGE, FILL_MODEL_BIAS[FillModel.PER_LEG_SLIPPAGE], mid + adjustment, None))

    return results


# ---------------------------------------------------------------------------
# Multi-leg fill research (directive section 12).
# ---------------------------------------------------------------------------

class MultiLegFillMode(str, Enum):
    SIMULTANEOUS_PACKAGE = "SIMULTANEOUS_PACKAGE"  # both legs fill together at a net price -- lowest legging risk, often the LEAST realistic for size/liquidity
    INDEPENDENT_LEGGING = "INDEPENDENT_LEGGING"  # legs fill separately, exposing the position between fills -- most realistic, highest legging risk


@dataclass(frozen=True)
class LegFillEstimate:
    leg_label: str
    fill_price: Optional[float]


@dataclass(frozen=True)
class MultiLegFillResult:
    mode: MultiLegFillMode
    net_price: Optional[float]
    legging_exposure_seconds: Optional[float]  # None under SIMULTANEOUS_PACKAGE by construction
    reason: Optional[str]


def evaluate_multi_leg_fill(
    mode: MultiLegFillMode,
    leg_estimates: Sequence[LegFillEstimate],
    leg_signs: Sequence[float],  # +1.0 = long/debit leg, -1.0 = short/credit leg, aligned index-for-index with leg_estimates
    independent_legging_gap_seconds: Optional[float] = None,
) -> MultiLegFillResult:
    """Never assumes a simultaneous fill is achievable just because it was
    requested -- reports NET_PRICE=None when any required leg estimate is
    missing, rather than silently pricing the package from only the legs
    that happened to have a fill. `INDEPENDENT_LEGGING` additionally
    requires the caller to supply the actual observed gap between leg
    fills (`independent_legging_gap_seconds`) -- never assumes a canonical
    delay."""
    if len(leg_estimates) != len(leg_signs):
        return MultiLegFillResult(mode, None, None, "LEG_COUNT_SIGN_MISMATCH")
    if any(leg.fill_price is None for leg in leg_estimates):
        return MultiLegFillResult(mode, None, None, "AT_LEAST_ONE_LEG_HAS_NO_MODELED_FILL")

    net_price = sum(sign * leg.fill_price for leg, sign in zip(leg_estimates, leg_signs))

    if mode == MultiLegFillMode.SIMULTANEOUS_PACKAGE:
        return MultiLegFillResult(mode, net_price, None, None)

    if independent_legging_gap_seconds is None:
        return MultiLegFillResult(mode, net_price, None, "MISSING_LEGGING_GAP_SECONDS")
    return MultiLegFillResult(mode, net_price, independent_legging_gap_seconds, None)


# ---------------------------------------------------------------------------
# TCA measurements (directive section 13).
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TcaCheckpointPrices:
    decision_mid: Optional[float]
    arrival_bid: Optional[float]
    arrival_ask: Optional[float]
    submitted_limit: Optional[float]
    fill_price: Optional[float]
    side: str  # "buy" | "sell"


@dataclass(frozen=True)
class TcaResult:
    slippage_vs_decision_mid: Optional[float]  # signed: positive = cost to the trader, in the trader's disfavor
    slippage_vs_arrival_side: Optional[float]  # vs. arrival bid (sell) or arrival ask (buy) -- the "expected worst case at arrival"
    spread_capture_or_concession: Optional[float]  # positive = captured inside the arrival spread; negative = paid through it


def compute_tca(prices: TcaCheckpointPrices) -> TcaResult:
    """Every field is signed FROM THE TRADER'S PERSPECTIVE (positive =
    cost), computed only from caller-supplied, already-PIT-safe
    checkpoint prices. Missing any operand yields None for that specific
    field, never a fabricated zero cost."""
    sign = 1.0 if prices.side == "sell" else -1.0

    slippage_vs_mid = None
    if prices.decision_mid is not None and prices.fill_price is not None:
        slippage_vs_mid = sign * (prices.decision_mid - prices.fill_price)

    slippage_vs_arrival_side = None
    arrival_reference = prices.arrival_bid if prices.side == "sell" else prices.arrival_ask
    if arrival_reference is not None and prices.fill_price is not None:
        slippage_vs_arrival_side = sign * (arrival_reference - prices.fill_price)

    spread_capture = None
    if prices.arrival_bid is not None and prices.arrival_ask is not None and prices.fill_price is not None:
        arrival_mid = (prices.arrival_bid + prices.arrival_ask) / 2.0
        spread_capture = sign * (prices.fill_price - arrival_mid)

    return TcaResult(slippage_vs_mid, slippage_vs_arrival_side, spread_capture)


@dataclass(frozen=True)
class RollExecutionCost:
    close_leg_cost: Optional[float]  # positive = cost to close the old leg
    open_leg_cost: Optional[float]  # positive = cost/credit-shortfall on the new leg, same sign convention
    net_roll_execution_cost: Optional[float]


def compute_roll_execution_cost(close_leg_cost: Optional[float], open_leg_cost: Optional[float]) -> RollExecutionCost:
    """A roll's realized-P&L-on-the-old-leg is immutable per the standing
    ROLL-001 discipline (close-old + open-new, never blended) -- this
    function computes ONLY the execution-cost component (spread/slippage
    on each leg), never a merged P&L figure, keeping it strictly additive
    to whatever the old leg's own immutable realized P&L already was."""
    if close_leg_cost is None or open_leg_cost is None:
        return RollExecutionCost(close_leg_cost, open_leg_cost, None)
    return RollExecutionCost(close_leg_cost, open_leg_cost, close_leg_cost + open_leg_cost)
