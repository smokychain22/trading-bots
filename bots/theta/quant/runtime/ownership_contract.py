"""Stable JSON boundary around bots/theta/quant/models/ownership_v0.py.

Mirrors src/theta/ownership-contract.ts's ownershipEvaluationResponseSchema
field-for-field. This adapter performs no provider I/O -- it only converts
an already-assembled OwnershipInputs payload into ownership_v0.evaluate()'s
output, JSON-shaped for the TypeScript contract to validate.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.ownership_v0 import OwnershipInputs, OwnershipPolicyV0, evaluate  # noqa: E402

CONTRACT_VERSION = "theta-ownership-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> OwnershipPolicyV0:
    return OwnershipPolicyV0(
        policy_version=_required(data, "policyVersion"),
        min_stock_avg_volume=_required(data, "minStockAvgVolume"),
        min_option_open_interest=_required(data, "minOptionOpenInterest"),
        min_option_volume=_required(data, "minOptionVolume"),
        max_spread_pct=_required(data, "maxSpreadPct"),
        rv_normalization_ceiling=_required(data, "rvNormalizationCeiling"),
        downside_semivar_normalization_ceiling=_required(data, "downsideSemivarNormalizationCeiling"),
        gap_frequency_normalization_ceiling=_required(data, "gapFrequencyNormalizationCeiling"),
        event_decay_window_days=_required(data, "eventDecayWindowDays"),
    )


def _inputs(data: dict[str, Any]) -> OwnershipInputs:
    return OwnershipInputs(
        stock_avg_volume=_required(data, "stockAvgVolume"),
        option_open_interest=_required(data, "optionOpenInterest"),
        option_volume=_required(data, "optionVolume"),
        spread_pct=_required(data, "spreadPct"),
        ret_1d=_required(data, "ret1d"),
        ret_5d=_required(data, "ret5d"),
        ret_20d=_required(data, "ret20d"),
        ret_60d=_required(data, "ret60d"),
        ma20_rel=_required(data, "ma20Rel"),
        ma50_rel=_required(data, "ma50Rel"),
        ma200_rel=_required(data, "ma200Rel"),
        ma_slope=_required(data, "maSlope"),
        relative_strength=_required(data, "relativeStrength"),
        rv10=_required(data, "rv10"),
        rv20=_required(data, "rv20"),
        rv60=_required(data, "rv60"),
        drawdown=_required(data, "drawdown"),
        max_adverse_gap=_required(data, "maxAdverseGap"),
        gap_frequency=_required(data, "gapFrequency"),
        downside_semivariance=_required(data, "downsideSemivariance"),
        historical_recovery_median_days=_required(data, "historicalRecoveryMedianDays"),
        historical_recovery_p95_days=_required(data, "historicalRecoveryP95Days"),
        severe_drawdown_episode_count=_required(data, "severeDrawdownEpisodeCount"),
        earnings_distance_days=_required(data, "earningsDistanceDays"),
        ex_dividend_distance_days=_required(data, "exDividendDistanceDays"),
        known_event_distance_days=_required(data, "knownEventDistanceDays"),
        thesis_invalidated=data.get("thesisInvalidated", False),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    snapshot_id = _required(request, "snapshotId")
    underlying_symbol = _required(request, "underlyingSymbol")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    inputs = _inputs(_required(request, "inputs"))

    result = evaluate(inputs, policy)

    return {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": snapshot_id,
        "underlyingSymbol": underlying_symbol,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "ownability": result.ownability,
        "components": [
            {
                "name": c.name,
                "value": c.value,
                "status": c.status,
                "reasons": [asdict(r) for r in c.reasons],
            }
            for c in result.components
        ],
        "thesisInvalidated": result.thesis_invalidated,
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
