"""Generic PIT leakage harness (work package 82).

Each feature/dataset module already has its own dedicated future-bar-
exclusion test (trend.py, momentum.py, realized_volatility.py, flow.py,
event_context.py, correlation.py, entry_episode_training.py, etc.) -- this
module is not a replacement for those, and does not re-derive their
individual leakage rules. It IS the missing reusable harness: one function
any of those tests (or a future one) can call to prove, generically, that
appending a post-decision observation never changes a T0 result.
"""
from __future__ import annotations

from typing import Any, Callable


def assert_pit_invariant(compute_fn: Callable[..., Any], *, before_args: tuple, after_args: tuple) -> None:
    """`before_args` and `after_args` must differ ONLY in that `after_args`
    carries additional observations dated strictly after the decision
    point being computed -- the caller is responsible for constructing
    that difference correctly; this harness only proves the two calls
    produce an IDENTICAL result. A mismatch means a future observation
    leaked into what should be a T0-only computation."""
    before_result = compute_fn(*before_args)
    after_result = compute_fn(*after_args)
    if before_result != after_result:
        raise AssertionError(
            f'PIT_LEAKAGE_DETECTED: appending a post-decision observation changed the result.\n'
            f'before={before_result!r}\nafter={after_result!r}'
        )
