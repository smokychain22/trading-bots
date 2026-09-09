"""THETA-H (Hold-the-Strike) transparent baseline -- a SEPARATE namespace
from theta_q_baseline.py by design.

Per H-H-02 in bots/theta/quant/research/data/hypotheses.json: this
archetype's statistics must never be pooled with THETA-Q's, because
intentional, frequent assignment at 2-5 DTE is exactly the pattern where a
closed-trade WR can hide unresolved stock drawdown. Sharing a class
hierarchy or config/output shape with theta_q_baseline.py would make it easy
to accidentally aggregate the two in a report; keeping every type here
distinct (``ThetaHCandidateInputs``, ``ThetaHPolicyV0``,
``ThetaHEvaluation``) is a deliberate guard against that, not an
accident of code organization.

Adds the short-DTE-specific diagnostics the research brief calls for that
theta_q_baseline.py does not need at its default 30-60 DTE lattice: gamma
exposure, overnight gap risk, distance-to-strike, and an assignment-
probability PROXY (not a fitted model -- no assignment model exists yet).
Does not claim a higher win rate anywhere -- there is no WR field in this
module's output at all, only economics and risk diagnostics, exactly like
theta_q_baseline.py's own refusal to fabricate EV_net.
"""

from dataclasses import dataclass
from typing import List, Optional

from models.common import ReasonCode


@dataclass(frozen=True)
class ThetaHCandidateInputs:
    underlying_symbol: str
    strike: float
    multiplier: float
    entry_premium_per_share: float
    dte: int
    spot_price: float

    spread_pct: Optional[float]
    quote_age_seconds: Optional[float]
    open_interest: Optional[int]
    volume: Optional[int]

    gamma: Optional[float]
    overnight_gap_history_pct: Optional[float]  # typical/observed overnight gap magnitude for this underlying

    ownership_acceptability: Optional[float]

    earnings_distance_days: Optional[int]
    broker_allowed_qty: int
    contract_is_standard: bool


@dataclass(frozen=True)
class ThetaHPolicyV0:
    policy_version: str
    min_dte: int
    max_dte: int
    max_spread_pct: float
    min_quote_freshness_seconds: float
    min_open_interest: int
    min_volume: int
    earnings_exclusion_days: int
    ownership_acceptability_floor: float
    max_gamma_exposure: float  # hard ceiling -- short-DTE gamma risk is this archetype's defining hazard
    max_overnight_gap_tolerance_pct: float
    risk_budget_qty_cap: int
    collateral_qty_cap: int
    concentration_qty_cap: int


@dataclass(frozen=True)
class ThetaHDiagnostics:
    distance_to_strike_pct: float  # (spot - strike) / strike -- how close to ATM
    gamma_exposure: Optional[float]
    overnight_gap_risk_flag: bool
    assignment_probability_proxy: Optional[float]  # NOT a fitted model -- see module docstring
    recovery_requirement_expected: bool  # True if this candidate, if assigned, would need recovery-wait handling


@dataclass(frozen=True)
class ThetaHEconomics:
    max_profit: float
    break_even_price: float
    secured_collateral_per_contract: float


@dataclass(frozen=True)
class ThetaHEvaluation:
    underlying_symbol: str
    hard_veto: bool
    reasons: List[ReasonCode]
    diagnostics: Optional[ThetaHDiagnostics]
    economics: Optional[ThetaHEconomics]
    ownership_score: Optional[float]
    quantity: int


