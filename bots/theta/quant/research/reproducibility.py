"""Model comparison and reproducibility contract for THETA (R6).

Every experiment result THETA ever reports must be reproducible from its
own record: which dataset, which feature set, which target definition,
which walk-forward split plan, and which source-code revision produced
it. This module implements that contract as real, deterministic,
testable code -- not aspirational documentation.

No I/O, no provider dependency -- pure functions over caller-supplied
descriptors, exercised only against synthetic fixtures until real
resolved episodes exist (`docs/research/THETA_EV_MODEL_SPEC.md`'s
EV_MODEL_NOT_EMPIRICALLY_READY status, unchanged).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence


def _canonical_json(value: Any) -> str:
    """Deterministic JSON serialization: sorted keys, fixed separators, no
    ambiguous whitespace. The single building block every hash function
    below uses, so two callers who build the "same" object in a
    different key/argument order always hash identically."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_feature_set(feature_names: Sequence[str]) -> str:
    """Hashes a feature set. Order-INVARIANT and duplicate-INVARIANT by
    construction (`sorted(set(...))`) -- two callers who list the same
    features in a different order, or who accidentally repeat one name,
    must get the identical hash, since the feature SET is what matters
    for reproducibility, not the order it happened to be enumerated in."""
    canonical = sorted(set(feature_names))
    return _sha256_hex(_canonical_json(canonical))


def hash_dataset(records: Sequence[Mapping[str, Any]]) -> str:
    """Hashes a dataset as an order-invariant set of canonically-
    serialized records: two callers who assembled the identical set of
    records in a different row order get the identical hash, but
    changing even one record's content (or adding/removing a record)
    changes the hash. Order invariance here specifically guards against
    a dataset-hash that would spuriously differ across two genuinely
    identical extracts that merely iterated a source table in a
    different order."""
    canonical_records = sorted(_canonical_json(r) for r in records)
    return _sha256_hex(_canonical_json(canonical_records))


@dataclass(frozen=True)
class ExperimentResultContract:
    """One reproducible experiment result. Every field the R6 directive
    required for reproducibility is present and REQUIRED (no optional
    identity field) -- an experiment result missing any of these cannot
    be reproduced or meaningfully compared against another, and this
    dataclass makes that a construction-time requirement rather than a
    documentation promise."""

    model_id: str
    dataset_hash: str
    feature_set_hash: str
    target_version: str
    split_plan_hash: str
    source_code_sha: str

    # Metrics -- each Optional and None (never fabricated) when genuinely
    # unknown, per the standing "never fabricate EV/win-rate/Sharpe"
    # instruction.
    ev_net: Optional[float]
    win_probability: Optional[float]
    calibration_ece: Optional[float]
    expected_shortfall: Optional[float]
    value_at_risk: Optional[float]
    max_drawdown_pct: Optional[float]
    return_per_capital_day: Optional[float]
    assignment_rate: Optional[float]
    model_uncertainty: Optional[float]  # e.g. standard error of ev_net, or None if not computable

    def experiment_fingerprint(self) -> str:
        """The single reproducibility fingerprint for this result: a hash
        of every IDENTITY field (never the metrics themselves -- two
        genuinely independent re-runs of the identical experiment must
        produce the identical fingerprint even if floating-point noise
        makes their metrics differ in the last few digits; the
        fingerprint answers "was this the same experiment," the metrics
        answer "what did it find")."""
        identity = {
            "model_id": self.model_id,
            "dataset_hash": self.dataset_hash,
            "feature_set_hash": self.feature_set_hash,
            "target_version": self.target_version,
            "split_plan_hash": self.split_plan_hash,
            "source_code_sha": self.source_code_sha,
        }
        return _sha256_hex(_canonical_json(identity))
