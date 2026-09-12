"""R6H research dataset record contracts.

Rewritten this phase to ADAPT to Codex's now-real, migrated Production
schema (`migrations/018_point_in_time_evidence_pipeline.sql`,
`src/research/point-in-time-evidence.ts`,
`src/research/postgres-dataset-export.ts`) rather than maintain a parallel
schema invented in R6G before that Production contract existed. Field
names, enum values, and hashing convention below are a DIRECT mirror of
the real tables (`trade.candidate_set_evidence`,
`trade.candidate_point_in_time_evidence`, `trade.global_wait_evidence`,
`market.execution_quote_observation`, `research.theta_outcome_label`,
`research.theta_dataset_export`) -- see
`docs/research/R6H_PRODUCTION_RESEARCH_SCHEMA_PARITY.md` for the full
field-by-field comparison and the one genuine mismatch found
(`REQUIRED_CODEX_CONTRACT_CHANGE`, documented there, not silently
worked around here).

R6G's separate `SelectedCandidate` type is REMOVED here: Production embeds
selection identity directly in `candidate_set_evidence`
(best_candidate_id/second_best_candidate_id/best_rejected_candidate_id)
and in each candidate's own `selected` boolean -- a standalone
"SelectedCandidate" record would be a parallel, redundant schema.
`ManagementActionValue`/`ManagementActionSet` are UNCHANGED from R6G
(Production's own `management_action_frontier` table is a separate,
1:1-joined table by `management_input_snapshot_id`, the same relationship
R6G's design already used).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, Tuple


class ThetaStrategyBranch(str, Enum):
    """Mirrors `strategy-package.ts`'s `thetaStrategyBranch` enum exactly."""

    THETA_CONVENTIONAL = "THETA_CONVENTIONAL"
    THETA_HOLD_STRIKE = "THETA_HOLD_STRIKE"
    THETA_RECOVERY = "THETA_RECOVERY"
    THETA_CC = "THETA_CC"
    THETA_DEFINED_RISK = "THETA_DEFINED_RISK"


class ThetaStrategyAction(str, Enum):
    """Mirrors `strategy-package.ts`'s `thetaStrategyAction` enum exactly."""

    OPEN_CSP = "OPEN_CSP"
    OPEN_DEFINED_RISK = "OPEN_DEFINED_RISK"
    HOLD = "HOLD"
    CLOSE_FULL = "CLOSE_FULL"
    ROLL = "ROLL"
    LET_EXPIRE = "LET_EXPIRE"
    ACCEPT_ASSIGNMENT = "ACCEPT_ASSIGNMENT"
    REDEPLOY = "REDEPLOY"
    RECOVERY_WAIT = "RECOVERY_WAIT"
    SELL_STOCK = "SELL_STOCK"
    SELL_CC = "SELL_CC"
    HOLD_CC = "HOLD_CC"
    CLOSE_CC = "CLOSE_CC"
    ROLL_CC = "ROLL_CC"
    ALLOW_CALL_AWAY = "ALLOW_CALL_AWAY"
    WAIT = "WAIT"
    PASS = "PASS"


class HardStatus(str, Enum):
    """Mirrors `trade.candidate_point_in_time_evidence.hard_status`'s CHECK constraint exactly."""

    FEASIBLE = "FEASIBLE"
    HARD_VETO = "HARD_VETO"
    INVALID = "INVALID"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


class SoftStatus(str, Enum):
    """Mirrors `trade.candidate_point_in_time_evidence.soft_status`'s CHECK constraint exactly."""

    RANKED = "RANKED"
    REJECTED = "REJECTED"
    UNKNOWN = "UNKNOWN"


class CompletenessState(str, Enum):
    """Mirrors `trade.candidate_set_evidence.completeness_state`'s CHECK constraint exactly."""

    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    UNKNOWN = "UNKNOWN"


class DataQuality(str, Enum):
    """Mirrors `market.execution_quote_observation.data_quality`'s CHECK constraint exactly."""

    GOOD = "GOOD"
    DEGRADED = "DEGRADED"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"
    INVALID = "INVALID"
    NOT_ENTITLED = "NOT_ENTITLED"


class ObservationRole(str, Enum):
    """Mirrors `market.execution_quote_observation.observation_role`'s CHECK constraint exactly."""

    DECISION = "DECISION"
    SUBSEQUENT = "SUBSEQUENT"
    BROKER_FILL = "BROKER_FILL"


class CensoringState(str, Enum):
    """Mirrors `research.theta_outcome_label.censoring_state`'s CHECK constraint exactly.
    R6G's looser `resolved: bool` on `EconomicEpisode` is replaced by this
    3-way state -- a boolean cannot represent the genuine RIGHT_CENSORED
    (still open, not yet resolvable, distinct from INVALIDATED) case."""

    RESOLVED = "RESOLVED"
    RIGHT_CENSORED = "RIGHT_CENSORED"
    INVALIDATED = "INVALIDATED"


