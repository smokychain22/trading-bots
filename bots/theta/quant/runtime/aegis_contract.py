"""Stable JSON boundary around bots/theta/quant/models/aegis.py.

Mirrors src/theta/aegis-contract.ts's aegisAssessmentResponseSchema
field-for-field. ``permittedActions`` is computed here (never by the
TypeScript side) as the union of the always-permitted risk-reducing
actions (exit supremacy) and whatever new-risk-opening actions
``new_risk_state`` allows -- both tables are read directly from aegis.py,
never re-derived independently, so the two languages cannot drift apart.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.aegis import AegisInputs, AegisPolicy, assess_aegis, permitted_actions_for  # noqa: E402

CONTRACT_VERSION = "theta-aegis-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> AegisPolicy:
    return AegisPolicy(
        policy_version=_required(data, "policyVersion"),
        max_ticker_concentration_pct=_required(data, "maxTickerConcentrationPct"),
        max_sector_concentration_pct=_required(data, "maxSectorConcentrationPct"),
        max_correlation_cluster_pct=_required(data, "maxCorrelationClusterPct"),
        max_portfolio_capital_at_risk_pct=_required(data, "maxPortfolioCapitalAtRiskPct"),
        max_inventory_capacity_pct=_required(data, "maxInventoryCapacityPct"),
        max_assignment_capacity_pct=_required(data, "maxAssignmentCapacityPct"),
        max_recovery_capacity_pct=_required(data, "maxRecoveryCapacityPct"),
        provider_required_states=frozenset(_required(data, "providerRequiredStates")),
    )


def _inputs(data: dict[str, Any]) -> AegisInputs:
    return AegisInputs(
        ticker_concentration_pct=_required(data, "tickerConcentrationPct"),
        sector_concentration_pct=_required(data, "sectorConcentrationPct"),
        correlation_cluster_exposure_pct=_required(data, "correlationClusterExposurePct"),
        portfolio_capital_at_risk_pct=_required(data, "portfolioCapitalAtRiskPct"),
        inventory_capacity_used_pct=_required(data, "inventoryCapacityUsedPct"),
        assignment_capacity_used_pct=_required(data, "assignmentCapacityUsedPct"),
        recovery_capacity_used_pct=_required(data, "recoveryCapacityUsedPct"),
        liquidity_acceptable=_required(data, "liquidityAcceptable"),
        execution_quality_acceptable=_required(data, "executionQualityAcceptable"),
        provider_state=_required(data, "providerState"),
        stress_gap_detected=_required(data, "stressGapDetected"),
        stress_iv_shock_detected=_required(data, "stressIvShockDetected"),
        stress_spread_widening_detected=_required(data, "stressSpreadWideningDetected"),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    decision_id = _required(request, "decisionId")
    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    inputs = _inputs(_required(request, "inputs"))

    assessment = assess_aegis(policy, inputs)

    permitted_actions = sorted(permitted_actions_for(assessment.new_risk_state))

    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": decision_id,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "families": [
            {"family": f.family.value, "state": f.state.value, "reasons": [asdict(r) for r in f.reasons]}
            for f in assessment.families
        ],
        "newRiskState": assessment.new_risk_state.value,
        "reasons": [asdict(r) for r in assessment.reasons],
        "permittedActions": permitted_actions,
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
