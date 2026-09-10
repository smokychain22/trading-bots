"""Execution-quality / fill model (Phase 2C-quant).

Deterministic heuristic baseline (MODEL-001: simple, interpretable baseline
first) estimating fill probability and expected slippage from bid/ask/spread/
quote-age/size -- never assuming a midpoint fill as executable truth. A
logistic/GBM challenger is future work once real TCA data exists
(docs/quant/phase2/MODEL_REGISTRY.md's execution/fill model entry); this
module is intentionally simple and fully auditable.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from models.common import ReasonCode


class FillOutcome(str, Enum):
    NO_FILL = "NO_FILL"
    PARTIAL_FILL = "PARTIAL_FILL"
    FULL_FILL = "FULL_FILL"
    CANCEL = "CANCEL"
    REPRICE = "REPRICE"


@dataclass(frozen=True)
class ExecutionQualityPolicy:
    policy_version: str
    max_acceptable_spread_pct: float
    min_quote_size_for_full_confidence: int
    max_quote_age_seconds: float
    min_after_cost_utility_to_cross: float  # if expected utility after slippage falls below this, skip/cancel


@dataclass(frozen=True)
class ExecutionQualityInputs:
    bid: Optional[float]
    ask: Optional[float]
    quote_size: Optional[int]
    quote_age_seconds: Optional[float]
    limit_price: float
    pre_slippage_expected_utility: Optional[float]


@dataclass(frozen=True)
class ExecutionQualityAssessment:
    spread_pct: Optional[float]
    fill_probability: Optional[float]  # heuristic estimate in [0, 1], None if UNKNOWN
    expected_slippage_per_share: Optional[float]
    acceptable: Optional[bool]  # None if UNKNOWN -- never assumed acceptable
    recommended_action: str  # "SUBMIT" | "SKIP" | "CANCEL" | "UNKNOWN"
    reasons: List[ReasonCode]


def assess_execution_quality(
    policy: ExecutionQualityPolicy, inputs: ExecutionQualityInputs
) -> ExecutionQualityAssessment:
    reasons: List[ReasonCode] = []

    if inputs.bid is None or inputs.ask is None:
        reasons.append(ReasonCode("QUOTE_UNKNOWN", -1, "Bid/ask is UNKNOWN, not assumed acceptable."))
        return ExecutionQualityAssessment(None, None, None, None, "UNKNOWN", reasons)

    if inputs.ask <= 0:
        reasons.append(ReasonCode("INVALID_QUOTE", -1, "Ask must be > 0."))
        return ExecutionQualityAssessment(None, None, None, None, "UNKNOWN", reasons)

    spread_pct = (inputs.ask - inputs.bid) / inputs.ask

    if inputs.quote_age_seconds is None:
        reasons.append(ReasonCode("QUOTE_AGE_UNKNOWN", -1, "Quote freshness is UNKNOWN, not assumed fresh."))
        return ExecutionQualityAssessment(spread_pct, None, None, None, "UNKNOWN", reasons)
    if inputs.quote_age_seconds > policy.max_quote_age_seconds:
        reasons.append(ReasonCode("QUOTE_STALE", -1, f"quote_age_seconds={inputs.quote_age_seconds} exceeds budget."))
        return ExecutionQualityAssessment(spread_pct, None, None, False, "SKIP", reasons)

    if spread_pct > policy.max_acceptable_spread_pct:
        reasons.append(ReasonCode("SPREAD_TOO_WIDE", -1, f"spread_pct={spread_pct} exceeds {policy.max_acceptable_spread_pct}."))
        return ExecutionQualityAssessment(spread_pct, None, None, False, "SKIP", reasons)

    if inputs.quote_size is None:
        reasons.append(ReasonCode("QUOTE_SIZE_UNKNOWN", -1, "Quote size is UNKNOWN, not assumed sufficient."))
        fill_probability = None
    else:
        # Simple, auditable heuristic: fill probability scales with how deep
        # the limit price sits relative to the spread and how much size is
        # displayed, never derived from a fitted model.
        size_ratio = min(1.0, inputs.quote_size / policy.min_quote_size_for_full_confidence)
        price_ratio = 0.0 if inputs.ask == inputs.bid else max(
            0.0, min(1.0, (inputs.limit_price - inputs.bid) / (inputs.ask - inputs.bid))
        )
        fill_probability = 0.5 * size_ratio + 0.5 * price_ratio

    expected_slippage = (inputs.ask - inputs.limit_price) if inputs.limit_price < inputs.ask else 0.0

    if inputs.pre_slippage_expected_utility is None:
        reasons.append(ReasonCode("PRE_SLIPPAGE_UTILITY_UNKNOWN", -1, "Cannot confirm after-cost utility remains positive."))
        return ExecutionQualityAssessment(spread_pct, fill_probability, expected_slippage, None, "UNKNOWN", reasons)

    after_cost_utility = inputs.pre_slippage_expected_utility - expected_slippage
    if after_cost_utility < policy.min_after_cost_utility_to_cross:
        reasons.append(ReasonCode(
            "ECONOMIC_VALUE_INSUFFICIENT", -1,
            f"after_cost_utility={after_cost_utility} below minimum {policy.min_after_cost_utility_to_cross} -- "
            "skip/cancel rather than crossing blindly.",
        ))
        return ExecutionQualityAssessment(spread_pct, fill_probability, expected_slippage, False, "CANCEL", reasons)

    reasons.append(ReasonCode("EXECUTION_QUALITY_ACCEPTABLE", 1, f"after_cost_utility={after_cost_utility}"))
    return ExecutionQualityAssessment(spread_pct, fill_probability, expected_slippage, True, "SUBMIT", reasons)
