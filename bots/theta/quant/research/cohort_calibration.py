"""Calibration evaluated per cohort (DTE/delta/regime/ticker/sector or any
caller-defined key), work package 56.

Reuses `validation.py`'s existing `calibration_metrics` (Brier, log loss,
expected calibration error, reliability bins) instead of re-deriving those
formulas -- this module only adds the cohort grouping and the
`INSUFFICIENT_SAMPLE` gate for a cohort too small to calibrate honestly. A
tiny bucket never gets a fabricated calibration verdict merely because the
caller asked for one.
"""
from __future__ import annotations

from typing import Dict, Sequence
from research.validation import CalibrationMetrics, calibration_metrics


def cohort_calibration_report(
    cohort_keys: Sequence[str], probabilities: Sequence[float], labels: Sequence[int],
    bin_count: int, minimum_cohort_n: int,
) -> Dict[str, dict]:
    if not (len(cohort_keys) == len(probabilities) == len(labels)):
        raise ValueError('COHORT_CALIBRATION_LENGTH_MISMATCH')
    if minimum_cohort_n <= 0:
        raise ValueError('COHORT_CALIBRATION_MINIMUM_N_INVALID')
    by_cohort: Dict[str, Dict[str, list]] = {}
    for cohort, probability, label in zip(cohort_keys, probabilities, labels):
        bucket = by_cohort.setdefault(cohort, {'probabilities': [], 'labels': []})
        bucket['probabilities'].append(probability)
        bucket['labels'].append(label)
    report = {}
    for cohort, values in sorted(by_cohort.items()):
        n = len(values['labels'])
        if n < minimum_cohort_n:
            report[cohort] = {'state': 'INSUFFICIENT_SAMPLE', 'sampleSize': n,
                               'minimumRequired': minimum_cohort_n, 'metrics': None}
            continue
        metrics: CalibrationMetrics = calibration_metrics(values['probabilities'], values['labels'], bin_count)
        report[cohort] = {'state': 'EVALUATED', 'sampleSize': n, 'minimumRequired': minimum_cohort_n,
                           'metrics': metrics}
    return report
