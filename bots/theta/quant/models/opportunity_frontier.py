"""Opportunity frontier / anti-paralysis engine.

Prevents THETA from degrading into an OPEN-vs-WAIT classifier. A single
unattractive candidate must never make the whole engine idle: this module
ranks a full opportunity book across many already-evaluated candidates and
only concludes global idleness once the book has genuinely been searched,
with an explainable, auditable reason -- never a bare "WAIT".

Two dispositions are kept structurally distinct, never conflated:

- WAIT (with a specific sub-reason): "this opportunity may become
  attractive if a named, monitorable state variable changes" -- transient,
  always paired with a recheck trigger elsewhere in the caller's scheduling
  layer, never indefinite.
- PASS: "this candidate is currently structurally inferior, and nothing
  about it is expected to change on the next equivalent scan" -- e.g.
  unacceptable ownership, non-positive after-cost EV, or an unresolved
  required input.

This module does NOT compute EV_net, ownership, AEGIS, or sizing itself --
it consumes already-computed per-candidate outputs from
theta_q_baseline.py / ownership_v0.py / aegis.py / sizing.py and applies the
disposition/ranking/global-idle-explainability logic those modules
deliberately do not (each keeps a single responsibility, per this repo's
existing convention -- see rank_candidates()'s own docstring in
theta_q_baseline.py).
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Sequence

from models.common import ReasonCode


class WaitReason(str, Enum):
    WAIT_PRICE = "WAIT_PRICE"
    WAIT_VOL = "WAIT_VOL"
    WAIT_LIQUIDITY = "WAIT_LIQUIDITY"
    WAIT_EVENT = "WAIT_EVENT"
    WAIT_REGIME = "WAIT_REGIME"


class CandidateDisposition(str, Enum):
    OPEN_FULL = "OPEN_FULL"
    OPEN_REDUCED = "OPEN_REDUCED"
    OPEN_ALTERNATE_CONTRACT = "OPEN_ALTERNATE_CONTRACT"  # same expiry, neighboring strike
    OPEN_ALTERNATE_EXPIRY = "OPEN_ALTERNATE_EXPIRY"  # different DTE bucket, same underlying/structure intent
    OPEN_ALTERNATE_STRUCTURE = "OPEN_ALTERNATE_STRUCTURE"  # a different, validated structure (e.g. defined-risk)
    WAIT = "WAIT"
    PASS = "PASS"


_OPEN_DISPOSITIONS = frozenset({
    CandidateDisposition.OPEN_FULL,
    CandidateDisposition.OPEN_REDUCED,
    CandidateDisposition.OPEN_ALTERNATE_CONTRACT,
    CandidateDisposition.OPEN_ALTERNATE_EXPIRY,
    CandidateDisposition.OPEN_ALTERNATE_STRUCTURE,
})


class GlobalIdleReason(str, Enum):
    NO_POSITIVE_AFTER_COST_EDGE = "NO_POSITIVE_AFTER_COST_EDGE"
    PORTFOLIO_RISK_CAP_REACHED = "PORTFOLIO_RISK_CAP_REACHED"
    CAPITAL_UNAVAILABLE = "CAPITAL_UNAVAILABLE"
    MARKET_DATA_INVALID = "MARKET_DATA_INVALID"
    BROKER_UNAVAILABLE = "BROKER_UNAVAILABLE"
    SYSTEM_QUARANTINED = "SYSTEM_QUARANTINED"
    ALL_ELIGIBLE_CONTRACTS_ILLIQUID = "ALL_ELIGIBLE_CONTRACTS_ILLIQUID"
    EVENT_RISK_CLUSTER = "EVENT_RISK_CLUSTER"
    REGIME_RISK = "REGIME_RISK"


@dataclass(frozen=True)
class OpportunityFrontierPolicy:
    policy_version: str
    # Above this model-uncertainty level, a genuinely positive-edge candidate
    # is sized down (OPEN_REDUCED) rather than rejected -- uncertainty must
    # not automatically mean WAIT (this task's explicit anti-paralysis rule).
    reduced_size_uncertainty_threshold: float


@dataclass(frozen=True)
class CandidateSnapshot:
    """One already-evaluated candidate's summary. Every field is the OUTPUT
    of an upstream model (theta_q_baseline.py / ownership_v0.py / aegis.py),
    never raw market data -- this module only classifies/ranks."""

    candidate_id: str
    underlying_symbol: str
    ev_net: Optional[float]
    return_per_capital_day: Optional[float]
    ownership_acceptable: Optional[bool]
    liquidity_acceptable: Optional[bool]
    iv_compensation_sufficient: Optional[bool]
    event_near: bool
    regime_acceptable: Optional[bool]
    model_uncertainty: Optional[float]  # in [0, 1], None if unmodeled
    aegis_permits_full: bool
    aegis_permits_reduced: bool
    has_alternate_contract: bool  # a neighboring strike, same expiry, not yet evaluated
    has_alternate_expiry: bool  # a different DTE bucket, same underlying/structure intent, not yet evaluated
    has_alternate_structure: bool  # a validated defined-risk (or other) structure alternative exists


@dataclass(frozen=True)
class CandidateDecision:
    candidate_id: str
    disposition: CandidateDisposition
    wait_reason: Optional[WaitReason]
    rejection_category: Optional[str]  # explicit bucket for global-idle tallying; None for OPEN_* dispositions
    reasons: List[ReasonCode] = field(default_factory=list)


def _classify(policy: OpportunityFrontierPolicy, c: CandidateSnapshot) -> CandidateDecision:
    reasons: List[ReasonCode] = []

    # Unresolved required inputs -- neither a confirmed-transient WAIT nor a
    # confirmed-inferior PASS, but never actionable: UNKNOWN != acceptable.
    if c.ownership_acceptable is None or c.ev_net is None:
        reasons.append(ReasonCode("REQUIRED_INPUT_UNKNOWN", -1, "Ownership/EV is UNKNOWN, not assumed acceptable."))
        return CandidateDecision(c.candidate_id, CandidateDisposition.PASS, None, "UNKNOWN_INPUT", reasons)

    # Structural disqualifiers -> PASS. Nothing here is expected to change on
    # the next equivalent scan given already-known information.
    if not c.ownership_acceptable:
        reasons.append(ReasonCode("OWNERSHIP_UNACCEPTABLE", -1, "Ownership screen failed -- structurally inferior, not transient."))
        return CandidateDecision(c.candidate_id, CandidateDisposition.PASS, None, "OWNERSHIP", reasons)
    if c.ev_net <= 0:
        reasons.append(ReasonCode("NEGATIVE_AFTER_COST_EV", -1, "After-cost EV is non-positive on this specific contract."))
        # A negative-EV contract does not mean the underlying/opportunity is
        # dead -- a neighboring strike or a different DTE bucket may still
        # be positive-EV. Try those before giving up with PASS (this task's
        # explicit "preferred DTE loses economic advantage -> evaluate
        # another validated DTE region" requirement).
        if c.has_alternate_expiry:
            reasons.append(ReasonCode("ALTERNATE_EXPIRY_FALLBACK", 0, "A different DTE bucket has not yet been evaluated."))
            return CandidateDecision(c.candidate_id, CandidateDisposition.OPEN_ALTERNATE_EXPIRY, None, None, reasons)
        if c.has_alternate_contract:
            reasons.append(ReasonCode("ALTERNATE_CONTRACT_FALLBACK", 0, "A neighboring strike has not yet been evaluated."))
            return CandidateDecision(c.candidate_id, CandidateDisposition.OPEN_ALTERNATE_CONTRACT, None, None, reasons)
        return CandidateDecision(c.candidate_id, CandidateDisposition.PASS, None, "NEGATIVE_EV", reasons)

    # Transient/monitorable conditions -> WAIT with a specific sub-reason,
    # each of which the caller's scheduler can attach a recheck trigger to.
    if c.event_near:
        reasons.append(ReasonCode("EVENT_PROXIMITY", -1, "A known event is imminent."))
        return CandidateDecision(c.candidate_id, CandidateDisposition.WAIT, WaitReason.WAIT_EVENT, "EVENT", reasons)
    if c.liquidity_acceptable is False:
        reasons.append(ReasonCode("LIQUIDITY_UNACCEPTABLE", -1, "Spread/liquidity is currently unacceptable."))
        return CandidateDecision(c.candidate_id, CandidateDisposition.WAIT, WaitReason.WAIT_LIQUIDITY, "LIQUIDITY", reasons)
    if c.iv_compensation_sufficient is False:
        reasons.append(ReasonCode("IV_COMPENSATION_INSUFFICIENT", -1, "Premium does not currently compensate for volatility taken."))
        return CandidateDecision(c.candidate_id, CandidateDisposition.WAIT, WaitReason.WAIT_VOL, "VOL", reasons)
    if c.regime_acceptable is False:
        reasons.append(ReasonCode("REGIME_UNFAVORABLE", -1, "Current regime disfavors this structure/branch."))
        return CandidateDecision(c.candidate_id, CandidateDisposition.WAIT, WaitReason.WAIT_REGIME, "REGIME", reasons)

    # AEGIS gating -- fall back to an alternate contract/structure before
    # ever collapsing to PASS; PASS here means even the fallbacks are unavailable.
    if not c.aegis_permits_full and not c.aegis_permits_reduced:
        reasons.append(ReasonCode("AEGIS_BLOCKS_FULL_AND_REDUCED", -1, "AEGIS permits neither full nor reduced risk on this contract."))
        if c.has_alternate_structure:
            reasons.append(ReasonCode("DEFINED_RISK_FALLBACK", 0, "A permitted defined-risk alternative exists."))
            return CandidateDecision(c.candidate_id, CandidateDisposition.OPEN_ALTERNATE_STRUCTURE, None, None, reasons)
        if c.has_alternate_contract:
            reasons.append(ReasonCode("ALTERNATE_CONTRACT_FALLBACK", 0, "A neighboring contract has not yet been evaluated."))
            return CandidateDecision(c.candidate_id, CandidateDisposition.OPEN_ALTERNATE_CONTRACT, None, None, reasons)
        return CandidateDecision(c.candidate_id, CandidateDisposition.PASS, None, "AEGIS", reasons)

    # Positive edge, structurally sound, risk-permitted -- uncertainty
    # governs SIZE, never whether to act at all.
    if c.model_uncertainty is not None and c.model_uncertainty > policy.reduced_size_uncertainty_threshold:
        reasons.append(ReasonCode(
            "ELEVATED_UNCERTAINTY_REDUCED_SIZE", 0,
            f"model_uncertainty={c.model_uncertainty} exceeds threshold -- sizing down, not rejecting.",
        ))
        return CandidateDecision(c.candidate_id, CandidateDisposition.OPEN_REDUCED, None, None, reasons)

    if not c.aegis_permits_full:
        reasons.append(ReasonCode("AEGIS_REDUCED_ONLY", 0, "AEGIS permits reduced risk only."))
        return CandidateDecision(c.candidate_id, CandidateDisposition.OPEN_REDUCED, None, None, reasons)

    reasons.append(ReasonCode("CANDIDATE_QUALIFIES_FULL", 1, "Structural, transient, and risk checks all clear."))
    return CandidateDecision(c.candidate_id, CandidateDisposition.OPEN_FULL, None, None, reasons)


@dataclass(frozen=True)
class OpportunityBookEntry:
    rank: Optional[int]  # None for non-actionable (WAIT/PASS) entries
    candidate: CandidateSnapshot
    decision: CandidateDecision


@dataclass(frozen=True)
class GlobalIdleReport:
    reason: GlobalIdleReason
    eligible_underlyings_scanned: int
    contracts_evaluated: int
    positive_ev_candidates: int
    risk_rejected_candidates: int
    execution_rejected_candidates: int
    best_rejected_candidate_id: Optional[str]
    best_rejected_ev: Optional[float]


@dataclass(frozen=True)
class OpportunityBook:
    entries: List[OpportunityBookEntry]
    actionable_entries: List[OpportunityBookEntry]  # ranked OPEN_* entries, best first
    global_idle: Optional[GlobalIdleReport]  # None whenever at least one actionable entry exists


def _rank_key(candidate: CandidateSnapshot) -> tuple:
    if candidate.return_per_capital_day is None:
        return (0, 0.0)
    return (1, candidate.return_per_capital_day)


def _global_idle_reason(entries: Sequence[OpportunityBookEntry]) -> GlobalIdleReason:
    if not entries:
        return GlobalIdleReason.MARKET_DATA_INVALID
    categories = [e.decision.rejection_category for e in entries]
    if categories and all(cat == "AEGIS" for cat in categories):
        return GlobalIdleReason.PORTFOLIO_RISK_CAP_REACHED
    if categories and all(cat == "LIQUIDITY" for cat in categories):
        return GlobalIdleReason.ALL_ELIGIBLE_CONTRACTS_ILLIQUID
    if categories and all(cat == "EVENT" for cat in categories):
        return GlobalIdleReason.EVENT_RISK_CLUSTER
    if categories and all(cat == "REGIME" for cat in categories):
        return GlobalIdleReason.REGIME_RISK
    return GlobalIdleReason.NO_POSITIVE_AFTER_COST_EDGE


def build_opportunity_book(
    policy: OpportunityFrontierPolicy, candidates: Sequence[CandidateSnapshot]
) -> OpportunityBook:
    """Classifies and ranks every candidate. Returns at least one actionable
    entry whenever any candidate genuinely qualifies -- a single bad
    candidate never suppresses another candidate's independent OPEN_*
    disposition. Only when NO candidate qualifies does this return a
    GlobalIdleReport, and that report proves the book was searched (counts,
    best-rejected reference) rather than asserting idleness opaquely.
    """
    entries = [
        OpportunityBookEntry(rank=None, candidate=c, decision=_classify(policy, c))
        for c in candidates
    ]

    actionable = [e for e in entries if e.decision.disposition in _OPEN_DISPOSITIONS]
    actionable.sort(key=lambda e: _rank_key(e.candidate), reverse=True)
    ranked_actionable = [
        OpportunityBookEntry(rank=i + 1, candidate=e.candidate, decision=e.decision)
        for i, e in enumerate(actionable)
    ]

    if ranked_actionable:
        return OpportunityBook(entries=entries, actionable_entries=ranked_actionable, global_idle=None)

    known_ev_candidates = [c for c in candidates if c.ev_net is not None]
    best = max(known_ev_candidates, key=lambda c: c.ev_net, default=None)  # type: ignore[arg-type]

    report = GlobalIdleReport(
        reason=_global_idle_reason(entries),
        eligible_underlyings_scanned=len({c.underlying_symbol for c in candidates}),
        contracts_evaluated=len(candidates),
        positive_ev_candidates=sum(1 for c in candidates if c.ev_net is not None and c.ev_net > 0),
        risk_rejected_candidates=sum(1 for e in entries if e.decision.rejection_category == "AEGIS"),
        execution_rejected_candidates=sum(1 for e in entries if e.decision.rejection_category == "LIQUIDITY"),
        best_rejected_candidate_id=best.candidate_id if best is not None else None,
        best_rejected_ev=best.ev_net if best is not None else None,
    )
    return OpportunityBook(entries=entries, actionable_entries=[], global_idle=report)
