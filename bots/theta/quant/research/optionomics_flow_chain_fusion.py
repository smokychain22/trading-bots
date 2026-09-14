"""Composite/temporal-fusion execution-quote qualification: does a flow
print (`optionomics_flow_event.ParsedFlowEvent`) plus an immediately
fetched chain snapshot for the SAME exact contract together constitute a
temporally corroborated execution quote?

Context: Optionomics' own documentation confirms options-chain reads are
session-snapshot ("the most recent completed ingestion for the requested
session"), never a streaming quote feed -- this is why direct qualification
was already closed `NOT_QUALIFIED` (`optionomics_execution_quote_
qualification` in the TypeScript layer). A live flow PRINT, however, is a
point-in-time trade fact (if the payload schema is ever confirmed) that
could, in principle, corroborate a chain snapshot fetched immediately
after it -- IF the same exact contract is matched (never fuzzy) and the
event-to-chain latency is bounded and disclosed.

This module builds that composite logic ahead of any observed real flow
payload, so it is ready the moment Codex (or a future authenticated
session) supplies real samples. It does not invent quote authority: a
composite candidate here is explicitly a DIFFERENT, weaker evidence class
than a true streaming NBBO, and this module never claims otherwise.

Contract matching mirrors `matchOptionomicsContractIdentity`
(`src/theta/optionomics-provider.ts`): exact OCC symbol match first, else
exact underlying+expiration+type+strike match, else UNMATCHED -- never a
nearest-strike or fuzzy fallback.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from research.optionomics_flow_event import ExecutionClassification, FlowEventContractIdentity, ParsedFlowEvent


class ContractMatchMethod(str, Enum):
    EXACT_OCC_SYMBOL = "EXACT_OCC_SYMBOL"
    EXACT_UNDERLYING_EXPIRATION_TYPE_STRIKE = "EXACT_UNDERLYING_EXPIRATION_TYPE_STRIKE"
    UNMATCHED = "UNMATCHED"


@dataclass(frozen=True)
class ChainSnapshotContract:
    """One contract row from an immediately-fetched chain snapshot --
    the composite fusion's "second source". Field names mirror
    `AlpacaContractIdentity`/Codex's normalized chain shape; this module
    performs no fetch itself and accepts this as caller-supplied input."""

    occ_symbol: Optional[str]
    underlying: Optional[str]
    expiration: Optional[str]
    option_type: Optional[str]
    strike: Optional[float]
    bid: Optional[float]
    ask: Optional[float]
    snapshot_timestamp_utc: str


def match_contract_identity(
    event_contract: FlowEventContractIdentity, chain_contracts: "list[ChainSnapshotContract]",
) -> "tuple[ContractMatchMethod, Optional[ChainSnapshotContract]]":
    """Exact-match-only, mirroring `matchOptionomicsContractIdentity`.
    Never returns a nearest/fuzzy match -- an unresolved identity is
    UNMATCHED, full stop."""
    if event_contract.occ_symbol is not None:
        for candidate in chain_contracts:
            if candidate.occ_symbol == event_contract.occ_symbol:
                return ContractMatchMethod.EXACT_OCC_SYMBOL, candidate
    if (
        event_contract.underlying is not None
        and event_contract.expiration is not None
        and event_contract.option_type is not None
        and event_contract.strike is not None
    ):
        for candidate in chain_contracts:
            if (
                candidate.underlying == event_contract.underlying
                and candidate.expiration == event_contract.expiration
                and candidate.option_type == event_contract.option_type
                and candidate.strike == event_contract.strike
            ):
                return ContractMatchMethod.EXACT_UNDERLYING_EXPIRATION_TYPE_STRIKE, candidate
    return ContractMatchMethod.UNMATCHED, None


class ClassificationConsistency(str, Enum):
    CONSISTENT = "CONSISTENT"  # provider classification matches the retrieved BBO position
    INCONSISTENT = "INCONSISTENT"  # provider classification contradicts the retrieved BBO position
    NOT_APPLICABLE = "NOT_APPLICABLE"  # classification UNKNOWN, or bid/ask unavailable -- nothing to check
    UNKNOWN = "UNKNOWN"  # inputs present but insufficient (e.g. crossed/degenerate BBO)


def check_classification_bbo_consistency(
    classification: ExecutionClassification, trade_price: Optional[float],
    bid: Optional[float], ask: Optional[float], tolerance: float,
) -> ClassificationConsistency:
    """`tolerance` is an explicit, caller-justified absolute price
    tolerance (e.g. one minimum tick) accounting for latency between the
    print and the chain fetch -- never a hardcoded default here."""
    if classification == ExecutionClassification.UNKNOWN:
        return ClassificationConsistency.NOT_APPLICABLE
    if trade_price is None or bid is None or ask is None:
        return ClassificationConsistency.NOT_APPLICABLE
    if bid > ask:
        return ClassificationConsistency.UNKNOWN  # crossed retrieved BBO -- cannot judge position honestly
    if classification == ExecutionClassification.AT_ASK:
        return ClassificationConsistency.CONSISTENT if abs(trade_price - ask) <= tolerance else ClassificationConsistency.INCONSISTENT
    if classification == ExecutionClassification.AT_BID:
        return ClassificationConsistency.CONSISTENT if abs(trade_price - bid) <= tolerance else ClassificationConsistency.INCONSISTENT
    if classification == ExecutionClassification.ABOVE_ASK:
        return ClassificationConsistency.CONSISTENT if trade_price > ask + tolerance else ClassificationConsistency.INCONSISTENT
    if classification == ExecutionClassification.BELOW_BID:
        return ClassificationConsistency.CONSISTENT if trade_price < bid - tolerance else ClassificationConsistency.INCONSISTENT
    if classification in (ExecutionClassification.MID, ExecutionClassification.BETWEEN):
        inside_spread = (bid - tolerance) <= trade_price <= (ask + tolerance)
        return ClassificationConsistency.CONSISTENT if inside_spread else ClassificationConsistency.INCONSISTENT
    return ClassificationConsistency.UNKNOWN


class CompositeQuoteState(str, Enum):
    COMPOSITE_CANDIDATE = "COMPOSITE_CANDIDATE"  # matched contract, bounded latency, no contradiction found
    REJECTED_CONTRACT_UNMATCHED = "REJECTED_CONTRACT_UNMATCHED"
    REJECTED_LATENCY_EXCEEDED = "REJECTED_LATENCY_EXCEEDED"
    REJECTED_CLASSIFICATION_INCONSISTENT = "REJECTED_CLASSIFICATION_INCONSISTENT"
    REJECTED_INCOMPLETE_EVENT = "REJECTED_INCOMPLETE_EVENT"


@dataclass(frozen=True)
class CompositeQuoteResult:
    state: CompositeQuoteState
    match_method: ContractMatchMethod
    event_to_chain_latency_seconds: Optional[float]
    classification_consistency: ClassificationConsistency
    bid: Optional[float]
    ask: Optional[float]
    reason: Optional[str]
    #: This composite result is a WEAKER evidence class than a true
    #: streaming NBBO fill -- it is never promoted to `CONSOLIDATED_NBBO`
    #: or `TRUSTED_TWO_SIDED_ORDER_PRICING` in `ExecutionOptionQuote`'s
    #: `sourceSemantics` vocabulary. No existing enum value cleanly
    #: names it; that gap is flagged for Codex rather than silently
    #: mapped onto an existing value.
    source_semantics_gap_note: str = (
        "No ExecutionOptionQuote.sourceSemantics value represents a "
        "temporally-fused flow+chain composite; do not map this onto "
        "CONSOLIDATED_NBBO, TRUSTED_TWO_SIDED_ORDER_PRICING, or "
        "INDICATIVE without a deliberate contract change."
    )


def _parse_iso_seconds(timestamp: str) -> Optional[float]:
    """Minimal, dependency-free ISO-8601 UTC parse for latency math.
    Returns None on any format this parser doesn't recognize rather than
    guessing -- callers needing broader parsing should convert upstream."""
    from datetime import datetime, timezone

    candidates = (timestamp, timestamp.replace("Z", "+00:00"))
    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    return None


def build_composite_quote(
    event: ParsedFlowEvent,
    chain_contracts: "list[ChainSnapshotContract]",
    max_event_to_chain_latency_seconds: float,
    classification_tolerance: float,
) -> CompositeQuoteResult:
    """The single composite-qualification entry point. `max_event_to_
    chain_latency_seconds` and `classification_tolerance` must be
    supplied and justified by the caller -- this module hardcodes
    neither, per the standing no-arbitrary-thresholds rule."""
    if event.trade_timestamp_utc is None or event.trade_price is None:
        return CompositeQuoteResult(
            CompositeQuoteState.REJECTED_INCOMPLETE_EVENT, ContractMatchMethod.UNMATCHED, None,
            ClassificationConsistency.NOT_APPLICABLE, None, None,
            "EVENT_MISSING_TRADE_TIMESTAMP_OR_TRADE_PRICE",
        )

    match_method, matched = match_contract_identity(event.contract, chain_contracts)
    if matched is None:
        return CompositeQuoteResult(
            CompositeQuoteState.REJECTED_CONTRACT_UNMATCHED, ContractMatchMethod.UNMATCHED, None,
            ClassificationConsistency.NOT_APPLICABLE, None, None,
            "NO_EXACT_CONTRACT_MATCH_IN_CHAIN_SNAPSHOT",
        )

    event_seconds = _parse_iso_seconds(event.trade_timestamp_utc)
    chain_seconds = _parse_iso_seconds(matched.snapshot_timestamp_utc)
    if event_seconds is None or chain_seconds is None:
        return CompositeQuoteResult(
            CompositeQuoteState.REJECTED_INCOMPLETE_EVENT, match_method, None,
            ClassificationConsistency.NOT_APPLICABLE, matched.bid, matched.ask,
            "UNPARSEABLE_TIMESTAMP:cannot compute event-to-chain latency",
        )

    latency = abs(chain_seconds - event_seconds)
    if latency > max_event_to_chain_latency_seconds:
        return CompositeQuoteResult(
            CompositeQuoteState.REJECTED_LATENCY_EXCEEDED, match_method, latency,
            ClassificationConsistency.NOT_APPLICABLE, matched.bid, matched.ask,
            f"LATENCY_{latency:.3f}S_EXCEEDS_BOUND_{max_event_to_chain_latency_seconds}S",
        )

    consistency = check_classification_bbo_consistency(
        event.execution_classification, event.trade_price, matched.bid, matched.ask, classification_tolerance,
    )
    if consistency == ClassificationConsistency.INCONSISTENT:
        return CompositeQuoteResult(
            CompositeQuoteState.REJECTED_CLASSIFICATION_INCONSISTENT, match_method, latency,
            consistency, matched.bid, matched.ask,
            "PROVIDER_EXECUTION_CLASSIFICATION_CONTRADICTS_RETRIEVED_BBO_POSITION",
        )

    return CompositeQuoteResult(
        CompositeQuoteState.COMPOSITE_CANDIDATE, match_method, latency, consistency, matched.bid, matched.ask, None,
    )
