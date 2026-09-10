"""Loads and validates the THETA Strategy DNA research registry: strategy
archetypes, feature families, benchmarks, hypotheses, and experiments.

Uses only the Python standard library and paths relative to this file. Reads
the expert-priors data files directly (by relative path) rather than
importing bots.theta.quant.expert_priors.loader, so this module has no
dependency on how the eventual Python package/build tooling (Phase 0,
Codex-owned) wires up imports across bots/theta/quant/'s subpackages.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

_RESEARCH_DATA_DIR = Path(__file__).resolve().parent / "data"
_EXPERT_PRIORS_DATA_DIR = (
    Path(__file__).resolve().parent.parent / "expert_priors" / "data"
)

CANDIDATE_ACTIONS = {
    "WAIT",
    "OPEN_CSP",
    "HOLD",
    "CLOSE",
    "ROLL",
    "ASSIGN",
    "EXPIRE",
    "RECOVERY_WAIT",
    "SELL_CC",
    "CLOSE_STOCK",
    "CALL_AWAY",
    "REDEPLOY",
}
EVIDENCE_STATES = {"OBSERVED", "RECONSTRUCTED", "INFERRED", "UNKNOWN"}
HYPOTHESIS_STATUSES = {"RETAIN", "CORRECT", "TEST", "REJECT"}
HYPOTHESIS_TYPES = {"trading", "measurement"}
LABEL_TYPES = {
    "entry_label",
    "assignment_label",
    "management_label",
    "roll_label",
    "cc_label",
    "recovery_label",
    "execution_label",
    "N/A_MEASUREMENT",
}
REQUIRED_HYPOTHESIS_FIELDS = (
    "mechanism",
    "state",
    "alternatives",
    "label_type",
    "label_definition",
    "payoff_target",
    "failure_mode",
    "calibration_requirement",
    "evidence_requirement",
    "acceptance_criterion",
    "rejection_criterion",
)


class ResearchRegistryError(ValueError):
    """Raised when the research registry data files fail structural or
    cross-reference validation."""


def _load_json(directory: Path, filename: str) -> dict:
    return json.loads((directory / filename).read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Hypothesis:
    hypothesis_id: str
    archetype_id: str
    hypothesis_type: str
    statement: str
    candidate_actions: List[str]
    feature_families_required: List[str]
    status: str
    experiment_id: Optional[str]
    contradicts: List[str]


def load_expert_source_ids() -> Set[str]:
    """Just the set of known expert_source_id values, read directly from
    expert_sources.json without importing the expert_priors package."""
    raw = _load_json(_EXPERT_PRIORS_DATA_DIR, "expert_sources.json")
    return {e["expert_source_id"] for e in raw["experts"]}


def load_archetype_ids() -> Set[str]:
    raw = _load_json(_RESEARCH_DATA_DIR, "strategy_archetypes.json")
    return {a["archetype_id"] for a in raw["archetypes"]}


def load_feature_family_ids() -> Set[str]:
    raw = _load_json(_RESEARCH_DATA_DIR, "feature_families.json")
    return {f["feature_family_id"] for f in raw["features"]}


def load_benchmark_ids() -> Set[str]:
    raw = _load_json(_RESEARCH_DATA_DIR, "benchmarks.json")
    return {b["id"] for b in raw["canonical_trd_benchmarks"]} | {
        b["id"] for b in raw["archetype_specific_benchmarks"]
    }


def load_hypotheses() -> List[Hypothesis]:
    raw = _load_json(_RESEARCH_DATA_DIR, "hypotheses.json")
    return [
        Hypothesis(
            hypothesis_id=h["hypothesis_id"],
            archetype_id=h["archetype_id"],
            hypothesis_type=h["hypothesis_type"],
            statement=h["statement"],
            candidate_actions=list(h.get("candidate_actions", [])),
            feature_families_required=list(h.get("feature_families_required", [])),
            status=h["status"],
            experiment_id=h.get("experiment_id"),
            contradicts=list(h.get("contradicts", [])),
        )
        for h in raw["hypotheses"]
    ]


def load_hypotheses_raw() -> List[dict]:
    """The full hypothesis objects (all fields), for callers that need more
    than the :class:`Hypothesis` dataclass's subset -- e.g. rationale,
    source_experts, baseline/null/ablation refs."""
    return _load_json(_RESEARCH_DATA_DIR, "hypotheses.json")["hypotheses"]


def load_experiment_ids() -> Set[str]:
    raw = _load_json(_RESEARCH_DATA_DIR, "experiments.json")
    return {e["experiment_id"] for e in raw["experiments"]}


def validate_registry() -> None:
    """Runs every cross-reference check described in
    bots/theta/tests/quant/test_research_registry.py, raising
    ResearchRegistryError on the first violation found. Intended for use in
    CI and as a pre-flight check before anything downstream (a backtester,
    a model pipeline) consumes this registry.
    """
    expert_ids = load_expert_source_ids()
    archetype_ids = load_archetype_ids()
    feature_ids = load_feature_family_ids()
    benchmark_ids = load_benchmark_ids()
    experiment_ids = load_experiment_ids()
    hypotheses_raw = load_hypotheses_raw()
    hypothesis_ids = {h["hypothesis_id"] for h in hypotheses_raw}

    archetypes_with_hypotheses: Set[str] = set()

    for h in hypotheses_raw:
        hid = h["hypothesis_id"]

        if h["archetype_id"] not in archetype_ids:
            raise ResearchRegistryError(f"{hid}: unknown archetype_id {h['archetype_id']!r}")
        archetypes_with_hypotheses.add(h["archetype_id"])

        if h["hypothesis_type"] not in HYPOTHESIS_TYPES:
            raise ResearchRegistryError(f"{hid}: invalid hypothesis_type {h['hypothesis_type']!r}")

        if h["status"] not in HYPOTHESIS_STATUSES:
            raise ResearchRegistryError(f"{hid}: invalid status {h['status']!r}")

        for field in REQUIRED_HYPOTHESIS_FIELDS:
            if field not in h:
                raise ResearchRegistryError(f"{hid}: missing required field {field!r}")

        if h["label_type"] not in LABEL_TYPES:
            raise ResearchRegistryError(f"{hid}: invalid label_type {h['label_type']!r}")

        for se in h.get("source_experts", []):
            if se["expert_source_id"] not in expert_ids:
                raise ResearchRegistryError(
                    f"{hid}: unknown expert_source_id {se['expert_source_id']!r}"
                )
            if se["evidence_state"] not in EVIDENCE_STATES:
                raise ResearchRegistryError(
                    f"{hid}: invalid evidence_state {se['evidence_state']!r}"
                )

        for ca in h.get("candidate_actions", []):
            if ca not in CANDIDATE_ACTIONS:
                raise ResearchRegistryError(f"{hid}: invalid candidate_action {ca!r}")

        for ff in h.get("feature_families_required", []):
            if ff not in feature_ids:
                raise ResearchRegistryError(f"{hid}: unknown feature_family_id {ff!r}")

        for ref_field in ("baseline_ref", "null_ref", "ablation_ref"):
            ref = h.get(ref_field)
            if ref is not None and ref not in benchmark_ids:
                raise ResearchRegistryError(f"{hid}: unknown {ref_field} {ref!r}")

        experiment_id = h.get("experiment_id")
        if experiment_id is not None and experiment_id not in experiment_ids:
            raise ResearchRegistryError(f"{hid}: unknown experiment_id {experiment_id!r}")

        for c in h.get("contradicts", []):
            if c not in hypothesis_ids:
                raise ResearchRegistryError(f"{hid}: contradicts unknown hypothesis {c!r}")
            other = next((x for x in hypotheses_raw if x["hypothesis_id"] == c), None)
            if other is not None and hid not in other.get("contradicts", []):
                raise ResearchRegistryError(
                    f"{hid} contradicts {c} but {c} does not list {hid} back "
                    f"(asymmetric contradiction)"
                )

        for g in h.get("guards_against", []):
            if g not in hypothesis_ids:
                raise ResearchRegistryError(f"{hid}: guards_against unknown hypothesis {g!r}")

    missing_coverage = archetype_ids - archetypes_with_hypotheses
    if missing_coverage:
        raise ResearchRegistryError(
            f"archetypes with zero hypotheses (coverage gap): {sorted(missing_coverage)}"
        )

    # experiments.json -> hypotheses.json back-reference
    experiments_raw = _load_json(_RESEARCH_DATA_DIR, "experiments.json")["experiments"]
    for e in experiments_raw:
        for hid in e["hypothesis_ids"]:
            if hid not in hypothesis_ids:
                raise ResearchRegistryError(
                    f"experiment {e['experiment_id']}: unknown hypothesis_id {hid!r}"
                )
