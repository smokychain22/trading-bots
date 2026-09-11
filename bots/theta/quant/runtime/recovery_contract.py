"""Stable JSON boundary around models.recovery_decision (R1H item K2).

Mirrors management_contract.py / assignment_contract.py's pattern. This
adapter performs no provider I/O and never authorizes execution. It wraps
the already-tested models.recovery_decision.evaluate_recovery, whose
three modeled actions are RECOVERY_WAIT / SELL_STOCK / SELL_CC.

SELL_PARTIAL_STOCK (requested by the R1 management roadmap) has NO
corresponding economic model in this repository yet -- recovery_decision.py
has no partial-sell formula, and inventing one here would violate the
standing "do not invent missing values" rule. This contract always
reports partialSellStock as {"modeled": false}, never a fabricated
utility, so a caller can see the gap explicitly rather than have it
silently absorbed into SELL_STOCK or omitted.

best_cc_utility (used by evaluate_recovery to decide between SELL_CC and
RECOVERY_WAIT) is an external input, exactly as recovery_decision.py's
own docstring requires -- if the caller wants it derived from a real CC
candidate frontier, it should come from covered_call_contract.py
(wrapping models.covered_call_ranker) and be passed in here already
computed, never re-derived by this module.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from models.recovery_decision import (  # noqa: E402
    RecoveryCandidateInputs,
    RecoveryPolicy,
    evaluate_recovery,
)

CONTRACT_VERSION = "theta-recovery-runtime-v1"


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _policy(data: dict[str, Any]) -> RecoveryPolicy:
    kwargs: dict[str, Any] = {
        "policy_version": _required(data, "policyVersion"),
        "max_wait_days": _required(data, "maxWaitDays"),
    }
    if "thesisInvalidationTriggersExit" in data:
        kwargs["thesis_invalidation_triggers_exit"] = data["thesisInvalidationTriggersExit"]
    return RecoveryPolicy(**kwargs)


def _candidate(data: dict[str, Any]) -> RecoveryCandidateInputs:
    return RecoveryCandidateInputs(
        days_in_recovery=_required(data, "daysInRecovery"),
        recovery_summary=None,  # context-only per recovery_decision.py's own docstring; not required by v0's bound check
        thesis_invalidated=_required(data, "thesisInvalidated"),
        covered_call_available=_required(data, "coveredCallAvailable"),
        best_cc_utility=data.get("bestCcUtility"),
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
    candidate = _candidate(_required(request, "candidate"))

    evaluation = evaluate_recovery(policy, candidate)

    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": decision_id,
        "snapshotId": snapshot_id,
        "fusionSnapshotHash": fusion_snapshot_hash,
        "timestamp": timestamp,
        "policyVersion": policy.policy_version,
        "action": evaluation.action,
        "boundExceeded": evaluation.bound_exceeded,
        "reasons": [asdict(reason) for reason in evaluation.reasons],
        "partialSellStock": {"modeled": False},
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
