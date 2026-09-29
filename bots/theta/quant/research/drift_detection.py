"""Drift detection: feature / prediction / calibration / regime-mix /
label drift, each with minimum-N and window metadata (work package 90).

A single generic comparator (`detect_distribution_drift`) covers all five
drift kinds -- feature, prediction, calibration (drift in a calibration
metric over time), regime-mix (drift in categorical regime-label
frequencies), and label (drift in the outcome label rate) are all, at
bottom, a comparison between a baseline window's distribution and a
current window's distribution. Below the caller's minimum N, a window is
`INSUFFICIENT_SAMPLE`, never a forced comparison.
"""
from __future__ import annotations

from typing import Sequence, Tuple


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def _stdev(values: Sequence[float], mean: float) -> float:
    if len(values) < 2:
        return 0.0
    variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return variance ** 0.5


def detect_distribution_drift(
    drift_kind: str, baseline_window: Sequence[float], current_window: Sequence[float],
    minimum_n: int, baseline_window_bounds: Tuple[str, str], current_window_bounds: Tuple[str, str],
    meaningful_effect_size: float,
) -> dict:
    if drift_kind not in ('FEATURE', 'PREDICTION', 'CALIBRATION', 'REGIME_MIX', 'LABEL'):
        raise ValueError(f'DRIFT_DETECTION_UNKNOWN_KIND:{drift_kind}')
    if minimum_n <= 0:
        raise ValueError('DRIFT_DETECTION_MINIMUM_N_INVALID')
    if not (0 <= meaningful_effect_size):
        raise ValueError('DRIFT_DETECTION_EFFECT_SIZE_INVALID')

    base_n, curr_n = len(baseline_window), len(current_window)
    if base_n < minimum_n or curr_n < minimum_n:
        return {
            'version': 'theta-drift-detection-v1', 'driftKind': drift_kind, 'state': 'INSUFFICIENT_SAMPLE',
            'baselineN': base_n, 'currentN': curr_n, 'minimumN': minimum_n,
            'baselineWindowBounds': list(baseline_window_bounds), 'currentWindowBounds': list(current_window_bounds),
            'meanShift': None, 'driftDetected': None,
        }

    baseline_mean = _mean(baseline_window)
    current_mean = _mean(current_window)
    baseline_std = _stdev(baseline_window, baseline_mean)
    shift = current_mean - baseline_mean
    drift_detected = abs(shift) > meaningful_effect_size
    return {
        'version': 'theta-drift-detection-v1', 'driftKind': drift_kind, 'state': 'EVALUATED',
        'baselineN': base_n, 'currentN': curr_n, 'minimumN': minimum_n,
        'baselineWindowBounds': list(baseline_window_bounds), 'currentWindowBounds': list(current_window_bounds),
        'baselineMean': baseline_mean, 'currentMean': current_mean, 'baselineStdev': baseline_std,
        'meanShift': shift, 'meaningfulEffectSize': meaningful_effect_size, 'driftDetected': drift_detected,
    }
