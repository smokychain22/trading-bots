"""Stable JSON boundary around bots/theta/quant/models/opportunity_frontier.py.

Batch adapter (one call per snapshot, many candidates), like
pareto_frontier_contract.py -- the anti-paralysis global-idle report is
inherently a whole-book computation, not a per-candidate one.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.opportunity_frontier import (  # noqa: E402
    CandidateSnapshot,
    OpportunityFrontierPolicy,
    build_opportunity_book,
)

CONTRACT_VERSION = "theta-opportunity-frontier-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> OpportunityFrontierPolicy:
    return OpportunityFrontierPolicy(
        policy_version=_required(data, "policyVersion"),
        reduced_size_uncertainty_threshold=_required(data, "reducedSizeUncertaintyThreshold"),
    )


def _snapshot(data: dict[str, Any]) -> CandidateSnapshot:
    return CandidateSnapshot(
        candidate_id=_required(data, "candidateId"),
        underlying_symbol=_required(data, "underlyingSymbol"),
        ev_net=_required(data, "evNet"),
        return_per_capital_day=_required(data, "returnPerCapitalDay"),
        ownership_acceptable=_required(data, "ownershipAcceptable"),
        liquidity_acceptable=_required(data, "liquidityAcceptable"),
        iv_compensation_sufficient=_required(data, "ivCompensationSufficient"),
        event_near=_required(data, "eventNear"),
        regime_acceptable=_required(data, "regimeAcceptable"),
        model_uncertainty=_required(data, "modelUncertainty"),
        aegis_permits_full=_required(data, "aegisPermitsFull"),
        aegis_permits_reduced=_required(data, "aegisPermitsReduced"),
        has_alternate_contract=_required(data, "hasAlternateContract"),
        has_alternate_expiry=_required(data, "hasAlternateExpiry"),
        has_alternate_structure=_required(data, "hasAlternateStructure"),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    candidates_data = _required(request, "candidates")
    if not isinstance(candidates_data, list):
        raise ValueError("candidates must be a list")

    candidates = [_snapshot(c) for c in candidates_data]
    ids = [c.candidate_id for c in candidates]
    if len(ids) != len(set(ids)):
        raise ValueError("candidateId values must be unique")

    book = build_opportunity_book(policy, candidates)

    # book.entries always carries rank=None by construction -- only
    # book.actionable_entries (a separate, ranked list) has the real rank
    # for OPEN_* dispositions. Build a lookup so the serialized "entries"
    # list reports the actual rank instead of always emitting null.
    rank_by_candidate_id = {entry.candidate.candidate_id: entry.rank for entry in book.actionable_entries}

    return {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "entries": [
            {
                "candidateId": entry.candidate.candidate_id,
                "rank": rank_by_candidate_id.get(entry.candidate.candidate_id),
                "disposition": entry.decision.disposition.value,
                "waitReason": entry.decision.wait_reason.value if entry.decision.wait_reason is not None else None,
                "rejectionCategory": entry.decision.rejection_category,
                "reasons": [asdict(r) for r in entry.decision.reasons],
            }
            for entry in book.entries
        ],
        "actionableCandidateIds": [entry.candidate.candidate_id for entry in book.actionable_entries],
        "globalIdle": (
            None
            if book.global_idle is None
            else {
                "reason": book.global_idle.reason.value,
                "eligibleUnderlyingsScanned": book.global_idle.eligible_underlyings_scanned,
                "contractsEvaluated": book.global_idle.contracts_evaluated,
                "positiveEvCandidates": book.global_idle.positive_ev_candidates,
                "riskRejectedCandidates": book.global_idle.risk_rejected_candidates,
                "executionRejectedCandidates": book.global_idle.execution_rejected_candidates,
                "bestRejectedCandidateId": book.global_idle.best_rejected_candidate_id,
                "bestRejectedEv": book.global_idle.best_rejected_ev,
            }
        ),
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
