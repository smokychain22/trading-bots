"""Research parser for a hypothetical Optionomics live-flow/webhook print
event -- built ahead of any observed real payload.

Status as of this module's authorship (2026-09-14): confirmed by direct
`WebFetch` of `optionomics.ai/features/api` and `optionomics.ai/docs/api`
that (a) a webhook delivery TRANSPORT is documented as a supported
developer feature for alert channels including "Options Flow" and
"Unusual prints", but (b) the actual developer API reference states
verbatim "there is no webhook functionality described for Option Alerts
or Options Flow" and documents zero payload field schema for any flow
channel. No real flow-event payload has been observed by this branch.
Every field name below is therefore a RESEARCH GUESS at what a
print-level flow event would plausibly carry (mirroring common
industry flow-alert vocabulary: contract identity, trade price/size,
execution classification vs NBBO) -- none of it is confirmed.

This module follows `research_family_adapters.FeatureFieldMap`'s
discipline exactly: nothing is extracted under a guessed key name.
`FlowEventFieldMap` defaults every field to `None`; a caller must
supply the ACTUAL observed field names (from a real captured payload)
before `parse_flow_event` will extract anything. With no map supplied,
extraction correctly yields `None` fields and `evidence_class ==
"UNMAPPED_SCHEMA"` -- never a fabricated event.

Execution classification is treated with the same fail-closed
discipline as everywhere else in this repository: an unrecognized
provider label becomes `ExecutionClassification.UNKNOWN`, never
silently coerced to `MID` or dropped. See TEAM_CHARTER "UNKNOWN never
zero" and this directive's own explicit instruction: "UNKNOWN provider
label must remain UNKNOWN. Never convert unknown labels into MID or
PASS."
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional


class ExecutionClassification(str, Enum):
    """Where a print landed relative to the NBBO at trade time, per the
    provider's OWN label (never re-derived by this module from price
    alone -- that derivation, if ever done, belongs to the fusion module
    which has an actual retrieved bid/ask to compare against)."""

    AT_ASK = "AT_ASK"
    AT_BID = "AT_BID"
    MID = "MID"
    BETWEEN = "BETWEEN"  # inside the spread but not at the midpoint
    ABOVE_ASK = "ABOVE_ASK"
    BELOW_BID = "BELOW_BID"
    UNKNOWN = "UNKNOWN"


#: Provider labels this module currently recognizes. Deliberately a
#: closed, explicit set -- an unrecognized label (any casing/spelling
#: Optionomics may actually use, none of which has been observed) maps
#: to UNKNOWN rather than a best-effort guess.
_KNOWN_CLASSIFICATION_LABELS: Dict[str, ExecutionClassification] = {
    "AT_ASK": ExecutionClassification.AT_ASK,
    "AT_BID": ExecutionClassification.AT_BID,
    "MID": ExecutionClassification.MID,
    "BETWEEN": ExecutionClassification.BETWEEN,
    "ABOVE_ASK": ExecutionClassification.ABOVE_ASK,
    "BELOW_BID": ExecutionClassification.BELOW_BID,
}


def classify_execution_label(raw_label: Optional[Any]) -> ExecutionClassification:
    """Never raises, never guesses. Anything not an exact (case-
    normalized) match to a known label is UNKNOWN -- including None,
    non-string types, empty strings, and unrecognized provider text."""
    if not isinstance(raw_label, str):
        return ExecutionClassification.UNKNOWN
    normalized = raw_label.strip().upper()
    return _KNOWN_CLASSIFICATION_LABELS.get(normalized, ExecutionClassification.UNKNOWN)


class FlowEventEvidenceClass(str, Enum):
    UNMAPPED_SCHEMA = "UNMAPPED_SCHEMA"  # no FlowEventFieldMap supplied -- nothing extracted
    PARTIAL_FIELDS = "PARTIAL_FIELDS"  # map supplied but required identity/timestamp fields absent from this payload
    PARSED = "PARSED"  # contract identity + timestamp + trade price all resolved


@dataclass(frozen=True)
class FlowEventFieldMap:
    """The explicit, caller-supplied mapping from this module's logical
    field names to a REAL observed payload's actual key names. Every
    field defaults to `None` -- exactly `research_family_adapters.
    FeatureFieldMap`'s pattern. Supplying this map from a guessed key
    name (rather than one confirmed against an actual captured payload)
    would defeat its purpose; callers must not do that."""

    underlying_key: Optional[str] = None
    expiration_key: Optional[str] = None
    option_type_key: Optional[str] = None
    strike_key: Optional[str] = None
    occ_symbol_key: Optional[str] = None
    trade_timestamp_key: Optional[str] = None
    trade_price_key: Optional[str] = None
    trade_size_key: Optional[str] = None
    execution_classification_key: Optional[str] = None
    reported_bid_key: Optional[str] = None
    reported_ask_key: Optional[str] = None
    sweep_key: Optional[str] = None
    block_key: Optional[str] = None
    multi_leg_key: Optional[str] = None
    event_id_key: Optional[str] = None


@dataclass(frozen=True)
class FlowEventContractIdentity:
    """Identity as REPORTED by the flow event -- not yet matched against
    any chain snapshot. Mirrors the shape `matchOptionomicsContractIdentity`
    (TypeScript, `optionomics-provider.ts`) expects for exact-match lookup:
    an OCC symbol if present, else underlying+expiration+type+strike."""

    occ_symbol: Optional[str]
    underlying: Optional[str]
    expiration: Optional[str]
    option_type: Optional[str]  # "CALL" | "PUT" | None -- never guessed from an ambiguous label
    strike: Optional[float]


@dataclass(frozen=True)
class ParsedFlowEvent:
    evidence_class: FlowEventEvidenceClass
    contract: FlowEventContractIdentity
    trade_timestamp_utc: Optional[str]
    trade_price: Optional[float]
    trade_size: Optional[int]
    execution_classification: ExecutionClassification
    reported_bid: Optional[float]
    reported_ask: Optional[float]
    sweep: Optional[bool]
    block: Optional[bool]
    multi_leg: Optional[bool]
    event_id: Optional[str]
    blocker: Optional[str]


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _as_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _as_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    return None


def _as_str(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def _get(payload: Dict[str, Any], key: Optional[str]) -> Optional[Any]:
    if key is None or not isinstance(payload, dict):
        return None
    return payload.get(key)


def _normalize_option_type(raw: Optional[Any]) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    normalized = raw.strip().upper()
    if normalized in ("CALL", "C"):
        return "CALL"
    if normalized in ("PUT", "P"):
        return "PUT"
    return None  # an unrecognized option-type label is UNKNOWN identity, never guessed


def parse_flow_event(raw_payload: Dict[str, Any], field_map: FlowEventFieldMap) -> ParsedFlowEvent:
    """Extracts a single flow print under an explicit field map. Never
    raises on malformed input; every unresolved field is `None`, and
    `evidence_class`/`blocker` name exactly why extraction stopped where
    it did. This function performs no I/O, no network access, and no
    broker interaction of any kind."""
    if not isinstance(raw_payload, dict):
        return ParsedFlowEvent(
            FlowEventEvidenceClass.UNMAPPED_SCHEMA,
            FlowEventContractIdentity(None, None, None, None, None),
            None, None, None, ExecutionClassification.UNKNOWN, None, None, None, None, None, None,
            "RAW_PAYLOAD_NOT_A_MAPPING",
        )

    map_is_empty = field_map == FlowEventFieldMap()
    if map_is_empty:
        return ParsedFlowEvent(
            FlowEventEvidenceClass.UNMAPPED_SCHEMA,
            FlowEventContractIdentity(None, None, None, None, None),
            None, None, None, ExecutionClassification.UNKNOWN, None, None, None, None, None, None,
            "NO_FLOW_EVENT_FIELD_MAP_SUPPLIED:every field name is a research guess until a real payload confirms one",
        )

    occ_symbol = _as_str(_get(raw_payload, field_map.occ_symbol_key))
    underlying = _as_str(_get(raw_payload, field_map.underlying_key))
    expiration = _as_str(_get(raw_payload, field_map.expiration_key))
    option_type = _normalize_option_type(_get(raw_payload, field_map.option_type_key))
    strike = _as_float(_get(raw_payload, field_map.strike_key))
    contract = FlowEventContractIdentity(occ_symbol, underlying, expiration, option_type, strike)

    trade_timestamp = _as_str(_get(raw_payload, field_map.trade_timestamp_key))
    trade_price = _as_float(_get(raw_payload, field_map.trade_price_key))
    trade_size = _as_int(_get(raw_payload, field_map.trade_size_key))
    execution_classification = classify_execution_label(_get(raw_payload, field_map.execution_classification_key))
    reported_bid = _as_float(_get(raw_payload, field_map.reported_bid_key))
    reported_ask = _as_float(_get(raw_payload, field_map.reported_ask_key))
    sweep = _as_bool(_get(raw_payload, field_map.sweep_key))
    block = _as_bool(_get(raw_payload, field_map.block_key))
    multi_leg = _as_bool(_get(raw_payload, field_map.multi_leg_key))
    event_id = _as_str(_get(raw_payload, field_map.event_id_key))

    has_identity = occ_symbol is not None or (underlying is not None and expiration is not None and option_type is not None and strike is not None)
    if not has_identity or trade_timestamp is None or trade_price is None:
        missing = []
        if not has_identity:
            missing.append("CONTRACT_IDENTITY")
        if trade_timestamp is None:
            missing.append("TRADE_TIMESTAMP")
        if trade_price is None:
            missing.append("TRADE_PRICE")
        return ParsedFlowEvent(
            FlowEventEvidenceClass.PARTIAL_FIELDS, contract, trade_timestamp, trade_price, trade_size,
            execution_classification, reported_bid, reported_ask, sweep, block, multi_leg, event_id,
            f"REQUIRED_FIELDS_ABSENT_FROM_THIS_PAYLOAD:{','.join(missing)}",
        )

    return ParsedFlowEvent(
        FlowEventEvidenceClass.PARSED, contract, trade_timestamp, trade_price, trade_size,
        execution_classification, reported_bid, reported_ask, sweep, block, multi_leg, event_id, None,
    )
