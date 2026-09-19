"""Stable JSON boundary around bots/theta/quant/features/realized_volatility.py.

Research/shadow only -- this contract has no live Production caller and
confers no broker authority. It exists so a TS caller can request a
one-step-ahead HAR-RV (Corsi, 2009) realized-variance forecast without
reimplementing the fit in TypeScript, per the standing MODEL-001 rule
(baseline-first, no duplicate model).

Leakage-safety: every training pair (features_i, target_{i+1}) uses ONLY
realized-variance observations strictly at or before index i for the
features, and the single already-realized value at i+1 for the target --
never a value from beyond the caller-supplied series. The forecast itself
is for one step AFTER the last index in the supplied series (an unobserved
future value), computed from features that only ever look backward.
"""

from __future__ import annotations

import json
import sys
from math import isfinite, sqrt
from pathlib import Path
from typing import Any, List, Optional

_QUANT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_QUANT_DIR))

from features.realized_volatility import (  # noqa: E402
    HarRvFeatures,
    fit_har_rv_ols,
    har_rv_features,
)

CONTRACT_VERSION = "theta-har-rv-runtime-v1"
MODEL_VERSION = "theta-har-rv-shadow-v1"
ANNUALIZATION_PERIODS = 252


def _required(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise ValueError(f"missing required field: {name}")
    return data[name]


def _series(value: Any) -> List[Optional[float]]:
    if not isinstance(value, list):
        raise ValueError("realizedVarianceSeries must be a list")
    parsed: List[Optional[float]] = []
    for item in value:
        if item is None:
            parsed.append(None)
        elif isinstance(item, (int, float)) and not isinstance(item, bool) and isfinite(float(item)) and item >= 0:
            parsed.append(float(item))
        else:
            raise ValueError("realizedVarianceSeries entries must be finite non-negative numbers or null")
    return parsed


def evaluate_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError(f"contractVersion must equal {CONTRACT_VERSION}")

    snapshot_id = _required(request, "snapshotId")
    timestamp = _required(request, "timestamp")
    as_of = _required(request, "asOf")
    series = _series(_required(request, "realizedVarianceSeries"))
    weekly_window = int(request.get("weeklyWindow", 5))
    monthly_window = int(request.get("monthlyWindow", 22))
    minimum_training_observations = int(request.get("minimumTrainingObservations", 30))
    if weekly_window <= 0 or monthly_window <= 0 or minimum_training_observations <= 0:
        raise ValueError("weeklyWindow, monthlyWindow, and minimumTrainingObservations must be positive")

    base = {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": snapshot_id,
        "timestamp": timestamp,
        "asOf": as_of,
        "modelVersion": MODEL_VERSION,
        "horizonDays": 1,
    }

    if len(series) < monthly_window + 1:
        return {
            **base, "forecastRealizedVariance": None, "forecastRealizedVolatility": None,
            "trainingObservationCount": 0, "dataQuality": "INSUFFICIENT_HISTORY",
            "reason": f"series length {len(series)} is below the minimum monthlyWindow+1={monthly_window + 1}",
        }

    # Build leakage-safe training pairs: features at i (using series[:i+1]
    # only) paired with the ALREADY-REALIZED value at i+1. i ranges only
    # over indices where BOTH i and i+1 are valid series positions.
    training_features: List[HarRvFeatures] = []
    training_targets: List[float] = []
    for i in range(monthly_window - 1, len(series) - 1):
        target = series[i + 1]
        if target is None:
            continue
        feature = har_rv_features(series, i, weekly_window=weekly_window, monthly_window=monthly_window)
        if feature is None:
            continue
        training_features.append(feature)
        training_targets.append(target)

    if len(training_features) < minimum_training_observations:
        return {
            **base, "forecastRealizedVariance": None, "forecastRealizedVolatility": None,
            "trainingObservationCount": len(training_features), "dataQuality": "INSUFFICIENT_HISTORY",
            "reason": f"only {len(training_features)} leakage-safe training pairs, below minimumTrainingObservations={minimum_training_observations}",
        }

    fit = fit_har_rv_ols(training_features, training_targets)
    if fit is None:
        return {
            **base, "forecastRealizedVariance": None, "forecastRealizedVolatility": None,
            "trainingObservationCount": len(training_features), "dataQuality": "UNKNOWN",
            "reason": "OLS fit failed (singular design matrix)",
        }

    current_features = har_rv_features(series, len(series) - 1, weekly_window=weekly_window, monthly_window=monthly_window)
    if current_features is None:
        return {
            **base, "forecastRealizedVariance": None, "forecastRealizedVolatility": None,
            "trainingObservationCount": len(training_features), "dataQuality": "UNKNOWN",
            "reason": "current (as-of) HAR-RV features are UNKNOWN -- likely a gap in the tail of the supplied series",
        }

    forecast_variance = (
        fit.intercept
        + fit.beta_daily * current_features.daily
        + fit.beta_weekly * current_features.weekly
        + fit.beta_monthly * current_features.monthly
    )
    # A forecast realized VARIANCE is not economically meaningful if negative
    # (variance is non-negative by construction) -- a negative OLS output
    # here means the linear fit extrapolated poorly for this observation,
    # reported honestly as UNKNOWN rather than clamped to a fabricated zero.
    if forecast_variance < 0:
        return {
            **base, "forecastRealizedVariance": None, "forecastRealizedVolatility": None,
            "trainingObservationCount": len(training_features), "dataQuality": "UNKNOWN",
            "reason": f"OLS forecast variance was negative ({forecast_variance:.8f}), not clamped to a fabricated zero",
        }

    return {
        **base,
        "forecastRealizedVariance": forecast_variance,
        "forecastRealizedVolatility": sqrt(forecast_variance * ANNUALIZATION_PERIODS),
        "trainingObservationCount": len(training_features),
        "dataQuality": "KNOWN",
        "reason": None,
    }


def main() -> int:
    try:
        request = json.load(sys.stdin)
        response = evaluate_request(request)
        json.dump(response, sys.stdout, sort_keys=True, separators=(",", ":"), allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except (KeyError, TypeError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        json.dump(
            {"contractVersion": CONTRACT_VERSION, "error": {"code": "INVALID_REQUEST", "message": str(error)}},
            sys.stdout,
            sort_keys=True,
            separators=(",", ":"),
        )
        sys.stdout.write("\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
