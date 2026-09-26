"""COMMAND 5C-7 item 13: the Python-side runner that turns a real, versioned
research campaign (a set of per-trial normalized return series) into the
typed `SelectionBiasReceipt` TypeScript expects (`src/research/
selection-bias-receipt.ts`). This module does NOT reimplement DSR/PBO math
-- it computes plain descriptive statistics (mean, sample standard
deviation, skewness, kurtosis, variance-across-trial-Sharpes) from a real
input series and passes them into the existing, unmodified
`deflated_sharpe_ratio` / `probability_of_backtest_overfitting` functions in
`selection_bias.py`.

Input contract (read from a JSON file or stdin): a `SelectionBiasCampaignInput`
with one non-empty return series PER TRIAL, all trials' series sharing the
same partition count (required for PBO's rectangular performance matrix).
`returnNormalizationVersion` is mandatory -- this runner refuses raw,
un-normalized dollar P&L (see `return_normalization` docstring for the
allowed bases). This module has zero broker authority: it reads a JSON file,
computes statistics, and writes a JSON receipt. It never touches a broker,
Production database, or the live worker.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Dict, List, Sequence

from research.selection_bias import DsrInputs, deflated_sharpe_ratio, probability_of_backtest_overfitting

SELECTION_BIAS_RUNNER_VERSION = "theta-selection-bias-runner-v1"

# Must match `return-normalization.ts`'s ReturnNormalizationVersion values --
# this runner refuses to run without an explicit, pre-registered basis.
ALLOWED_RETURN_NORMALIZATION_VERSIONS = frozenset({
    "capital-at-risk-return-v1",
    "capital-day-return-v1",
    "max-loss-normalized-return-v1",
    "collateral-normalized-return-v1",
})


class SelectionBiasRunnerError(Exception):
    pass


def _pearson_kurtosis(series: Sequence[float]) -> float:
    n = len(series)
    mean = statistics.fmean(series)
    variance = statistics.pvariance(series, mean)
    if variance <= 0:
        return 3.0  # a constant series has no meaningful excess/deficit; treat as normal-convention default
    m4 = sum((x - mean) ** 4 for x in series) / n
    return m4 / (variance ** 2)


def _sample_skewness(series: Sequence[float]) -> float:
    n = len(series)
    mean = statistics.fmean(series)
    stdev = statistics.pstdev(series, mean)
    if stdev <= 0:
        return 0.0
    m3 = sum((x - mean) ** 3 for x in series) / n
    return m3 / (stdev ** 3)


def _sharpe(series: Sequence[float]) -> float:
    """Plain per-period Sharpe (mean / population stdev) of a normalized
    return series -- not annualized here; annualization, if wanted, is a
    caller-side presentation concern, not part of this receipt."""
    mean = statistics.fmean(series)
    stdev = statistics.pstdev(series, mean)
    if stdev <= 0:
        return 0.0
    return mean / stdev


def run_selection_bias_campaign(campaign: Dict[str, object]) -> Dict[str, object]:
    """`campaign` must contain: researchCampaignId (str), returnNormalizationVersion (str),
    trialIdentities (list[str]), trialReturnSeries (dict[trialId -> list[float]] with
    every series the same length -- the rectangular partition count PBO requires),
    inputDatasetHash (str), dependencyGroupingVersion (str), codeSha (str)."""
    campaign_id = campaign.get("researchCampaignId")
    normalization = campaign.get("returnNormalizationVersion")
    trial_identities = campaign.get("trialIdentities")
    trial_series = campaign.get("trialReturnSeries")
    dataset_hash = campaign.get("inputDatasetHash")
    grouping_version = campaign.get("dependencyGroupingVersion")
    code_sha = campaign.get("codeSha")

    if not isinstance(campaign_id, str) or not campaign_id:
        raise SelectionBiasRunnerError("SELECTION_BIAS_RUNNER_CAMPAIGN_ID_REQUIRED")
    if not isinstance(normalization, str) or normalization not in ALLOWED_RETURN_NORMALIZATION_VERSIONS:
        raise SelectionBiasRunnerError(
            f"SELECTION_BIAS_RUNNER_RETURN_NORMALIZATION_INVALID: must be one of {sorted(ALLOWED_RETURN_NORMALIZATION_VERSIONS)}"
        )
    if not isinstance(trial_identities, list) or not trial_identities:
        raise SelectionBiasRunnerError("SELECTION_BIAS_RUNNER_TRIAL_IDENTITIES_REQUIRED")
    if len(set(trial_identities)) != len(trial_identities):
        raise SelectionBiasRunnerError("SELECTION_BIAS_RUNNER_DUPLICATE_TRIAL_IDENTITY")
    if not isinstance(trial_series, dict):
        raise SelectionBiasRunnerError("SELECTION_BIAS_RUNNER_TRIAL_RETURN_SERIES_REQUIRED")
    for trial_id in trial_identities:
        if trial_id not in trial_series:
            raise SelectionBiasRunnerError(f"SELECTION_BIAS_RUNNER_MISSING_SERIES_FOR_TRIAL:{trial_id}")
    for name in ("inputDatasetHash", "dependencyGroupingVersion", "codeSha"):
        if not isinstance(campaign.get(name), str) or not campaign.get(name):
            raise SelectionBiasRunnerError(f"SELECTION_BIAS_RUNNER_{name.upper()}_REQUIRED")

    series_by_trial: Dict[str, List[float]] = {tid: [float(x) for x in trial_series[tid]] for tid in trial_identities}
    lengths = {len(series) for series in series_by_trial.values()}
    if any(length < 2 for length in lengths):
        raise SelectionBiasRunnerError("SELECTION_BIAS_RUNNER_SERIES_TOO_SHORT")

    # This campaign's own subject trial is always the first identity by
    # convention -- the runner does not guess which trial is "the" result;
    # the caller's ordering is the contract.
    subject_id = trial_identities[0]
    subject_series = series_by_trial[subject_id]
    n_trials = len(trial_identities)

    trial_sharpes = [_sharpe(series_by_trial[tid]) for tid in trial_identities]
    variance_of_trial_sharpes = statistics.pvariance(trial_sharpes) if n_trials > 1 else None

    dsr_inputs = DsrInputs(
        observed_sharpe=_sharpe(subject_series),
        n_observations=len(subject_series),
        skewness=_sample_skewness(subject_series),
        kurtosis=_pearson_kurtosis(subject_series),
        n_trials=n_trials,
        variance_of_trial_sharpes=variance_of_trial_sharpes,
    )
    dsr_result = deflated_sharpe_ratio(dsr_inputs)

    # PBO's performance matrix requires equal-length, EVEN partition counts
    # across every trial -- if the real campaign's series lengths differ
    # (a real, honest possibility with independent episodes), PBO is
    # reported UNKNOWN via its own min_partitions/rectangular guard rather
    # than truncated/padded here.
    if len(lengths) == 1:
        partition_count = next(iter(lengths))
        performance_matrix = [series_by_trial[tid] for tid in trial_identities]
        pbo_result = probability_of_backtest_overfitting(performance_matrix)
    else:
        pbo_result = probability_of_backtest_overfitting([[0.0, 0.0]], min_candidates=999999)

    if dsr_result.deflated_sharpe_ratio is None:
        dsr_p_value = None
    else:
        dsr_p_value = 1.0 - dsr_result.deflated_sharpe_ratio

    receipt = {
        "contractVersion": "theta-selection-bias-receipt-v1",
        "researchCampaignId": campaign_id,
        "returnNormalizationVersion": normalization,
        "numberOfTrials": n_trials,
        "trialIdentities": list(trial_identities),
        "dsr": None if dsr_result.deflated_sharpe_ratio is None else {
            "deflatedSharpeRatio": dsr_result.deflated_sharpe_ratio,
            "expectedMaxSharpeUnderNull": dsr_result.expected_max_sharpe_under_multiple_testing,
            "pValue": dsr_p_value,
        },
        "pbo": None if pbo_result.probability_of_overfitting is None else {
            "probabilityOfBacktestOverfitting": pbo_result.probability_of_overfitting,
            "numberOfCombinatorialSplits": len(pbo_result.logit_values),
        },
        "inputDatasetHash": dataset_hash,
        "dependencyGroupingVersion": grouping_version,
        "codeSha": code_sha,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "runnerVersion": SELECTION_BIAS_RUNNER_VERSION,
        "diagnostics": {
            "dsrReasons": dsr_result.reasons,
            "pboReasons": pbo_result.reasons,
        },
    }
    return receipt


def main() -> int:
    raw = sys.stdin.read() if len(sys.argv) < 2 else open(sys.argv[1], "r", encoding="utf-8").read()
    try:
        campaign = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"SELECTION_BIAS_RUNNER_INVALID_JSON: {exc}"}))
        return 1
    try:
        receipt = run_selection_bias_campaign(campaign)
    except SelectionBiasRunnerError as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    print(json.dumps(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
