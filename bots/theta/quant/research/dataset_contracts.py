"""R6G research dataset record contracts.

Defines the exact offline-research record shapes THETA needs once a real
point-in-time historical dataset exists, so the empirical program (walk-
forward, ablation, promotion) can start immediately when that data arrives
rather than needing a schema designed under time pressure later.

Field names are deliberately aligned to Codex's now-canonical Production
TypeScript contracts (`src/theta/strategy-package.ts`,
`strategy-evaluation-contract.ts`, `strategy-decision-envelope.ts`) --
`branch` uses the same five `ThetaStrategyBranch` values, `action` the same
`ThetaStrategyAction` values, `candidate_id`/`ev_net`/`return_per_capital_
day`/`strategy_version_id` mirror Production's own `candidateId`/`evNet`/
`returnPerCapitalDay`/`strategyVersionId` naming -- so a research replay
built from these records and Production's own persisted evidence can be
joined without a translation layer.

These are RESEARCH dataset shapes only -- they do not read from or write to
Production, and every optional field is None (never fabricated) until real
data populates it. No row here is ever synthesized from a live decision;
these dataclasses only describe what a real historical record must look
like.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Tuple


class ThetaStrategyBranch(str, Enum):
    """Mirrors `strategy-package.ts`'s `thetaStrategyBranch` enum exactly --
    the same five canonical business names, never a sixth research-only
    name reintroduced here."""

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


@dataclass(frozen=True)
class RecordLineage:
    """Required on EVERY record type below -- the R6G directive's own
    "every row must preserve" list. No dataset record may omit any of
    these; a record missing lineage cannot be trusted for PIT-safe
    research regardless of how complete its economic fields are."""

    as_of: str  # ISO timestamp: the decision-relevant point-in-time moment this row represents
    provider_timestamp: str  # ISO timestamp: when the underlying provider (Alpaca/Optionomics) actually stamped the source data
    ingestion_timestamp: str  # ISO timestamp: when THETA's own pipeline recorded it (necessarily >= provider_timestamp)
    strategy_version_id: str  # mirrors strategy-package.ts's ThetaStrategyVersion.configurationHash-backed id
    feature_set_version: str
    entry_model_version: Optional[str]
    management_policy_version: Optional[str]
    cost_model_version: str
    risk_limit_version: str
    contract_identity: str  # the real, resolvable OCC symbol (or "N/A" for a stock-only row) -- never a synthetic placeholder
    lifecycle_chain_id: str  # groups every row belonging to the SAME whole economic episode -- the walk_forward.py chain-id unit


@dataclass(frozen=True)
class Candidate:
    """One evaluated candidate within a CandidateSet -- mirrors
    `strategy-evaluation-contract.ts`'s `candidateEvaluationSchema` field
    names (`candidateId`, `branch`, `applicable`, `action`,
    `expectedAfterCostValue`->`ev_net`, `returnPerCapitalDay`, `tailRisk`,
    `uncertainty`, `hardBlockers`, `softEvidence`)."""

    lineage: RecordLineage
    candidate_id: str
    branch: ThetaStrategyBranch
    applicable: bool
    action: Optional[ThetaStrategyAction]
    ev_net: Optional[float]
    return_per_capital_day: Optional[float]
    tail_risk: Optional[float]
    uncertainty: Optional[float]
    hard_blockers: Tuple[str, ...] = field(default_factory=tuple)
    soft_evidence: Tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class CandidateSet:
    """The full candidate/action frontier evaluated at one decision
    timestamp -- every candidate persisted, not only the winner, per the
    spec's own "persist selected and rejected alternatives" requirement."""

    lineage: RecordLineage
    snapshot_id: str
    candidates: Tuple[Candidate, ...]


@dataclass(frozen=True)
class SelectedCandidate:
    """The candidate actually chosen from a CandidateSet, if any --
    `candidate_id=None` represents a genuine GLOBAL_WAIT for this
    snapshot, never a fabricated selection."""

    lineage: RecordLineage
    snapshot_id: str
    candidate_id: Optional[str]
    second_best_candidate_id: Optional[str]


