"""Stable JSON boundary around Claude-owned THETA-Q research models.

This adapter performs no provider I/O and never authorizes execution. It converts a
frozen FusionSnapshot candidate payload into the existing deterministic candidate
lattice and transparent baseline model, then returns every alternative plus WAIT.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import re
import sys
from typing import Any

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.theta_q_baseline import (  # noqa: E402
    BaselinePolicy,
    CostAssumptions,
    CspCandidateInputs,
    SizingPolicy,
    rank_candidates,
)
from models.theta_q_lattice import ChainContract, LatticeConfig, build_candidate_grid  # noqa: E402

CONTRACT_VERSION = "theta-q-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _lattice_config(data: dict[str, Any]) -> LatticeConfig:
    return LatticeConfig(
        config_version=_required(data, "configVersion"),
        min_dte=_required(data, "minDte"),
        max_dte=_required(data, "maxDte"),
        delta_bands=tuple(tuple(band) for band in _required(data, "deltaBands")),
        min_open_interest=_required(data, "minOpenInterest"),
        min_volume=_required(data, "minVolume"),
        max_spread_pct=_required(data, "maxSpreadPct"),
        earnings_exclusion_days=_required(data, "earningsExclusionDays"),
    )


def _sizing_policy(data: dict[str, Any]) -> SizingPolicy:
    return SizingPolicy(
        risk_limit_version=_required(data, "riskLimitVersion"),
        max_spread_pct=_required(data, "maxSpreadPct"),
        min_quote_freshness_seconds=_required(data, "maxQuoteAgeSeconds"),
        min_open_interest=_required(data, "minOpenInterest"),
        min_volume=_required(data, "minVolume"),
        earnings_exclusion_days=_required(data, "earningsExclusionDays"),
        ownership_acceptability_floor=_required(data, "ownershipAcceptabilityFloor"),
        exceptional_utility_threshold=_required(data, "exceptionalUtilityThreshold"),
        strong_utility_threshold=_required(data, "strongUtilityThreshold"),
        minimum_positive_edge=_required(data, "minimumPositiveEdge"),
        risk_budget_qty_cap=_required(data, "riskBudgetQtyCap"),
        collateral_qty_cap=_required(data, "collateralQtyCap"),
        concentration_qty_cap=_required(data, "concentrationQtyCap"),
    )


def _cost_assumptions(data: dict[str, Any]) -> CostAssumptions:
    return CostAssumptions(
        commission_per_contract=_required(data, "commissionPerContract"),
        fees_per_contract=_required(data, "feesPerContract"),
        est_slippage_per_contract=_required(data, "estimatedSlippagePerContract"),
        cost_model_version=_required(data, "costModelVersion"),
    )


def _chain_contract(data: dict[str, Any]) -> ChainContract:
    return ChainContract(
        underlying_symbol=_required(data, "underlyingSymbol"),
        expiration_dte=_required(data, "dte"),
        strike=_required(data, "strike"),
        put_delta_magnitude=_required(data, "putDeltaMagnitude"),
        spread_pct=_required(data, "spreadPct"),
        open_interest=_required(data, "openInterest"),
        volume=_required(data, "volume"),
        earnings_distance_days=_required(data, "earningsDistanceDays"),
    )


def _baseline_input(data: dict[str, Any]) -> CspCandidateInputs:
    return CspCandidateInputs(
        underlying_symbol=_required(data, "underlyingSymbol"),
        strike=_required(data, "strike"),
        multiplier=_required(data, "multiplier"),
        entry_premium_per_share=_required(data, "entryPremiumPerShare"),
        dte=_required(data, "dte"),
        spread_pct=_required(data, "spreadPct"),
        quote_age_seconds=_required(data, "quoteAgeSeconds"),
        open_interest=_required(data, "openInterest"),
        volume=_required(data, "volume"),
        earnings_distance_days=_required(data, "earningsDistanceDays"),
        ownership_acceptability=_required(data, "ownershipAcceptability"),
        p_severe_drawdown=_required(data, "severeDrawdownProbability"),
        iv_rank=_required(data, "ivRank"),
        broker_allowed_qty=_required(data, "brokerAllowedQty"),
        contract_is_standard=_required(data, "contractIsStandard"),
    )


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")
    if request.get("operation") != "evaluateCspCandidates":
        raise ValueError("operation must equal evaluateCspCandidates")
    fusion_snapshot_hash = _required(request, "fusionSnapshotHash")
    if not isinstance(fusion_snapshot_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", fusion_snapshot_hash):
        raise ValueError("fusionSnapshotHash must be a lowercase SHA-256 hash")

    candidates = _required(request, "candidates")
    if not isinstance(candidates, list):
        raise ValueError("candidates must be a list")
    ids = [_required(candidate, "candidateId") for candidate in candidates]
    if len(ids) != len(set(ids)):
        raise ValueError("candidateId values must be unique")

    lattice = build_candidate_grid(
        [_chain_contract(candidate) for candidate in candidates],
        _lattice_config(_required(request, "latticeConfig")),
    )
    rejected_contracts = {contract.contract for contract in lattice.rejected}
    policy = BaselinePolicy(
        _sizing_policy(_required(request, "sizingPolicy")),
        _cost_assumptions(_required(request, "costAssumptions")),
    )

    eligible_pairs = [
        (candidate, _baseline_input(candidate))
        for candidate in candidates
        if _chain_contract(candidate) not in rejected_contracts
    ]
    ranked = rank_candidates(policy, [inputs for _, inputs in eligible_pairs])
    unevaluated = [
        (candidate["candidateId"], inputs, policy.evaluate(inputs))
        for candidate, inputs in eligible_pairs
    ]
    rank_by_candidate_id: dict[str, int] = {}
    matched_ids: set[str] = set()
    for index, ranked_evaluation in enumerate(ranked):
        match = next(
            (
                candidate_id
                for candidate_id, _, evaluation in unevaluated
                if candidate_id not in matched_ids and evaluation == ranked_evaluation
            ),
            None,
        )
        if match is None:
            raise RuntimeError("THETA-Q ranking output could not be matched to its input")
        matched_ids.add(match)
        rank_by_candidate_id[match] = index + 1

    results: list[dict[str, Any]] = []
    feasible_results: list[dict[str, Any]] = []
    for candidate in candidates:
        chain_contract = _chain_contract(candidate)
        candidate_id = candidate["candidateId"]
        lattice_match = next(
            item for item in lattice.eligible + lattice.rejected if item.contract == chain_contract
        )
        if lattice_match.reasons:
            result = {
                "candidateId": candidate_id,
                "rank": None,
                "actionFeasible": False,
                "quantity": 0,
                "economics": None,
                "ownershipScore": None,
                "reasons": [asdict(reason) for reason in lattice_match.reasons],
            }
        else:
            baseline_input = _baseline_input(candidate)
            evaluation = policy.evaluate(baseline_input)
            result = {
                "candidateId": candidate_id,
                "rank": rank_by_candidate_id.get(candidate_id),
                "actionFeasible": not evaluation.hard_veto and evaluation.quantity > 0,
                "quantity": evaluation.quantity,
                "economics": asdict(evaluation.economics) if evaluation.economics else None,
                "ownershipScore": evaluation.ownership_score,
                "reasons": [asdict(reason) for reason in evaluation.reasons],
            }
            if result["actionFeasible"]:
                feasible_results.append(result)
        results.append(result)

    feasible_results.sort(key=lambda item: item["rank"] or sys.maxsize)
    selected = feasible_results[0] if feasible_results else None
    return {
        "contractVersion": CONTRACT_VERSION,
        "fusionSnapshotHash": fusion_snapshot_hash,
        "candidates": results,
        "wait": {"candidateId": "WAIT", "actionFeasible": True, "quantity": 0},
        "recommendation": {
            "actionCode": "OPEN_CSP" if selected else "WAIT",
            "selectedCandidateId": selected["candidateId"] if selected else "WAIT",
            "quantity": selected["quantity"] if selected else 0,
            "executionAuthorized": False,
            "requiresAegis": True,
            "requiresFreshAlpacaBbo": True,
        },
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
