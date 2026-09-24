"""Non-authoritative training, artifact, and inference contracts.

These contracts make future research reproducible. They never select label
policy and never allow an unpromoted artifact to supply runtime risk evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import math
from typing import Mapping, Optional, Sequence, Tuple


PROMOTION_STATES = frozenset({"RESEARCH_ONLY", "MODEL_RESEARCH_VALID", "MODEL_PAPER_RISK_ELIGIBLE", "MODEL_EMPIRICALLY_PROMOTED"})
MODEL_FAMILIES = frozenset({"EMPIRICAL_FREQUENCY", "REGULARIZED_LOGISTIC", "SIMPLE_TREE_CHALLENGER"})


@dataclass(frozen=True)
class ChronologicalFold:
    train_start: str
    train_end: str
    validation_start: str
    validation_end: str
    purge_days: int
    embargo_days: int
    grouped_by_dependence_window: bool = True


@dataclass(frozen=True)
class SevereDrawdownTrainingPlan:
    plan_version: str
    label_spec_version: str
    dataset_version: str
    feature_version: str
    model_families: Tuple[str, ...]
    folds: Tuple[ChronologicalFold, ...]
    primary_metrics: Tuple[str, ...]
    calibrate_probabilities: bool
    promotion_requested: bool = False


@dataclass(frozen=True)
class SevereDrawdownModelArtifact:
    model_version: str
    label_spec_version: str
    dataset_version: str
    feature_version: str
    train_range: Tuple[str, str]
    validation_ranges: Tuple[Tuple[str, str], ...]
    oos_range: Tuple[str, str]
    model_family: str
    required_features: Tuple[str, ...]
    coefficients: Mapping[str, float]
    intercept: Optional[float]
    calibration: Mapping[str, object]
    metrics: Mapping[str, Optional[float]]
    promotion_state: str
    created_at: str
    artifact_hash: str


def artifact_hash(payload: Mapping[str, object]) -> str:
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def build_artifact(**values: object) -> SevereDrawdownModelArtifact:
    payload = dict(values)
    if payload.get("model_family") not in MODEL_FAMILIES:
        raise ValueError("unsupported model family")
    if payload.get("promotion_state") not in PROMOTION_STATES:
        raise ValueError("unsupported promotion state")
    expected = artifact_hash(payload)
    return SevereDrawdownModelArtifact(**payload, artifact_hash=expected)  # type: ignore[arg-type]


class SevereDrawdownArtifactRegistry:
    """Process-local registry contract. Durable adapters can implement the same rules."""

    def __init__(self) -> None:
        self._artifacts: dict[str, SevereDrawdownModelArtifact] = {}

    def register(self, artifact: SevereDrawdownModelArtifact) -> None:
        payload = dict(artifact.__dict__)
        claimed_hash = str(payload.pop("artifact_hash"))
        if artifact_hash(payload) != claimed_hash:
            raise ValueError("artifact hash mismatch")
        existing = self._artifacts.get(artifact.model_version)
        if existing is not None and existing.artifact_hash != artifact.artifact_hash:
            raise ValueError("model version is immutable")
        self._artifacts[artifact.model_version] = artifact

    def get(self, model_version: str) -> Optional[SevereDrawdownModelArtifact]:
        return self._artifacts.get(model_version)

    def paper_risk_eligible(self) -> Tuple[SevereDrawdownModelArtifact, ...]:
        return tuple(sorted(
            (item for item in self._artifacts.values() if item.promotion_state in {
                "MODEL_PAPER_RISK_ELIGIBLE", "MODEL_EMPIRICALLY_PROMOTED"
            }), key=lambda item: (item.created_at, item.model_version)
        ))


@dataclass(frozen=True)
class SevereDrawdownInference:
    probability: Optional[float]
    model_version: Optional[str]
    feature_version: str
    as_of: str
    missing_feature_reasons: Tuple[str, ...]
    calibration_status: str
    state: str


def infer_severe_drawdown(
    artifact: Optional[SevereDrawdownModelArtifact],
    features: Mapping[str, Optional[float]],
    feature_version: str,
    as_of: str,
) -> SevereDrawdownInference:
    if artifact is None:
        return SevereDrawdownInference(None, None, feature_version, as_of, ("MODEL_ARTIFACT_MISSING",), "UNKNOWN", "UNKNOWN")
    if artifact.promotion_state not in {"MODEL_PAPER_RISK_ELIGIBLE", "MODEL_EMPIRICALLY_PROMOTED"}:
        return SevereDrawdownInference(None, artifact.model_version, feature_version, as_of, ("MODEL_NOT_PAPER_RISK_ELIGIBLE",), "UNKNOWN", "UNKNOWN")
    if feature_version != artifact.feature_version:
        return SevereDrawdownInference(None, artifact.model_version, feature_version, as_of, ("FEATURE_VERSION_MISMATCH",), "UNKNOWN", "UNKNOWN")
    missing = tuple(sorted(name for name in artifact.required_features if features.get(name) is None))
    if missing:
        return SevereDrawdownInference(None, artifact.model_version, feature_version, as_of, tuple(f"MISSING_FEATURE:{name}" for name in missing), "UNKNOWN", "UNKNOWN")
    if any(type(features[name]) not in (int, float) or not math.isfinite(features[name]) for name in artifact.required_features):
        return SevereDrawdownInference(None, artifact.model_version, feature_version, as_of, ("INVALID_FEATURE_VALUE",), "UNKNOWN", "UNKNOWN")
    if artifact.model_family == "EMPIRICAL_FREQUENCY":
        probability = artifact.intercept
    elif artifact.model_family == "REGULARIZED_LOGISTIC":
        if artifact.intercept is None or not math.isfinite(artifact.intercept) \
                or any(name not in artifact.coefficients or not math.isfinite(artifact.coefficients[name]) for name in artifact.required_features):
            probability = None
        else:
            score = artifact.intercept + sum(artifact.coefficients[name] * float(features[name]) for name in artifact.required_features)
            probability = None if not math.isfinite(score) else 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, score))))
    else:
        probability = None
    if probability is None or not 0 <= probability <= 1:
        return SevereDrawdownInference(None, artifact.model_version, feature_version, as_of, ("ARTIFACT_NOT_EXECUTABLE",), "UNKNOWN", "UNKNOWN")
    calibrated = artifact.calibration.get("validated") is True
    if not calibrated:
        return SevereDrawdownInference(None, artifact.model_version, feature_version, as_of, ("CALIBRATION_NOT_VALIDATED",), "UNVALIDATED", "UNKNOWN")
    return SevereDrawdownInference(probability, artifact.model_version, feature_version, as_of, (), "VALIDATED", "KNOWN")


def validate_chronological_folds(folds: Sequence[ChronologicalFold]) -> None:
    for fold in folds:
        if not fold.grouped_by_dependence_window or fold.purge_days < 0 or fold.embargo_days < 0:
            raise ValueError("fold lacks dependence protection")
        if not (fold.train_start <= fold.train_end < fold.validation_start <= fold.validation_end):
            raise ValueError("fold is not chronological")


def validate_training_plan(plan: SevereDrawdownTrainingPlan) -> None:
    if not plan.plan_version or not plan.label_spec_version or not plan.dataset_version or not plan.feature_version:
        raise ValueError("training plan versions are required")
    if not plan.model_families or any(item not in MODEL_FAMILIES for item in plan.model_families):
        raise ValueError("training plan model family is unsupported")
    if not plan.primary_metrics:
        raise ValueError("training plan metrics are required")
    if plan.promotion_requested:
        raise ValueError("research training plans cannot request promotion")
    validate_chronological_folds(plan.folds)
