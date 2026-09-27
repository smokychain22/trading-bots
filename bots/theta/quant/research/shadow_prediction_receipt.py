"""Shadow prediction receipts (work package 88).

A shadow prediction is a research/model output computed alongside a real
decision but never fed back into it -- `broker_authority` is always
`False` here, structurally, and this module refuses to construct a
receipt that claims otherwise. Every receipt carries model identity/
version, the exact input hash it was computed from, the prediction
itself, calibration state, uncertainty, the T0 timestamp, and truth class
(always `MODELED_RESEARCH` or `SYNTHETIC_FIXTURE` -- never `BROKER_ACTUAL`,
enforced via `truth_firewall.py`, WP71, reused not re-derived).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from research.production_export_loader import canonical_json, sha256_hex
from research.truth_firewall import FORBIDDEN_SILENT_TRANSITIONS

_ALLOWED_TRUTH_CLASSES = ('MODELED_RESEARCH', 'SYNTHETIC_FIXTURE')


@dataclass(frozen=True)
class ShadowPredictionReceipt:
    model_id: str
    model_version: str
    input_hash: str
    prediction: float
    calibration_state: str  # 'UNCALIBRATED' | 'PLATT' | 'ISOTONIC' | 'INSUFFICIENT_CALIBRATION_EVIDENCE'
    uncertainty: Optional[float]  # e.g. a confidence-interval half-width; None if not computable
    t0_timestamp: str
    truth_class: str
    broker_authority: bool = False
    content_hash: str = ''


def build_shadow_prediction_receipt(
    model_id: str, model_version: str, input_hash: str, prediction: float, calibration_state: str,
    uncertainty: Optional[float], t0_timestamp: str, truth_class: str,
) -> ShadowPredictionReceipt:
    if truth_class not in _ALLOWED_TRUTH_CLASSES:
        raise ValueError(f'SHADOW_PREDICTION_TRUTH_CLASS_MUST_BE_RESEARCH_TIER:{truth_class}')
    if ('MODELED_RESEARCH', 'BROKER_ACTUAL') not in FORBIDDEN_SILENT_TRANSITIONS:
        raise AssertionError('SHADOW_PREDICTION_TRUTH_FIREWALL_CONTRACT_CHANGED_UNEXPECTEDLY')
    if not input_hash:
        raise ValueError('SHADOW_PREDICTION_INPUT_HASH_REQUIRED')
    payload = dict(
        model_id=model_id, model_version=model_version, input_hash=input_hash, prediction=prediction,
        calibration_state=calibration_state, uncertainty=uncertainty, t0_timestamp=t0_timestamp,
        truth_class=truth_class, broker_authority=False,
    )
    return ShadowPredictionReceipt(**payload, content_hash=sha256_hex(canonical_json(payload)))
