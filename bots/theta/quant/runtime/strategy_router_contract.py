"""Stable JSON boundary around bots/theta/quant/models/strategy_router.py.

Mirrors src/theta/strategy-router-contract.ts's strategyRoutingResponseSchema
field-for-field. Every strategy family gets a result (eligible or not) --
this is a routing decision, never a partial vote.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.strategy_router import (  # noqa: E402
    LifecycleState,
    MarketContext,
    PortfolioContext,
    RouterPolicy,
    route_strategies,
)

CONTRACT_VERSION = "theta-strategy-router-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> RouterPolicy:
    return RouterPolicy(
        policy_version=_required(data, "policyVersion"),
        theta_q_min_ownership_acceptability=_required(data, "thetaQMinOwnershipAcceptability"),
        theta_h_min_ownership_acceptability=_required(data, "thetaHMinOwnershipAcceptability"),
        theta_d_gate_satisfied=_required(data, "thetaDGateSatisfied"),
    )


def _portfolio(data: dict[str, Any]) -> PortfolioContext:
    return PortfolioContext(
        lifecycle_state=LifecycleState(_required(data, "lifecycleState")),
        stock_shares_held=_required(data, "stockSharesHeld"),
        open_option_exists=_required(data, "openOptionExists"),
        assignment_imminent=_required(data, "assignmentImminent"),
    )


def _market(data: dict[str, Any]) -> MarketContext:
    return MarketContext(
        ownership_acceptable=_required(data, "ownershipAcceptable"),
        liquidity_acceptable=_required(data, "liquidityAcceptable"),
        event_near=_required(data, "eventNear"),
        critical_data_valid=_required(data, "criticalDataValid"),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    portfolio = _portfolio(_required(request, "portfolio"))
    market = _market(_required(request, "market"))

    results = route_strategies(policy, portfolio, market)

    return {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "results": [
            {
                "strategyFamily": r.strategy_family.value,
                "eligible": r.eligible,
                "eligibilityState": r.eligibility_state.value,
                "reasons": [asdict(reason) for reason in r.reasons],
                "policyVersion": r.policy_version,
            }
            for r in results
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
