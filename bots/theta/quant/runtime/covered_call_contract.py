"""Stable JSON boundary around models.covered_call_ranker (R1H item K2/K3).

Mirrors the other runtime contracts' pattern. This wraps the already-
tested models.covered_call_ranker.rank_covered_call_frontier, which
decides among WAIT (retain stock unhedged) / SELL_STOCK / SELL_CC(any
number of real candidates) -- the OPENING decision for a new covered
call. It never selects a call merely because shares exist (WAIT is the
default absent a superior known utility, per the model's own H-C-02
discipline).

This is distinct from an already-open CC leg's HOLD_CC/CLOSE_CC/ROLL_CC/
ALLOW_CALL_AWAY management, which reuses management_contract.py directly
(the generic open-option-leg action-value model is agnostic to put vs.
call) rather than duplicating that math here.
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

from models.covered_call_ranker import (  # noqa: E402
    CoveredCallCandidate,
    CoveredCallPolicy,
    StockRetainedContext,
    rank_covered_call_frontier,
)

CONTRACT_VERSION = "theta-covered-call-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> CoveredCallPolicy:
    return CoveredCallPolicy(
        policy_version=_required(data, "policyVersion"),
        execution_cost_per_contract=_required(data, "executionCostPerContract"),
    )


def _candidate(data: dict[str, Any]) -> CoveredCallCandidate:
    return CoveredCallCandidate(
        strike=_required(data, "strike"),
        dte=_required(data, "dte"),
        credit_per_share=data.get("creditPerShare"),
        multiplier=_required(data, "multiplier"),
        call_away_regret_per_share=data.get("callAwayRegretPerShare"),
        event_risk_penalty=data.get("eventRiskPenalty"),
    )


def _stock(data: dict[str, Any]) -> StockRetainedContext:
    return StockRetainedContext(
        shares=_required(data, "shares"),
        economic_basis_per_share=_required(data, "economicBasisPerShare"),
        current_price_per_share=data.get("currentPricePerShare"),
        stock_ev_if_uncapped=data.get("stockEvIfUncapped"),
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
    candidates = [_candidate(c) for c in _required(request, "candidates")]
    stock = _stock(_required(request, "stock"))

    decision = rank_covered_call_frontier(policy, candidates, stock)

    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": decision_id,
        "snapshotId": snapshot_id,
        "fusionSnapshotHash": fusion_snapshot_hash,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "selectedLabel": decision.selected_label,
        "selectedReasons": [asdict(reason) for reason in decision.selected_reasons],
        "valuations": [
            {"label": v.label, "utility": v.utility, "reasons": [asdict(reason) for reason in v.reasons]}
            for v in decision.valuations
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
