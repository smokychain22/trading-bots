"""Machine-readable research phase-completion manifest.

Exists so a future session knows what is FINISHED and never re-derives,
re-audits, or rebuilds it. Every entry names the module/test that makes
the claim checkable -- a `COMPLETE` entry whose module does not exist is
a bug this file's own test suite catches.

`BLOCKED_ON_DATA` entries name the exact missing evidence, never a vague
"needs more work". Nothing here grants execution authority: Codex owns
canonical main, Production, migrations, Neon, worker activation,
execution gates, and broker submission.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Tuple


class PhaseState(str, Enum):
    COMPLETE = "COMPLETE"  # built, tested, and not to be rebuilt
    PARTIAL = "PARTIAL"  # genuinely unfinished -- MUST carry an exact remaining blocker
    BLOCKED_ON_DATA = "BLOCKED_ON_DATA"  # machinery ready; only real evidence is missing
    SUPERSEDED = "SUPERSEDED"  # replaced by a canonical Production contract; never rebuild


@dataclass(frozen=True)
class PhaseItem:
    key: str
    state: PhaseState
    modules: Tuple[str, ...]  # research modules that implement/prove the claim
    blocker: Optional[str] = None  # REQUIRED for PARTIAL and BLOCKED_ON_DATA, forbidden otherwise
    note: Optional[str] = None


_ITEMS: Tuple[PhaseItem, ...] = (
    # ---- R6 research engineering: finished, do not rebuild ----
    PhaseItem("R6_DATASET_CONTRACTS", PhaseState.COMPLETE, ("dataset_contracts.py",),
              note="Mirrors migration 018 field-for-field; migration 019 additive-only, parity re-verified."),
    PhaseItem("R6_EXPORT_LOADER", PhaseState.COMPLETE, ("production_export_loader.py",),
              note="Fail-closed intake: schema version, dataset hash, ordering, duplicate identity, enums, PIT order, crossed BBO."),
    PhaseItem("R6_PIT_FIREWALL", PhaseState.COMPLETE, ("production_export_loader.py", "point_in_time_join.py"),
              note="Recursive future-label firewall; key set unioned with Codex's own forbiddenFeatureKeys."),
    PhaseItem("R6_TARGETS", PhaseState.COMPLETE, ("research_targets.py",),
              note="Frozen under TARGET_DEFINITION_VERSION; no premium-only label exists."),
    PhaseItem("R6_DEPENDENCE", PhaseState.COMPLETE, ("dataset_readiness.py", "correlation_metrics.py", "regime_report.py"),
              note="effective_sample_size over explicit dependence-group keys."),
    PhaseItem("R6_READINESS_ENGINE", PhaseState.COMPLETE, ("dataset_readiness.py",),
              note="Six-state cumulative machine; no stage can be skipped."),
    PhaseItem("R6_EXPERIMENT_DEFINITIONS", PhaseState.COMPLETE, ("experiment_registry.py", "ablation.py", "management_policy.py"),
              note="Machine-readable experiment/ablation/policy family registry."),
    PhaseItem("R6_PROMOTION_CONTRACT", PhaseState.COMPLETE, ("promotion_checker.py", "champion_challenger.py"),
              note="Six failure classes plus PROMOTION_ELIGIBLE_RESEARCH ceiling."),
    PhaseItem("R6_AUTO_PIPELINE", PhaseState.COMPLETE, ("empirical_pipeline.py",),
              note="One entry point plus a thin `python -m research.empirical_pipeline` CLI: load -> audit -> readiness -> eligible experiments -> artifacts."),
    PhaseItem("R6_WALK_FORWARD_ENGINE", PhaseState.COMPLETE, ("walk_forward.py",),
              note="Purge/embargo/label-availability/chain-grouping all implemented and tested."),
    PhaseItem("R6_SELECTION_BIAS", PhaseState.COMPLETE, ("selection_bias.py",),
              note="DSR (sigma-scaled) and PBO (average-rank tie handling) both repaired and fixture-tested."),

    # ---- R6 empirical evidence: only real data is missing ----
    PhaseItem("R6_REAL_PIT_DATA", PhaseState.BLOCKED_ON_DATA, ("empirical_pipeline.py",),
              blocker="No Production dataset export exists. Codex handoff 2026-09-12: zero point-in-time rows, zero shadow candidates, zero resolved labels, zero subsequent quote observations."),
    PhaseItem("R6_MODEL_FIT", PhaseState.BLOCKED_ON_DATA, ("empirical_pipeline.py", "baseline_models.py"),
              blocker="Requires MODEL_FIT_ELIGIBLE readiness, which requires resolved labels that do not exist."),
    PhaseItem("R6_WALK_FORWARD", PhaseState.BLOCKED_ON_DATA, ("walk_forward.py",),
              blocker="Requires resolved chains spanning enough sessions to build folds."),
    PhaseItem("R6_OOS", PhaseState.BLOCKED_ON_DATA, ("walk_forward.py", "promotion_checker.py"),
              blocker="Requires a walk-forward plan plus a reserved untouched final segment."),
    PhaseItem("R6_CALIBRATION_EMPIRICAL", PhaseState.BLOCKED_ON_DATA, ("calibration_metrics.py",),
              blocker="Requires predicted probabilities paired with realized binary outcomes."),
    PhaseItem("R6_GATE_REGRET", PhaseState.BLOCKED_ON_DATA, ("strategy_routing_shadow.py",),
              blocker="Requires defensible counterfactual fill semantics plus resolved outcomes for soft-rejected candidates."),
    PhaseItem("R6_ACTION_REGRET", PhaseState.BLOCKED_ON_DATA, ("strategy_routing_shadow.py",),
              blocker="Counterfactual management paths branch; requires a defensible branching methodology plus resolved alternative outcomes."),

    # ---- Fast-forward research phases ----
    PhaseItem("R3_QUANT", PhaseState.COMPLETE, ("account_risk_capacity.py",),
              note="Per-account isolated capacities, min-of-capacities quantity, isolation violations, exit check."),
    PhaseItem("R4_QUANT", PhaseState.COMPLETE, ("follower_copy_economics.py",),
              note="Follower sizing from own capacity only, copyability decisions, lifecycle eligibility, roll leg independence, degradation metrics, master-fill-first confirmation, DIRECTION-AWARE credit/debit price deterioration (Codex-identified defect, repaired), exit check."),
    PhaseItem("R5_QUANT", PhaseState.COMPLETE, ("quant_explanation_contracts.py",),
              note="Candidate/position/strategy/performance explanations, uncalibrated-probability guard, decision-field consistency validation, exit check."),
    PhaseItem("R7_RESEARCH_GATE", PhaseState.COMPLETE, ("research_evidence_packet.py",),
              note="Fourteen-dimension all-True packet; any False or None blocks readiness."),
    PhaseItem("R8_ANALYTICS", PhaseState.COMPLETE, ("paper_validation_analytics.py",),
              note="Paper-only summary contract, operational incident tally, stability recommendation."),
    PhaseItem("R9_RESEARCH_GATE", PhaseState.COMPLETE, ("research_evidence_packet.py",),
              note="Live-small research evidence gate; recommendation only, never an activation."),

    # ---- Superseded by canonical Production contracts ----
    PhaseItem("RESEARCH_STRATEGY_REGISTRY", PhaseState.SUPERSEDED, ("strategy_config.py",),
              note="src/theta/strategy-package.ts is the canonical strategy-version/config authority; do not extend the research copy."),
    PhaseItem("RESEARCH_FEATURE_TAXONOMY", PhaseState.SUPERSEDED, ("feature_taxonomy.py",),
              note="Codex's TypeScript hard/soft evidence contract owns runtime classification; the Python taxonomy stays research-only."),
    PhaseItem("NARROW_PAPER_READINESS_PRECHECK", PhaseState.SUPERSEDED, ("research_evidence_packet.py",),
              note="REMOVED from dataset_readiness.py (Codex removed the same helper on canonical main, 115285b). research_evidence_packet.research_ready_for_paper (14 dimensions) is now the ONLY R7 entry point; do not reintroduce an 8-dimension subset."),
)

PHASE_STATUS: Dict[str, PhaseItem] = {item.key: item for item in _ITEMS}


def get(key: str) -> Optional[PhaseItem]:
    return PHASE_STATUS.get(key)


def items_in_state(state: PhaseState) -> List[PhaseItem]:
    return [item for item in _ITEMS if item.state == state]


def blockers() -> Dict[str, str]:
    """Every currently-blocking item mapped to its exact blocker text --
    the single place a future session reads to learn what is genuinely
    left, without re-deriving it from commit history."""
    return {item.key: item.blocker for item in _ITEMS if item.blocker is not None}


def validate_manifest() -> List[str]:
    """Structural self-check: PARTIAL/BLOCKED_ON_DATA must carry a
    blocker; COMPLETE/SUPERSEDED must not; every item must name at least
    one module. Returns violations (empty = valid)."""
    violations: List[str] = []
    for item in _ITEMS:
        requires_blocker = item.state in (PhaseState.PARTIAL, PhaseState.BLOCKED_ON_DATA)
        if requires_blocker and not item.blocker:
            violations.append(f"{item.key}: {item.state.value} requires an exact blocker")
        if not requires_blocker and item.blocker:
            violations.append(f"{item.key}: {item.state.value} must not carry a blocker")
        if not item.modules:
            violations.append(f"{item.key}: no implementing module named")
    return violations
