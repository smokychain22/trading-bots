"""Promotion evidence assembler (work package 89).

Requires every mandatory evidence category before a model/policy may even
be CONSIDERED for promotion -- this module never grants promotion itself
(that remains an owner/Codex decision gated by TRD graduation gates
G1-G7), it only refuses to assemble a promotion evidence packet when a
mandatory category is missing or structurally empty.
"""
from __future__ import annotations

from typing import Any, Dict, List
from research.production_export_loader import canonical_json, sha256_hex

MANDATORY_CATEGORIES = (
    'pit', 'baseline', 'ablation', 'oos', 'cost', 'risk', 'calibration', 'sampleSize',
    'selectionBiasControls', 'reproducibility',
)


def _is_substantive(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (str, list, tuple, dict)) and len(value) == 0:
        return False
    return True


def assemble_promotion_evidence(evidence: Dict[str, Any]) -> dict:
    missing: List[str] = [category for category in MANDATORY_CATEGORIES if not _is_substantive(evidence.get(category))]
    if missing:
        payload = {'version': 'theta-promotion-evidence-assembler-v1', 'state': 'PROMOTION_REFUSED',
                   'missingCategories': missing, 'evidence': None}
        return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
    payload = {
        'version': 'theta-promotion-evidence-assembler-v1', 'state': 'EVIDENCE_ASSEMBLED_NOT_A_PROMOTION_DECISION',
        'missingCategories': [], 'evidence': {category: evidence[category] for category in MANDATORY_CATEGORIES},
        'promotionGranted': False,
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