class SubjectType(str, Enum):
    """Mirrors `research.theta_outcome_label.subject_type`'s CHECK constraint exactly."""

    CANDIDATE = "CANDIDATE"
    MANAGED_EPISODE = "MANAGED_EPISODE"
    WHOLE_CHAIN = "WHOLE_CHAIN"
    EXECUTION = "EXECUTION"


@dataclass(frozen=True)
class ProviderProvenance:
    """Mirrors `point-in-time-evidence.ts`'s `providerProvenanceSchema` exactly:
    source, operationAlias, providerTimestamp (nullable), ingestionTimestamp,
    asOf, version, state. The TS schema's own invariant
    (`providerTimestamp <= asOf`, `ingestionTimestamp >= asOf`) is
    re-verified here (see `production_export_loader.py`), not just
    assumed true because the row came from Production."""

    source: str
    operation_alias: str
    provider_timestamp: Optional[str]
    ingestion_timestamp: str
    as_of: str
    version: str
    state: DataQuality


@dataclass(frozen=True)
class StrategyLineage:
    """Mirrors `point-in-time-evidence.ts`'s `strategyLineageSchema` exactly."""

    strategy_version: str
    risk_version: str
    feature_version: str
    cost_model_version: str
    regime_version: str
    execution_model_version: str


@dataclass(frozen=True)
class Candidate:
    """Mirrors `trade.candidate_point_in_time_evidence` exactly. The 12 JSON
    feature-family blobs (contract/market/volatility/technical/event/flow/
    ownership/account/portfolio/aegis/execution/known_economics) are kept
    as opaque `Dict[str, Any]` here -- this module does not redefine their
    internal shape, only validates (via `production_export_loader.py`)
    that none of them contains a forbidden future-label key."""

    candidate_id: str
    decision_id: Optional[str]
    fusion_snapshot_id: str
    decision_time: str
    branch: ThetaStrategyBranch
    rank_at_decision: Optional[int]
    selected: bool
    hard_status: HardStatus
    soft_status: SoftStatus
    rejection_reason: Optional[str]
    contract: Dict[str, Any]
    market: Dict[str, Any]
    volatility: Dict[str, Any]
    technical: Dict[str, Any]
    event: Dict[str, Any]
    flow: Dict[str, Any]
    ownership: Dict[str, Any]
    account: Dict[str, Any]
    portfolio: Dict[str, Any]
    aegis: Dict[str, Any]
    execution: Dict[str, Any]
    known_economics: Dict[str, Any]
    unknown_economics: Tuple[str, ...]
    hard_blockers: Tuple[str, ...]
    soft_evidence: Tuple[Any, ...]
    provider_provenance: Tuple[ProviderProvenance, ...]
    lineage: StrategyLineage
    content_hash: str


@dataclass(frozen=True)
class CandidateSet:
    """Mirrors `trade.candidate_set_evidence` exactly -- selection identity
    (best/second-best/best-rejected) lives HERE, not in a separate
    SelectedCandidate record (R6G's design point removed this phase)."""

    candidate_set_id: str
    decision_time: str
    universe_evaluated: Tuple[str, ...]
    branches_considered: Tuple[ThetaStrategyBranch, ...]
    counts: Dict[str, int]
    best_candidate_id: Optional[str]
    second_best_candidate_id: Optional[str]
    best_rejected_candidate_id: Optional[str]
    completeness_state: CompletenessState
    missing_scope: Tuple[str, ...]
    content_hash: str


@dataclass(frozen=True)
class GlobalWaitEvidence:
    """Mirrors `trade.global_wait_evidence` exactly."""

    decision_id: str
    candidate_set_id: Optional[str]
    decision_time: str
    wait_reason: str
    underlyings_evaluated: int
    contracts_evaluated: int
    branches_considered: Tuple[ThetaStrategyBranch, ...]
    best_rejected_candidate_id: Optional[str]
    best_feasible_action: Optional[str]
    blockers: Tuple[str, ...]
    data_missing: Tuple[str, ...]
    search_proof: Dict[str, Any]
    earned: bool
    validation_violations: Tuple[str, ...]
    content_hash: str


@dataclass(frozen=True)
class ShadowCandidate:
    """Mirrors `trade.shadow_opportunity`'s exported columns (per
    `postgres-dataset-export.ts`'s own SELECT list) exactly."""

    opportunity_id: str
    fusion_snapshot_id: str
    observed_at: str
    underlying: str
    contract_symbol: Optional[str]
    strategy_branch: ThetaStrategyBranch
    ev_net: Optional[float]
    tail_adjusted_ev: Optional[float]
    return_per_capital_day: Optional[float]
    capital_required: Optional[float]
    uncertainty: Optional[float]
    aegis_state: Optional[str]
    recommended_quantity: Optional[float]
    execution_quality_acceptable: Optional[bool]
    outcome: Optional[str]
    wait_reason: Optional[str]
    rejection_category: Optional[str]
    reasons: Tuple[Any, ...]
    policy_version: str
    model_versions: Dict[str, Any]


