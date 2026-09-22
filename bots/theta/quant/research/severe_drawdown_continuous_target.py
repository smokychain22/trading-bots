"""Continuous severe-downside target research (directive Item B, sections 5-6).

`severe_drawdown_dataset.py` already materializes the BINARY
BREACHED/SURVIVED/CENSORED label. This module is the genuinely missing
continuous counterpart: forward MAE, timeToMAE, volatility-normalized MAE,
and expected-move-normalized MAE -- computed with the exact same
point-in-time price-path walk, dataset-cutoff censoring, and corporate-
action-ambiguity exclusion conventions as the binary dataset (reusing
`_ambiguous_action` from `severe_drawdown_dataset.py` rather than
re-deriving the ambiguity rule), so the two target families are never
allowed to silently drift apart.

No promotion authority: this module produces a research dataset only. It
never fits a model, never picks a horizon, and never claims a target is
"ready" -- caller-supplied `dataset_cutoff`/`horizon_days` remain
mandatory, versioned inputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional, Sequence

from research.severe_drawdown_dataset import (
    CorporateActionEvidence,
    HistoricalPriceObservation,
    PointInTimeFeatureSnapshot,
    _ambiguous_action,
)


@dataclass(frozen=True)
class ContinuousTargetEpisode:
    episode_id: str
    underlying: str
    decision_date: date
    entry_price: float
    feature_snapshot: PointInTimeFeatureSnapshot
    # PRIOR/PIT-only normalization inputs -- both must be estimated strictly
    # as of decision_date (never using any bar inside the forward horizon).
    # None means genuinely UNKNOWN, never silently defaulted to 1.0/0.0.
    prior_realized_volatility: Optional[float]
    prior_expected_move: Optional[float]


@dataclass(frozen=True)
class ContinuousTargetRow:
    episode_id: str
    underlying: str
    decision_date: date
    horizon_end: date
    dependence_group: str
    censored: bool
    exclusion_reason: Optional[str]
    # The date this row's forward_mae actually became fully known/matured
    # -- None whenever the row is censored or excluded (repair for a
    # defect Codex's A-D acceptance review found, item B: "a training
    # observation is usable only if its outcome/label had fully matured").
    # Mirrors severe_drawdown_dataset.py's MaterializedSevereDrawdownRow.
    # label_available_at naming exactly, so both target families describe
    # outcome maturity the same way. A DOWNSTREAM consumer (the cohort-
    # quantile baseline, the logistic baseline) must treat a row with
    # label_available_at=None as unresolved and never fold it into any
    # other row's training history, regardless of what forward_mae reads.
    label_available_at: Optional[date]
    # Raw forward maximum adverse excursion, as a negative-or-zero fraction
    # of entry_price (0.0 = no adverse move observed at all). For a
    # CENSORED row this is still reported (the partial worst-drawdown
    # observed so far) for descriptive/survival-analysis purposes, but its
    # label_available_at is None -- it must never be treated as a matured
    # ground-truth outcome by a consumer.
    forward_mae: Optional[float]
    # Bars/days from decision_date to the worst point observed. 0 if the
    # worst point IS the decision date itself (no adverse move yet).
    time_to_mae_days: Optional[int]
    volatility_normalized_mae: Optional[float]
    expected_move_normalized_mae: Optional[float]


def _dependence_groups(episodes: Sequence[ContinuousTargetEpisode], horizon_days: int) -> dict:
    groups: dict = {}
    by_underlying: dict = {}
    for episode in episodes:
        by_underlying.setdefault(episode.underlying, []).append(episode)
    for underlying, values in by_underlying.items():
        component = 0
        component_end: Optional[date] = None
        for episode in sorted(values, key=lambda item: (item.decision_date, item.episode_id)):
            end = episode.decision_date + timedelta(days=horizon_days)
            if component_end is None or episode.decision_date > component_end:
                component += 1
                component_end = end
            else:
                component_end = max(component_end, end)
            groups[episode.episode_id] = f"{underlying}:overlap:{component}"
    return groups


def materialize_continuous_target_dataset(
    episodes: Sequence[ContinuousTargetEpisode],
    observations: Sequence[HistoricalPriceObservation],
    corporate_actions: Sequence[CorporateActionEvidence],
    horizon_days: int,
    dataset_cutoff: date,
    dataset_version: str,
) -> Sequence[ContinuousTargetRow]:
    if not dataset_version:
        raise ValueError("dataset_version is required")
    if horizon_days <= 0:
        raise ValueError("horizon_days must be positive")

    groups = _dependence_groups(episodes, horizon_days)
    rows: list[ContinuousTargetRow] = []
    for episode in sorted(episodes, key=lambda item: (item.decision_date, item.underlying, item.episode_id)):
        if episode.entry_price <= 0:
            raise ValueError(f"entry price must be positive: {episode.episode_id}")
        horizon_end = episode.decision_date + timedelta(days=horizon_days)

        if _ambiguous_action(episode, corporate_actions, horizon_end):
            rows.append(ContinuousTargetRow(
                episode_id=episode.episode_id, underlying=episode.underlying,
                decision_date=episode.decision_date, horizon_end=horizon_end,
                dependence_group=groups[episode.episode_id], censored=False,
                exclusion_reason="CORPORATE_ACTION_AMBIGUOUS", label_available_at=None, forward_mae=None,
                time_to_mae_days=None, volatility_normalized_mae=None, expected_move_normalized_mae=None,
            ))
            continue

        # Repair for a defect Codex's A-D acceptance review found (item B):
        # "Do not use same-day adjusted close for an intraday decision if
        # that close occurred after decision time." A decision can be made
        # intraday, well before that same day's own closing price is
        # known -- including decision_date's own adjusted close in the
        # forward-looking price path would let same-day noise (which the
        # decision-maker could not have observed) masquerade as forward
        # risk. The window starts STRICTLY AFTER decision_date.
        prices = sorted(
            (
                item for item in observations
                if item.underlying == episode.underlying
                and item.adjustment in {"SPLIT_ADJUSTED", "ALL_ADJUSTED"}
                and item.adjusted_close > 0
                and episode.decision_date < item.as_of <= min(horizon_end, dataset_cutoff)
            ),
            key=lambda item: item.as_of,
        )
        if not prices:
            rows.append(ContinuousTargetRow(
                episode_id=episode.episode_id, underlying=episode.underlying,
                decision_date=episode.decision_date, horizon_end=horizon_end,
                dependence_group=groups[episode.episode_id], censored=False,
                exclusion_reason="ADJUSTED_PRICE_PATH_UNAVAILABLE", label_available_at=None, forward_mae=None,
                time_to_mae_days=None, volatility_normalized_mae=None, expected_move_normalized_mae=None,
            ))
            continue

        worst_drawdown = 0.0
        worst_date = episode.decision_date
        for point in prices:
            drawdown = (point.adjusted_close - episode.entry_price) / episode.entry_price
            if drawdown < worst_drawdown:
                worst_drawdown = drawdown
                worst_date = point.as_of

        censored = horizon_end > dataset_cutoff
        time_to_mae = (worst_date - episode.decision_date).days

        volatility_normalized_mae = (
            worst_drawdown / episode.prior_realized_volatility
            if episode.prior_realized_volatility is not None and episode.prior_realized_volatility > 0
            else None
        )
        expected_move_normalized_mae = (
            worst_drawdown / episode.prior_expected_move
            if episode.prior_expected_move is not None and episode.prior_expected_move > 0
            else None
        )

        rows.append(ContinuousTargetRow(
            episode_id=episode.episode_id, underlying=episode.underlying,
            decision_date=episode.decision_date, horizon_end=horizon_end,
            dependence_group=groups[episode.episode_id], censored=censored,
            exclusion_reason=None, label_available_at=None if censored else horizon_end,
            forward_mae=worst_drawdown, time_to_mae_days=time_to_mae,
            volatility_normalized_mae=volatility_normalized_mae,
            expected_move_normalized_mae=expected_move_normalized_mae,
        ))
    return tuple(rows)
