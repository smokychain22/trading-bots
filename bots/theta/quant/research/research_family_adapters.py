"""Pipeline adapters: wire the four new research families into the
existing R6 readiness machine (`dataset_readiness.py`, `empirical_
pipeline.py`) without duplicating either.

Each adapter answers ONE question -- "given what is actually in this
dataset export, can family X run right now, and if not, why not" -- and
returns an explicit `AdapterState`, never a fabricated zero or fallback
result. `empirical_pipeline.run_theta_empirical_pipeline` calls these
(see its own new `research_family_results` field) once readiness reaches
`DESCRIPTIVE_AUDIT_ONLY`; this module has no knowledge of Production and
performs no I/O of its own.

IMPORTANT SCHEMA CAVEAT (read before trusting a READY result): `dataset_
contracts.Candidate.contract`/`market`/`volatility` are typed as opaque
`Dict[str, Any]` both here AND in Production's own TypeScript (`point-in-
time-evidence.ts` declares them plain `jsonObject`) -- their INTERNAL key
names are not a confirmed, versioned contract anywhere in this
repository. This module therefore never hardcodes a guessed key name
(e.g. assuming `contract["strike"]` exists). Extraction requires an
explicit `FeatureFieldMap` the caller supplies; with no map, every
extraction correctly yields nothing and the adapter reports `NOT_
APPLICABLE` with the exact missing-mapping reason -- never a silently
empty "success." Confirming the real key names is a narrow, named
`RESEARCH_HANDOFF` item, not something this module invents.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence, Tuple

from research.dataset_contracts import Candidate
from research.iv_realized_vol_research import OhlcBar, close_to_close_rv, compute_vrp, garman_klass_rv, parkinson_rv, rogers_satchell_rv
from research.paper_baseline_dte_bias import BaselineReceiptCandidateRecord, NearMissRecord, build_dte_bias_report
from research.term_structure_research import TermMethod, TermMethodComparison, TermQuotePoint, all_strike_mean_term, atm_relative_term, matched_log_moneyness_term, total_variance_term
from research.volatility_surface_research import SurfacePoint, fit_raw_svi


class AdapterState(str, Enum):
    READY = "READY"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    INVALID_INPUT = "INVALID_INPUT"
    NOT_APPLICABLE = "NOT_APPLICABLE"


@dataclass(frozen=True)
class AdapterResult:
    """One research family's pipeline-integration result. `result` holds
    the underlying research module's own typed output object (never
    re-shaped or summarized into a bare number) -- callers that want
    GOOD/BAD/PROFITABLE-style interpretation must compute it themselves
    from `result`; this contract never renders that judgment."""

    family: str
    state: AdapterState
    blocker: Optional[str]
    n: int
    result: Optional[Any]
    experiment_ids: Tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class FeatureFieldMap:
    """The explicit, caller-supplied mapping from this repository's own
    logical field names to the ACTUAL key names inside a Candidate's
    opaque `contract`/`market`/`volatility` blobs. Every field defaults to
    `None` -- an unmapped field is never guessed, and the adapter that
    depends on it reports `NOT_APPLICABLE` naming exactly which mapping is
    missing."""

    strike_key: Optional[str] = None
    expiration_key: Optional[str] = None
    option_type_key: Optional[str] = None
    log_moneyness_key: Optional[str] = None
    simple_moneyness_key: Optional[str] = None  # a DIFFERENT quantity from log_moneyness_key -- see CONFIRMED_CANDIDATE_FIELD_MAP
    implied_volatility_key: Optional[str] = None
    bid_key: Optional[str] = None
    ask_key: Optional[str] = None
    quote_quality_key: Optional[str] = None
    underlying_price_key: Optional[str] = None
    dte_key: Optional[str] = None


#: The confirmed Production candidate-export field map, per Codex's own
#: `docs/research/THETA_PRODUCTION_RESEARCH_EXPORT_CONTRACT.md` and its
#: `docs/HANDOFF.md` (2026-09-14, "R7 final internal engineering
#: closure") direct answer to this branch's prior `RESEARCH_HANDOFF`:
#: "the exact Production candidate-export keys are contract.strike,
#: contract.expiration, contract.optionType, contract.dte, contract.
#: moneyness, market.bid, market.ask, market.stockPrice, market.
#: dataQuality, and volatility.iv."
#:
#: `log_moneyness_key` is DELIBERATELY left unset: Codex's own contract
#: doc states "moneyness must not be treated as ln(K/F)... forward
#: log-moneyness remains unavailable until a defensible point-in-time
#: forward is persisted." Substituting `contract.moneyness` (simple
#: moneyness) for true forward log-moneyness would be exactly the kind
#: of silent field substitution this repository's own discipline
#: forbids -- so `run_surface_adapter`/`run_term_adapter` correctly stay
#: `NOT_APPLICABLE` under this map until Codex exports a real forward.
#: `simple_moneyness_key` carries the confirmed field separately so a
#: future, EXPLICITLY simple-moneyness-based research path (never fed
#: into the SVI/log-moneyness-based modules) can use it honestly.
CONFIRMED_CANDIDATE_FIELD_MAP = FeatureFieldMap(
    strike_key="strike", expiration_key="expiration", option_type_key="optionType",
    log_moneyness_key=None, simple_moneyness_key="moneyness",
    implied_volatility_key="iv", bid_key="bid", ask_key="ask",
    quote_quality_key="dataQuality", underlying_price_key="stockPrice", dte_key="dte",
)


def _get(blob: Dict[str, Any], key: Optional[str]) -> Optional[Any]:
    if key is None or not isinstance(blob, dict):
        return None
    return blob.get(key)


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


# ---------------------------------------------------------------------------
# Extraction: opaque Candidate blobs -> the research modules' own typed inputs
# ---------------------------------------------------------------------------


def extract_surface_points(candidates: Sequence[Candidate], field_map: FeatureFieldMap) -> Tuple[List[SurfacePoint], str]:
    """Returns (points, blocker). `blocker` is empty string only when
    extraction was attempted (not necessarily successful for every row --
    a row missing a required field is simply skipped, never guessed)."""
    if field_map.log_moneyness_key is None or field_map.implied_volatility_key is None or field_map.dte_key is None:
        return [], "FEATURE_FIELD_MAP_MISSING:log_moneyness_key,implied_volatility_key,dte_key required for surface extraction"
    points: List[SurfacePoint] = []
    for candidate in candidates:
        k = _as_float(_get(candidate.volatility, field_map.log_moneyness_key))
        if k is None:
            # 0.0 is a legitimate ATM log-moneyness -- `or` would wrongly
            # treat it as missing and fall through to the contract blob.
            k = _as_float(_get(candidate.contract, field_map.log_moneyness_key))
        iv = _as_float(_get(candidate.volatility, field_map.implied_volatility_key))
        if k is None or iv is None or iv <= 0:
            continue
        dte = _get(candidate.contract, field_map.dte_key)
        years = (dte / 365.0) if isinstance(dte, (int, float)) and dte > 0 else None
        if years is None:
            continue
        quality = _get(candidate.market, field_map.quote_quality_key) if field_map.quote_quality_key else None
        liquid = quality == "GOOD" if quality is not None else True
        points.append(SurfacePoint(log_moneyness=k, total_variance=iv * iv * years, liquid=liquid))
    return points, ""


def extract_term_points(candidates: Sequence[Candidate], field_map: FeatureFieldMap) -> Tuple[List[TermQuotePoint], str]:
    if field_map.expiration_key is None or field_map.log_moneyness_key is None or field_map.implied_volatility_key is None:
        return [], "FEATURE_FIELD_MAP_MISSING:expiration_key,log_moneyness_key,implied_volatility_key required for term extraction"
    points: List[TermQuotePoint] = []
    for candidate in candidates:
        expiration = _get(candidate.contract, field_map.expiration_key)
        k = _as_float(_get(candidate.volatility, field_map.log_moneyness_key))
        iv = _as_float(_get(candidate.volatility, field_map.implied_volatility_key))
        strike = _as_float(_get(candidate.contract, field_map.strike_key)) if field_map.strike_key else None
        option_type = _get(candidate.contract, field_map.option_type_key) if field_map.option_type_key else None
        quality = _get(candidate.market, field_map.quote_quality_key) if field_map.quote_quality_key else None
        if not isinstance(expiration, str) or k is None or iv is None or iv <= 0:
            continue
        points.append(TermQuotePoint(
            expiration=expiration, strike=strike if strike is not None else 0.0,
            log_moneyness=k, option_type=option_type if isinstance(option_type, str) else "UNKNOWN",
            implied_volatility=iv, liquid=(quality == "GOOD") if quality is not None else True,
        ))
    return points, ""


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------


def run_surface_adapter(
    candidates: Sequence[Candidate], expiry: str, field_map: FeatureFieldMap,
    min_strike_count: int, m_grid: Sequence[float], sigma_grid: Sequence[float],
    experiment_ids: Tuple[str, ...] = (),
) -> AdapterResult:
    points, blocker = extract_surface_points(candidates, field_map)
    if blocker:
        return AdapterResult("VOLATILITY_SURFACE", AdapterState.NOT_APPLICABLE, blocker, 0, None, experiment_ids)
    if len(points) < min_strike_count:
        return AdapterResult(
            "VOLATILITY_SURFACE", AdapterState.INSUFFICIENT_DATA,
            f"{len(points)} usable points < required minimum {min_strike_count}", len(points), None, experiment_ids,
        )
    fit = fit_raw_svi(expiry, points, min_strike_count, m_grid, sigma_grid)
    if fit.evidence_state != "FITTED":
        return AdapterResult("VOLATILITY_SURFACE", AdapterState.INSUFFICIENT_DATA, fit.evidence_state, len(points), fit, experiment_ids)
    return AdapterResult("VOLATILITY_SURFACE", AdapterState.READY, None, len(points), fit, experiment_ids)


class RvMethodName(str, Enum):
    CLOSE_TO_CLOSE = "CLOSE_TO_CLOSE"
    PARKINSON = "PARKINSON"
    GARMAN_KLASS = "GARMAN_KLASS"
    ROGERS_SATCHELL = "ROGERS_SATCHELL"


def run_iv_rv_adapter(
    historical_bars: Optional[Sequence[OhlcBar]], iv_annualized: Optional[float],
    iv_horizon_years: float, rv_horizon_years: float, minimum_sample_size: int,
    horizon_tolerance_years: float, experiment_ids: Tuple[str, ...] = (),
) -> Dict[str, AdapterResult]:
    """Historical OHLC bars are NOT part of the candidate export schema
    (`dataset_contracts.Candidate` carries per-decision feature blobs, not
    a daily price series) -- this adapter therefore requires them as a
    SEPARATE input a caller must supply from wherever historical bars are
    actually sourced, and correctly reports `NOT_APPLICABLE` when absent
    rather than pretending Candidate rows contain them."""
    if historical_bars is None:
        blocker = "HISTORICAL_OHLC_BARS_NOT_SUPPLIED:not part of the candidate/dataset export schema"
        return {method.value: AdapterResult(f"IV_RV_{method.value}", AdapterState.NOT_APPLICABLE, blocker, 0, None, experiment_ids)
                for method in (RvMethodName.CLOSE_TO_CLOSE, RvMethodName.PARKINSON, RvMethodName.GARMAN_KLASS, RvMethodName.ROGERS_SATCHELL)}

    results: Dict[str, AdapterResult] = {}
    for name, fn in (
        (RvMethodName.CLOSE_TO_CLOSE, close_to_close_rv), (RvMethodName.PARKINSON, parkinson_rv),
        (RvMethodName.GARMAN_KLASS, garman_klass_rv), (RvMethodName.ROGERS_SATCHELL, rogers_satchell_rv),
    ):
        estimate = fn(historical_bars, minimum_sample_size)
        if estimate.evidence_state != "ESTIMATED":
            results[name.value] = AdapterResult(f"IV_RV_{name.value}", AdapterState.INSUFFICIENT_DATA, estimate.evidence_state, len(historical_bars), estimate, experiment_ids)
            continue
        vrp = compute_vrp(iv_annualized, iv_horizon_years, estimate, rv_horizon_years, horizon_tolerance_years)
        results[name.value] = AdapterResult(f"IV_RV_{name.value}", AdapterState.READY, None, len(historical_bars), vrp, experiment_ids)
    return results


def run_term_adapter(
    candidates: Sequence[Candidate], near_dte: Optional[int], far_dte: Optional[int],
    field_map: FeatureFieldMap, target_log_moneyness: float, max_moneyness_distance: float,
    experiment_ids: Tuple[str, ...] = (),
) -> AdapterResult:
    points, blocker = extract_term_points(candidates, field_map)
    if blocker:
        return AdapterResult("TERM_STRUCTURE", AdapterState.NOT_APPLICABLE, blocker, 0, None, experiment_ids)
    expirations = sorted({p.expiration for p in points})
    if len(expirations) < 2:
        return AdapterResult("TERM_STRUCTURE", AdapterState.INSUFFICIENT_DATA, "FEWER_THAN_TWO_EXPIRATIONS_WITH_USABLE_QUOTES", len(points), None, experiment_ids)
    near_points = [p for p in points if p.expiration == expirations[0]]
    far_points = [p for p in points if p.expiration == expirations[-1]]
    comparison = TermMethodComparison({
        TermMethod.ALL_STRIKE_MEAN: all_strike_mean_term(near_points, far_points, near_dte, far_dte),
        TermMethod.ATM_RELATIVE: atm_relative_term(near_points, far_points, near_dte, far_dte),
        TermMethod.MATCHED_LOG_MONEYNESS: matched_log_moneyness_term(
            near_points, far_points, near_dte, far_dte, target_log_moneyness, max_moneyness_distance,
        ),
    })
    all_strike = comparison.results_by_method[TermMethod.ALL_STRIKE_MEAN]
    total_variance = total_variance_term(all_strike.near_iv, near_dte, all_strike.far_iv, far_dte)
    comparison.results_by_method[TermMethod.TOTAL_VARIANCE] = total_variance
    return AdapterResult("TERM_STRUCTURE", AdapterState.READY, None, len(points), comparison, experiment_ids)


def run_dte_bias_adapter(
    baseline_receipts: Optional[Sequence[Sequence[BaselineReceiptCandidateRecord]]],
    near_misses: Optional[Sequence[Sequence[NearMissRecord]]],
    minimum_receipts_required: int, skew_share_difference_threshold: float,
    experiment_ids: Tuple[str, ...] = (),
) -> AdapterResult:
    """`theta_paper_active_baseline_receipt`/`theta_near_miss_reevaluation_
    event` (migration 027) are NOT yet part of `postgres-dataset-export.
    ts`'s own SELECT list (confirmed in this branch's parity addendum) --
    this adapter therefore requires the caller to supply already-extracted
    receipt data directly and reports `NOT_APPLICABLE` when none is
    supplied, rather than pretending the current dataset export carries
    it."""
    if baseline_receipts is None:
        return AdapterResult(
            "PAPER_BASELINE_DTE_BIAS", AdapterState.NOT_APPLICABLE,
            "BASELINE_RECEIPTS_NOT_IN_CURRENT_DATASET_EXPORT_SCHEMA", 0, None, experiment_ids,
        )
    report = build_dte_bias_report(
        baseline_receipts, near_misses or [[] for _ in baseline_receipts],
        minimum_receipts_required, skew_share_difference_threshold,
    )
    state = AdapterState.READY if report.sufficient_receipts else AdapterState.INSUFFICIENT_DATA
    blocker = None if report.sufficient_receipts else f"{report.total_receipts} receipts < required minimum {minimum_receipts_required}"
    return AdapterResult("PAPER_BASELINE_DTE_BIAS", state, blocker, report.total_receipts, report, experiment_ids)


# ---------------------------------------------------------------------------
# Companion entry point for `empirical_pipeline.run_theta_empirical_pipeline`
# ---------------------------------------------------------------------------
#
# Deliberately NOT wired directly into `empirical_pipeline.py`'s own
# function signature: that module was ported into, and is independently
# maintained on, canonical main (see `R6_MEGA_PHASE_PARITY_ADDENDUM.md`),
# so changing its signature here would only create a new parity gap for
# Codex to reconcile rather than a real integration. Instead, a caller
# invokes the already-public `run_theta_empirical_pipeline`, and -- once
# its `status == "OK"` -- passes the SAME `LoadedDatasetExport`/
# `ExperimentConfig` it already has to this function. No dataset is
# loaded or validated twice.


def run_all_family_adapters(
    candidates: Sequence[Candidate],
    surface_field_map: FeatureFieldMap,
    term_field_map: FeatureFieldMap,
    near_dte: Optional[int], far_dte: Optional[int], target_expiry: str,
    min_strike_count: int, m_grid: Sequence[float], sigma_grid: Sequence[float],
    target_log_moneyness: float, max_moneyness_distance: float,
    historical_bars: Optional[Sequence[OhlcBar]], iv_annualized: Optional[float],
    iv_horizon_years: float, rv_horizon_years: float, rv_minimum_sample_size: int, horizon_tolerance_years: float,
    baseline_receipts: Optional[Sequence[Sequence[BaselineReceiptCandidateRecord]]],
    near_misses: Optional[Sequence[Sequence[NearMissRecord]]],
    dte_bias_minimum_receipts: int, dte_bias_skew_threshold: float,
) -> Dict[str, AdapterResult]:
    """Runs every family adapter against one dataset's candidates and
    returns a flat, deterministic `{family_key: AdapterResult}` map --
    the single object a caller (CLI, notebook, or a future pipeline step)
    needs to answer "what research is actually runnable on THIS dataset
    right now, and why not otherwise." Every parameter that would
    otherwise be an invented default is required here too, for the same
    reason each underlying adapter requires it."""
    results: Dict[str, AdapterResult] = {}
    surface = run_surface_adapter(candidates, target_expiry, surface_field_map, min_strike_count, m_grid, sigma_grid)
    results[surface.family] = surface
    term = run_term_adapter(candidates, near_dte, far_dte, term_field_map, target_log_moneyness, max_moneyness_distance)
    results[term.family] = term
    for key, result in run_iv_rv_adapter(
        historical_bars, iv_annualized, iv_horizon_years, rv_horizon_years, rv_minimum_sample_size, horizon_tolerance_years,
    ).items():
        results[f"IV_RV_{key}"] = result
    dte_bias = run_dte_bias_adapter(baseline_receipts, near_misses, dte_bias_minimum_receipts, dte_bias_skew_threshold)
    results[dte_bias.family] = dte_bias
    return results
