"""Stable JSON boundary around models.management_action_value (R1H item K).

Mirrors theta_q_contract.py's pattern exactly, and satisfies the EXISTING
src/theta/management-contract.ts schema (that TS file, and the decision-
assembly layer built on top of it in src/theta/management-assembly.ts,
were already built and tested before this Python contract existed -- this
file completes that pre-existing, previously-unwired boundary rather than
inventing a new one).

This adapter performs no provider I/O and never authorizes execution. It
converts an already-assembled ManagementContext payload (built by the
TypeScript side from REAL current position/quote state) into the existing
deterministic ManagementPolicy/ManagementContext evaluation and returns
every alternative's valuation plus the selected action, echoing back
snapshotId/fusionSnapshotHash/timestamp exactly as theta_q_contract.py
echoes fusionSnapshotHash -- so the TS side can verify a response belongs
to the FusionSnapshot it was requested against, never trusting a stale or
mismatched result.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import re
import sys
from typing import Any, Optional

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.management_action_value import (  # noqa: E402
    AssignAlternative,
    ManagementContext,
    ManagementPolicy,
    OpenOptionLegState,
    RedeployAlternative,
    RollCandidate,
    evaluate_management_alternatives,
    hold_advantage,
)

CONTRACT_VERSION = "theta-management-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> ManagementPolicy:
    return ManagementPolicy(
        policy_version=_required(data, "policyVersion"),
        execution_cost_per_contract=_required(data, "executionCostPerContract"),
        capital_days_penalty_rate=_required(data, "capitalDaysPenaltyRate"),
        tail_risk_penalty_weight=_required(data, "tailRiskPenaltyWeight"),
    )


def _optional_open_option_leg(data: Optional[dict[str, Any]]) -> Optional[OpenOptionLegState]:
    if data is None:
        return None
    return OpenOptionLegState(
        entry_credit_per_share=_required(data, "entryCreditPerShare"),
        current_bid_per_share=data.get("currentBidPerShare"),
        current_ask_per_share=data.get("currentAskPerShare"),
        strike=_required(data, "strike"),
        multiplier=_required(data, "multiplier"),
        dte=_required(data, "dte"),
    )


def _optional_roll_candidate(data: Optional[dict[str, Any]]) -> Optional[RollCandidate]:
    if data is None:
        return None
    return RollCandidate(
        new_strike=_required(data, "newStrike"),
        new_dte=_required(data, "newDte"),
        new_credit_per_share=data.get("newCreditPerShare"),
        estimated_future_value=data.get("estimatedFutureValue"),
    )


def _optional_assign_alternative(data: Optional[dict[str, Any]]) -> Optional[AssignAlternative]:
    if data is None:
        return None
    return AssignAlternative(estimated_future_value=data.get("estimatedFutureValue"))


def _optional_redeploy_alternative(data: Optional[dict[str, Any]]) -> Optional[RedeployAlternative]:
    if data is None:
        return None
    return RedeployAlternative(estimated_future_value=data.get("estimatedFutureValue"))


def _context(data: dict[str, Any]) -> ManagementContext:
    return ManagementContext(
        as_of=_required(data, "asOf"),
        open_option_leg=_optional_open_option_leg(data.get("openOptionLeg")),
        roll_candidate=_optional_roll_candidate(data.get("rollCandidate")),
        assign_alternative=_optional_assign_alternative(data.get("assignAlternative")),
        redeploy_alternative=_optional_redeploy_alternative(data.get("redeployAlternative")),
        capital_committed=data.get("capitalCommitted"),
        hold_forward_value=data.get("holdForwardValue"),
        p_severe_drawdown=data.get("pSevereDrawdown"),
        at_expiration_otm=_required(data, "atExpirationOtm"),
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
    ctx = _context(_required(request, "context"))

    decision = evaluate_management_alternatives(policy, ctx)
    advantage = hold_advantage(decision)

    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": decision_id,
        "snapshotId": snapshot_id,
        "fusionSnapshotHash": fusion_snapshot_hash,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "selectedAction": decision.selected_action.value,
        "selectedReasons": [asdict(reason) for reason in decision.selected_reasons],
        "holdAdvantage": advantage,
        "valuations": [
            {
                "action": valuation.action.value,
                "feasible": valuation.feasible,
                "certainCashflow": valuation.certain_cashflow,
                "estimatedFutureValue": valuation.estimated_future_value,
                "tailRiskPenalty": valuation.tail_risk_penalty,
                "capitalDaysPenalty": valuation.capital_days_penalty,
                "executionPenalty": valuation.execution_penalty,
                "utility": valuation.utility,
                "reasons": [asdict(reason) for reason in valuation.reasons],
            }
            for valuation in decision.valuations
        ],
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
