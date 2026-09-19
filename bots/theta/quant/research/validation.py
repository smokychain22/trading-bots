"""Deterministic R6 validation primitives.

This module never selects a strategy and never promotes a policy. It keeps an
economic chain in one split, reserves an untouched final OOS suffix, and
computes calibration from caller-supplied predictions. Minimum sample sizes
are caller policy, never hidden constants in this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import exp, log
from typing import Iterable, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class ValidationObservation:
    observation_id: str
    economic_chain_id: str
    observed_at: str


@dataclass(frozen=True)
class WalkForwardConfig:
    train_groups: int
    validation_groups: int
    forward_groups: int
    step_groups: int
    embargo_groups: int
    final_oos_groups: int


@dataclass(frozen=True)
class WalkForwardSplit:
    train_ids: Tuple[str, ...]
    validation_ids: Tuple[str, ...]
    forward_ids: Tuple[str, ...]


@dataclass(frozen=True)
class WalkForwardPlan:
    splits: Tuple[WalkForwardSplit, ...]
    final_oos_ids: Tuple[str, ...]
    group_order: Tuple[str, ...]


def _parse_timestamp(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"INVALID_OBSERVATION_TIMESTAMP:{value}") from error


def build_grouped_walk_forward_plan(
    observations: Sequence[ValidationObservation], config: WalkForwardConfig
) -> WalkForwardPlan:
    values = (
        config.train_groups,
        config.validation_groups,
        config.forward_groups,
        config.step_groups,
        config.final_oos_groups,
    )
    if any(value <= 0 for value in values) or config.embargo_groups < 0:
        raise ValueError("WALK_FORWARD_CONFIG_INVALID")
    if not observations:
        return WalkForwardPlan(splits=(), final_oos_ids=(), group_order=())

    by_group: dict[str, List[ValidationObservation]] = {}
    first_seen: dict[str, datetime] = {}
    seen_ids: set[str] = set()
    for observation in observations:
        if not observation.observation_id or not observation.economic_chain_id:
            raise ValueError("OBSERVATION_IDENTITY_REQUIRED")
        if observation.observation_id in seen_ids:
            raise ValueError(f"DUPLICATE_OBSERVATION_ID:{observation.observation_id}")
        seen_ids.add(observation.observation_id)
        timestamp = _parse_timestamp(observation.observed_at)
        by_group.setdefault(observation.economic_chain_id, []).append(observation)
        first_seen[observation.economic_chain_id] = min(first_seen.get(observation.economic_chain_id, timestamp), timestamp)

    group_order = tuple(sorted(by_group, key=lambda group: (first_seen[group], group)))
    if config.final_oos_groups >= len(group_order):
        return WalkForwardPlan(
            splits=(),
            final_oos_ids=tuple(item.observation_id for group in group_order for item in sorted(by_group[group], key=lambda row: (_parse_timestamp(row.observed_at), row.observation_id))),
            group_order=group_order,
        )

    development_groups = group_order[:-config.final_oos_groups]
    final_groups = group_order[-config.final_oos_groups:]

    def ids(groups: Iterable[str]) -> Tuple[str, ...]:
        return tuple(
            item.observation_id
            for group in groups
            for item in sorted(by_group[group], key=lambda row: (_parse_timestamp(row.observed_at), row.observation_id))
        )

    required = config.train_groups + config.embargo_groups + config.validation_groups + config.embargo_groups + config.forward_groups
    splits: List[WalkForwardSplit] = []
    start = 0
    while start + required <= len(development_groups):
        train_end = start + config.train_groups
        validation_start = train_end + config.embargo_groups
        validation_end = validation_start + config.validation_groups
        forward_start = validation_end + config.embargo_groups
        forward_end = forward_start + config.forward_groups
        splits.append(WalkForwardSplit(
            train_ids=ids(development_groups[start:train_end]),
            validation_ids=ids(development_groups[validation_start:validation_end]),
            forward_ids=ids(development_groups[forward_start:forward_end]),
        ))
        start += config.step_groups
    return WalkForwardPlan(splits=tuple(splits), final_oos_ids=ids(final_groups), group_order=group_order)


@dataclass(frozen=True)
class CalibrationMetrics:
    sample_size: int
    brier_score: Optional[float]
    log_loss: Optional[float]
    expected_calibration_error: Optional[float]
    positive_count: int
    negative_count: int


def calibration_metrics(probabilities: Sequence[float], labels: Sequence[int], bin_count: int) -> CalibrationMetrics:
    if len(probabilities) != len(labels):
        raise ValueError("CALIBRATION_LENGTH_MISMATCH")
    if bin_count <= 0:
        raise ValueError("CALIBRATION_BIN_COUNT_INVALID")
    if any(label not in (0, 1) for label in labels):
        raise ValueError("CALIBRATION_LABEL_INVALID")
    if any(probability < 0 or probability > 1 for probability in probabilities):
        raise ValueError("CALIBRATION_PROBABILITY_INVALID")
    count = len(labels)
    positives = sum(labels)
    if count == 0:
        return CalibrationMetrics(0, None, None, None, 0, 0)
    brier = sum((probability - label) ** 2 for probability, label in zip(probabilities, labels)) / count
    epsilon = 1e-15
    logloss = -sum(
        label * log(min(max(probability, epsilon), 1 - epsilon))
        + (1 - label) * log(1 - min(max(probability, epsilon), 1 - epsilon))
        for probability, label in zip(probabilities, labels)
    ) / count
    ece = 0.0
    for index in range(bin_count):
        lower, upper = index / bin_count, (index + 1) / bin_count
        members = [
            (probability, label)
            for probability, label in zip(probabilities, labels)
            if probability >= lower and (probability < upper or (index == bin_count - 1 and probability == 1))
        ]
        if members:
            confidence = sum(item[0] for item in members) / len(members)
            frequency = sum(item[1] for item in members) / len(members)
            ece += len(members) / count * abs(confidence - frequency)
    return CalibrationMetrics(count, brier, logloss, ece, positives, count - positives)


@dataclass(frozen=True)
class PlattScaler:
    intercept: float
    slope: float

    def predict(self, score: float) -> float:
        value = self.intercept + self.slope * score
        if value >= 0:
            return 1 / (1 + exp(-value))
        exponential = exp(value)
        return exponential / (1 + exponential)


def fit_platt_scaler(
    scores: Sequence[float], labels: Sequence[int], minimum_samples: int, max_iterations: int = 100, tolerance: float = 1e-10
) -> Optional[PlattScaler]:
    if len(scores) != len(labels):
        raise ValueError("PLATT_LENGTH_MISMATCH")
    if minimum_samples <= 0 or max_iterations <= 0 or tolerance <= 0:
        raise ValueError("PLATT_CONFIG_INVALID")
    if len(scores) < minimum_samples or len(set(labels)) < 2:
        return None
    if any(label not in (0, 1) for label in labels):
        raise ValueError("PLATT_LABEL_INVALID")
    intercept = log((sum(labels) + 1) / (len(labels) - sum(labels) + 1))
    slope = 0.0
    for _ in range(max_iterations):
        probabilities = [PlattScaler(intercept, slope).predict(score) for score in scores]
        g0 = sum(probability - label for probability, label in zip(probabilities, labels))
        g1 = sum((probability - label) * score for probability, label, score in zip(probabilities, labels, scores))
        weights = [probability * (1 - probability) for probability in probabilities]
        h00 = sum(weights) + 1e-12
        h01 = sum(weight * score for weight, score in zip(weights, scores))
        h11 = sum(weight * score * score for weight, score in zip(weights, scores)) + 1e-12
        determinant = h00 * h11 - h01 * h01
        if abs(determinant) < 1e-18:
            return None
        delta0 = (h11 * g0 - h01 * g1) / determinant
        delta1 = (-h01 * g0 + h00 * g1) / determinant
        intercept -= delta0
        slope -= delta1
        if max(abs(delta0), abs(delta1)) < tolerance:
            break
    return PlattScaler(intercept, slope)


@dataclass(frozen=True)
class IsotonicCalibrator:
    upper_bounds: Tuple[float, ...]
    values: Tuple[float, ...]

    def predict(self, score: float) -> float:
        for upper, value in zip(self.upper_bounds, self.values):
            if score <= upper:
                return value
        return self.values[-1]


def fit_isotonic_calibrator(scores: Sequence[float], labels: Sequence[int], minimum_samples: int) -> Optional[IsotonicCalibrator]:
    if len(scores) != len(labels):
        raise ValueError("ISOTONIC_LENGTH_MISMATCH")
    if minimum_samples <= 0:
        raise ValueError("ISOTONIC_CONFIG_INVALID")
    if len(scores) < minimum_samples or len(set(labels)) < 2:
        return None
    if any(label not in (0, 1) for label in labels):
        raise ValueError("ISOTONIC_LABEL_INVALID")
    ordered = sorted(zip(scores, labels), key=lambda item: item[0])
    blocks: List[List[float]] = []  # lower, upper, sum, count
    for score, label in ordered:
        blocks.append([score, score, float(label), 1.0])
        while len(blocks) >= 2 and blocks[-2][2] / blocks[-2][3] > blocks[-1][2] / blocks[-1][3]:
            right = blocks.pop()
            left = blocks.pop()
            blocks.append([left[0], right[1], left[2] + right[2], left[3] + right[3]])
    return IsotonicCalibrator(
        upper_bounds=tuple(block[1] for block in blocks),
        values=tuple(block[2] / block[3] for block in blocks),
    )
