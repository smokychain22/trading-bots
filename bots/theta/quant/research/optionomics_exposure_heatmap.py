"""Research consumer for Codex's confirmed Optionomics exposure-heatmap
families -- gamma, Vanna, and Charm (`src/theta/optionomics-provider.ts`,
canonical main `a36ac88`/`92f9fc1`).

Distinct from `optionomics_context_metrics.py`: METRICS returns scalar
per-underlying values (`totalGex`, `gammaFlipStrike`, ...); this module
consumes the HEATMAP shape -- a 2D grid over (strike, expiration) for one
of three metrics (`gamma_exposure`/`vanna_exposure`/`charm_exposure`).
Codex's own normalizer validates the response echoes the EXACT requested
metric before treating it as populated (`if (envelope.metric !==
expectedMetric) return null`) -- this module preserves that same
discipline: it never accepts a grid whose `metric` field doesn't match
what was requested.

Standing invariant, carried through every result: Optionomics documents
`valueUnits: 'PROVIDER_REPORTED_UNVERIFIED'` and `signConvention:
'PROVIDER_DEFINITION_UNVERIFIED'` for these grids -- Codex's own known
limitation ("Vanna/Charm units, sign convention, methodology, and
point-in-time availability still require provider documentation or
empirical research before quantitative use," 2026-09-14 handoff). This
module therefore NEVER asserts a directional or magnitude claim from a
cell value -- it only classifies structure (which cell is nearest a
given strike/expiration, whether the grid is populated at all), exactly
like `gamma_regime_research.py`'s refusal to interpret a GEX sign without
an explicit verification flag.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class HeatmapMetric(str, Enum):
    """Mirrors `OptionomicsHeatmapMetric` in `optionomics-provider.ts`
    exactly -- the three CONFIRMED metric values, not guessed."""

    GAMMA_EXPOSURE = "gamma_exposure"
    VANNA_EXPOSURE = "vanna_exposure"
    CHARM_EXPOSURE = "charm_exposure"


@dataclass(frozen=True)
class ExposureHeatmapCell:
    """One (strike, expiration) cell. `value` is the provider-reported
    number under its OWN unverified units/sign convention -- never
    interpreted as a directional signal by this module."""

    strike: Optional[float]
    expiration: Optional[str]
    value: Optional[float]


@dataclass(frozen=True)
class ExposureHeatmapGrid:
    metric: HeatmapMetric
    strikes: Tuple[float, ...]
    expirations: Tuple[str, ...]
    cells: Tuple[ExposureHeatmapCell, ...]
    value_units: str  # always "PROVIDER_REPORTED_UNVERIFIED" when parsed from a real observation
    sign_convention: str  # always "PROVIDER_DEFINITION_UNVERIFIED"
    populated: bool


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _parse_cell(raw: Any) -> Optional[ExposureHeatmapCell]:
    if not isinstance(raw, dict):
        return None
    strike = _as_float(raw.get("strike"))
    expiration = raw.get("expiration") if isinstance(raw.get("expiration"), str) else None
    value = _as_float(raw.get("value"))
    return ExposureHeatmapCell(strike=strike, expiration=expiration, value=value)


def parse_exposure_heatmap(
    expected_metric: HeatmapMetric, normalized: Dict[str, Any],
) -> Optional[ExposureHeatmapGrid]:
    """Parses Codex's normalized heatmap record. Returns None -- never a
    fabricated grid -- whenever the response's own `metric` field does
    not match `expected_metric` (mirrors Codex's own `normalizeHeatmap`
    metric-echo check) or the payload shape is not recognizable."""
    if normalized.get("metric") != expected_metric.value:
        return None
    raw_cells = normalized.get("cells")
    if not isinstance(raw_cells, list):
        return None
    cells: List[ExposureHeatmapCell] = []
    for raw_cell in raw_cells:
        parsed = _parse_cell(raw_cell)
        if parsed is not None:
            cells.append(parsed)
    strikes = tuple(_as_float(s) for s in normalized.get("strikes", []) if _as_float(s) is not None)
    expirations = tuple(e for e in normalized.get("expirations", []) if isinstance(e, str))
    return ExposureHeatmapGrid(
        metric=expected_metric, strikes=strikes, expirations=expirations, cells=tuple(cells),
        value_units=str(normalized.get("valueUnits", "PROVIDER_REPORTED_UNVERIFIED")),
        sign_convention=str(normalized.get("signConvention", "PROVIDER_DEFINITION_UNVERIFIED")),
        populated=len(cells) > 0,
    )


def nearest_cell_to_strike(grid: ExposureHeatmapGrid, target_strike: float, expiration: Optional[str] = None) -> Optional[ExposureHeatmapCell]:
    """Returns the cell whose strike is closest to `target_strike`,
    optionally restricted to one expiration. None -- never a guess --
    when the grid is empty or no cell has a known strike."""
    candidates = [c for c in grid.cells if c.strike is not None and (expiration is None or c.expiration == expiration)]
    if not candidates:
        return None
    return min(candidates, key=lambda c: abs(c.strike - target_strike))  # type: ignore[arg-type]


def grid_value_range(grid: ExposureHeatmapGrid) -> Optional[Tuple[float, float]]:
    """(min, max) of all KNOWN cell values -- a purely structural summary
    (how much does this grid vary), never a directional interpretation.
    None when no cell has a known value."""
    values = [c.value for c in grid.cells if c.value is not None]
    if not values:
        return None
    return min(values), max(values)
