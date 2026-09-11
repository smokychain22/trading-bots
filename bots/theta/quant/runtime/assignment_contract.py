"""Stable JSON boundary around models.assignment_model (R1H item K1).

Mirrors theta_q_contract.py / management_contract.py's pattern exactly.
This adapter performs no provider I/O and never authorizes execution. It
converts an already-assembled AssignmentCandidateInputs payload (built by
the TypeScript side from REAL current position/ownership/account state)
into the existing deterministic AssignmentPolicy/evaluate_assignment
evaluation and returns the recommendation plus every reason, echoing back
snapshotId/fusionSnapshotHash/timestamp exactly as the other runtime
contracts do, so the TS side can verify a response belongs to the
FusionSnapshot it was requested against.

This contract deliberately does NOT compute required cash/collateral,
resulting share quantity, or post-assignment concentration -- those are
account-exposure quantities the TS side already derives in
account-exposure.ts (deriveAssignmentCapacity,
maxAdditionalContractsForCandidate, tickerConcentrationPct). The TS-side
assignment-assembly.ts combines this contract's economic/ownership
recommendation with those already-derived exposure quantities into one
final receipt, rather than this module re-deriving exposure math that
has no I/O-free, provider-independent form.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.assignment_model import (  # noqa: E402
    AssignmentCandidateInputs,
    AssignmentPolicy,
    evaluate_assignment,
)

CONTRACT_VERSION = "theta-assignment-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> AssignmentPolicy:
    return AssignmentPolicy(
        policy_version=_required(data, "policyVersion"),
        ownership_acceptability_floor=_required(data, "ownershipAcceptabilityFloor"),
        tail_risk_penalty_weight=_required(data, "tailRiskPenaltyWeight"),
    )


def _candidate(data: dict[str, Any]) -> AssignmentCandidateInputs:
    return AssignmentCandidateInputs(
        strike=_required(data, "strike"),
        multiplier=_required(data, "multiplier"),
        entry_premium_per_share=_required(data, "entryPremiumPerShare"),
        ownership_acceptability=data.get("ownershipAcceptability"),
        p_severe_drawdown=data.get("pSevereDrawdown"),
        mechanical_close_debit_per_share=data.get("mechanicalCloseDebitPerShare"),
        capital_committed=_required(data, "capitalCommitted"),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    decision_id = _required(request, "decisionId")
    snapshot_id = _required(request, "snapshotId")
    fusion_snapshot_hash = _required(request, "fusionSnapshotHash")
    if not isinstance(fusion_snapshot_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", fusion_snapshot_hash):
        raise ValueError("fusionSnapshotHash must be a lowercase SHA-256 hash")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    candidate = _candidate(_required(request, "candidate"))

    evaluation = evaluate_assignment(policy, candidate)

    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": decision_id,
        "snapshotId": snapshot_id,
        "fusionSnapshotHash": fusion_snapshot_hash,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "ownershipAcceptable": evaluation.ownership_acceptable,
        "economicBasisPerShare": evaluation.economics.economic_basis_per_share,
        "mechanicalCloseRealizedPnl": evaluation.economics.mechanical_close_realized_pnl,
        "acceptAssignmentTailPenalty": evaluation.economics.accept_assignment_tail_penalty,
        "recommendation": evaluation.recommendation,
        "reasons": [asdict(reason) for reason in evaluation.reasons],
    }


def main() -> int:
    try:
        request = json.load(sys.stdin)
        response = evaluate_request(request)
        json.dump(response, sys.stdout, sort_keys=True, separators=(",", ":"), allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except (KeyError, TypeError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        json.dump(
            {"contractVersion": CONTRACT_VERSION, "error": {"code": "INVALID_REQUEST", "message": str(error)}},
            sys.stdout,
            sort_keys=True,
            separators=(",", ":"),
        )
        sys.stdout.write("\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
