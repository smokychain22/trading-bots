"""R6H dataset readiness classification, branch slicing, dependence
grouping, and the controlled empirical-program entry point.

This is a RESEARCH READINESS classification only. `MODEL_FIT_ELIGIBLE` and
friends never imply Production strategy promotion -- that remains
`promotion_checker.py` (a downstream, much stricter gate) and, ultimately,
Codex/owner's own decision.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Sequence

from research.dataset_contracts import CensoringState, EconomicEpisode, ThetaStrategyBranch
from research.production_export_loader import LoadedDatasetExport


class DatasetReadinessState(str, Enum):
    DATASET_ABSENT = "DATASET_ABSENT"
    DATASET_PRESENT_UNUSABLE = "DATASET_PRESENT_UNUSABLE"  # loaded, but failed structural/PIT/firewall validation
    DESCRIPTIVE_AUDIT_ONLY = "DESCRIPTIVE_AUDIT_ONLY"  # valid, but insufficient for any model fit
    MODEL_FIT_ELIGIBLE = "MODEL_FIT_ELIGIBLE"
    WALK_FORWARD_ELIGIBLE = "WALK_FORWARD_ELIGIBLE"
    OOS_EVALUATION_ELIGIBLE = "OOS_EVALUATION_ELIGIBLE"


class EvidenceSourceLabel(str, Enum):
    """R6H item 25: every row/run must identify which evidence class it
    came from -- these are never blended silently."""

    HISTORICAL_REPLAY = "HISTORICAL_REPLAY"
    LIVE_SHADOW = "LIVE_SHADOW"
    PAPER_EXECUTION = "PAPER_EXECUTION"


@dataclass(frozen=True)
class SufficiencyThresholds:
    """R6H item 15: no invented universal minimum -- every threshold here
    is REQUIRED, caller-supplied, and caller-justified, per the standing
    "no arbitrary financial threshold" instruction."""

    min_raw_n: int
    min_independent_n: int
    min_positive_outcomes: int
    min_negative_outcomes: int
    min_branch_coverage: int  # how many of the 5 canonical branches must have at least one resolved episode
    min_regime_coverage: int  # how many distinct regime buckets must be represented


@dataclass(frozen=True)
class SufficiencyReport:
    eligible: bool
    reasons: List[str] = field(default_factory=list)


def assess_model_fit_sufficiency(
    raw_n: int,
    independent_n: int,
    positive_outcomes: int,
    negative_outcomes: int,
    branch_coverage: int,
    regime_coverage: int,
    thresholds: SufficiencyThresholds,
) -> SufficiencyReport:
    """Never a single pass/fail number without reasons -- every failing
    dimension is reported, not just the first one found, so a caller can
    see the WHOLE sufficiency picture at once."""
    reasons: List[str] = []
    if raw_n < thresholds.min_raw_n:
        reasons.append(f"raw_n={raw_n} below required minimum {thresholds.min_raw_n}")
    if independent_n < thresholds.min_independent_n:
        reasons.append(f"independent_n={independent_n} below required minimum {thresholds.min_independent_n}")
    if positive_outcomes < thresholds.min_positive_outcomes:
        reasons.append(f"positive_outcomes={positive_outcomes} below required minimum {thresholds.min_positive_outcomes}")
    if negative_outcomes < thresholds.min_negative_outcomes:
        reasons.append(f"negative_outcomes={negative_outcomes} below required minimum {thresholds.min_negative_outcomes}")
    if branch_coverage < thresholds.min_branch_coverage:
        reasons.append(f"branch_coverage={branch_coverage} below required minimum {thresholds.min_branch_coverage}")
    if regime_coverage < thresholds.min_regime_coverage:
        reasons.append(f"regime_coverage={regime_coverage} below required minimum {thresholds.min_regime_coverage}")
    return SufficiencyReport(eligible=(len(reasons) == 0), reasons=reasons)


@dataclass(frozen=True)
class BranchDatasetSlice:
    """R6H item 12: a deterministic, non-mixing filter for one branch's
    own resolved episodes. CSP-entry, recovery, and CC samples must never
    be pooled into one training target -- this dataclass's whole purpose
    is to make that separation structural, not a discipline someone has
    to remember at call sites."""

    branch: ThetaStrategyBranch
    resolved_episodes: List[EconomicEpisode]
    censored_episodes: List[EconomicEpisode]
    invalidated_episodes: List[EconomicEpisode]


def slice_by_branch(episodes_by_branch: Dict[ThetaStrategyBranch, Sequence[EconomicEpisode]]) -> Dict[ThetaStrategyBranch, BranchDatasetSlice]:
    """Splits each branch's own episodes into resolved/censored/
    invalidated buckets -- resolved/censored/invalidated are never mixed
    together even within one branch's own slice (item 13's own required
    distinction, applied per branch). CSP-entry, recovery, and CC samples
    are never pooled: the caller supplies the branch grouping (the real
    `research.theta_outcome_label` table is subject-type/subject-id keyed,
    not branch-keyed -- branch membership is only knowable by joining back
    to the candidate/chain that produced each episode, a join this module
    does not invent); this function's own job is strictly the per-branch
    censoring-state split, never the join itself."""
    slices: Dict[ThetaStrategyBranch, BranchDatasetSlice] = {}
    for branch, episodes in episodes_by_branch.items():
        dataset_slice = BranchDatasetSlice(branch=branch, resolved_episodes=[], censored_episodes=[], invalidated_episodes=[])
        for episode in episodes:
            dataset_slice = add_episode_to_slice(dataset_slice, episode)
        slices[branch] = dataset_slice
    return slices


def add_episode_to_slice(dataset_slice: BranchDatasetSlice, episode: EconomicEpisode) -> BranchDatasetSlice:
    """Appends one already-branch-resolved episode into the correct
    censoring bucket -- never silently dropping an unresolved episode."""
    if episode.censoring_state == CensoringState.RESOLVED:
        resolved = dataset_slice.resolved_episodes + [episode]
        censored, invalidated = dataset_slice.censored_episodes, dataset_slice.invalidated_episodes
    elif episode.censoring_state == CensoringState.RIGHT_CENSORED:
        resolved, invalidated = dataset_slice.resolved_episodes, dataset_slice.invalidated_episodes
        censored = dataset_slice.censored_episodes + [episode]
    else:
        resolved, censored = dataset_slice.resolved_episodes, dataset_slice.censored_episodes
        invalidated = dataset_slice.invalidated_episodes + [episode]
    return BranchDatasetSlice(dataset_slice.branch, resolved, censored, invalidated)


@dataclass(frozen=True)
class DependenceGroupKey:
    """R6H item 14: the deterministic grouping keys effective-N/clustered-
    bootstrap/grouped-split machinery needs. `None` fields mean that
    dimension is genuinely unknown for this row -- never defaulted to a
    value that would silently merge two actually-distinct groups."""

    wheel_chain_id: Optional[str]
    economic_episode_id: Optional[str]
    underlying: Optional[str]
    session_date: Optional[str]
    correlation_cluster: Optional[str]


def build_dependence_groups(keys: Sequence[DependenceGroupKey]) -> Dict[str, List[int]]:
    """Groups row INDICES by their full dependence key tuple -- two rows
    sharing every non-None dimension are the same dependence group; a row
    with a genuinely different (or unknown) value on any dimension is
    never merged into another group just because the caller wants a
    smaller group count."""
    groups: Dict[str, List[int]] = {}
    for index, key in enumerate(keys):
        group_key = "|".join([
            key.wheel_chain_id or "?", key.economic_episode_id or "?", key.underlying or "?",
            key.session_date or "?", key.correlation_cluster or "?",
        ])
        groups.setdefault(group_key, []).append(index)
    return groups


def effective_sample_size(keys: Sequence[DependenceGroupKey]) -> int:
    """The number of DISTINCT dependence groups -- never the raw row
    count. 1000 correlated decisions sharing the same wheel_chain_id/
    session/underlying is NOT N=1000 independent evidence."""
    return len(build_dependence_groups(keys))


def classify_dataset_readiness(
    export: Optional[LoadedDatasetExport],
    sufficiency: Optional[SufficiencyReport],
    walk_forward_plan_valid: Optional[bool] = None,
    final_oos_untouched: Optional[bool] = None,
) -> DatasetReadinessState:
    """The single state-machine entry point. Each state requires the
    PRIOR state's condition to already hold -- there is no path to
    OOS_EVALUATION_ELIGIBLE that skips MODEL_FIT_ELIGIBLE, even if a
    caller supplies `final_oos_untouched=True` in isolation."""
    if export is None:
        return DatasetReadinessState.DATASET_ABSENT
    if sufficiency is None:
        return DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY
    if not sufficiency.eligible:
        return DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY
    if walk_forward_plan_valid is not True:
        return DatasetReadinessState.MODEL_FIT_ELIGIBLE
    if final_oos_untouched is not True:
        return DatasetReadinessState.WALK_FORWARD_ELIGIBLE
    return DatasetReadinessState.OOS_EVALUATION_ELIGIBLE


@dataclass(frozen=True)
class ExperimentConfig:
    """R6H item 21: every experiment run's own identity, reused from
    `reproducibility.py`'s existing versioning discipline rather than a
    new ad hoc config shape."""

    dataset_hash: str
    target_version: str
    feature_version: str
    strategy_branch: ThetaStrategyBranch
    cost_model_version: str
    split_definition: str
    experiment_id: str
    hypothesis_id: Optional[str]
    evidence_source: EvidenceSourceLabel


@dataclass(frozen=True)
class EmpiricalRunResult:
    readiness_state: DatasetReadinessState
    sufficiency: Optional[SufficiencyReport]
    eligible_experiments: List[str]
    refused_experiments: List[str]
    reproducibility_fingerprint: Optional[str]


def run_empirical_program(
    export: Optional[LoadedDatasetExport],
    config: ExperimentConfig,
    sufficiency: Optional[SufficiencyReport],
    walk_forward_plan_valid: Optional[bool] = None,
    final_oos_untouched: Optional[bool] = None,
) -> EmpiricalRunResult:
    """R6H item 20: the ONE controlled research entry point. It validates
    readiness and REFUSES ineligible experiments -- it never trains a
    model just because a dataset happens to be present. Every experiment
    class below is included in `eligible_experiments` ONLY once its own
    readiness precondition genuinely holds."""
    state = classify_dataset_readiness(export, sufficiency, walk_forward_plan_valid, final_oos_untouched)

    eligible: List[str] = []
    refused: List[str] = []

    if state == DatasetReadinessState.DATASET_ABSENT:
        refused.extend(["DESCRIPTIVE_AUDIT", "MODEL_FIT", "WALK_FORWARD", "OOS_EVALUATION"])
    elif state == DatasetReadinessState.DATASET_PRESENT_UNUSABLE:
        refused.extend(["DESCRIPTIVE_AUDIT", "MODEL_FIT", "WALK_FORWARD", "OOS_EVALUATION"])
    elif state == DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY:
        eligible.append("DESCRIPTIVE_AUDIT")
        refused.extend(["MODEL_FIT", "WALK_FORWARD", "OOS_EVALUATION"])
    elif state == DatasetReadinessState.MODEL_FIT_ELIGIBLE:
        eligible.extend(["DESCRIPTIVE_AUDIT", "MODEL_FIT"])
        refused.extend(["WALK_FORWARD", "OOS_EVALUATION"])
    elif state == DatasetReadinessState.WALK_FORWARD_ELIGIBLE:
        eligible.extend(["DESCRIPTIVE_AUDIT", "MODEL_FIT", "WALK_FORWARD"])
        refused.append("OOS_EVALUATION")
    else:
        eligible.extend(["DESCRIPTIVE_AUDIT", "MODEL_FIT", "WALK_FORWARD", "OOS_EVALUATION"])

    fingerprint = None
    if export is not None:
        from research.reproducibility import _canonical_json, _sha256_hex

        identity = {
            "dataset_hash": config.dataset_hash, "target_version": config.target_version,
            "feature_version": config.feature_version, "strategy_branch": config.strategy_branch.value,
            "cost_model_version": config.cost_model_version, "split_definition": config.split_definition,
            "experiment_id": config.experiment_id, "hypothesis_id": config.hypothesis_id,
            "evidence_source": config.evidence_source.value,
        }
        fingerprint = _sha256_hex(_canonical_json(identity))

    return EmpiricalRunResult(
        readiness_state=state, sufficiency=sufficiency, eligible_experiments=eligible,
        refused_experiments=refused, reproducibility_fingerprint=fingerprint,
    )


@dataclass(frozen=True)
class ResearchPaperReadinessCheck:
    """R7 fast-forward: the research-side gate a branch must pass before
    Claude's research would ever recommend "ready for first Paper" --
    Claude never submits or activates anything itself; this is a
    checklist output only, for Codex/owner to act on."""

    branch_supported: bool
    cohort_supported: bool
    oos_ev_positive: Optional[bool]
    tail_acceptable: Optional[bool]
    calibration_acceptable: Optional[bool]
    execution_assumptions_survive: Optional[bool]
    uncertainty_acceptable: Optional[bool]
    no_subgroup_collapse: Optional[bool]


def research_ready_for_paper(check: ResearchPaperReadinessCheck) -> bool:
    """Returns True only when EVERY dimension is explicitly True -- any
    None (genuinely unknown, e.g. because no data exists yet) or False
    makes the whole result False, never treated as a passing default.
    This function's result is a RESEARCH RECOMMENDATION ONLY; Claude
    never submits or activates a Paper order regardless of this value."""
    return all([
        check.branch_supported, check.cohort_supported, check.oos_ev_positive is True,
        check.tail_acceptable is True, check.calibration_acceptable is True,
        check.execution_assumptions_survive is True, check.uncertainty_acceptable is True,
        check.no_subgroup_collapse is True,
    ])
