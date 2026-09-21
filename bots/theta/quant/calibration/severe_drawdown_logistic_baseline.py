"""Regularized logistic-regression baseline for the BINARY severe-drawdown
label (directive Item B, section 7).

Purpose per the directive: determine whether cohort/family instability
belongs in the PROBABILITY MODEL rather than in the label definition
itself. This module fits one plain, L2-regularized logistic regression
(stdlib-only, gradient descent -- this repo's pyproject.toml declares zero
third-party dependencies, matching every other model in
`bots/theta/quant/models/`) over caller-supplied, already-point-in-time
feature vectors, and reports calibration quality -- it never promotes
itself to Production and never claims readiness on its own.

No deep learning, no GBM here (directive: "no deep learning"; GBM only if
justified by this baseline first, which has not happened -- no real
dataset exists in this session).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class LogisticTrainingRow:
    features: Tuple[float, ...]
    label: int  # 1 = severe drawdown breached, 0 = survived. Never a censored row.


@dataclass(frozen=True)
class LogisticFitResult:
    weights: Tuple[float, ...]
    bias: float
    iterations_run: int
    converged: bool
    l2_penalty: float


def fit_logistic_regression(
    rows: Sequence[LogisticTrainingRow],
    l2_penalty: float = 1.0,
    learning_rate: float = 0.1,
    max_iterations: int = 2000,
    convergence_tolerance: float = 1e-7,
) -> LogisticFitResult:
    """Batch gradient descent with L2 regularization on the weights (not
    the bias). Deterministic (zero-initialized weights, no randomness), so
    a re-run on identical input reproduces identical output exactly --
    required for research reproducibility.
    """
    if len(rows) == 0:
        raise ValueError("SEVERE_DRAWDOWN_LOGISTIC_TRAINING_SET_EMPTY")
    n_features = len(rows[0].features)
    if any(len(row.features) != n_features for row in rows):
        raise ValueError("SEVERE_DRAWDOWN_LOGISTIC_FEATURE_VECTOR_LENGTH_MISMATCH")
    if l2_penalty < 0:
        raise ValueError("SEVERE_DRAWDOWN_LOGISTIC_L2_PENALTY_MUST_BE_NON_NEGATIVE")

    weights = [0.0] * n_features
    bias = 0.0
    n = len(rows)
    converged = False
    iterations_run = 0

    for iteration in range(max_iterations):
        iterations_run = iteration + 1
        grad_weights = [0.0] * n_features
        grad_bias = 0.0
        for row in rows:
            z = bias + sum(w * x for w, x in zip(weights, row.features))
            prediction = 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, z))))
            error = prediction - row.label
            for i, x in enumerate(row.features):
                grad_weights[i] += error * x
            grad_bias += error
        grad_weights = [(g / n) + (l2_penalty / n) * w for g, w in zip(grad_weights, weights)]
        grad_bias = grad_bias / n

        new_weights = [w - learning_rate * g for w, g in zip(weights, grad_weights)]
        new_bias = bias - learning_rate * grad_bias
        step_size = max(abs(nw - w) for nw, w in zip(new_weights, weights)) if weights else 0.0
        step_size = max(step_size, abs(new_bias - bias))
        weights, bias = new_weights, new_bias
        if step_size < convergence_tolerance:
            converged = True
            break

    return LogisticFitResult(weights=tuple(weights), bias=bias, iterations_run=iterations_run,
                              converged=converged, l2_penalty=l2_penalty)


def predict_probability(fit: LogisticFitResult, features: Sequence[float]) -> float:
    if len(features) != len(fit.weights):
        raise ValueError("SEVERE_DRAWDOWN_LOGISTIC_PREDICT_FEATURE_VECTOR_LENGTH_MISMATCH")
    z = fit.bias + sum(w * x for w, x in zip(fit.weights, features))
    return 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, z))))


@dataclass(frozen=True)
class ReliabilityBin:
    bin_lower: float
    bin_upper: float
    n: int
    mean_predicted: Optional[float]
    empirical_rate: Optional[float]


@dataclass(frozen=True)
class CalibrationReport:
    n: int
    brier_score: float
    log_loss: float
    expected_calibration_error: float
    reliability_bins: Tuple[ReliabilityBin, ...]


def evaluate_calibration(
    predicted_probabilities: Sequence[float], actual_labels: Sequence[int], n_bins: int = 10,
) -> CalibrationReport:
    """Computes Brier score, log loss, and Expected Calibration Error (ECE)
    over an OOS (out-of-sample) prediction/label pair -- this function does
    not itself perform the chronological split; the caller must supply
    predictions that were produced without seeing these labels during
    fitting (see `chronological_train_test_split` below).
    """
    if len(predicted_probabilities) != len(actual_labels):
        raise ValueError("SEVERE_DRAWDOWN_CALIBRATION_LENGTH_MISMATCH")
    n = len(predicted_probabilities)
    if n == 0:
        raise ValueError("SEVERE_DRAWDOWN_CALIBRATION_EMPTY_EVALUATION_SET")

    epsilon = 1e-12
    brier_score = sum((p - y) ** 2 for p, y in zip(predicted_probabilities, actual_labels)) / n
    log_loss = -sum(
        y * math.log(max(p, epsilon)) + (1 - y) * math.log(max(1 - p, epsilon))
        for p, y in zip(predicted_probabilities, actual_labels)
    ) / n

    bin_width = 1.0 / n_bins
    bins: List[ReliabilityBin] = []
    ece = 0.0
    for i in range(n_bins):
        lower, upper = i * bin_width, (i + 1) * bin_width
        members = [
            (p, y) for p, y in zip(predicted_probabilities, actual_labels)
            if (lower <= p < upper) or (i == n_bins - 1 and p == upper)
        ]
        if not members:
            bins.append(ReliabilityBin(bin_lower=lower, bin_upper=upper, n=0, mean_predicted=None, empirical_rate=None))
            continue
        mean_predicted = sum(p for p, _ in members) / len(members)
        empirical_rate = sum(y for _, y in members) / len(members)
        bins.append(ReliabilityBin(bin_lower=lower, bin_upper=upper, n=len(members),
                                    mean_predicted=mean_predicted, empirical_rate=empirical_rate))
        ece += (len(members) / n) * abs(mean_predicted - empirical_rate)

    return CalibrationReport(n=n, brier_score=brier_score, log_loss=log_loss,
                              expected_calibration_error=ece, reliability_bins=tuple(bins))


def chronological_train_test_split(
    rows: Sequence[Tuple[str, LogisticTrainingRow]], test_fraction: float = 0.3,
) -> Tuple[Tuple[LogisticTrainingRow, ...], Tuple[LogisticTrainingRow, ...]]:
    """Splits `(decision_date_iso, row)` pairs chronologically -- the
    earliest `1 - test_fraction` rows become TRAIN, the remaining latest
    rows become the untouched OOS TEST set. Never a random/shuffled split,
    which would leak future information into training for this kind of
    time-ordered financial data.
    """
    if not (0.0 < test_fraction < 1.0):
        raise ValueError("SEVERE_DRAWDOWN_LOGISTIC_TEST_FRACTION_MUST_BE_IN_OPEN_UNIT_INTERVAL")
    ordered = sorted(rows, key=lambda item: item[0])
    split_index = max(1, int(round(len(ordered) * (1 - test_fraction))))
    split_index = min(split_index, len(ordered) - 1) if len(ordered) > 1 else len(ordered)
    train = tuple(row for _, row in ordered[:split_index])
    test = tuple(row for _, row in ordered[split_index:])
    return train, test
