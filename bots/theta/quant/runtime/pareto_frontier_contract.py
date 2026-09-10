"""Stable JSON boundary around bots/theta/quant/models/pareto_frontier.py.

Unlike the other runtime adapters (one call per contract), this operates on
a BATCH of candidates at once -- Pareto dominance is inherently a pairwise
comparison across the whole candidate set for one snapshot, not a
per-candidate computation. Returns every candidate tagged with whether it
survived (non-dominated) and, for a dominated candidate, which other
candidate_ids dominate it -- so a caller/shadow-book can show WHY a
candidate was eliminated, not just that it was.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.pareto_frontier import CandidateEconomics, compute_pareto_frontier, dominated_by  # noqa: E402

CONTRACT_VERSION = "theta-pareto-frontier-runtime-v1"

_FIELDS = (
    "grossCredit", "evNet", "calibratedPWin", "breakEvenWr", "edgeBuffer", "expectedTailLoss",
    "assignmentProbability", "severeDrawdownProbability", "capitalRequirement", "capitalDays",
    "returnPerCapitalDay", "liquiditySpreadPct", "fillProbability", "expectedSlippage", "modelUncertainty",
)

_FIELD_TO_ATTR = {
    "grossCredit": "gross_credit", "evNet": "ev_net", "calibratedPWin": "calibrated_p_win",
    "breakEvenWr": "break_even_wr", "edgeBuffer": "edge_buffer", "expectedTailLoss": "expected_tail_loss",
    "assignmentProbability": "assignment_probability", "severeDrawdownProbability": "severe_drawdown_probability",
    "capitalRequirement": "capital_requirement", "capitalDays": "capital_days",
    "returnPerCapitalDay": "return_per_capital_day", "liquiditySpreadPct": "liquidity_spread_pct",
    "fillProbability": "fill_probability", "expectedSlippage": "expected_slippage",
    "modelUncertainty": "model_uncertainty",
}


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _candidate_economics(data: dict[str, Any]) -> CandidateEconomics:
    kwargs = {"candidate_id": _required(data, "candidateId")}
    for field_name in _FIELDS:
        kwargs[_FIELD_TO_ATTR[field_name]] = _required(data, field_name)
    return CandidateEconomics(**kwargs)


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    candidates_data = _required(request, "candidates")
    if not isinstance(candidates_data, list) or len(candidates_data) == 0:
        raise ValueError("candidates must be a non-empty list")

    candidates = [_candidate_economics(c) for c in candidates_data]
    ids = [c.candidate_id for c in candidates]
    if len(ids) != len(set(ids)):
        raise ValueError("candidateId values must be unique")

    survivors = compute_pareto_frontier(candidates)
    survivor_ids = {c.candidate_id for c in survivors}

    return {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "results": [
            {
                "candidateId": candidate_id,
                "survivesFrontier": candidate_id in survivor_ids,
                "dominatedBy": [] if candidate_id in survivor_ids else dominated_by(candidates, candidate_id),
            }
            for candidate_id in ids
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
