"""Selection-bias diagnostics for THETA's model/strategy search (R6B).

Implements the Deflated Sharpe Ratio (DSR, Bailey & Lopez de Prado 2014)
and the Probability of Backtest Overfitting (PBO, Bailey, Borwein, Lopez
de Prado & Zhu 2015-style combinatorially symmetric cross-validation),
per the explicit R6B directive: a defense against strategy mining and
multiple testing, not a rubber stamp for a small dataset.

Neither metric here has ever been run against real THETA data -- no real
historical option-chain dataset exists yet
(`docs/research/THETA_EV_MODEL_SPEC.md`'s EV_MODEL_NOT_EMPIRICALLY_READY
status, unchanged by this module). Both are pure, deterministic
functions over already-computed return/ranking series, exercised only
against synthetic fixtures in this module's own test suite.

Do not treat raw Sharpe (or raw EV) as sufficient evidence on its own --
that is exactly the multiple-testing trap this module exists to guard
against.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations
from typing import List, Optional, Sequence


# ---------------------------------------------------------------------------
# Deflated Sharpe Ratio
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DsrInputs:
    observed_sharpe: float  # the strategy's own realized (non-annualized-unless-stated) Sharpe ratio
    n_observations: int  # sample length (number of return observations the Sharpe was computed over)
    skewness: float  # sample skewness of the return series (0.0 for a symmetric distribution)
    kurtosis: float  # sample PEARSON (non-excess) kurtosis -- 3.0 for a normal distribution, > 3.0 for fat tails (never excess kurtosis, which would be 0.0 for normal -- the Mertens/DSR variance formula below is written in terms of the standard, non-excess convention)
    n_trials: int  # number of independent strategy variants actually searched, INCLUDING this one
    variance_of_trial_sharpes: Optional[float]  # var(Sharpe) across the n_trials candidates, if known; None if only n_trials is known


@dataclass(frozen=True)
class DsrResult:
    observed_sharpe: float
    expected_max_sharpe_under_multiple_testing: Optional[float]
    deflated_sharpe_ratio: Optional[float]  # a probability in [0, 1]: P(true Sharpe > 0 | observed, adjusted for n_trials)
    reasons: List[str]


def _expected_max_sharpe(n_trials: int, variance_of_trial_sharpes: float) -> float:
    """Expected maximum Sharpe ratio across `n_trials` INDEPENDENT trials
    under the null (true Sharpe = 0), per Bailey & Lopez de Prado's own
    approximation using the expected maximum of `n_trials` draws from a
    standard normal, scaled by the cross-trial Sharpe STANDARD DEVIATION
    (sigma, not variance -- a real bug caught by Codex review: the formula
    below is written in units of Sharpe, so it must be scaled by sigma =
    sqrt(variance), never by variance itself, or the hurdle silently uses
    the wrong units whenever variance != 1). Uses the classical extreme-
    value approximation:

        E[max] ~= sigma * ((1 - gamma) * Z^-1(1 - 1/N) + gamma * Z^-1(1 - 1/(N*e)))

    where gamma is the Euler-Mascheroni constant and Z^-1 is the standard
    normal inverse CDF. `n_trials=1` has no multiple-testing inflation at
    all (expected max = 0, no deflation beyond the single-trial baseline).
    """
    if n_trials <= 1:
        return 0.0
    if variance_of_trial_sharpes < 0:
        raise ValueError(f"variance_of_trial_sharpes must be >= 0, got {variance_of_trial_sharpes}")
    sigma_of_trial_sharpes = math.sqrt(variance_of_trial_sharpes)
    euler_mascheroni = 0.5772156649015329
    z_inv_1 = _normal_inverse_cdf(1.0 - 1.0 / n_trials)
    z_inv_2 = _normal_inverse_cdf(1.0 - 1.0 / (n_trials * math.e))
    return sigma_of_trial_sharpes * ((1 - euler_mascheroni) * z_inv_1 + euler_mascheroni * z_inv_2)


def _normal_inverse_cdf(p: float) -> float:
    """Acklam's rational approximation to the standard normal inverse
    CDF -- accurate to ~1.15e-9, no scipy/numpy dependency (consistent
    with this module's own dependency-free convention, mirroring
    baseline_models.py's pure-Python ridge solver)."""
    if not (0.0 < p < 1.0):
        raise ValueError(f"p must be in (0, 1), got {p}")

    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]

    p_low, p_high = 0.02425, 1 - 0.02425
    if p < p_low:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p <= p_high:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
               (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    q = math.sqrt(-2 * math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def deflated_sharpe_ratio(inputs: DsrInputs) -> DsrResult:
    """Computes the DSR: the probability that the strategy's TRUE Sharpe
    ratio exceeds zero, after deflating the observed Sharpe by the
    expected maximum Sharpe one would see by chance across `n_trials`
    independent searched variants, and correcting the standard error for
    a non-normal (skewed/fat-tailed) return distribution.

    Returns deflated_sharpe_ratio=None (never a fabricated confidence)
    when the inputs cannot support a real estimate: fewer than 2
    observations, or `n_trials` > 1 with no variance estimate supplied
    (the expected-max-Sharpe term is meaningless without knowing how
    spread out the trial Sharpes were).
    """
    reasons: List[str] = []

    if inputs.n_observations < 2:
        reasons.append("n_observations < 2 -- insufficient sample to estimate a standard error at all")
        return DsrResult(observed_sharpe=inputs.observed_sharpe, expected_max_sharpe_under_multiple_testing=None, deflated_sharpe_ratio=None, reasons=reasons)

    if inputs.n_trials < 1:
        reasons.append("n_trials must be >= 1")
        return DsrResult(observed_sharpe=inputs.observed_sharpe, expected_max_sharpe_under_multiple_testing=None, deflated_sharpe_ratio=None, reasons=reasons)

    if inputs.n_trials > 1 and inputs.variance_of_trial_sharpes is None:
        reasons.append("n_trials > 1 but variance_of_trial_sharpes was not supplied -- cannot compute the multiple-testing hurdle without it")
        return DsrResult(observed_sharpe=inputs.observed_sharpe, expected_max_sharpe_under_multiple_testing=None, deflated_sharpe_ratio=None, reasons=reasons)

    expected_max = _expected_max_sharpe(inputs.n_trials, inputs.variance_of_trial_sharpes or 0.0)
    if inputs.n_trials > 1:
        reasons.append(f"deflated observed Sharpe against expected max of {inputs.n_trials} trials = {expected_max:.4f}")
    else:
        reasons.append("n_trials=1 -- no multiple-testing deflation applied")

    # Standard error of the Sharpe ratio estimator, corrected for skew/
    # kurtosis (Mertens 2002 / Bailey & Lopez de Prado's own formula):
    n = inputs.n_observations
    sr = inputs.observed_sharpe
    skew = inputs.skewness
    kurt = inputs.kurtosis
    variance_term = (1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr) / (n - 1)
    if variance_term <= 0:
        reasons.append("non-positive variance term (pathological skew/kurtosis for this Sharpe/N combination) -- cannot compute a safe standard error")
        return DsrResult(observed_sharpe=sr, expected_max_sharpe_under_multiple_testing=expected_max, deflated_sharpe_ratio=None, reasons=reasons)
    standard_error = math.sqrt(variance_term)

    z = (sr - expected_max) / standard_error
    dsr = _normal_cdf(z)

    reasons.append(f"DSR={dsr:.4f}: probability the true Sharpe exceeds zero after deflation")
    return DsrResult(observed_sharpe=sr, expected_max_sharpe_under_multiple_testing=expected_max, deflated_sharpe_ratio=dsr, reasons=reasons)


# ---------------------------------------------------------------------------
# Probability of Backtest Overfitting (combinatorially symmetric CV)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PboResult:
    n_candidates: int
    n_partitions: int
    probability_of_overfitting: Optional[float]  # fraction of combinatorial splits where the IS-best candidate ranks in the OOS-worst half
    logit_values: List[float]
    reasons: List[str]


def probability_of_backtest_overfitting(
    performance_matrix: Sequence[Sequence[float]],
    min_candidates: int = 2,
    min_partitions: int = 2,
) -> PboResult:
    """Combinatorially Symmetric Cross-Validation PBO, per Bailey/Borwein/
    Lopez de Prado/Zhu: `performance_matrix[i][t]` is candidate strategy
    `i`'s performance (e.g. per-period return or EV) in time partition
    `t`. For every way of splitting the partitions into two equal-size
    halves (IS, OOS), the candidate ranked BEST in-sample is checked
    against its OOS rank; if that candidate's OOS performance rank falls
    in the bottom half, that split contributes to overfitting evidence.
    PBO is the fraction of splits where this occurs.

    Returns probability_of_overfitting=None (UNKNOWN, never a fabricated
    number) when there are fewer than `min_candidates` strategies or
    fewer than `min_partitions` time partitions -- PBO cannot rescue an
    undersized study, per the explicit instruction.
    """
    reasons: List[str] = []
    n_candidates = len(performance_matrix)
    n_partitions = len(performance_matrix[0]) if n_candidates > 0 else 0

    if n_candidates < min_candidates:
        reasons.append(f"only {n_candidates} candidate(s), fewer than the required minimum {min_candidates}")
        return PboResult(n_candidates=n_candidates, n_partitions=n_partitions, probability_of_overfitting=None, logit_values=[], reasons=reasons)
    if n_partitions < min_partitions:
        reasons.append(f"only {n_partitions} time partition(s), fewer than the required minimum {min_partitions}")
        return PboResult(n_candidates=n_candidates, n_partitions=n_partitions, probability_of_overfitting=None, logit_values=[], reasons=reasons)
    if n_partitions % 2 != 0:
        reasons.append("n_partitions must be even to split into two equal IS/OOS halves under this CSCV scheme")
        return PboResult(n_candidates=n_candidates, n_partitions=n_partitions, probability_of_overfitting=None, logit_values=[], reasons=reasons)

    half = n_partitions // 2
    all_partition_indices = list(range(n_partitions))
    logit_values: List[float] = []
    overfit_count = 0
    total_splits = 0

    for is_indices in combinations(all_partition_indices, half):
        is_set = set(is_indices)
        oos_indices = [i for i in all_partition_indices if i not in is_set]

        is_scores = [sum(performance_matrix[c][t] for t in is_indices) for c in range(n_candidates)]
        oos_scores = [sum(performance_matrix[c][t] for t in oos_indices) for c in range(n_candidates)]

        best_is_candidate = max(range(n_candidates), key=lambda c: is_scores[c])

        # OOS rank of the IS-best candidate, as a relative rank in (0, 1]
        # where 1.0 = best OOS performer, closer to 0 = worst. Ties in
        # oos_scores are given the AVERAGE rank of the tied group (standard
        # fractional/mid-rank convention) rather than an arbitrary sort-
        # stable position -- an unbroken tie must not silently bias the
        # IS-best candidate's apparent OOS standing in either direction.
        best_score = oos_scores[best_is_candidate]
        n_strictly_worse = sum(1 for c in range(n_candidates) if oos_scores[c] < best_score)
        n_tied = sum(1 for c in range(n_candidates) if oos_scores[c] == best_score)
        average_rank_position = n_strictly_worse + (n_tied - 1) / 2.0  # 0-indexed average position among ties
        relative_rank = (average_rank_position + 1) / n_candidates  # in (0, 1]

        logit = math.log(relative_rank / (1.0 - relative_rank)) if 0 < relative_rank < 1 else (float("inf") if relative_rank >= 1 else float("-inf"))
        if math.isfinite(logit):
            logit_values.append(logit)

        if relative_rank <= 0.5:
            overfit_count += 1
        total_splits += 1

    pbo = overfit_count / total_splits if total_splits > 0 else None
    if pbo is not None:
        reasons.append(f"PBO={pbo:.4f} across {total_splits} combinatorial IS/OOS splits of {n_candidates} candidates")

    return PboResult(n_candidates=n_candidates, n_partitions=n_partitions, probability_of_overfitting=pbo, logit_values=logit_values, reasons=reasons)