@dataclass(frozen=True)
class ShadowCandidate:
    """A soft-rejected (never hard-vetoed) candidate retained for gate-
    regret research (per `strategy_routing_shadow.py`'s existing
    `GateRegretRecord` shape, now given a full lineage-bearing dataset
    record). `counterfactual_ev_net`/`counterfactual_tail_risk` remain
    None until a real replay can reconstruct them -- never estimated from
    the candidate's own pre-rejection score."""

    lineage: RecordLineage
    candidate_id: str
    branch: ThetaStrategyBranch
    rejecting_gate: str
    counterfactual_ev_net: Optional[float]
    counterfactual_tail_risk: Optional[float]


@dataclass(frozen=True)
class ManagementSnapshot:
    """One shared, timestamped management decision-state snapshot --
    mirrors `models/management_action_value.py`'s `ManagementContext`
    concept as a persistable research record."""

    lineage: RecordLineage
    open_option_leg_present: bool
    stock_shares_held: float
    capital_committed: Optional[float]
    p_severe_drawdown: Optional[float]
    at_expiration_otm: bool


@dataclass(frozen=True)
class ManagementActionValue:
    """One feasible action's valuation within a ManagementActionSet."""

    action: ThetaStrategyAction
    feasible: bool
    certain_cashflow: Optional[float]
    estimated_future_value: Optional[float]
    tail_risk_penalty: Optional[float]
    capital_days_penalty: Optional[float]
    execution_penalty: Optional[float]
    utility: Optional[float]


@dataclass(frozen=True)
class ManagementActionSet:
    """Every feasible management action valued from the SAME
    ManagementSnapshot -- mirrors `management_action_value.py`'s
    `ManagementDecision.valuations`, now a persistable dataset record."""

    lineage: RecordLineage
    snapshot_id: str
    valuations: Tuple[ManagementActionValue, ...]
    selected_action: Optional[ThetaStrategyAction]


@dataclass(frozen=True)
class EconomicEpisode:
    """A fully resolved whole economic episode -- the unit
    `episode_economics.py::whole_episode_pnl` and `walk_forward.py`'s
    chain-grouping operate over. `resolved` distinguishes a genuinely
    completed chain from one still open (an open chain must never be
    scored as if it were resolved -- see `chain_resolution.py`'s
    RESOLVED/CENSORED_OPEN distinction, which this record's `resolved`
    flag reuses conceptually)."""

    lineage: RecordLineage
    branch: ThetaStrategyBranch
    resolved: bool
    whole_chain_net_pnl: Optional[float]
    managed_episode_net_pnl: Optional[float]
    return_on_secured_capital: Optional[float]
    return_per_capital_day: Optional[float]
    max_drawdown_pct: Optional[float]
    max_adverse_excursion: Optional[float]
    expected_shortfall: Optional[float]
    severe_drawdown_event: Optional[bool]
    assignment_occurred: Optional[bool]
    recovery_duration_days: Optional[float]
    recovery_success: Optional[bool]
    call_away_occurred: Optional[bool]
    capital_lock_days: Optional[float]


@dataclass(frozen=True)
class ExecutionEvidence:
    """One order's realized execution facts -- TCA lineage, per spec
    section 26. `fill_probability` is deliberately absent as a field here:
    per `execution_simulator.py`'s own convention, a structural simulator
    never reports one, and a REAL fill either happened (this record
    exists with `filled=True`) or it did not (`filled=False`); there is no
    "probability" to store after the fact, only an outcome."""

    lineage: RecordLineage
    order_id: str
    filled: bool
    filled_quantity: float
    limit_price: Optional[float]
    fill_price: Optional[float]
    slippage_per_unit: Optional[float]
    spread_capture: Optional[float]
    markout_1min: Optional[float]
    markout_5min: Optional[float]


@dataclass(frozen=True)
class LifecycleEvent:
    """One broker-reconciled lifecycle transition (expiry/assignment/roll/
    call-away/close) -- links to `lineage.lifecycle_chain_id` so every
    event belonging to the same economic episode can be reassembled in
    order. `event_type` is a plain string here (not a THETA-owned enum)
    because the authoritative lifecycle-state vocabulary is Codex's own
    Production state machine -- this record cites whatever value Codex's
    broker-reconciled evidence actually used, never redefines it."""

    lineage: RecordLineage
    event_type: str
    broker_activity_id: Optional[str]
    resulting_lifecycle_state: str
