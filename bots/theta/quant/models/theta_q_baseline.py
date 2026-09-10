"""THETA-Q first simple baseline: a transparent, non-ML CSP candidate scorer.

Per the research brief: "Before sophisticated ML, design a transparent
baseline" using liquid underlyings, ownability, acceptable assignment risk,
a conventional CSP lattice, after-cost EV, realistic execution assumptions,
and complete lifecycle accounting -- and "do not optimize the first baseline
for 70-80% WR."

This module is deliberately NOT a model: every score is an explicit, auditable
formula over named inputs, every gate is reason-coded (TRD CAND-003: "opaque
scalar score alone is insufficient"), and every threshold that would
otherwise be a magic number is a required constructor argument on
:class:`BaselinePolicy`, not a default baked into this file (no hard-coded
universal values, per docs/TEAM_CHARTER.md and TRD section 51).

This module has no I/O and no provider dependency -- it operates purely on
already-computed candidate inputs (the shape a FusionSnapshot/candidate
pipeline would eventually supply). It does not connect to Alpaca or
Optionomics. All example data used in this module's tests is explicitly
synthetic, not real market data.
"""

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from models.common import ReasonCode


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CspCandidateInputs:
    """One CSP candidate's already-computed feature values. Field names match
    bots/theta/quant/research/data/feature_families.json feature_family_id
    values so a real pipeline can populate this directly from that registry.
    ``None`` means UNKNOWN for that field -- never coerced to 0 or a default.
    """

    underlying_symbol: str
    strike: float
    multiplier: float
    entry_premium_per_share: float
    dte: int

    # Liquidity (hard-gate family)
    spread_pct: Optional[float]
    quote_age_seconds: Optional[float]
    open_interest: Optional[int]
    volume: Optional[int]

    # Event (hard/soft by branch -- this baseline treats near-term earnings as hard)
    earnings_distance_days: Optional[int]

    # Ownership/quality (soft score family) -- each expected on a 0..1
    # reliability/acceptability scale where higher is better, or None if
    # genuinely unavailable (UNKNOWN, not assumed neutral).
    ownership_acceptability: Optional[float]
    p_severe_drawdown: Optional[float]

    # Volatility context (soft, informational -- never a standalone gate,
    # per UNIV-002 "high IV alone is never sufficient for a CSP entry")
    iv_rank: Optional[float]

    # Portfolio/account state, supplied by the caller (not fetched here)
    broker_allowed_qty: int
    contract_is_standard: bool


@dataclass(frozen=True)
class CostAssumptions:
    """Versioned cost model inputs (TRD Appendix A EV_net / COST-001). Every
    field must be supplied explicitly -- this is what ``cost_model_version``
    is for; nothing here defaults to zero or is invented by this module.
    """

    commission_per_contract: float
    fees_per_contract: float
    est_slippage_per_contract: float
    cost_model_version: str


@dataclass(frozen=True)
class SizingPolicy:
    """Versioned risk-limit inputs (TRD section 18.1/19, section 51: "No risk
    limit may be changed live without creating a new version"). Every
    threshold is a required field -- there is no built-in default multiplier
    or threshold in this module.
    """

    risk_limit_version: str
    max_spread_pct: float
    min_quote_freshness_seconds: float
    min_open_interest: int
    min_volume: int
    earnings_exclusion_days: int
    ownership_acceptability_floor: float
    exceptional_utility_threshold: float
    strong_utility_threshold: float
    minimum_positive_edge: float
    risk_budget_qty_cap: int
    collateral_qty_cap: int
    concentration_qty_cap: int


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CandidateEconomics:
    max_profit: float
    break_even_price: float
    secured_collateral_per_contract: float
    credit_collateral_ratio: float
    ev_net: Optional[float]
    ev_net_unknown_reason: Optional[str]


@dataclass(frozen=True)
class CandidateEvaluation:
    underlying_symbol: str
    hard_veto: bool
    reasons: List[ReasonCode]
    economics: Optional[CandidateEconomics]
    ownership_score: Optional[float]
    quantity: int


# ---------------------------------------------------------------------------
# Baseline policy
# ---------------------------------------------------------------------------


