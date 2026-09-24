"""Deterministic R6 validation primitives.

This module never selects a strategy and never promotes a policy. It keeps an
economic chain in one split, reserves an untouched final OOS suffix, and
computes calibration from caller-supplied predictions. Minimum sample sizes
are caller policy, never hidden constants in this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from math import exp, log, isfinite
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


@dataclass(frozen=True)
class PitValidationObservation:
    observation_id: str
    economic_chain_id: str
    observed_at: str
    feature_available_at: str
    label_available_at: Optional[str]
    label_window_end: Optional[str]


@dataclass(frozen=True)
class PurgedWalkForwardPlan:
    plan: WalkForwardPlan
    purged_ids: Tuple[str, ...]
    refused_split_count: int
    embargo_seconds: int
    policy_version: str


def build_purged_walk_forward_plan(
    observations: Sequence[PitValidationObservation], config: WalkForwardConfig,
    embargo_seconds: int, policy_version: str,
) -> PurgedWalkForwardPlan:
    """Actual timestamp/label-aware purging, beyond first-seen group ordering.

    Every row in a dependency group must have been label-observable strictly
    before the next evaluation partition, including the time embargo. Missing
    labels censor training/calibration eligibility, never become negative labels.
    Final OOS labels are never consumed to design a split.
    """
    if not isinstance(embargo_seconds, int) or embargo_seconds < 0 or not policy_version.strip():
        raise ValueError('PIT_SPLIT_POLICY_REQUIRED')
    by_id = {row.observation_id: row for row in observations}
    for row in observations:
        decision = _parse_timestamp(row.observed_at)
        if _parse_timestamp(row.feature_available_at) > decision:
            raise ValueError('FUTURE_FEATURE_EVIDENCE')
        if row.label_window_end is not None and _parse_timestamp(row.label_window_end) < decision:
            raise ValueError('LABEL_WINDOW_BEFORE_DECISION')
        if row.label_available_at is not None:
            available = _parse_timestamp(row.label_available_at)
            if row.label_window_end is None or available < _parse_timestamp(row.label_window_end):
                raise ValueError('LABEL_AVAILABILITY_BEFORE_OUTCOME_END')
    structural = build_grouped_walk_forward_plan([
        ValidationObservation(r.observation_id, r.economic_chain_id, r.observed_at) for r in observations
    ], config)
    purged: set[str] = set()

    def before(ids: Tuple[str, ...], next_ids: Tuple[str, ...]) -> Tuple[str, ...]:
        if not next_ids:
            purged.update(ids)
            return ()
        cutoff = min(_parse_timestamp(by_id[i].observed_at) for i in next_ids) - timedelta(seconds=embargo_seconds)
        bad_groups = set()
        for identity in ids:
            r = by_id[identity]
            if r.label_available_at is None or r.label_window_end is None \
                    or _parse_timestamp(r.label_available_at) >= cutoff or _parse_timestamp(r.label_window_end) >= cutoff:
                bad_groups.add(r.economic_chain_id)
        kept = tuple(i for i in ids if by_id[i].economic_chain_id not in bad_groups)
        purged.update(i for i in ids if i not in kept)
        return kept

    splits = []
    refused = 0
    for split in structural.splits:
        train = before(split.train_ids, split.validation_ids)
        calibration = before(split.validation_ids, split.forward_ids)
        # Any development observation overlapping final OOS is excluded from
        # development evaluation too. Never use final OOS outcomes as a cutoff.
        forward = before(split.forward_ids, structural.final_oos_ids)
        counts = [len({by_id[i].economic_chain_id for i in values}) for values in (train, calibration, forward)]
        if any(n < minimum for n, minimum in zip(counts, (config.train_groups, config.validation_groups, config.forward_groups))):
            refused += 1
            continue
        splits.append(WalkForwardSplit(train, calibration, forward))
    return PurgedWalkForwardPlan(WalkForwardPlan(tuple(splits), structural.final_oos_ids, structural.group_order),
        tuple(sorted(purged)), refused, embargo_seconds, policy_version)


def _parse_timestamp(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    try:
        result = datetime.fromisoformat(normalized)
        if result.tzinfo is None:
            raise ValueError("TIMESTAMP_TIMEZONE_REQUIRED")
        return result
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
class ReliabilityBin:
    lower: float
    upper: float
    count: int
    mean_probability: Optional[float]
    observed_frequency: Optional[float]


@dataclass(frozen=True)
class CalibrationMetrics:
    sample_size: int
    brier_score: Optional[float]
    log_loss: Optional[float]
    expected_calibration_error: Optional[float]
    positive_count: int
    negative_count: int
    reliability_bins: Tuple[ReliabilityBin, ...] = ()


def calibration_metrics(probabilities: Sequence[float], labels: Sequence[int], bin_count: int) -> CalibrationMetrics:
    if len(probabilities) != len(labels):
        raise ValueError("CALIBRATION_LENGTH_MISMATCH")
    if bin_count <= 0:
        raise ValueError("CALIBRATION_BIN_COUNT_INVALID")
    if any(label not in (0, 1) for label in labels):
        raise ValueError("CALIBRATION_LABEL_INVALID")
    if any(not isfinite(probability) or probability < 0 or probability > 1 for probability in probabilities):
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
    reliability = []
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
            reliability.append(ReliabilityBin(lower, upper, len(members), confidence, frequency))
        else:
            reliability.append(ReliabilityBin(lower, upper, 0, None, None))
    return CalibrationMetrics(count, brier, logloss, ece, positives, count - positives, tuple(reliability))


@dataclass(frozen=True)
class PlattScaler:
    intercept: float
    slope: float

    def predict(self, score: float) -> float:
        if not all(isfinite(v) for v in (score, self.intercept, self.slope)):
            raise ValueError("PLATT_NONFINITE_INPUT")
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
    if minimum_samples <= 0 or max_iterations <= 0 or not isfinite(tolerance) or tolerance <= 0:
        raise ValueError("PLATT_CONFIG_INVALID")
    if any(not isfinite(score) for score in scores):
        raise ValueError("PLATT_SCORE_INVALID")
    if any(label not in (0, 1) for label in labels):
        raise ValueError("PLATT_LABEL_INVALID")
    if len(scores) < minimum_samples or len(set(labels)) < 2:
        return None
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
        if not isfinite(determinant) or abs(determinant) < 1e-18:
            return None
        delta0 = (h11 * g0 - h01 * g1) / determinant
        delta1 = (-h01 * g0 + h00 * g1) / determinant
        intercept -= delta0
        slope -= delta1
        if not isfinite(intercept) or not isfinite(slope):
            return None
        if max(abs(delta0), abs(delta1)) < tolerance:
            return PlattScaler(intercept, slope)
    # A bounded optimizer failing to converge is not a fitted calibrator.
    return None


@dataclass(frozen=True)
class IsotonicCalibrator:
    upper_bounds: Tuple[float, ...]
    values: Tuple[float, ...]

    def predict(self, score: float) -> float:
        if not isfinite(score):
            raise ValueError("ISOTONIC_NONFINITE_SCORE")
        if not self.values or len(self.upper_bounds) != len(self.values):
            raise ValueError("ISOTONIC_INVALID_MODEL")
        for upper, value in zip(self.upper_bounds, self.values):
            if score <= upper:
                return value
        return self.values[-1]


def fit_isotonic_calibrator(scores: Sequence[float], labels: Sequence[int], minimum_samples: int) -> Optional[IsotonicCalibrator]:
    if len(scores) != len(labels):
        raise ValueError("ISOTONIC_LENGTH_MISMATCH")
    if minimum_samples <= 0:
        raise ValueError("ISOTONIC_CONFIG_INVALID")
    if any(not isfinite(score) for score in scores):
        raise ValueError("ISOTONIC_SCORE_INVALID")
    if any(label not in (0, 1) for label in labels):
        raise ValueError("ISOTONIC_LABEL_INVALID")
    if len(scores) < minimum_samples or len(set(labels)) < 2:
        return None
    ordered = sorted(zip(scores, labels), key=lambda item: item[0])
    tied: List[List[float]] = []
    for score, label in ordered:
        # Aggregate all ties before PAV. Premature pooling can otherwise merge
        # a lower-score block before the tied higher-score mean is known.
        if tied and tied[-1][1] == score:
            tied[-1][2] += label
            tied[-1][3] += 1
        else:
            tied.append([score, score, float(label), 1.0])
    blocks: List[List[float]] = []  # lower, upper, sum, count
    for block in tied:
        blocks.append(block)
        while len(blocks) >= 2 and blocks[-2][2] / blocks[-2][3] > blocks[-1][2] / blocks[-1][3]:
            right = blocks.pop()
            left = blocks.pop()
            blocks.append([left[0], right[1], left[2] + right[2], left[3] + right[3]])
    return IsotonicCalibrator(
        upper_bounds=tuple(block[1] for block in blocks),
        values=tuple(block[2] / block[3] for block in blocks),
    )
