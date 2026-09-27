"""T0 research adapter (THETA long-run build, work package 28).

Consumes the EXACT persisted `T0ReplayBundle` JSON shape Phase 1 already
built and wired on the TypeScript side
(`src/theta/t0-replay-bundle.ts`'s `T0ReplayBundleSchema` -- `snapshotId`,
`timestamp`, `strategyVersion`, `contracts`, `routing`, `stock`,
`assignmentCapacityQty`, `aegisNewRiskState`, `eventState`,
`unmanagedBrokerPositionCount`, `unevaluatedUnderlyingCount`,
`optionomicsContext`) -- never a second, competing bundle schema. This
module only reads an already-persisted dict; it makes no provider call of
its own.
"""

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence


@dataclass(frozen=True)
class T0ResearchRow:
    """One quant research row derived from a real, persisted T0 bundle --
    never re-fetched, only transformed."""
    snapshot_id: str
    timestamp: str
    strategy_version: str
    underlying_symbol: Optional[str]
    contract_count: int
    routing_present: bool
    stock_held: bool
    assignment_capacity_qty: Optional[float]
    aegis_new_risk_state: Optional[str]
    event_state: Optional[str]
    unmanaged_broker_position_count: int
    unevaluated_underlying_count: int
    missing_fields: Sequence[str]


_REQUIRED_FIELDS = (
    "snapshotId", "timestamp", "strategyVersion", "contracts", "routing", "stock",
    "assignmentCapacityQty", "aegisNewRiskState", "eventState",
    "unmanagedBrokerPositionCount", "unevaluatedUnderlyingCount", "optionomicsContext",
)


def t0_bundle_to_research_row(bundle: Mapping[str, Any]) -> T0ResearchRow:
    """Transforms a real, already-persisted `T0ReplayBundle`-shaped dict.
    Every field this function reads is checked for presence explicitly --
    a missing field is recorded in `missing_fields`, never silently
    defaulted, and this function raises if the bundle is missing enough
    structure to be unusable (no `contracts` key at all)."""
    missing = [field for field in _REQUIRED_FIELDS if field not in bundle]
    if "contracts" in missing or "snapshotId" in missing or "timestamp" in missing or "strategyVersion" in missing:
        raise ValueError(f"T0_BUNDLE_ADAPTER_MISSING_REQUIRED_STRUCTURE:{missing}")

    contracts = bundle["contracts"]
    stock = bundle.get("stock")
    underlying_symbol = None
    if isinstance(contracts, list) and len(contracts) > 0 and isinstance(contracts[0], dict):
        underlying_symbol = contracts[0].get("underlying")
    elif isinstance(stock, dict):
        underlying_symbol = stock.get("underlying")

    return T0ResearchRow(
        snapshot_id=bundle["snapshotId"], timestamp=bundle["timestamp"], strategy_version=bundle["strategyVersion"],
        underlying_symbol=underlying_symbol, contract_count=len(contracts) if isinstance(contracts, list) else 0,
        routing_present=bundle.get("routing") is not None, stock_held=stock is not None,
        assignment_capacity_qty=bundle.get("assignmentCapacityQty"),
        aegis_new_risk_state=bundle.get("aegisNewRiskState"), event_state=bundle.get("eventState"),
        unmanaged_broker_position_count=bundle.get("unmanagedBrokerPositionCount", 0),
        unevaluated_underlying_count=bundle.get("unevaluatedUnderlyingCount", 0),
        missing_fields=tuple(missing),
    )
