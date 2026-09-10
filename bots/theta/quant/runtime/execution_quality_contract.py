"""Stable JSON boundary around bots/theta/quant/models/execution_quality.py.

Mirrors src/theta/execution-quality-contract.ts's
executionQualityResponseSchema field-for-field.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.execution_quality import (  # noqa: E402
    ExecutionQualityInputs,
    ExecutionQualityPolicy,
    assess_execution_quality,
)

CONTRACT_VERSION = "theta-execution-quality-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> ExecutionQualityPolicy:
    return ExecutionQualityPolicy(
        policy_version=_required(data, "policyVersion"),
        max_acceptable_spread_pct=_required(data, "maxAcceptableSpreadPct"),
        min_quote_size_for_full_confidence=_required(data, "minQuoteSizeForFullConfidence"),
        max_quote_age_seconds=_required(data, "maxQuoteAgeSeconds"),
        min_after_cost_utility_to_cross=_required(data, "minAfterCostUtilityToCross"),
    )


def _inputs(data: dict[str, Any]) -> ExecutionQualityInputs:
    return ExecutionQualityInputs(
        bid=_required(data, "bid"),
        ask=_required(data, "ask"),
        quote_size=_required(data, "quoteSize"),
        quote_age_seconds=_required(data, "quoteAgeSeconds"),
        limit_price=_required(data, "limitPrice"),
        pre_slippage_expected_utility=_required(data, "preSlippageExpectedUtility"),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    decision_id = _required(request, "decisionId")
    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    inputs = _inputs(_required(request, "inputs"))

    assessment = assess_execution_quality(policy, inputs)

    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": decision_id,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "spreadPct": assessment.spread_pct,
        "fillProbability": assessment.fill_probability,
        "expectedSlippagePerShare": assessment.expected_slippage_per_share,
        "acceptable": assessment.acceptable,
        "recommendedAction": assessment.recommended_action,
        "reasons": [asdict(r) for r in assessment.reasons],
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
