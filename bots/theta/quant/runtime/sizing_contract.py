"""Stable JSON boundary around bots/theta/quant/models/sizing.py.

Mirrors src/theta/sizing-contract.ts's sizingResultResponseSchema
field-for-field. ``quantity=0`` is always a legitimate response -- this
adapter never floors it to 1.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.aegis import RiskState  # noqa: E402
from models.sizing import SizingInputs, SizingPolicy, compute_sizing  # noqa: E402

CONTRACT_VERSION = "theta-sizing-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> SizingPolicy:
    return SizingPolicy(
        policy_version=_required(data, "policyVersion"),
        risk_budget_qty_cap=_required(data, "riskBudgetQtyCap"),
        collateral_qty_cap=_required(data, "collateralQtyCap"),
        concentration_qty_cap=_required(data, "concentrationQtyCap"),
        assignment_capacity_qty_cap=_required(data, "assignmentCapacityQtyCap"),
        reduced_state_multiplier=_required(data, "reducedStateMultiplier"),
    )


def _inputs(data: dict[str, Any]) -> SizingInputs:
    return SizingInputs(
        equity=_required(data, "equity"),
        cash=_required(data, "cash"),
        buying_power=_required(data, "buyingPower"),
        required_collateral_per_contract=_required(data, "requiredCollateralPerContract"),
        broker_allowed_qty=_required(data, "brokerAllowedQty"),
        risk_state=RiskState(_required(data, "riskState")),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    decision_id = _required(request, "decisionId")
    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    inputs = _inputs(_required(request, "inputs"))

    result = compute_sizing(policy, inputs)

    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": decision_id,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "quantity": result.quantity,
        "capitalRequired": result.capital_required,
        "bindingConstraint": result.binding_constraint,
        "reasons": [asdict(r) for r in result.reasons],
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
