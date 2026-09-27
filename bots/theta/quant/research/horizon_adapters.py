"""Horizon adapters for Command-5A future observation records (work
package 68).

These adapters never call a provider -- research code has no runtime
network authority (see `docs/OWNERSHIP.md`). Each adapter only computes
the `scheduled_at` timestamp a horizon implies from a decision time, and
normalizes/validates an ALREADY-CAPTURED observation record (however it
got captured -- by Codex's runtime, per the `future_bbo`/`future_iv`/
`future_greeks` entries in `future_capture_contract.py`) into one
canonical `HorizonObservation` shape. A missing field stays `None`
(`UNKNOWN`), never a fabricated/interpolated value.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
from research.production_export_loader import canonical_json, sha256_hex

HORIZONS = {
    '+15m': timedelta(minutes=15), '+1h': timedelta(hours=1), 'EOD': None,  # EOD has no fixed offset -- session-dependent
    '+1d': timedelta(days=1), '+3d': timedelta(days=3), '+5d': timedelta(days=5),
}


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('HORIZON_ADAPTER_TIMESTAMP_TIMEZONE_REQUIRED')
    return result


@dataclass(frozen=True)
class HorizonObservation:
    episode_id: str
    candidate_id: str
    horizon: str
    scheduled_at: Optional[str]  # None only for EOD (session-dependent, not a fixed offset)
    observed_at: Optional[str]
    provider_timestamp: Optional[str]
    truth_class: str
    underlying_price: Optional[float]
    bid: Optional[float]
    ask: Optional[float]
    iv: Optional[float]
    greeks: Optional[Dict[str, float]]
    missing_reason: Optional[str]
    content_hash: str = ''


def scheduled_at_for_horizon(decision_time: str, horizon: str) -> Optional[str]:
    if horizon not in HORIZONS:
        raise ValueError(f'HORIZON_ADAPTER_UNKNOWN_HORIZON:{horizon}')
    offset = HORIZONS[horizon]
    if offset is None:
        return None
    return (_time(decision_time) + offset).isoformat()


def build_horizon_observation(
    episode_id: str, candidate_id: str, horizon: str, decision_time: str, captured: Optional[Dict[str, Any]],
) -> HorizonObservation:
    """`captured` is whatever evidence row (if any) a caller already has
    for this episode/candidate/horizon -- this function never fetches it.
    `captured=None` produces an explicit UNKNOWN observation, not a
    fabricated one."""
    scheduled = scheduled_at_for_horizon(decision_time, horizon)
    if captured is None:
        payload = dict(
            episode_id=episode_id, candidate_id=candidate_id, horizon=horizon, scheduled_at=scheduled,
            observed_at=None, provider_timestamp=None, truth_class='UNKNOWN', underlying_price=None,
            bid=None, ask=None, iv=None, greeks=None, missing_reason='NOT_YET_CAPTURED',
        )
        return HorizonObservation(**payload, content_hash=sha256_hex(canonical_json(payload)))

    observed_at = captured.get('observedAt')
    if observed_at is not None and scheduled is not None and _time(observed_at) < _time(decision_time):
        raise ValueError('HORIZON_ADAPTER_OBSERVATION_BEFORE_DECISION')
    truth_class = captured.get('truthClass')
    if truth_class not in ('BROKER_ACTUAL', 'MARKET_OBSERVED', 'MODELED_RESEARCH', 'UNKNOWN'):
        raise ValueError(f'HORIZON_ADAPTER_UNKNOWN_TRUTH_CLASS:{truth_class}')
    payload = dict(
        episode_id=episode_id, candidate_id=candidate_id, horizon=horizon, scheduled_at=scheduled,
        observed_at=observed_at, provider_timestamp=captured.get('providerTimestamp'), truth_class=truth_class,
        underlying_price=captured.get('underlyingPrice'), bid=captured.get('bid'), ask=captured.get('ask'),
        iv=captured.get('iv'), greeks=captured.get('greeks'), missing_reason=captured.get('missingReason'),
    )
    return HorizonObservation(**payload, content_hash=sha256_hex(canonical_json(payload)))