class ThetaHPolicy:
    def __init__(self, policy: ThetaHPolicyV0):
        self.policy = policy

    def _hard_veto_reasons(self, c: ThetaHCandidateInputs) -> List[ReasonCode]:
        reasons: List[ReasonCode] = []
        p = self.policy

        if not c.contract_is_standard:
            reasons.append(ReasonCode("CONTRACT_NON_STANDARD", -1, "Adjusted/non-standard contract."))
        if not (p.min_dte <= c.dte <= p.max_dte):
            reasons.append(ReasonCode("DTE_OUTSIDE_HOLD_STRIKE_WINDOW", -1, f"dte={c.dte} outside [{p.min_dte},{p.max_dte}]"))
        if c.spread_pct is None or c.spread_pct > p.max_spread_pct:
            reasons.append(ReasonCode("SPREAD_INELIGIBLE", -1, "Spread UNKNOWN or too wide for short-DTE execution."))
        if c.quote_age_seconds is None or c.quote_age_seconds > p.min_quote_freshness_seconds:
            reasons.append(ReasonCode("QUOTE_STALE_OR_UNKNOWN", -1, "Quote freshness UNKNOWN or stale."))
        if c.open_interest is None or c.open_interest < p.min_open_interest:
            reasons.append(ReasonCode("OPEN_INTEREST_INSUFFICIENT", -1, "OI UNKNOWN or below floor."))
        if c.volume is None or c.volume < p.min_volume:
            reasons.append(ReasonCode("VOLUME_INSUFFICIENT", -1, "Volume UNKNOWN or below floor."))
        if c.earnings_distance_days is not None and c.earnings_distance_days <= p.earnings_exclusion_days:
            reasons.append(ReasonCode("EARNINGS_TOO_NEAR", -1, f"earnings_distance_days={c.earnings_distance_days}"))
        if c.gamma is not None and abs(c.gamma) > p.max_gamma_exposure:
            reasons.append(ReasonCode("GAMMA_EXPOSURE_TOO_HIGH", -1, f"gamma={c.gamma} exceeds ceiling {p.max_gamma_exposure}"))
        if c.overnight_gap_history_pct is not None and c.overnight_gap_history_pct > p.max_overnight_gap_tolerance_pct:
            reasons.append(ReasonCode(
                "OVERNIGHT_GAP_HISTORY_TOO_HIGH", -1,
                f"overnight_gap_history_pct={c.overnight_gap_history_pct} exceeds tolerance",
            ))
        if c.broker_allowed_qty <= 0:
            reasons.append(ReasonCode("BROKER_QTY_ZERO", -1, "Broker-allowed quantity is zero."))

        return reasons

    def _diagnostics(self, c: ThetaHCandidateInputs) -> ThetaHDiagnostics:
        distance_to_strike_pct = (c.spot_price - c.strike) / c.strike

        overnight_gap_risk_flag = (
            c.overnight_gap_history_pct is not None
            and c.overnight_gap_history_pct > self.policy.max_overnight_gap_tolerance_pct * 0.5
        )

        # Assignment-probability PROXY only: closer to ATM (distance -> 0)
        # is treated as higher assignment likelihood. This is an explicit
        # placeholder, not the real assignment model (TRD section 17),
        # which requires calibration this baseline does not have.
        assignment_probability_proxy = None
        if distance_to_strike_pct is not None:
            assignment_probability_proxy = max(0.0, 1.0 - min(abs(distance_to_strike_pct) * 10, 1.0))

        return ThetaHDiagnostics(
            distance_to_strike_pct=distance_to_strike_pct,
            gamma_exposure=c.gamma,
            overnight_gap_risk_flag=overnight_gap_risk_flag,
            assignment_probability_proxy=assignment_probability_proxy,
            # Hold-the-Strike is intentional-assignment by design (TRD
            # section 4/15) -- recovery-wait handling is expected whenever
            # assignment is plausible at all, not just in edge cases.
            recovery_requirement_expected=(
                assignment_probability_proxy is not None and assignment_probability_proxy > 0.3
            ),
        )

    def _economics(self, c: ThetaHCandidateInputs) -> ThetaHEconomics:
        return ThetaHEconomics(
            max_profit=c.entry_premium_per_share * c.multiplier,
            break_even_price=c.strike - c.entry_premium_per_share,
            secured_collateral_per_contract=c.strike * c.multiplier,
        )

    def _quantity(self, c: ThetaHCandidateInputs, ownership_score: Optional[float]) -> int:
        if ownership_score is None or ownership_score < self.policy.ownership_acceptability_floor:
            return 0
        qty_base = min(
            self.policy.risk_budget_qty_cap,
            self.policy.collateral_qty_cap,
            self.policy.concentration_qty_cap,
            c.broker_allowed_qty,
        )
        return max(qty_base, 0)

    def evaluate(self, c: ThetaHCandidateInputs) -> ThetaHEvaluation:
        hard_reasons = self._hard_veto_reasons(c)
        if hard_reasons:
            return ThetaHEvaluation(
                underlying_symbol=c.underlying_symbol,
                hard_veto=True,
                reasons=hard_reasons,
                diagnostics=None,
                economics=None,
                ownership_score=None,
                quantity=0,
            )

        diagnostics = self._diagnostics(c)
        economics = self._economics(c)
        ownership_score = c.ownership_acceptability

        reasons: List[ReasonCode] = []
        if ownership_score is None:
            reasons.append(ReasonCode("OWNERSHIP_UNKNOWN", -1, "No ownership score available."))
        elif ownership_score < self.policy.ownership_acceptability_floor:
            reasons.append(ReasonCode("OWNERSHIP_BELOW_FLOOR", -1, f"ownership_score={ownership_score}"))
        else:
            reasons.append(ReasonCode("OWNERSHIP_ACCEPTABLE", 1, f"ownership_score={ownership_score}"))

        if diagnostics.overnight_gap_risk_flag:
            reasons.append(ReasonCode("OVERNIGHT_GAP_RISK_ELEVATED", -1, "Overnight gap risk flagged."))
        if diagnostics.recovery_requirement_expected:
            reasons.append(ReasonCode(
                "RECOVERY_REQUIREMENT_EXPECTED", 0,
                "Assignment plausible; recovery-wait handling should be pre-planned, not decided post-hoc.",
            ))

        quantity = self._quantity(c, ownership_score)

        return ThetaHEvaluation(
            underlying_symbol=c.underlying_symbol,
            hard_veto=False,
            reasons=reasons,
            diagnostics=diagnostics,
            economics=economics,
            ownership_score=ownership_score,
            quantity=quantity,
        )
