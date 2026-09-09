"""Loads and validates the Expert Strategy DNA data files.

Uses only the Python standard library and paths relative to this file, so it
does not depend on however the eventual Python package/build tooling (Phase 0,
Codex-owned) ends up configuring imports -- these JSON files are read
directly, not through a package import of this module from elsewhere.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

_DATA_DIR = Path(__file__).resolve().parent / "data"

EVIDENCE_STATES = {"OBSERVED", "RECONSTRUCTED", "INFERRED", "UNKNOWN"}
EVIDENCE_CLASSES = {
    "A_LIVE_OOS",
    "B_INSTITUTIONAL",
    "C_UNTOUCHED_OOS",
    "D_EXPERT_DNA",
    "E_ENGINEERING",
    "F_MARKETING",
}


class ExpertPriorDataError(ValueError):
    """Raised when the expert-priors data files fail structural validation."""


@dataclass(frozen=True)
class ExpertSource:
    expert_source_id: str
    name: str
    evidence_class: str
    evidence_state: str
    posture_quote: str
    source_ref: str
    status: str
    borrowed_prior: str
    do_not_assume: str
    is_failure_dna: bool
    is_failure_study: bool


@dataclass(frozen=True)
class ExpertArchetypeMapping:
    expert_source_id: str
    archetype_ids: List[str]
    note: str


def load_expert_sources() -> Dict[str, ExpertSource]:
    """Loads expert_sources.json, keyed by expert_source_id. Raises
    ExpertPriorDataError if any entry uses an evidence_state/evidence_class
    outside the canonical enums, or if expert_source_id is duplicated.
    """
    raw = json.loads((_DATA_DIR / "expert_sources.json").read_text(encoding="utf-8"))
    result: Dict[str, ExpertSource] = {}
    for entry in raw["experts"]:
        eid = entry["expert_source_id"]
        if eid in result:
            raise ExpertPriorDataError(f"duplicate expert_source_id: {eid}")
        if entry["evidence_state"] not in EVIDENCE_STATES:
            raise ExpertPriorDataError(
                f"{eid}: invalid evidence_state {entry['evidence_state']!r}"
            )
        if entry["evidence_class"] not in EVIDENCE_CLASSES:
            raise ExpertPriorDataError(
                f"{eid}: invalid evidence_class {entry['evidence_class']!r}"
            )
        result[eid] = ExpertSource(
            expert_source_id=eid,
            name=entry["name"],
            evidence_class=entry["evidence_class"],
            evidence_state=entry["evidence_state"],
            posture_quote=entry["posture_quote"],
            source_ref=entry["source_ref"],
            status=entry["status"],
            borrowed_prior=entry["borrowed_prior"],
            do_not_assume=entry["do_not_assume"],
            is_failure_dna=entry["is_failure_dna"],
            is_failure_study=entry["is_failure_study"],
        )
    return result


def load_expert_archetype_map() -> List[ExpertArchetypeMapping]:
    """Loads expert_archetype_map.json as a list of mappings, in file order."""
    raw = json.loads((_DATA_DIR / "expert_archetype_map.json").read_text(encoding="utf-8"))
    return [
        ExpertArchetypeMapping(
            expert_source_id=m["expert_source_id"],
            archetype_ids=list(m["archetype_ids"]),
            note=m["note"],
        )
        for m in raw["mappings"]
    ]


def validate_cross_references(
    experts: Dict[str, ExpertSource],
    mappings: List[ExpertArchetypeMapping],
    known_archetype_ids: set,
) -> None:
    """Validates that every mapping references a real expert and a real
    archetype, and that every expert appears in at least one mapping.
    ``known_archetype_ids`` is supplied by the caller (bots/theta/quant/
    research/registry.py) rather than imported directly, keeping this module
    self-contained regardless of package layout.
    """
    mapped_experts = set()
    for m in mappings:
        if m.expert_source_id not in experts:
            raise ExpertPriorDataError(
                f"expert_archetype_map.json references unknown expert "
                f"{m.expert_source_id!r}"
            )
        for a in m.archetype_ids:
            if a not in known_archetype_ids:
                raise ExpertPriorDataError(
                    f"expert_archetype_map.json: expert {m.expert_source_id!r} "
                    f"references unknown archetype {a!r}"
                )
        mapped_experts.add(m.expert_source_id)

    missing = set(experts) - mapped_experts
    if missing:
        raise ExpertPriorDataError(
            f"experts with no archetype mapping at all: {sorted(missing)}"
        )
