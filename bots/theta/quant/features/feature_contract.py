"""Canonical quant-side feature result contract (THETA long-run build,
work package 01).

Every feature family (TREND, MOMENTUM, REALIZED_VOLATILITY, and future
families) should produce -- or be adapted to -- one `FeatureResult`, so
downstream consumers (a canonical feature bundle, the router research
adapter, dataset builders) have exactly one shape to consume rather than
one bespoke dataclass per family.

Truth class is distinct from state: `state` says whether a usable value
exists right now (`OK`/`UNKNOWN`/`STALE`/`INSUFFICIENT_HISTORY`/
`INSUFFICIENT_COVERAGE`/`INVALID`/`NOT_APPLICABLE`); `truth_class` says
what KIND of value it would be if present (an actually-observed market
fact vs. something derived/modeled/policy-supplied). A feature can be
`state=OK, truth_class=MODELED_RESEARCH` (a real, present, but modeled
value) -- these two dimensions are never conflated into one flag.

Determinism/hashing reuses this repo's existing canonical-JSON/SHA-256
convention (`research/parquet_archive.py`'s `_canonical_json`/`_sha256_text`)
rather than inventing a second one.
"""

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Optional, Sequence


class FeatureResultState(str, Enum):
    OK = "OK"
    UNKNOWN = "UNKNOWN"
    STALE = "STALE"
    INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"
    INSUFFICIENT_COVERAGE = "INSUFFICIENT_COVERAGE"
    INSUFFICIENT_SAMPLE = "INSUFFICIENT_SAMPLE"
    INVALID = "INVALID"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class FeatureTruthClass(str, Enum):
    MARKET_OBSERVED = "MARKET_OBSERVED"
    DERIVED_FROM_OBSERVED = "DERIVED_FROM_OBSERVED"
    MODELED_RESEARCH = "MODELED_RESEARCH"
    POLICY = "POLICY"
    MANUAL = "MANUAL"
    UNKNOWN = "UNKNOWN"


def _canonical_json(value: Any) -> str:
    # Reuses research/parquet_archive.py's exact convention -- one
    # canonical-JSON authority for this quant package, not a second one.
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class FeatureResult:
    """The one canonical feature result shape. `value`/`structured_value`
    are mutually exclusive by convention (a scalar family sets `value`, a
    structured family like VOLATILITY_SURFACE sets `structured_value`) --
    never both, and a caller must not read `value` without first checking
    `state == OK`.
    """
    feature_id: str
    family: str
    state: FeatureResultState
    truth_class: FeatureTruthClass
    value: Optional[float]
    structured_value: Optional[Mapping[str, Any]]
    units: str
    source_provider: str
    source_operation: str
    as_of: str
    retrieved_at: str
    freshness_seconds: Optional[float]
    coverage: Optional[float]
    version: str
    reason_codes: Sequence[str] = field(default_factory=tuple)
    provenance_hash: Optional[str] = None

    def __post_init__(self) -> None:
        if self.state == FeatureResultState.OK and self.value is None and self.structured_value is None:
            raise ValueError("FEATURE_RESULT_OK_REQUIRES_A_VALUE")
        if self.value is not None and self.structured_value is not None:
            raise ValueError("FEATURE_RESULT_VALUE_AND_STRUCTURED_VALUE_ARE_MUTUALLY_EXCLUSIVE")

    def to_json_dict(self) -> dict:
        return {
            "featureId": self.feature_id, "family": self.family, "state": self.state.value,
            "truthClass": self.truth_class.value, "value": self.value,
            "structuredValue": dict(self.structured_value) if self.structured_value is not None else None,
            "units": self.units, "sourceProvider": self.source_provider, "sourceOperation": self.source_operation,
            "asOf": self.as_of, "retrievedAt": self.retrieved_at, "freshnessSeconds": self.freshness_seconds,
            "coverage": self.coverage, "version": self.version, "reasonCodes": list(self.reason_codes),
            "provenanceHash": self.provenance_hash,
        }

    def content_hash(self) -> str:
        """A deterministic content hash of this exact result -- excludes
        `provenance_hash` itself (which may reference this hash) to avoid
        a self-referential value; includes every other field."""
        payload = self.to_json_dict()
        payload.pop("provenanceHash", None)
        return _sha256_text(_canonical_json(payload))


def feature_result_from_json_dict(payload: Mapping[str, Any]) -> FeatureResult:
    """The inverse of `FeatureResult.to_json_dict` -- reload after
    serialization must reproduce an identical result (work package 01's
    determinism requirement, and work package 02's reload test)."""
    return FeatureResult(
        feature_id=payload["featureId"], family=payload["family"],
        state=FeatureResultState(payload["state"]), truth_class=FeatureTruthClass(payload["truthClass"]),
        value=payload.get("value"), structured_value=payload.get("structuredValue"),
        units=payload["units"], source_provider=payload["sourceProvider"], source_operation=payload["sourceOperation"],
        as_of=payload["asOf"], retrieved_at=payload["retrievedAt"], freshness_seconds=payload.get("freshnessSeconds"),
        coverage=payload.get("coverage"), version=payload["version"],
        reason_codes=tuple(payload.get("reasonCodes", ())), provenance_hash=payload.get("provenanceHash"),
    )
