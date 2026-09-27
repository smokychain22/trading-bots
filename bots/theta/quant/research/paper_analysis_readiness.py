"""Paper analysis readiness adapters (work package 91).

Adapters for future real Paper orders/fills/partials/cancel-replace/TCA/
assignment/expiry/exercise/management/whole-chain evidence. No real Paper
trading has occurred in this repository as of this pass (see
`docs/operations/` receipts and `LIVE_AUTHORIZATION=NOT_GRANTED` --
`MASTER_PAPER_EXECUTION_ENABLED=false`), so every adapter here normalizes
whatever evidence a caller supplies (or `None`) into one contract and
never claims a real Paper fill/outcome exists when it doesn't.
"""
from __future__ import annotations

from typing import Any, Dict, Optional
from research.production_export_loader import canonical_json, sha256_hex

PAPER_ADAPTER_KINDS = (
    'FILLS', 'PARTIALS', 'CANCEL_REPLACE', 'TCA', 'ASSIGNMENT', 'EXPIRY', 'EXERCISE', 'MANAGEMENT', 'WHOLE_CHAIN',
)


def build_paper_readiness_adapter(adapter_kind: str, evidence: Optional[Dict[str, Any]]) -> dict:
    if adapter_kind not in PAPER_ADAPTER_KINDS:
        raise ValueError(f'PAPER_READINESS_UNKNOWN_ADAPTER_KIND:{adapter_kind}')
    if evidence is None:
        payload = {'version': 'theta-paper-analysis-readiness-v1', 'adapterKind': adapter_kind,
                   'state': 'NOT_YET_CAPTURED_NO_REAL_PAPER_DATA', 'evidence': None, 'realPaperClaim': False}
        return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
    if evidence.get('truthClass') == 'BROKER_ACTUAL' and evidence.get('masterPaperExecutionEnabled') is not True:
        raise ValueError('PAPER_READINESS_BROKER_ACTUAL_CLAIM_WITHOUT_EXECUTION_ENABLED_EVIDENCE')
    payload = {'version': 'theta-paper-analysis-readiness-v1', 'adapterKind': adapter_kind,
               'state': 'EVIDENCE_NORMALIZED', 'evidence': evidence, 'realPaperClaim': evidence.get('truthClass') == 'BROKER_ACTUAL'}
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}


def readiness_report(evidence_by_kind: Dict[str, Optional[Dict[str, Any]]]) -> dict:
    return {kind: build_paper_readiness_adapter(kind, evidence_by_kind.get(kind)) for kind in PAPER_ADAPTER_KINDS}
