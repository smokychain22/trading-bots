"""Strict, JSON-safe observation envelopes. No trading or execution authority."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import math
import re
from typing import Any, Mapping

UTC = timezone.utc
_TS = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$")
_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,31}$")


class ObservationError(ValueError):
    """Malformed source data; caller must record a gap rather than invent data."""


def utc_timestamp(value: str | datetime) -> str:
    """Canonical UTC RFC3339 with nine digits, retaining provider nanoseconds."""
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ObservationError("timestamp_requires_timezone")
        dt = value.astimezone(UTC)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond:06d}000Z"
    if not isinstance(value, str) or len(value) > 40:
        raise ObservationError("invalid_timestamp")
    match = _TS.fullmatch(value)
    if not match:
        raise ObservationError("invalid_timestamp")
    base, fraction, offset = match.groups()
    if offset != "Z" and (int(offset[1:3]) > 23 or int(offset[4:6]) > 59):
        raise ObservationError("invalid_timestamp_offset")
    try:
        dt = datetime.fromisoformat(base + ("+00:00" if offset == "Z" else offset)).astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise ObservationError("invalid_timestamp") from exc
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + (fraction or "").ljust(9, "0") + "Z"


def parse_utc(value: str | datetime) -> datetime:
    return datetime.fromisoformat(utc_timestamp(value).replace("Z", "+00:00"))


def timestamp_ns(value: str | datetime) -> int:
    canonical = utc_timestamp(value)
    seconds = datetime.fromisoformat(canonical[:19] + "+00:00") - datetime(1970, 1, 1, tzinfo=UTC)
    return (seconds.days * 86400 + seconds.seconds) * 1_000_000_000 + int(canonical[20:29])


def json_safe(value: Any, depth: int = 0) -> Any:
    if depth > 16:
        raise ObservationError("payload_too_deep")
    if value is None or isinstance(value, (str, bool)):
        if isinstance(value, str) and len(value) > 32768:
            raise ObservationError("string_too_large")
        return value
    if isinstance(value, int):
        if abs(value) > 10**18:
            raise ObservationError("integer_too_large")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ObservationError("non_finite_number")
        return value
    if isinstance(value, Mapping):
        if len(value) > 256 or any(not isinstance(k, str) for k in value):
            raise ObservationError("invalid_object")
        return {k: json_safe(v, depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        if len(value) > 256:
            raise ObservationError("array_too_large")
        return [json_safe(v, depth + 1) for v in value]
    raise ObservationError("not_json_safe")


def canonical_json(value: Any) -> str:
    return json.dumps(json_safe(value), allow_nan=False, sort_keys=True, separators=(",", ":"))


def validate_symbol(symbol: str) -> str:
    if not isinstance(symbol, str) or not _SYMBOL.fullmatch(symbol):
        raise ObservationError("invalid_symbol")
    return symbol


def number(value: Any, name: str, *, minimum: float = 0) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ObservationError("invalid_" + name)
    if not math.isfinite(value) or value < minimum or abs(value) > 10**15:
        raise ObservationError("invalid_" + name)
    return value


def _object(payload: Mapping[str, Any]) -> dict:
    if not isinstance(payload, Mapping):
        raise ObservationError("payload_requires_object")
    return json_safe(payload)


def envelope(kind: str, symbol: str | None, payload: Mapping[str, Any], received_at: str | datetime,
             *, source: str = "alpaca", feed: str | None = None,
             event_at: str | datetime | None = None, published_at: str | datetime | None = None,
             first_known_at: str | datetime | None = None, previous_event_at: str | datetime | None = None,
             stale_after_seconds: float = 120, future_tolerance_seconds: float = 2,
             quality: tuple[str, ...] | list[str] = (), provenance: Mapping[str, Any] | None = None) -> dict:
    if source not in ("alpaca", "mock"):
        raise ObservationError("unsupported_source")
    if feed not in (None, "iex", "indicative"):
        raise ObservationError("unsupported_feed")
    if symbol is not None:
        validate_symbol(symbol)
    body = _object(payload)
    observed = utc_timestamp(received_at)
    event = utc_timestamp(event_at) if event_at is not None else None
    first = utc_timestamp(first_known_at) if first_known_at is not None else observed
    published = utc_timestamp(published_at) if published_at is not None else None
    if first > observed:
        raise ObservationError("first_known_after_receipt")
    number(stale_after_seconds, "stale_threshold")
    number(future_tolerance_seconds, "future_tolerance")
    flags = set(quality)
    if event is None:
        flags.add("event_time_unknown")
    else:
        age = timestamp_ns(observed) - timestamp_ns(event)
        if age < -Decimal(str(future_tolerance_seconds)) * 1_000_000_000:
            flags.add("future_timestamp")
        if age > Decimal(str(stale_after_seconds)) * 1_000_000_000:
            flags.add("stale")
        if previous_event_at is not None and event < utc_timestamp(previous_event_at):
            flags.add("out_of_order")
    if published is not None and published > observed:
        flags.add("future_publication_timestamp")
    if source == "mock":
        flags.add("synthetic")
    if feed == "iex":
        flags.add("single_exchange")
    if feed == "indicative":
        flags.add("indicative_not_executable")
    prov = dict(provenance or {})
    # These properties cannot be overridden by a caller-supplied provenance dict.
    prov.update(transport="mock" if source == "mock" else "rest_polling", synthetic=source == "mock",
                executable=False, broker_authority="NONE", publication_time_inferred=False,
                first_known_basis="local_receipt", timestamp_precision="up_to_nanoseconds")
    logical = hashlib.sha256(canonical_json([kind, symbol, source, feed, event]).encode()).hexdigest()
    content_hash = hashlib.sha256(canonical_json([body, published]).encode()).hexdigest()
    identity = hashlib.sha256(f"{logical}:0:{content_hash}".encode()).hexdigest()
    result = dict(kind=kind, symbol=symbol, source=source, feed=feed, quality=sorted(flags),
                  event_at=event, observed_at=observed, first_known_at=first,
                  revision_first_known_at=observed, published_at=published, payload=body,
                  revision=0, logical_id=logical, content_hash=content_hash, id=identity,
                  provenance=prov)
    if len(canonical_json(result).encode()) > 65536:
        raise ObservationError("observation_too_large")
    return result


def normalize_bar(payload: Mapping[str, Any], received_at: str | datetime, *, symbol: str,
                  feed: str = "iex", source: str = "alpaca", **kwargs: Any) -> dict:
    raw = _object(payload)
    if feed != "iex":
        raise ObservationError("stock_feed_must_be_iex")
    try:
        start = utc_timestamp(raw["t"])
        body = {name: number(raw[key], name) for name, key in
                (("open", "o"), ("high", "h"), ("low", "l"), ("close", "c"), ("volume", "v"))}
    except KeyError as exc:
        raise ObservationError("missing_bar_field") from exc
    if body["low"] > min(body["open"], body["close"]) or body["high"] < max(body["open"], body["close"]) or body["high"] < body["low"]:
        raise ObservationError("invalid_ohlc_range")
    # This adapter is specifically for the latest one-minute bar endpoint.
    if parse_utc(start).second != 0 or start[20:29] != "000000000":
        raise ObservationError("bar_not_minute_aligned")
    end = utc_timestamp(parse_utc(start) + timedelta(minutes=1))
    body.update(bucket_start=start, bucket_end=end, interval_seconds=60)
    if "n" in raw:
        count = number(raw["n"], "trade_count")
        if not isinstance(count, int):
            raise ObservationError("invalid_trade_count")
        body["trade_count"] = count
    if "vw" in raw:
        body["vwap"] = number(raw["vw"], "vwap")
    flags = ["incomplete"] if utc_timestamp(received_at) < end else []
    return envelope("stock_bar", symbol, body, received_at, source=source, feed=feed,
                    event_at=start, quality=flags, **kwargs)


def normalize_trade(payload: Mapping[str, Any], received_at: str | datetime, *, symbol: str,
                    feed: str = "iex", source: str = "alpaca", **kwargs: Any) -> dict:
    raw = _object(payload)
    if feed != "iex":
        raise ObservationError("stock_feed_must_be_iex")
    try:
        body = {"price": number(raw["p"], "price"), "size": number(raw["s"], "size")}
        event = raw["t"]
    except KeyError as exc:
        raise ObservationError("missing_trade_field") from exc
    for src, dst in (("i", "trade_id"), ("x", "exchange"), ("c", "conditions")):
        if src in raw:
            body[dst] = raw[src]
    # Distinct trades at identical source timestamps remain distinct logical events.
    result = envelope("stock_trade", symbol, body, received_at, source=source, feed=feed,
                      event_at=event, **kwargs)
    if "trade_id" in body:
        result["logical_id"] = hashlib.sha256(canonical_json([result["logical_id"], body["trade_id"]]).encode()).hexdigest()
        result["id"] = hashlib.sha256(f"{result['logical_id']}:0:{result['content_hash']}".encode()).hexdigest()
    return result


def normalize_option_quote(payload: Mapping[str, Any], received_at: str | datetime, *, symbol: str,
                           feed: str = "indicative", source: str = "alpaca", **kwargs: Any) -> dict:
    raw = _object(payload)
    if feed != "indicative":
        raise ObservationError("option_feed_must_be_indicative")
    try:
        body = {name: number(raw[key], name) for name, key in
                (("bid", "bp"), ("ask", "ap"), ("bid_size", "bs"), ("ask_size", "as"))}
        event = raw["t"]
    except KeyError as exc:
        raise ObservationError("missing_quote_field") from exc
    flags = ["crossed_quote"] if body["bid"] > body["ask"] else []
    if not body["bid"] or not body["ask"] or not body["bid_size"] or not body["ask_size"]:
        flags.append("one_sided_or_zero_quote")
    body.update(executable=False, nbbo=False, quote_type="modified_indicative")
    for key in ("bx", "ax", "c"):
        if key in raw:
            body[key] = raw[key]
    return envelope("option_quote", symbol, body, received_at, source=source, feed=feed,
                    event_at=event, quality=flags, **kwargs)


def normalize_clock(payload: Mapping[str, Any], received_at: str | datetime, *, source: str = "alpaca") -> dict:
    raw = _object(payload)
    if not isinstance(raw.get("is_open"), bool):
        raise ObservationError("invalid_market_clock_open_flag")
    try:
        timestamp = utc_timestamp(raw["timestamp"])
        body = {"is_open": raw["is_open"], "next_open": utc_timestamp(raw["next_open"]),
                "next_close": utc_timestamp(raw["next_close"])}
    except KeyError as exc:
        raise ObservationError("missing_clock_field") from exc
    if body["next_open"] <= timestamp or body["next_close"] <= timestamp:
        raise ObservationError("nonfuture_market_clock_boundary")
    return envelope("market_clock", None, body, received_at, source=source,
                    event_at=timestamp, stale_after_seconds=30)


def normalize_snapshot(payload: Mapping[str, Any], received_at: str | datetime, *, symbol: str,
                       source: str = "alpaca", feed: str = "indicative") -> dict:
    raw = _object(payload)
    if feed != "indicative":
        raise ObservationError("option_feed_must_be_indicative")
    times, flags = [], ["snapshot_components_not_atomic", "greeks_publication_unknown"]
    if raw.get("latestQuote") is not None:
        quote = normalize_option_quote(raw["latestQuote"], received_at, symbol=symbol, source=source)
        times.append(quote["event_at"])
        flags.extend(quote["quality"])
    if raw.get("latestTrade") is not None:
        trade = _object(raw["latestTrade"])
        try:
            number(trade["p"], "option_trade_price")
            number(trade["s"], "option_trade_size")
            times.append(utc_timestamp(trade["t"]))
        except KeyError as exc:
            raise ObservationError("missing_snapshot_trade_field") from exc
        flags.append("indicative_trades_delayed")
    greeks = raw.get("greeks")
    if greeks is not None and not isinstance(greeks, dict):
        raise ObservationError("invalid_snapshot_greeks")
    for name, value in (greeks or {}).items():
        number(value, "greek_" + name, minimum=-10**9)
    if "impliedVolatility" in raw and raw["impliedVolatility"] is not None:
        number(raw["impliedVolatility"], "implied_volatility")
    raw.update(executable=False, nbbo=False)
    return envelope("option_snapshot", symbol, raw, received_at, source=source, feed=feed,
                    event_at=max(times) if times else None, quality=flags)


def normalize_contract(payload: Mapping[str, Any], received_at: str | datetime, *, source: str = "alpaca") -> dict:
    raw = _object(payload)
    symbol = validate_symbol(raw.get("symbol"))
    # Metadata publication and effective-update times are not supplied by this endpoint.
    return envelope("contract_metadata", symbol, raw, received_at, source=source,
                    quality=["publication_time_unknown", "metadata_as_observed"])


def validate_envelope_identity(item: Mapping[str, Any]) -> None:
    """Recheck untrusted envelope identity and non-execution invariants at storage."""
    expected_feeds = {"stock_bar": "iex", "stock_trade": "iex", "option_quote": "indicative",
                      "option_snapshot": "indicative", "market_clock": None, "contract_metadata": None}
    kind = item.get("kind")
    if kind not in expected_feeds or item.get("feed") != expected_feeds[kind]:
        raise ObservationError("invalid_kind_feed")
    source = item.get("source")
    if source not in {"alpaca", "mock"}:
        raise ObservationError("invalid_source")
    symbol = item.get("symbol")
    if kind == "market_clock":
        if symbol is not None:
            raise ObservationError("clock_symbol_not_null")
    else:
        validate_symbol(symbol)
    if not isinstance(item.get("payload"), dict) or not isinstance(item.get("quality"), list):
        raise ObservationError("invalid_envelope_payload")
    if not all(isinstance(flag, str) for flag in item["quality"]):
        raise ObservationError("invalid_quality")
    prov = item.get("provenance")
    if not isinstance(prov, dict) or prov.get("executable") is not False or prov.get("broker_authority") != "NONE" or prov.get("synthetic") is not (source == "mock"):
        raise ObservationError("invalid_provenance")
    if ("synthetic" in item["quality"]) != (source == "mock"):
        raise ObservationError("synthetic_label_mismatch")
    if item["feed"] == "indicative":
        if "indicative_not_executable" not in item["quality"] or item["payload"].get("executable") is not False or item["payload"].get("nbbo") is not False:
            raise ObservationError("indicative_execution_claim")
    event = utc_timestamp(item["event_at"]) if item.get("event_at") is not None else None
    logical = hashlib.sha256(canonical_json([kind, symbol, source, item["feed"], event]).encode()).hexdigest()
    if kind == "stock_trade" and "trade_id" in item["payload"]:
        logical = hashlib.sha256(canonical_json([logical, item["payload"]["trade_id"]]).encode()).hexdigest()
    if logical != item.get("logical_id"):
        raise ObservationError("logical_identity_mismatch")
