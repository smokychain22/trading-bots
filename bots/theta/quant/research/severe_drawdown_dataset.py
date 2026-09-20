"""Policy-neutral point-in-time severe-drawdown dataset materialization.

The caller supplies the complete SevereDrawdownLabelSpec. This module never
chooses a horizon or threshold and never promotes a dataset or model.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from hashlib import sha256
import json
from typing import Dict, Mapping, Optional, Sequence, Tuple

from models.severe_drawdown_spec import (
    LabelStatus,
    PricePoint,
    SevereDrawdownLabelResult,
    SevereDrawdownLabelSpec,
    compute_severe_drawdown_label,
)


@dataclass(frozen=True)
class HistoricalPriceObservation:
    underlying: str
    as_of: date
    adjusted_close: float
    provider: str
    feed: str
    retrieved_at: str
    data_version: str
    adjustment: str


@dataclass(frozen=True)
class CorporateActionEvidence:
    underlying: str
    effective_date: date
    action_type: str
    state: str  # VERIFIED_ADJUSTED, VERIFIED_NO_PRICE_BREAK, AMBIGUOUS
    provider: str
    known_at: str


@dataclass(frozen=True)
class PointInTimeFeatureSnapshot:
    underlying: str
    decision_date: date
    feature_available_at: str
    feature_version: str
    values: Mapping[str, Optional[float]]
    missing_features: Tuple[str, ...]


@dataclass(frozen=True)
class SevereDrawdownEpisode:
    episode_id: str
    underlying: str
    decision_date: date
    entry_price: float
    feature_snapshot: PointInTimeFeatureSnapshot


@dataclass(frozen=True)
class MaterializedSevereDrawdownRow:
    episode_id: str
    underlying: str
    decision_date: date
    horizon_end: date
    dependence_group: str
    feature_snapshot: PointInTimeFeatureSnapshot
    label: Optional[SevereDrawdownLabelResult]
    exclusion_reason: Optional[str]
    label_available_at: Optional[date]


@dataclass(frozen=True)
class SevereDrawdownDataset:
    dataset_version: str
    label_spec_version: str
    provider_sources: Tuple[str, ...]
    feed_sources: Tuple[str, ...]
    rows: Tuple[MaterializedSevereDrawdownRow, ...]
    content_hash: str


def _iso_instant_on_or_before_day(value: str, cutoff: date) -> bool:
    try:
        return date.fromisoformat(value[:10]) <= cutoff
    except (TypeError, ValueError):
        return False


def _ambiguous_action(
    episode: SevereDrawdownEpisode,
    actions: Sequence[CorporateActionEvidence],
    horizon_end: date,
) -> bool:
    return any(
        item.underlying == episode.underlying
        and episode.decision_date <= item.effective_date <= horizon_end
        and item.state == "AMBIGUOUS"
        for item in actions
    )


def _dependence_groups(
    episodes: Sequence[SevereDrawdownEpisode], horizon_days: int
) -> Dict[str, str]:
    groups: Dict[str, str] = {}
    by_underlying: Dict[str, list[SevereDrawdownEpisode]] = {}
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


def materialize_severe_drawdown_dataset(
    episodes: Sequence[SevereDrawdownEpisode],
    observations: Sequence[HistoricalPriceObservation],
    corporate_actions: Sequence[CorporateActionEvidence],
    spec: SevereDrawdownLabelSpec,
    dataset_cutoff: date,
    dataset_version: str,
) -> SevereDrawdownDataset:
    if not dataset_version:
        raise ValueError("dataset_version is required")
    if spec.horizon_days <= 0 or spec.threshold_value <= 0:
        raise ValueError("label spec horizon and threshold must be positive")
    groups = _dependence_groups(episodes, spec.horizon_days)
    rows: list[MaterializedSevereDrawdownRow] = []
    for episode in sorted(episodes, key=lambda item: (item.decision_date, item.underlying, item.episode_id)):
        if episode.entry_price <= 0:
            raise ValueError(f"entry price must be positive: {episode.episode_id}")
        if not _iso_instant_on_or_before_day(episode.feature_snapshot.feature_available_at, episode.decision_date):
            raise ValueError(f"FEATURE_AFTER_DECISION:{episode.episode_id}")
        horizon_end = episode.decision_date + timedelta(days=spec.horizon_days)
        exclusion_reason: Optional[str] = None
        label: Optional[SevereDrawdownLabelResult] = None
        if _ambiguous_action(episode, corporate_actions, horizon_end):
            exclusion_reason = "CORPORATE_ACTION_AMBIGUOUS"
        else:
            prices = [
                PricePoint(item.as_of, item.adjusted_close)
                for item in observations
                if item.underlying == episode.underlying
                and item.adjustment in {"SPLIT_ADJUSTED", "ALL_ADJUSTED"}
                and item.adjusted_close > 0
            ]
            if not prices:
                exclusion_reason = "ADJUSTED_PRICE_PATH_UNAVAILABLE"
            else:
                label = compute_severe_drawdown_label(
                    episode.entry_price, episode.decision_date, prices, spec, dataset_cutoff
                )
        if label is None or label.status == LabelStatus.CENSORED:
            label_available_at = None
        elif label.status == LabelStatus.BREACHED:
            label_available_at = label.breach_date
        else:
            label_available_at = horizon_end
        rows.append(MaterializedSevereDrawdownRow(
            episode_id=episode.episode_id,
            underlying=episode.underlying,
            decision_date=episode.decision_date,
            horizon_end=horizon_end,
            dependence_group=groups[episode.episode_id],
            feature_snapshot=episode.feature_snapshot,
            label=label,
            exclusion_reason=exclusion_reason,
            label_available_at=label_available_at,
        ))
    identity = {
        "datasetVersion": dataset_version,
        "labelSpecVersion": spec.spec_version,
        "rows": [
            {
                "episodeId": row.episode_id,
                "underlying": row.underlying,
                "decisionDate": row.decision_date.isoformat(),
                "horizonEnd": row.horizon_end.isoformat(),
                "dependenceGroup": row.dependence_group,
                "featureVersion": row.feature_snapshot.feature_version,
                "label": row.label.status.value if row.label else None,
                "exclusionReason": row.exclusion_reason,
            }
            for row in rows
        ],
    }
    digest = sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return SevereDrawdownDataset(
        dataset_version=dataset_version,
        label_spec_version=spec.spec_version,
        provider_sources=tuple(sorted({item.provider for item in observations})),
        feed_sources=tuple(sorted({item.feed for item in observations})),
        rows=tuple(rows),
        content_hash=digest,
    )
