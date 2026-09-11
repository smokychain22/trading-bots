"""Reference (verification-only) Black-Scholes price/vega/IV solver (R6D).

THETA does not solve IV internally in Production -- Optionomics-sourced IV
is the executable truth, and this module must never become a second,
contradictory Production source of IV. Its only legitimate role is
VERIFICATION / backtest reconstruction / a sanity-check fallback for
research, per the standing "give an internal implementation an explicit
role, never a second contradictory Production truth" instruction.

Dependency-free (no scipy/numpy), mirroring this package's existing
convention (`selection_bias.py`'s `_normal_cdf`, `execution_simulator.py`'s
direction-aware isolation). Deliberately built to NEVER exhibit the two
batch-contamination bugs found in `thedhruvhegde/ivsurf`'s own vectorized
implementation (`docs/research/THETA_IV_SOLVER_COMPARISON.md`): every
contract here is solved and validated independently, one at a time -- there
is no vectorized/batch code path for a bad neighbor to contaminate.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _normal_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


@dataclass(frozen=True)
class BsInputs:
    spot: float
    strike: float
    years_to_expiry: float  # T; 0.0 means expired/at-expiry, never negative
    risk_free_rate: float
    sigma: float
    option_type: str  # "call" or "put"


def bs_price(inputs: BsInputs) -> float:
    """Black-Scholes price for exactly ONE contract. At T=0 (or effectively
    zero), returns intrinsic value directly -- this function only ever
    prices the ONE contract it was called for, so a T=0 contract can never
    contaminate any other contract's price (unlike ivsurf's `np.any(T==0)`
    whole-batch shortcut)."""
    if inputs.spot <= 0 or inputs.strike <= 0 or inputs.years_to_expiry < 0:
        raise ValueError("spot/strike must be positive and years_to_expiry must be >= 0")
    if inputs.option_type not in ("call", "put"):
        raise ValueError(f"option_type must be 'call' or 'put', got {inputs.option_type!r}")

    if inputs.years_to_expiry == 0.0:
        if inputs.option_type == "call":
            return max(inputs.spot - inputs.strike, 0.0)
        return max(inputs.strike - inputs.spot, 0.0)

    if inputs.sigma <= 0:
        raise ValueError("sigma must be positive for T > 0")

    sqrt_t = math.sqrt(inputs.years_to_expiry)
    d1 = (math.log(inputs.spot / inputs.strike) + (inputs.risk_free_rate + 0.5 * inputs.sigma ** 2) * inputs.years_to_expiry) / (inputs.sigma * sqrt_t)
    d2 = d1 - inputs.sigma * sqrt_t
    discount = math.exp(-inputs.risk_free_rate * inputs.years_to_expiry)

    if inputs.option_type == "call":
        return inputs.spot * _normal_cdf(d1) - inputs.strike * discount * _normal_cdf(d2)
    return inputs.strike * discount * _normal_cdf(-d2) - inputs.spot * _normal_cdf(-d1)


def bs_vega(inputs: BsInputs) -> float:
    """Vega (per 1.00 change in sigma, i.e. per a full vol point of 100%,
    matching this package's other per-1.00-sigma convention in
    execution_simulator.py/exposure math). Returns 0.0 at T=0 -- vega is
    genuinely zero at expiry, never undefined."""
    if inputs.years_to_expiry <= 0 or inputs.sigma <= 0:
        return 0.0
    sqrt_t = math.sqrt(inputs.years_to_expiry)
    d1 = (math.log(inputs.spot / inputs.strike) + (inputs.risk_free_rate + 0.5 * inputs.sigma ** 2) * inputs.years_to_expiry) / (inputs.sigma * sqrt_t)
    return inputs.spot * _normal_pdf(d1) * sqrt_t


def implied_volatility(
    price: float,
    spot: float,
    strike: float,
    years_to_expiry: float,
    risk_free_rate: float,
    option_type: str,
    tol: float = 1e-6,
    max_iter: int = 100,
) -> Optional[float]:
    """Newton-Raphson with a bisection fallback, for exactly ONE contract.
    Returns None (never NaN, never a fabricated guess) when the contract
    cannot be solved: price below intrinsic value (an arbitrage/no-arbitrage
    violation), T <= 0 (there is no IV to solve for at/after expiry), or
    non-convergence within `max_iter`. A single bad `price` here can never
    affect any other contract's result, since this function only ever
    handles one contract per call."""
    if years_to_expiry <= 0:
        return None

    if option_type == "call":
        intrinsic = max(spot - strike * math.exp(-risk_free_rate * years_to_expiry), 0.0)
    elif option_type == "put":
        intrinsic = max(strike * math.exp(-risk_free_rate * years_to_expiry) - spot, 0.0)
    else:
        raise ValueError(f"option_type must be 'call' or 'put', got {option_type!r}")

    if price < intrinsic - tol:
        return None  # a genuine no-arbitrage violation -- never solved, never guessed

    sigma = 0.2
    for _ in range(max_iter):
        candidate = BsInputs(spot, strike, years_to_expiry, risk_free_rate, sigma, option_type)
        modeled_price = bs_price(candidate)
        vega = bs_vega(candidate)
        diff = modeled_price - price
        if abs(diff) < tol:
            return sigma
        if vega < 1e-10:
            break  # Newton step is unusable (low-vega region) -- fall through to bisection
        sigma = sigma - diff / vega
        sigma = max(1e-4, min(sigma, 5.0))

    # Bisection fallback (Brent-family bracketing, simplified): always
    # converges for a monotonic price-vs-sigma function within the bracket,
    # at the cost of more iterations than Newton.
    lo, hi = 1e-4, 5.0
    price_lo = bs_price(BsInputs(spot, strike, years_to_expiry, risk_free_rate, lo, option_type)) - price
    price_hi = bs_price(BsInputs(spot, strike, years_to_expiry, risk_free_rate, hi, option_type)) - price
    if price_lo * price_hi > 0:
        return None  # root not bracketed -- fails closed, never guesses

    for _ in range(200):
        mid = (lo + hi) / 2.0
        price_mid = bs_price(BsInputs(spot, strike, years_to_expiry, risk_free_rate, mid, option_type)) - price
        if abs(price_mid) < tol:
            return mid
        if price_lo * price_mid < 0:
            hi = mid
        else:
            lo, price_lo = mid, price_mid

    return None  # did not converge within the iteration budget -- UNKNOWN, never a stale guess
