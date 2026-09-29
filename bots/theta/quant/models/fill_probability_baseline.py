"""Fill-probability baseline, label-fitted (THETA long-run build, work
package 37).

Distinct from `models/execution_quality.py`'s `fill_probability` (a real,
tested, BBO/size-relative HEURISTIC, not label-fitted -- kept, not
duplicated). This module is the label-fitted baseline work package 37
specifically asks for: a real, minimal logistic-regression-style fit over
`(bid, ask, limit_price, quote_size)` -> real BROKER_ACTUAL fill/no-fill
labels. Only ever fits from `truth_class="BROKER_ACTUAL"` labels -- a
`MODELED_RESEARCH`/`SYNTHETIC_FIXTURE` label is rejected explicitly, never
silently included in a fit that would then be reported as if trained on
real fills.

Per work package 37's explicit instruction: if labels are insufficient,
this returns an explicit `INSUFFICIENT_SAMPLE` result, never a forced fit.
As of this session, zero real BROKER_ACTUAL fill labels exist anywhere in
this repository (per WP24's real search: the only real historical episode,
Sep24, never reached a fill -- `qDecision: PASS`) -- so every real caller
of this module today receives `INSUFFICIENT_SAMPLE`, honestly.
"""

from dataclasses import dataclass
from typing import Optional, Sequence


@dataclass(frozen=True)
class FillLabelRow:
    bid: float
    ask: float
    limit_price: float
    quote_size: Optional[int]
    filled: bool
    truth_class: str  # must be "BROKER_ACTUAL" to be used in fitting


@dataclass(frozen=True)
class FillProbabilityFit:
    state: str  # "FITTED" | "INSUFFICIENT_SAMPLE"
    sample_n: int
    minimum_required_n: int
    intercept: Optional[float]
    beta_price_position: Optional[float]  # coefficient on (limit - bid) / (ask - bid)
    beta_quote_size: Optional[float]


def _price_position(row: FillLabelRow) -> Optional[float]:
    if row.ask == row.bid:
        return None
    return (row.limit_price - row.bid) / (row.ask - row.bid)


def fit_fill_probability_baseline(rows: Sequence[FillLabelRow], minimum_required_n: int = 30) -> FillProbabilityFit:
    """A minimal, transparent logistic fit (gradient descent on a 2-feature
    logistic model) over ONLY `truth_class == "BROKER_ACTUAL"` rows. A
    label whose `truth_class` is not `BROKER_ACTUAL` is silently excluded
    from the sample count -- never used to inflate N or bias the fit with
    a modeled/synthetic label masquerading as a real fill outcome.
    """
    real_rows = [row for row in rows if row.truth_class == "BROKER_ACTUAL"]
    usable_rows = [row for row in real_rows if _price_position(row) is not None]
    if len(usable_rows) < minimum_required_n:
        return FillProbabilityFit(
            state="INSUFFICIENT_SAMPLE", sample_n=len(usable_rows), minimum_required_n=minimum_required_n,
            intercept=None, beta_price_position=None, beta_quote_size=None,
        )

    # Minimal logistic regression via gradient descent -- transparent,
    # auditable, no external dependency (matches this repo's baseline-first
    # discipline, MODEL-001).
    intercept, beta_price, beta_size = 0.0, 0.0, 0.0
    learning_rate = 0.1
    features = [
        (1.0, _price_position(row), (row.quote_size or 0) / 100.0, 1.0 if row.filled else 0.0)
        for row in usable_rows
    ]
    for _ in range(500):
        grad_intercept = grad_price = grad_size = 0.0
        for _bias, price_position, size_feature, label in features:
            z = intercept + beta_price * price_position + beta_size * size_feature
            prediction = 1.0 / (1.0 + pow(2.718281828, -z))
            error = prediction - label
            grad_intercept += error
            grad_price += error * price_position
            grad_size += error * size_feature
        n = len(features)
        intercept -= learning_rate * grad_intercept / n
        beta_price -= learning_rate * grad_price / n
        beta_size -= learning_rate * grad_size / n

    return FillProbabilityFit(
        state="FITTED", sample_n=len(usable_rows), minimum_required_n=minimum_required_n,
        intercept=intercept, beta_price_position=beta_price, beta_quote_size=beta_size,
    )


def predict_fill_probability(fit: FillProbabilityFit, bid: float, ask: float, limit_price: float, quote_size: Optional[int]) -> Optional[float]:
    if fit.state != "FITTED" or ask == bid:
        return None
    price_position = (limit_price - bid) / (ask - bid)
    size_feature = (quote_size or 0) / 100.0
    z = fit.intercept + fit.beta_price_position * price_position + fit.beta_quote_size * size_feature
    return 1.0 / (1.0 + pow(2.718281828, -z))
