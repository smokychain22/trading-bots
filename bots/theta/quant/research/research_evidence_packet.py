"""R7/R9 research evidence gates.

Two recommendation-only gates:

- `research_ready_for_paper(...)`  -- R7: is the RESEARCH evidence strong
  enough that a first Paper order would be scientifically defensible?
- `research_eligible_for_live_small(...)` -- R9: is the combined
  research + Paper evidence strong enough that live-small would be
  scientifically defensible?

Both are ALL-TRUE gates: any dimension that is `False` OR `None`
(genuinely unknown) blocks readiness. There is no majority vote, no
weighted score, and no default-to-ready. Neither function activates
anything -- Codex/owner alone decide Paper and live activation, and
`PAPER_READY` stays NO regardless of what these return.

No threshold is invented here: every dimension arrives as a caller-
supplied tri-state judgment (`True`/`False`/`None`), because the numeric
bars that would produce those judgments are versioned configuration, not
this module's business.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class ResearchEvidencePacket:
    """R7's fourteen required dimensions. Every Optional[bool] field is
    tri-state: True (satisfied), False (explicitly not satisfied), None
    (genuinely unknown -- e.g. because no empirical data exists yet).
    None NEVER counts as satisfied."""

    strategy_branch_supported: Optional[bool]
    cohort_supported: Optional[bool]
    positive_oos_ev: Optional[bool]
    tail_acceptable: Optional[bool]
    drawdown_acceptable: Optional[bool]
    calibration_acceptable: Optional[bool]
    effective_n_acceptable: Optional[bool]
    regime_stability_acceptable: Optional[bool]
    execution_assumptions_survive: Optional[bool]
    uncertainty_acceptable: Optional[bool]
    no_subgroup_collapse: Optional[bool]
    reproducible_experiment: Optional[bool]
    no_unresolved_leakage_finding: Optional[bool]
    promotion_checker_pass: Optional[bool]

    def dimensions(self) -> Dict[str, Optional[bool]]:
        return {name: getattr(self, name) for name in self.__dataclass_fields__}


@dataclass(frozen=True)
class GateResult:
    ready: bool
    unsatisfied_dimensions: List[str]
    unknown_dimensions: List[str]
    reasons: List[str]


def _evaluate(dimensions: Dict[str, Optional[bool]], gate_name: str) -> GateResult:
    unsatisfied = [name for name, value in dimensions.items() if value is False]
    unknown = [name for name, value in dimensions.items() if value is None]
    ready = not unsatisfied and not unknown

    reasons: List[str] = []
    if unsatisfied:
        reasons.append(f"{gate_name}_BLOCKED_BY_FAILED_DIMENSIONS:{','.join(sorted(unsatisfied))}")
    if unknown:
        reasons.append(f"{gate_name}_BLOCKED_BY_UNKNOWN_DIMENSIONS:{','.join(sorted(unknown))}")
    if ready:
        reasons.append(f"{gate_name}_ALL_DIMENSIONS_SATISFIED -- research recommendation only; activation remains Codex/owner authority")
    return GateResult(ready=ready, unsatisfied_dimensions=sorted(unsatisfied), unknown_dimensions=sorted(unknown), reasons=reasons)


def research_ready_for_paper(packet: ResearchEvidencePacket) -> GateResult:
    """R7. `ready=True` means only: the research evidence would support a
    first Paper order. It is never itself an authorization, and
    `PAPER_READY` remains NO until Codex/owner say otherwise."""
    return _evaluate(packet.dimensions(), "RESEARCH_READY_FOR_PAPER")


@dataclass(frozen=True)
class LiveSmallEvidencePacket:
    """R9's own dimensions -- strictly a superset concern: it requires the
    R7 research packet to already pass AND adds the Paper-era operational
    evidence that only exists after real Paper execution."""

    research_packet: ResearchEvidencePacket
    historical_pit_evidence_acceptable: Optional[bool]
    walk_forward_acceptable: Optional[bool]
    untouched_oos_acceptable: Optional[bool]
    paper_evidence_acceptable: Optional[bool]
    paper_execution_acceptable: Optional[bool]
    strategy_stability_acceptable: Optional[bool]
    operational_reliability_acceptable: Optional[bool]
    no_unresolved_reconciliation_defects: Optional[bool]
    no_unresolved_lifecycle_defects: Optional[bool]

    def own_dimensions(self) -> Dict[str, Optional[bool]]:
        return {
            name: getattr(self, name)
            for name in self.__dataclass_fields__
            if name != "research_packet"
        }


def research_eligible_for_live_small(packet: LiveSmallEvidencePacket) -> GateResult:
    """R9. Evidence status only -- Claude cannot activate live-small, and
    a `ready=True` here is a research recommendation that still requires
    Codex/owner action plus every Production gate they own."""
    combined: Dict[str, Optional[bool]] = dict(packet.research_packet.dimensions())
    combined.update(packet.own_dimensions())
    return _evaluate(combined, "RESEARCH_ELIGIBLE_FOR_LIVE_SMALL")


def unknown_packet() -> ResearchEvidencePacket:
    """The honest current state while `EV_MODEL_NOT_EMPIRICALLY_READY`:
    every empirical dimension unknown. Provided so callers never hand-
    build an all-None packet and accidentally set one field True."""
    return ResearchEvidencePacket(
        strategy_branch_supported=None, cohort_supported=None, positive_oos_ev=None,
        tail_acceptable=None, drawdown_acceptable=None, calibration_acceptable=None,
        effective_n_acceptable=None, regime_stability_acceptable=None,
        execution_assumptions_survive=None, uncertainty_acceptable=None,
        no_subgroup_collapse=None, reproducible_experiment=None,
        no_unresolved_leakage_finding=None, promotion_checker_pass=None,
    )


def unknown_live_small_packet() -> LiveSmallEvidencePacket:
    return LiveSmallEvidencePacket(
        research_packet=unknown_packet(), historical_pit_evidence_acceptable=None,
        walk_forward_acceptable=None, untouched_oos_acceptable=None, paper_evidence_acceptable=None,
        paper_execution_acceptable=None, strategy_stability_acceptable=None,
        operational_reliability_acceptable=None, no_unresolved_reconciliation_defects=None,
        no_unresolved_lifecycle_defects=None,
    )
