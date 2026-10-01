"""Training-serving parity implementations of the production (TypeScript) underlying features.

src/theta/underlying-features.ts computes the values the serving path feeds to the regime and ownership models.
Python research code that will train or calibrate those models must use the SAME definitions, or the model sees a
different distribution at serve time than it was fit on. Each function below mirrors one TypeScript function exactly and
is locked to its output by tests/fixtures/serving-features-parity.json (checked by both test suites).

RESEARCH_ONLY: nothing here is wired into a production decision. UNKNOWN is None, never zero.
"""
from typing import Optional, Sequence


def _finite(value: Optional[float]) -> bool:
    return value is not None and value == value and value not in (float('inf'), float('-inf'))


def serving_parity_trend_slope(closes: Sequence[Optional[float]], window: int) -> Optional[float]:
    """computeTrendSlope: OLS slope of the last `window` closes against 0..window-1, divided by the window mean close.

    None when len(closes) <= window, window < 1, any value is unknown, the mean is zero, or the denominator is zero.
    """
    if window < 1 or len(closes) <= window:
        return None
    tail = list(closes[len(closes) - window:])
    if not all(_finite(value) for value in tail):
        return None
    n = len(tail)
    mean_x = sum(range(n)) / n
    mean_y = sum(tail) / n  # type: ignore[arg-type]
    numerator = sum((i - mean_x) * (y - mean_y) for i, y in enumerate(tail))  # type: ignore[operator]
    denominator = sum((i - mean_x) ** 2 for i in range(n))
    if denominator == 0 or mean_y == 0:
        return None
    return numerator / denominator / mean_y


def _overnight_gaps(opens: Sequence[Optional[float]], closes: Sequence[Optional[float]], window: int) -> Optional[list]:
    """The `window` overnight transitions ending at the last bar (None when there are not window+1 bars)."""
    if window < 1 or len(opens) != len(closes) or len(closes) <= window:
        return None
    o = list(opens[len(opens) - window - 1:])
    c = list(closes[len(closes) - window - 1:])
    gaps = []
    for i in range(1, len(c)):
        previous_close, current_open = c[i - 1], o[i]
        if not _finite(previous_close) or not _finite(current_open) or previous_close <= 0:  # type: ignore[operator]
            continue  # the TypeScript implementation skips an unusable transition rather than counting it
        gaps.append((current_open - previous_close) / previous_close)  # type: ignore[operator]
    return [len(c) - 1, gaps]  # (transition count used as the denominator, usable gaps)


def serving_parity_gap_frequency(opens: Sequence[Optional[float]], closes: Sequence[Optional[float]],
                                 window: int, gap_threshold_pct: float) -> Optional[float]:
    """computeGapFrequency: fraction of the window's transitions whose overnight gap is <= -|threshold|."""
    prepared = _overnight_gaps(opens, closes, window)
    if prepared is None:
        return None
    transitions, gaps = prepared
    return sum(1 for gap in gaps if gap <= -abs(gap_threshold_pct)) / transitions


def serving_parity_max_adverse_gap(opens: Sequence[Optional[float]], closes: Sequence[Optional[float]],
                                   window: int) -> Optional[float]:
    """computeMaxAdverseGap: magnitude of the worst overnight gap-down in the window (0.0 is a real observed 'no gap-down')."""
    prepared = _overnight_gaps(opens, closes, window)
    if prepared is None:
        return None
    _, gaps = prepared
    worst = 0.0
    for gap in gaps:
        if gap < 0:
            worst = min(worst, gap)
    return abs(worst)