class BaselinePolicy:
    """The transparent THETA-Q baseline. Every method is a pure function of
    its arguments plus the policy's own versioned thresholds -- nothing here
    reads global state, the clock, or a provider.
    """

    def __init__(self, sizing_policy: SizingPolicy, cost_assumptions: CostAssumptions):
        self.sizing_policy = sizing_policy
        self.cost_assumptions = cost_assumptions

    # -- hard gates -----------------------------------------------------

    def _hard_veto_reasons(self, c: CspCandidateInputs) -> List[ReasonCode]:
        """Mechanical invalidity and liquidity/event floors -- binary,
        per TRD section 18's hard-veto table. Returns an empty list if none
        apply; the caller must still check ownership/economics separately."""
        reasons: List[ReasonCode] = []
        sp = self.sizing_policy

        if not c.contract_is_standard:
            reasons.append(ReasonCode(
                "CONTRACT_NON_STANDARD", -1,
                "Adjusted/non-standard contract; deliverable not provably standard (ALP-005).",
            ))
        if c.multiplier <= 0:
            reasons.append(ReasonCode("CONTRACT_INVALID_MULTIPLIER", -1, "Multiplier must be > 0."))
        if c.strike <= 0:
            reasons.append(ReasonCode("CONTRACT_INVALID_STRIKE", -1, "Strike must be > 0."))

        if c.spread_pct is None:
            reasons.append(ReasonCode("SPREAD_UNKNOWN", -1, "Spread is UNKNOWN, not assumed acceptable."))
        elif c.spread_pct > sp.max_spread_pct:
            reasons.append(ReasonCode(
                "SPREAD_TOO_WIDE", -1,
                f"spread_pct {c.spread_pct} exceeds max_spread_pct {sp.max_spread_pct} (versioned in {sp.risk_limit_version}).",
            ))

        if c.quote_age_seconds is None:
            reasons.append(ReasonCode("QUOTE_AGE_UNKNOWN", -1, "Quote freshness is UNKNOWN, not assumed fresh."))
        elif c.quote_age_seconds > sp.min_quote_freshness_seconds:
            reasons.append(ReasonCode(
                "QUOTE_STALE", -1,
                f"quote_age_seconds {c.quote_age_seconds} exceeds budget {sp.min_quote_freshness_seconds}.",
            ))

        # These remain hard vetoes per TRD section 18's liquidity-floor table
        # (a policy question, not changed here) -- but WHY a candidate was
        # rejected must distinguish "the value is UNKNOWN" from "the value
        # is known and genuinely below the floor": those are fundamentally
        # different findings for later empirical/regret analysis (R6), and
        # conflating them into one reason code would make it impossible to
        # tell a real liquidity rejection apart from a data-availability gap.
        if c.open_interest is None:
            reasons.append(ReasonCode("OPEN_INTEREST_UNKNOWN", -1, "Open interest is UNKNOWN, not assumed acceptable or zero."))
        elif c.open_interest < sp.min_open_interest:
            reasons.append(ReasonCode("OPEN_INTEREST_BELOW_FLOOR", -1, f"open_interest {c.open_interest} below floor {sp.min_open_interest}."))
        if c.volume is None:
            reasons.append(ReasonCode("VOLUME_UNKNOWN", -1, "Volume is UNKNOWN, not assumed acceptable or zero."))
        elif c.volume < sp.min_volume:
            reasons.append(ReasonCode("VOLUME_BELOW_FLOOR", -1, f"volume {c.volume} below floor {sp.min_volume}."))

        if c.earnings_distance_days is not None and c.earnings_distance_days <= sp.earnings_exclusion_days:
            reasons.append(ReasonCode(
                "EARNINGS_TOO_NEAR", -1,
                f"earnings_distance_days {c.earnings_distance_days} <= exclusion window {sp.earnings_exclusion_days} "
                f"(THETA-Q baseline default excludes near-term earnings; branch-specific policies may differ).",
            ))

        if c.broker_allowed_qty <= 0:
            reasons.append(ReasonCode("BROKER_QTY_ZERO", -1, "Broker-allowed quantity is zero."))

        return reasons

    # -- ownership/quality soft score ------------------------------------

    def _ownership_evaluation(self, c: CspCandidateInputs) -> Tuple[Optional[float], List[ReasonCode]]:
        """Transparent linear combination, not a model. Returns None if
        either input is UNKNOWN -- an unknown ownership state is never
        silently treated as acceptable (UNIV-003: every CSP candidate SHALL
        carry an ownership_acceptability score)."""
        reasons: List[ReasonCode] = []
        if c.ownership_acceptability is None:
            reasons.append(ReasonCode("OWNERSHIP_ACCEPTABILITY_UNKNOWN", -1, "No ownership score available."))
            return None, reasons
        if c.p_severe_drawdown is None:
            reasons.append(ReasonCode("SEVERE_DRAWDOWN_PROB_UNKNOWN", -1, "No severe-drawdown probability available."))
            return None, reasons

        if c.ownership_acceptability < self.sizing_policy.ownership_acceptability_floor:
            reasons.append(ReasonCode(
                "OWNERSHIP_BELOW_FLOOR", -1,
                f"ownership_acceptability {c.ownership_acceptability} below floor "
                f"{self.sizing_policy.ownership_acceptability_floor}.",
            ))
        else:
            reasons.append(ReasonCode("OWNERSHIP_ACCEPTABLE", 1, f"ownership_acceptability={c.ownership_acceptability}"))

        # Simple, fully transparent combination: reward ownership quality,
        # penalize severe-drawdown probability. This is a v0 baseline
        # formula, explicitly not claimed to be the final ownership model
        # (TRD section 43's actual model is a future, separately validated
        # component) -- it exists so THETA-Q has *something* auditable to
        # test against B0-B6/A1 before a learned model exists.
        score = c.ownership_acceptability * (1.0 - c.p_severe_drawdown)

        if c.iv_rank is not None:
            reasons.append(ReasonCode(
                "IV_RANK_CONTEXT", 0,
                f"iv_rank={c.iv_rank} -- informational only, never a standalone gate (UNIV-002).",
            ))

        return score, reasons

    # -- economics --------------------------------------------------------

    def _economics(self, c: CspCandidateInputs) -> CandidateEconomics:
        """TRD Appendix A formulas, applied literally -- no reinterpretation."""
        max_profit = c.entry_premium_per_share * c.multiplier
        break_even_price = c.strike - c.entry_premium_per_share
        secured_collateral = c.strike * c.multiplier
        credit_collateral = (
            (c.entry_premium_per_share * c.multiplier) / secured_collateral
            if secured_collateral > 0
            else None
        )

        cost_per_contract = (
            self.cost_assumptions.commission_per_contract
            + self.cost_assumptions.fees_per_contract
            + self.cost_assumptions.est_slippage_per_contract
        )
        # EV_net requires a calibrated P(loss)/expected-loss estimate that
        # this baseline does not have (no model exists yet) -- rather than
        # invent one, EV_net is explicitly UNKNOWN at this stage. A real
        # EV_net requires the entry outcome model (TRD section 17), which is
        # out of scope for "the first simple baseline" by design.
        return CandidateEconomics(
            max_profit=max_profit,
            break_even_price=break_even_price,
            secured_collateral_per_contract=secured_collateral,
            credit_collateral_ratio=credit_collateral if credit_collateral is not None else 0.0,
            ev_net=None,
            ev_net_unknown_reason=(
                "EV_net requires a calibrated entry-outcome probability model "
                "(TRD section 17), which this transparent v0 baseline does not "
                "include by design. Reporting a fabricated EV_net here would "
                "violate the no-invented-numbers rule -- gross economics "
                f"(cost_per_contract={cost_per_contract}, cost_model_version="
                f"{self.cost_assumptions.cost_model_version}) are computed so a "
                "future model can combine them with a real P(win)."
            ),
        )

    # -- sizing -------------------------------------------------------------

    def _quantity(self, c: CspCandidateInputs, ownership_score: Optional[float]) -> int:
        """TRD section 18.1 size-by-confidence structure, without a
        calibrated utility (none exists at this baseline stage) -- so this
        baseline can only size by the hard caps, never by a confidence
        multiplier it doesn't actually have evidence for. Quantity 0 is a
        legitimate, expected result, never floored to 1 (SIZE-001)."""
        if ownership_score is None:
            return 0
        qty_base = min(
            self.sizing_policy.risk_budget_qty_cap,
            self.sizing_policy.collateral_qty_cap,
            self.sizing_policy.concentration_qty_cap,
            c.broker_allowed_qty,
        )
        return max(qty_base, 0)

    # -- entry point ----------------------------------------------------

    def evaluate(self, c: CspCandidateInputs) -> CandidateEvaluation:
        hard_reasons = self._hard_veto_reasons(c)
        if hard_reasons:
            return CandidateEvaluation(
                underlying_symbol=c.underlying_symbol,
                hard_veto=True,
                reasons=hard_reasons,
                economics=None,
                ownership_score=None,
                quantity=0,
            )

        ownership_score, ownership_reasons = self._ownership_evaluation(c)
        economics = self._economics(c)

        reasons = list(ownership_reasons)
        below_floor = any(r.code == "OWNERSHIP_BELOW_FLOOR" for r in ownership_reasons)
        unknown_ownership = ownership_score is None

        if unknown_ownership or below_floor:
            qty = 0
        else:
            qty = self._quantity(c, ownership_score)

        return CandidateEvaluation(
            underlying_symbol=c.underlying_symbol,
            hard_veto=False,
            reasons=reasons,
            economics=economics,
            ownership_score=ownership_score,
            quantity=qty,
        )


def rank_candidates(
    policy: BaselinePolicy, candidates: Sequence[CspCandidateInputs]
) -> List[CandidateEvaluation]:
    """Evaluates every candidate and ranks the feasible (non-hard-veto,
    quantity > 0) ones by ownership_score descending -- an explicit,
    auditable rank, not an opaque combined score (CAND-003). Infeasible
    candidates are still returned (with their reasons) rather than dropped,
    per CAND-002's requirement to retain rejected alternatives.

    This function never appends a synthetic 'WAIT' candidate itself --
    WAIT is a decision made by the caller (the candidate/decision layer,
    Codex-owned) after seeing that zero or all candidates are infeasible;
    this module only scores CSPs, per its single responsibility.
    """
    evaluations = [policy.evaluate(c) for c in candidates]
    feasible = [e for e in evaluations if not e.hard_veto and e.quantity > 0]
    infeasible = [e for e in evaluations if e.hard_veto or e.quantity == 0]
    feasible.sort(key=lambda e: (e.ownership_score or 0.0), reverse=True)
    return feasible + infeasible
