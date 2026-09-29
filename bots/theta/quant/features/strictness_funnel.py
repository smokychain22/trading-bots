"""Strictness funnel engine (THETA long-run build, work package 23, Phase
2).

Categorizes real rejection/selection reason codes into one of the
canonical buckets, then produces counts/rates/a transition funnel by
strategy/date/feature state. Consumes ReasonCode-shaped rows (the same
`models.common.ReasonCode` every quant model in this repo already emits)
-- it does not invent a new reason-code taxonomy, it classifies the
existing one.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from enum import Enum
from typing import Mapping, Optional, Sequence


class StrictnessCategory(str, Enum):
    DATA_QUALITY = "DATA_QUALITY"
    SAFETY = "SAFETY"  # a hard, non-economic safety veto -- e.g. a broker-mutation/order-submission guard tripping
    POLICY = "POLICY"
    ECONOMIC = "ECONOMIC"
    AEGIS = "AEGIS"
    SIZING = "SIZING"
    INFRASTRUCTURE = "INFRASTRUCTURE"
    WAIT = "WAIT"
    SELECTED = "SELECTED"
    OTHER_TYPED = "OTHER_TYPED"  # a real, typed reason code this classifier has no rule for yet -- never silently dropped


# Real reason-code prefixes/exact-matches already observed across this
# repo's existing quant models (regime_v0.py, strategy_router.py,
# execution_quality.py, this session's own feature modules) -- extend this
# mapping as new real codes are found; a code absent from every rule below
# is OTHER_TYPED, never silently miscategorized.
_PREFIX_RULES: Mapping[str, StrictnessCategory] = {
    "UNKNOWN": StrictnessCategory.DATA_QUALITY, "STALE": StrictnessCategory.DATA_QUALITY,
    "INVALID": StrictnessCategory.DATA_QUALITY, "INSUFFICIENT": StrictnessCategory.DATA_QUALITY,
    "CRITICAL_DATA_INVALID": StrictnessCategory.DATA_QUALITY,
    "AEGIS": StrictnessCategory.AEGIS, "QUOTE_STALE": StrictnessCategory.DATA_QUALITY,
    "SPREAD_TOO_WIDE": StrictnessCategory.DATA_QUALITY, "ECONOMIC_VALUE_INSUFFICIENT": StrictnessCategory.ECONOMIC,
    "SIZING": StrictnessCategory.SIZING, "ZERO_OR_NO_SELECTION": StrictnessCategory.SIZING,
    "INELIGIBLE_STATE": StrictnessCategory.POLICY, "INELIGIBLE_STRUCTURE": StrictnessCategory.POLICY,
    "INELIGIBLE_RISK": StrictnessCategory.AEGIS, "INELIGIBLE_DATA": StrictnessCategory.DATA_QUALITY,
    "WAIT": StrictnessCategory.WAIT, "GLOBAL_WAIT": StrictnessCategory.WAIT,
    "SAFETY": StrictnessCategory.SAFETY, "GUARD": StrictnessCategory.SAFETY,
    "BROKER_MUTATION": StrictnessCategory.SAFETY, "REQUIRED": StrictnessCategory.SAFETY,
    "SELECTED": StrictnessCategory.SELECTED, "PASS": StrictnessCategory.SELECTED,
    "INFRASTRUCTURE": StrictnessCategory.INFRASTRUCTURE, "PROVIDER": StrictnessCategory.INFRASTRUCTURE,
}


_ORDERED_RULES = sorted(_PREFIX_RULES.items(), key=lambda entry: len(entry[0]), reverse=True)


def classify_reason_code(code: str) -> StrictnessCategory:
    # Longer, more specific rules are checked first (e.g.
    # "ECONOMIC_VALUE_INSUFFICIENT" must not be shadowed by the shorter,
    # more generic "INSUFFICIENT" rule) -- order-independent by construction,
    # never a silent dict-iteration-order bug.
    for prefix, category in _ORDERED_RULES:
        if code.startswith(prefix) or prefix in code:
            return category
    return StrictnessCategory.OTHER_TYPED


@dataclass(frozen=True)
class StrictnessRow:
    strategy: str
    date: str
    reason_code: str
    candidate_id: Optional[str]


@dataclass(frozen=True)
class StrictnessFunnelReport:
    total_count: int
    counts_by_category: Mapping[str, int]
    rates_by_category: Mapping[str, float]
    counts_by_strategy_category: Mapping[str, Mapping[str, int]]
    counts_by_date_category: Mapping[str, Mapping[str, int]]
    other_typed_codes_seen: Sequence[str]  # real, unclassified codes -- never silently absorbed into a bucket


def build_strictness_funnel(rows: Sequence[StrictnessRow]) -> StrictnessFunnelReport:
    total = len(rows)
    counts_by_category: Counter = Counter()
    counts_by_strategy_category: Mapping[str, Counter] = defaultdict(Counter)
    counts_by_date_category: Mapping[str, Counter] = defaultdict(Counter)
    other_typed_codes = set()

    for row in rows:
        category = classify_reason_code(row.reason_code)
        counts_by_category[category.value] += 1
        counts_by_strategy_category[row.strategy][category.value] += 1
        counts_by_date_category[row.date][category.value] += 1
        if category == StrictnessCategory.OTHER_TYPED:
            other_typed_codes.add(row.reason_code)

    rates_by_category = {
        category: (count / total if total > 0 else 0.0) for category, count in counts_by_category.items()
    }
    return StrictnessFunnelReport(
        total_count=total, counts_by_category=dict(counts_by_category), rates_by_category=rates_by_category,
        counts_by_strategy_category={strategy: dict(counter) for strategy, counter in counts_by_strategy_category.items()},
        counts_by_date_category={date: dict(counter) for date, counter in counts_by_date_category.items()},
        other_typed_codes_seen=tuple(sorted(other_typed_codes)),
    )
