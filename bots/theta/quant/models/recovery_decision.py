"""Recovery decision model (Phase 2B-quant): RECOVERY_WAIT vs SELL_STOCK vs SELL_CC.

Consumes ``recovery_spec.py``'s already-implemented survival-curve summary
context and enforces H-A-02 (RETAIN): a recovery-wait policy must have an
explicit bound -- this module has NO code path for an unconditional,
unbounded wait. Never automatically sells a covered call simply because
stock exists (H-C-02, RETAIN, docs/quant/phase2/PHASE2_MASTER_SPEC.md §8).
"""

from dataclasses import dataclass
from typing import List, Optional

from models.common import ReasonCode
from models.recovery_spec import RecoverySummary


@dataclass(frozen=True)
class RecoveryPolicy:
    policy_version: str
    max_wait_days: int  # REQUIRED bound -- H-A-02 forbids unconditional waiting
    thesis_invalidation_triggers_exit: bool = True


@dataclass(frozen=True)
class RecoveryCandidateInputs:
    days_in_recovery: int
    recovery_summary: Optional[RecoverySummary]  # context for a future refinement; not required by v0's bound check
    thesis_invalidated: bool  # supplied externally (ownership_v0.py's THESIS_INVALIDATED signal), never derived here
    covered_call_available: bool
    best_cc_utility: Optional[float]  # from covered_call_ranker.py, if already computed


@dataclass(frozen=True)
class RecoveryEvaluation:
    action: str  # "RECOVERY_WAIT" | "SELL_STOCK" | "SELL_CC"
    bound_exceeded: bool
    reasons: List[ReasonCode]


def evaluate_recovery(policy: RecoveryPolicy, c: RecoveryCandidateInputs) -> RecoveryEvaluation:
    reasons: List[ReasonCode] = []

    if c.thesis_invalidated and policy.thesis_invalidation_triggers_exit:
        reasons.append(ReasonCode(
            "THESIS_INVALIDATED", -1,
            "Thesis invalidation is a hard exit trigger, not a lower score (ownership_v0.py's own discipline).",
        ))
        return RecoveryEvaluation(action="SELL_STOCK", bound_exceeded=False, reasons=reasons)

    bound_exceeded = c.days_in_recovery >= policy.max_wait_days
    if bound_exceeded:
        reasons.append(ReasonCode(
            "RECOVERY_BOUND_EXCEEDED", -1,
            f"days_in_recovery={c.days_in_recovery} >= max_wait_days={policy.max_wait_days} (H-A-02).",
        ))
        return RecoveryEvaluation(action="SELL_STOCK", bound_exceeded=True, reasons=reasons)

    if c.covered_call_available and c.best_cc_utility is not None and c.best_cc_utility > 0.0:
        reasons.append(ReasonCode("CC_UTILITY_POSITIVE", 1, f"best_cc_utility={c.best_cc_utility}"))
        return RecoveryEvaluation(action="SELL_CC", bound_exceeded=False, reasons=reasons)

    reasons.append(ReasonCode(
        "RECOVERY_WAIT_CONTINUES", 0,
        "Within bound, thesis not invalidated, no positive-utility CC available -- continue waiting, never automatic CC.",
    ))
    return RecoveryEvaluation(action="RECOVERY_WAIT", bound_exceeded=False, reasons=reasons)
