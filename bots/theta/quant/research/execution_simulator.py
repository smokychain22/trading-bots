"""Research execution simulator for THETA's replay engine (R6B).

STRUCTURAL_EXECUTION_MODEL, explicitly NOT an EMPIRICALLY_CALIBRATED_FILL_
MODEL -- this distinction is the whole point of this module. It models
order DIRECTION, spread-relative pricing, quote freshness, and partial/
no-fill mechanics deterministically and testably. It does NOT claim to
know real-world fill probabilities: `fill_probability` is always
`FillProbability.UNKNOWN` (never a fabricated 70%/80%/90%) until a real
historical order/quote/fill dataset exists to calibrate against
(`docs/research/THETA_EV_MODEL_SPEC.md`'s EV_MODEL_NOT_EMPIRICALLY_READY
status extends to this module's fill probabilities too).

Order sides mirror THETA's own real order-intent vocabulary
(`src/theta/order-intent-state.ts`) rather than inventing a parallel one:
SELL_TO_OPEN, BUY_TO_CLOSE, SELL_TO_CLOSE, BUY_TO_OPEN (options), plus
BUY_STOCK/SELL_STOCK. Buying and selling do NOT share one directionless
slippage formula -- a BUY moves toward the ask, a SELL moves toward the
bid, per the explicit directive.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class OrderSide(str, Enum):
    SELL_TO_OPEN = "SELL_TO_OPEN"
    BUY_TO_CLOSE = "BUY_TO_CLOSE"
    SELL_TO_CLOSE = "SELL_TO_CLOSE"
    BUY_TO_OPEN = "BUY_TO_OPEN"
    BUY_STOCK = "BUY_STOCK"
    SELL_STOCK = "SELL_STOCK"


# Every side maps to a genuine BUY or SELL market-side effect -- this is
# the one fact that determines which side of the spread the fill price
# moves toward. Never inferred implicitly at each call site; fixed here
# once so it cannot silently disagree between two call sites.
_BUY_SIDES = frozenset({OrderSide.BUY_TO_CLOSE, OrderSide.BUY_TO_OPEN, OrderSide.BUY_STOCK})
_SELL_SIDES = frozenset({OrderSide.SELL_TO_OPEN, OrderSide.SELL_TO_CLOSE, OrderSide.SELL_STOCK})


def is_buy_side(side: OrderSide) -> bool:
    return side in _BUY_SIDES


class FillProbability(str, Enum):
    """Deliberately has only ONE real value today. This is not an
    oversight -- it is the honest statement that no calibrated fill-
    probability model exists yet. A future EMPIRICALLY_CALIBRATED_FILL_
    MODEL would replace this enum's consumption with a real float in
    [0, 1], but that requires real historical order/quote/fill evidence
    this repository does not have."""

    UNKNOWN = "UNKNOWN"


class FillOutcome(str, Enum):
    FULL_FILL = "FULL_FILL"
    PARTIAL_FILL = "PARTIAL_FILL"
    NO_FILL = "NO_FILL"
    REJECTED_STALE_QUOTE = "REJECTED_STALE_QUOTE"
    REJECTED_SESSION_CLOSED = "REJECTED_SESSION_CLOSED"
    REJECTED_INVALID_QUOTE = "REJECTED_INVALID_QUOTE"


@dataclass(frozen=True)
class QuoteState:
    bid: Optional[float]
    ask: Optional[float]
    bid_size: Optional[float]
    ask_size: Optional[float]
    quote_age_seconds: Optional[float]
    session_open: bool


@dataclass(frozen=True)
class OrderRequest:
    side: OrderSide
    quantity: float
    limit_price: Optional[float]  # None = market-style order (still requires a valid, fresh quote to simulate against)
    max_quote_age_seconds: float  # the replay's own freshness policy, caller-supplied, never a hardcoded default


@dataclass(frozen=True)
class SimulatedFillResult:
    outcome: FillOutcome
    filled_quantity: float  # 0.0 for NO_FILL/REJECTED_*
    unfilled_quantity: float
    fill_price: Optional[float]  # None unless outcome is FULL_FILL or PARTIAL_FILL
    modeled_slippage_per_unit: Optional[float]  # signed: positive = cost to the trader, in the direction that hurts them
    fill_probability: FillProbability
    reasons: list


def simulate_fill(
    request: OrderRequest,
    quote: QuoteState,
    fill_ratio: float,
) -> SimulatedFillResult:
    """Structural (not empirically calibrated) fill simulation.

    `fill_ratio` in [0, 1] is a caller-supplied, explicit assumption
    about how far into the spread the fill price lands (0.0 = at the
    passive/best-for-the-trader side, i.e. the quote's own bid for a buy
    or ask for a sell -- deliberately never used as a default; 1.0 = at
    the full spread, the worst price for the trader). This mirrors
    optopsy's own named "spread"/"liquidity" slippage models (`ADOPT_
    METHOD`, method only) rather than one directionless formula. This
    function does not choose a value for `fill_ratio` itself -- a real
    calibration would come from historical fill data, which does not
    exist yet.

    `fill_probability` is always `FillProbability.UNKNOWN` in the
    returned result -- this function determines FILL ELIGIBILITY
    (whether the order COULD structurally fill given the quote), never a
    probability of it actually happening in reality.
    """
    reasons = []

    if not quote.session_open:
        reasons.append("session is not open -- an order can never be simulated as filling outside real market hours")
        return SimulatedFillResult(
            outcome=FillOutcome.REJECTED_SESSION_CLOSED, filled_quantity=0.0, unfilled_quantity=request.quantity,
            fill_price=None, modeled_slippage_per_unit=None, fill_probability=FillProbability.UNKNOWN, reasons=reasons,
        )

    if quote.bid is None or quote.ask is None or quote.bid <= 0 or quote.ask <= 0 or quote.ask < quote.bid:
        reasons.append("quote is missing or structurally invalid (no bid/ask, non-positive price, or crossed market) -- never simulated against a fabricated price")
        return SimulatedFillResult(
            outcome=FillOutcome.REJECTED_INVALID_QUOTE, filled_quantity=0.0, unfilled_quantity=request.quantity,
            fill_price=None, modeled_slippage_per_unit=None, fill_probability=FillProbability.UNKNOWN, reasons=reasons,
        )

    if quote.quote_age_seconds is None or quote.quote_age_seconds > request.max_quote_age_seconds:
        reasons.append(f"quote_age_seconds={quote.quote_age_seconds} exceeds max_quote_age_seconds={request.max_quote_age_seconds} (or is unknown) -- never filled against a stale reference price")
        return SimulatedFillResult(
            outcome=FillOutcome.REJECTED_STALE_QUOTE, filled_quantity=0.0, unfilled_quantity=request.quantity,
            fill_price=None, modeled_slippage_per_unit=None, fill_probability=FillProbability.UNKNOWN, reasons=reasons,
        )

    if not (0.0 <= fill_ratio <= 1.0):
        raise ValueError(f"fill_ratio must be in [0, 1], got {fill_ratio}")

    mid = (quote.bid + quote.ask) / 2.0
    half_spread = (quote.ask - quote.bid) / 2.0
    buying = is_buy_side(request.side)

    # Direction-aware pricing -- the one property the directive requires
    # explicitly: buying moves toward the ask, selling moves toward the
    # bid, never a shared midpoint assumption for both.
    fill_price = mid + half_spread * fill_ratio if buying else mid - half_spread * fill_ratio

    if request.limit_price is not None:
        if buying and fill_price > request.limit_price:
            reasons.append(f"modeled fill price {fill_price:.4f} exceeds the buy limit {request.limit_price:.4f}")
            return SimulatedFillResult(
                outcome=FillOutcome.NO_FILL, filled_quantity=0.0, unfilled_quantity=request.quantity,
                fill_price=None, modeled_slippage_per_unit=None, fill_probability=FillProbability.UNKNOWN, reasons=reasons,
            )
        if not buying and fill_price < request.limit_price:
            reasons.append(f"modeled fill price {fill_price:.4f} is below the sell limit {request.limit_price:.4f}")
            return SimulatedFillResult(
                outcome=FillOutcome.NO_FILL, filled_quantity=0.0, unfilled_quantity=request.quantity,
                fill_price=None, modeled_slippage_per_unit=None, fill_probability=FillProbability.UNKNOWN, reasons=reasons,
            )

    # Structural liquidity ceiling: never assume the full requested
    # quantity fills when the quoted size at the relevant side is
    # smaller. The relevant side is the side the trader is REMOVING
    # liquidity from: a buy consumes ask size, a sell consumes bid size.
    available_size = quote.ask_size if buying else quote.bid_size
    if available_size is None:
        reasons.append("quote size at the relevant side is unknown -- structurally treated as zero available liquidity, never assumed sufficient")
        available_size = 0.0

    filled_quantity = min(request.quantity, available_size)
    unfilled_quantity = request.quantity - filled_quantity

    slippage_per_unit = half_spread * fill_ratio  # always non-negative: the cost of crossing part of the spread, in the direction that hurts the trader

    if filled_quantity <= 0:
        reasons.append("available quoted size at the relevant side is zero -- no fill")
        return SimulatedFillResult(
            outcome=FillOutcome.NO_FILL, filled_quantity=0.0, unfilled_quantity=request.quantity,
            fill_price=None, modeled_slippage_per_unit=None, fill_probability=FillProbability.UNKNOWN, reasons=reasons,
        )

    outcome = FillOutcome.FULL_FILL if unfilled_quantity <= 0 else FillOutcome.PARTIAL_FILL
    if outcome == FillOutcome.PARTIAL_FILL:
        reasons.append(f"requested quantity {request.quantity} exceeds available quoted size {available_size} at the relevant side -- partial fill only")
    else:
        reasons.append("full requested quantity structurally fillable against the modeled quote")

    return SimulatedFillResult(
        outcome=outcome, filled_quantity=filled_quantity, unfilled_quantity=unfilled_quantity,
        fill_price=fill_price, modeled_slippage_per_unit=slippage_per_unit,
        fill_probability=FillProbability.UNKNOWN, reasons=reasons,
    )
