"""Operator-facing explainability schema (P2E directive section 20).

Answers, from already-computed evidence, never from free-form generation:
WHAT did THETA choose? WHAT ELSE was feasible? WHY did this win? WHAT DATA
was missing? WHAT time state? WHAT position path? WHAT provider facts?
WHAT was the risk of acting vs. not acting?

Structured reason codes are the SOURCE OF TRUTH; `render_explanation_text()`
is a deterministic, template-based renderer -- never an LLM call, matching
the directive's explicit "avoid generic LLM prose as the source of truth"
instruction. Every field is populated from evidence this branch's own
research modules (or Codex's P1-P2D engineering) already produce; this
module performs no new computation of its own beyond assembly and
rendering.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Sequence


class MissingDataSeverity(str, Enum):
    """Mirrors `THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md`'s section 23
    REQUIRED_UNKNOWN vs. OPTIONAL_UNKNOWN distinction -- carried here so an
    explanation can tell an operator WHICH missing fields blocked the
    decision outright vs. which merely widened its uncertainty."""

    REQUIRED_UNKNOWN = "REQUIRED_UNKNOWN"
    OPTIONAL_UNKNOWN = "OPTIONAL_UNKNOWN"


@dataclass(frozen=True)
class MissingDataItem:
    field_name: str
    severity: MissingDataSeverity
    reason: str


@dataclass(frozen=True)
class AlternativeAction:
    action: str
    feasible: bool
    reason_not_selected: Optional[str]  # None only when this alternative WAS selected (should not happen alongside `selected_action`)


@dataclass(frozen=True)
class ActionInactionRiskSummary:
    """Mirrors `THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md`'s ActionEvidence
    field spec -- both sides always populated or explicitly None, never one
    side silently assumed to be zero."""

    action_tail_risk: Optional[float]
    action_execution_cost: Optional[float]
    inaction_cost_kind: Optional[str]  # 'PROFIT_GIVEBACK_EXPOSURE' | 'MISSED_EDGE' | 'CAPITAL_LOCK' | 'NONE_APPLICABLE'
    inaction_cost_estimate: Optional[float]


@dataclass(frozen=True)
class ExplanationEvidence:
    selected_action: str
    alternatives: Sequence[AlternativeAction]
    win_reason_codes: Sequence[str]  # e.g. from a Pareto-dominance comparison -- already-computed reason codes, never invented here
    missing_data: Sequence[MissingDataItem]
    time_state: Optional[str]  # session state / DTE / event-state label, already classified upstream
    position_path_summary: Optional[str]  # e.g. "PEAK +$340, now +$120, giveback $220" -- a pre-formatted string from position_path_state_research.py's own fields, not recomputed here
    provider_facts: Sequence[str]  # e.g. "Optionomics GEX: PROVIDER_REPORTED_UNVERIFIED, -1.2B" -- already-labeled provenance strings
    risk: ActionInactionRiskSummary


@dataclass(frozen=True)
class RenderedExplanation:
    evidence: ExplanationEvidence
    text: str


_TEMPLATE_HEADER = "DECISION: {action}"
_TEMPLATE_ALTERNATIVES_NONE = "No other actions were feasible at this decision point."
_TEMPLATE_WIN_REASON_NONE = "No win-reason codes were supplied -- this decision's evidence is incomplete."
_TEMPLATE_MISSING_NONE = "No missing data."
_TEMPLATE_TIME_STATE_NONE = "Time state: UNKNOWN."
_TEMPLATE_PATH_NONE = "No open-position path history (new position or WAIT/entry decision)."
_TEMPLATE_PROVIDER_NONE = "No provider facts attached to this decision."


def render_explanation_text(evidence: ExplanationEvidence) -> RenderedExplanation:
    """Deterministic, template-based rendering -- the SAME evidence always
    produces the SAME text. Never calls a language model; every sentence
    maps to one field on `ExplanationEvidence`, so an operator (or an
    automated test) can trace every line back to a specific piece of
    already-computed evidence."""
    lines: List[str] = [_TEMPLATE_HEADER.format(action=evidence.selected_action)]

    if len(evidence.alternatives) == 0:
        lines.append(_TEMPLATE_ALTERNATIVES_NONE)
    else:
        feasible = [alt for alt in evidence.alternatives if alt.feasible]
        lines.append(f"FEASIBLE ALTERNATIVES ({len(feasible)}):")
        for alt in evidence.alternatives:
            if alt.feasible:
                reason = alt.reason_not_selected or "no reason recorded"
                lines.append(f"  - {alt.action}: feasible, not selected because {reason}")
            else:
                lines.append(f"  - {alt.action}: not feasible")

    if len(evidence.win_reason_codes) == 0:
        lines.append(_TEMPLATE_WIN_REASON_NONE)
    else:
        lines.append(f"WHY {evidence.selected_action} WON: " + "; ".join(evidence.win_reason_codes))

    if len(evidence.missing_data) == 0:
        lines.append(_TEMPLATE_MISSING_NONE)
    else:
        required = [item for item in evidence.missing_data if item.severity == MissingDataSeverity.REQUIRED_UNKNOWN]
        optional = [item for item in evidence.missing_data if item.severity == MissingDataSeverity.OPTIONAL_UNKNOWN]
        if required:
            lines.append("REQUIRED DATA MISSING (decision blocked or fail-closed on these): "
                          + "; ".join(f"{item.field_name} ({item.reason})" for item in required))
        if optional:
            lines.append("OPTIONAL DATA MISSING (uncertainty widened, decision still made): "
                          + "; ".join(f"{item.field_name} ({item.reason})" for item in optional))

    lines.append(f"TIME STATE: {evidence.time_state}" if evidence.time_state is not None else _TEMPLATE_TIME_STATE_NONE)
    lines.append(f"POSITION PATH: {evidence.position_path_summary}" if evidence.position_path_summary is not None else _TEMPLATE_PATH_NONE)

    if len(evidence.provider_facts) == 0:
        lines.append(_TEMPLATE_PROVIDER_NONE)
    else:
        lines.append("PROVIDER FACTS: " + "; ".join(evidence.provider_facts))

    risk = evidence.risk
    lines.append(
        "RISK OF ACTING: tail_risk={tail}, execution_cost={cost} | RISK OF NOT ACTING: {inaction_kind}={inaction_value}".format(
            tail="UNKNOWN" if risk.action_tail_risk is None else risk.action_tail_risk,
            cost="UNKNOWN" if risk.action_execution_cost is None else risk.action_execution_cost,
            inaction_kind=risk.inaction_cost_kind or "UNKNOWN",
            inaction_value="UNKNOWN" if risk.inaction_cost_estimate is None else risk.inaction_cost_estimate,
        )
    )

    return RenderedExplanation(evidence=evidence, text="\n".join(lines))
