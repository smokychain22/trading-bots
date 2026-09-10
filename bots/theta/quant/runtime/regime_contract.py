"""Stable JSON boundary around bots/theta/quant/models/regime_v0.py.

Mirrors src/theta/regime-contract.ts's regimeSnapshotResponseSchema
field-for-field. Five independent axes are returned separately -- never
collapsed into one blended regime score (TRD section 42).
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.regime_v0 import RegimeInputs, RegimePolicyV0, classify  # noqa: E402

CONTRACT_VERSION = "theta-regime-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> RegimePolicyV0:
    return RegimePolicyV0(
        policy_version=_required(data, "policyVersion"),
        bull_ma_slope_floor=_required(data, "bullMaSlopeFloor"),
        bear_ma_slope_ceiling=_required(data, "bearMaSlopeCeiling"),
        rv_low_ceiling=_required(data, "rvLowCeiling"),
        rv_high_floor=_required(data, "rvHighFloor"),
        rv_shock_floor=_required(data, "rvShockFloor"),
        max_adverse_gap_shock_threshold=_required(data, "maxAdverseGapShockThreshold"),
        liquidity_thin_spread_pct_floor=_required(data, "liquidityThinSpreadPctFloor"),
        liquidity_dislocated_spread_pct_floor=_required(data, "liquidityDislocatedSpreadPctFloor"),
        correction_drawdown_ceiling=_required(data, "correctionDrawdownCeiling"),
        crisis_drawdown_ceiling=_required(data, "crisisDrawdownCeiling"),
    )


def _inputs(data: dict[str, Any]) -> RegimeInputs:
    return RegimeInputs(
        ma_slope=_required(data, "maSlope"),
        rv20=_required(data, "rv20"),
        max_adverse_gap=_required(data, "maxAdverseGap"),
        earnings_distance_days=_required(data, "earningsDistanceDays"),
        corporate_action_pending=_required(data, "corporateActionPending"),
        macro_risk_flag=_required(data, "macroRiskFlag"),
        spread_pct=_required(data, "spreadPct"),
        portfolio_or_market_drawdown=_required(data, "portfolioOrMarketDrawdown"),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    policy = _policy(_required(request, "policy"))
    inputs = _inputs(_required(request, "inputs"))

    snapshot = classify(inputs, policy)

    return {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "trendState": snapshot.trend_state.value if snapshot.trend_state is not None else None,
        "volatilityState": snapshot.volatility_state.value if snapshot.volatility_state is not None else None,
        "eventState": snapshot.event_state.value if snapshot.event_state is not None else None,
        "liquidityState": snapshot.liquidity_state.value if snapshot.liquidity_state is not None else None,
        "stressState": snapshot.stress_state.value if snapshot.stress_state is not None else None,
        "confidence": snapshot.confidence,
        "reasons": [asdict(r) for r in snapshot.reasons],
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