@dataclass(frozen=True)
class ManagementActionValue:
    """Unchanged from R6G -- one feasible action's valuation."""

    action: ThetaStrategyAction
    feasible: bool
    certain_cashflow: Optional[float]
    estimated_future_value: Optional[float]
    tail_risk_penalty: Optional[float]
    capital_days_penalty: Optional[float]
    execution_penalty: Optional[float]
    utility: Optional[float]


@dataclass(frozen=True)
class ManagementSnapshot:
    """Mirrors `trade.management_input_snapshot` joined with
    `trade.management_action_frontier` (per `postgres-dataset-export.ts`'s
    own join) -- `actions`/`selected_action`/`second_best_action` fields
    fold R6G's separate `ManagementActionSet` INTO this one record, since
    Production's own export already returns them pre-joined by
    `management_input_snapshot_id`."""

    management_input_snapshot_id: str
    fusion_snapshot_id: str
    chain_id: Optional[str]
    observed_at: str
    lifecycle_state: str
    input_fields: Dict[str, Any]
    unknown_fields: Tuple[str, ...]
    change_fields: Dict[str, Any]
    content_hash: str
    actions: Tuple[ManagementActionValue, ...]
    selected_action: Optional[ThetaStrategyAction]
    second_best_action: Optional[ThetaStrategyAction]
    decision_state: Optional[str]
    reason_codes: Tuple[str, ...]


@dataclass(frozen=True)
class LifecycleEvent:
    """Mirrors `trade.lifecycle_application` (per `postgres-dataset-
    export.ts`'s own SELECT list) exactly."""

    lifecycle_application_id: str
    evidence_key: str
    chain_id: str
    event_kind: str  # free string -- Codex's own storage layer does not constrain this to a fixed enum either
    provider_activity_ref_hash: Optional[str]
    transition_path: Tuple[Any, ...]
    applied_at: str
    result_hash: str
    detail: Dict[str, Any]


@dataclass(frozen=True)
class EconomicEpisode:
    """Mirrors `research.theta_outcome_label` (filtered to
    subject_type IN ('WHOLE_CHAIN','MANAGED_EPISODE'), per `postgres-
    dataset-export.ts`'s own query) exactly. `censoring_state` replaces
    R6G's `resolved: bool` -- see `CensoringState` above."""

    outcome_label_id: str
    subject_type: SubjectType
    subject_id: str
    label_available_at: str
    label_version: str
    censoring_state: CensoringState
    whole_chain_net_pnl: Optional[float]
    managed_episode_pnl: Optional[float]
    return_on_secured_capital: Optional[float]
    return_per_capital_day: Optional[float]
    max_adverse_excursion: Optional[float]
    max_favorable_excursion: Optional[float]
    recovery_duration_days: Optional[float]
    realized_execution_cost: Optional[float]
    outcomes: Dict[str, Any]
    provenance: Dict[str, Any]
    content_hash: str


@dataclass(frozen=True)
class ExecutionEvidence:
    """Mirrors `market.execution_quote_observation` exactly."""

    quote_observation_id: str
    candidate_id: Optional[str]
    management_input_snapshot_id: Optional[str]
    observation_role: ObservationRole
    observed_at: str
    provider_timestamp: Optional[str]
    ingestion_timestamp: str
    source: str
    operation_alias: str
    feed: Optional[str]
    contract_version: str
    bid: Optional[float]
    ask: Optional[float]
    bid_size: Optional[float]
    ask_size: Optional[float]
    proposed_limit: Optional[float]
    data_quality: DataQuality
    content_hash: str


@dataclass(frozen=True)
class DatasetExportArtifact:
    """Mirrors `point-in-time-evidence.ts`'s `DatasetExportArtifact`
    exactly -- the top-level shape a Production export actually produces.
    `schema_version` must equal `datasetExportVersion` ("theta-r6-dataset-
    v1") for this loader to accept it at all (see
    `production_export_loader.py`)."""

    schema_version: str
    source_window_start: str
    source_window_end: str
    exported_at: str
    feature_set_version: str
    strategy_versions: Tuple[str, ...]
    candidate_sets: Tuple[CandidateSet, ...]
    candidates: Tuple[Candidate, ...]
    shadow_candidates: Tuple[ShadowCandidate, ...]
    management_snapshots: Tuple[ManagementSnapshot, ...]
    lifecycle_outcomes: Tuple[LifecycleEvent, ...]
    whole_chain_outcomes: Tuple[EconomicEpisode, ...]
    execution_evidence: Tuple[ExecutionEvidence, ...]
    row_counts: Dict[str, int]
    dataset_hash: str
