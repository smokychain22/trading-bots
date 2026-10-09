"""Bounded read-only Basic REST adapter and an explicitly synthetic mock.

No network or environment credential access occurs on import/construction.
The only runtime transport sends GET requests to an exact allowlist. There are
no order, position, cancel, replace, assignment, exercise, or trading methods.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
from zoneinfo import ZoneInfo
import http.client
import json
import os
import re
import socket
import ssl
import threading
import time
from typing import Any, Callable, Mapping, Protocol
from urllib.parse import urlencode, urlsplit

from .observations import (ObservationError, json_safe, normalize_bar, normalize_clock,
                           normalize_contract, normalize_option_quote, normalize_snapshot,
                           normalize_trade, utc_timestamp, validate_symbol)

PAPER_HOST = "paper-api.alpaca.markets"
DATA_HOST = "data.alpaca.markets"
EXPECTED_SUFFIX = "48RC9"
ENDPOINTS = {
    "account": (PAPER_HOST, "/v2/account"),
    "clock": (PAPER_HOST, "/v2/clock"),
    "contracts": (PAPER_HOST, "/v2/options/contracts"),
    "calendar": (PAPER_HOST, "/v2/calendar"),
    "positions": (PAPER_HOST, "/v2/positions"),
    "orders": (PAPER_HOST, "/v2/orders"),
    "fills": (PAPER_HOST, "/v2/account/activities/FILL"),
    "stock_bars": (DATA_HOST, "/v2/stocks/bars/latest"),
    "stock_trades": (DATA_HOST, "/v2/stocks/trades/latest"),
    "option_quotes": (DATA_HOST, "/v1beta1/options/quotes/latest"),
    "option_snapshots": (DATA_HOST, "/v1beta1/options/snapshots"),
}
QUERY_KEYS = {
    "account": frozenset(), "clock": frozenset(), "positions": frozenset(),
    "calendar": frozenset(("start", "end")),
    "orders": frozenset(("status", "limit", "after", "until", "direction", "nested")),
    "fills": frozenset(("after", "until", "direction", "page_size", "page_token")),
    "contracts": frozenset(("underlying_symbols", "status", "limit", "expiration_date_gte", "expiration_date_lte")),
    "stock_bars": frozenset(("symbols", "feed")),
    "stock_trades": frozenset(("symbols", "feed")),
    "option_quotes": frozenset(("symbols", "feed")),
    "option_snapshots": frozenset(("symbols", "feed", "limit")),
}
_ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,100}$")


PROVIDER_ERROR_CODES = frozenset(['ACCOUNT_IDENTITY_MISMATCH', 'ACCOUNT_NOT_ACTIVE', 'ACCOUNT_NOT_VERIFIED', 'ACTIVITY_CAP_EXCEEDED', 'ACTIVITY_PAGINATION_CONFLICT', 'API_READ_NOT_ENABLED', 'AUTHORIZATION_REJECTED', 'CONTENT_ENCODING_REJECTED', 'DEADLINE', 'ENDPOINT_REJECTED', 'EXPECTED_ACCOUNT_SUFFIX_MISMATCH', 'EXTERNAL_CONFIGURATION_INVALID', 'EXTERNAL_CONFIGURATION_MISSING', 'FEED_REJECTED', 'HOST_REJECTED', 'HTTP_429', 'HTTP_ERROR', 'INVALID_ACTIVITY_QUERY', 'INVALID_ACTIVITY_WINDOW', 'INVALID_CALENDAR_RANGE', 'INVALID_CONTENT_LENGTH', 'INVALID_ORDER_QUERY', 'INVALID_ORDER_WINDOW', 'MALFORMED_ACCOUNT_CAPABILITIES', 'MALFORMED_ACTIVITY', 'MALFORMED_BROKER_FIELD', 'MALFORMED_CALENDAR', 'MALFORMED_DECIMAL', 'MALFORMED_ORDER', 'MALFORMED_POSITION', 'MALFORMED_RESPONSE', 'NETWORK_ERROR', 'ORDER_CAP_EXCEEDED', 'POSITION_CAP_EXCEEDED', 'RATE_LIMIT_DEADLINE', 'REDIRECT_REJECTED', 'REQUEST_REJECTED', 'REQUEST_TOO_LARGE', 'RESPONSE_TOO_LARGE', 'SOURCE_MISMATCH', 'TRANSPORT_ERROR', 'UNCLASSIFIED_PROVIDER_ERROR', 'URL_REJECTED'])


class ProviderError(RuntimeError):
    """Only static codes may escape; never echo URLs, credentials or server bodies."""
    def __init__(self, code: str, *, retryable: bool = False, retry_after: float | None = None):
        safe_code = code if isinstance(code, str) and code in PROVIDER_ERROR_CODES else "UNCLASSIFIED_PROVIDER_ERROR"
        super().__init__(safe_code)
        self.code = safe_code
        self.retryable = retryable is True
        self.retry_after = retry_after if not isinstance(retry_after, bool) and isinstance(retry_after, (int, float)) and 0 <= retry_after <= 120 else None


def _positive(value: Any, name: str, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= maximum:
        raise ValueError("invalid_" + name)
    return float(value)


def _symbols(values: tuple[str, ...] | list[str], maximum: int, *, option: bool = False) -> tuple[str, ...]:
    if not isinstance(values, (tuple, list)) or len(values) > maximum:
        raise ValueError("symbol_cap_exceeded")
    result = []
    for value in values:
        validate_symbol(value)
        if option and not re.fullmatch(r"[A-Z]{1,6}\d{6}[CP]\d{8}", value):
            raise ValueError("invalid_occ_option_symbol")
        if value in result:
            raise ValueError("duplicate_symbol")
        result.append(value)
    return tuple(result)


@dataclass(frozen=True)
class APIConfig:
    enable_api_read: bool = False
    key_env: str = "THETA_ALPACA_PAPER_KEY_ID"
    secret_env: str = "THETA_ALPACA_PAPER_SECRET_KEY"
    account_number_env: str = "THETA_ALPACA_PAPER_ACCOUNT_NUMBER"
    expected_account_suffix: str = EXPECTED_SUFFIX
    stock_symbols: tuple[str, ...] = ("SPY",)
    option_symbols: tuple[str, ...] = ()
    request_timeout_seconds: float = 5.0
    max_response_bytes: int = 1_048_576
    max_url_bytes: int = 4096
    contract_limit: int = 20

    def __post_init__(self) -> None:
        if not isinstance(self.enable_api_read, bool):
            raise ValueError("invalid_network_opt_in")
        if self.expected_account_suffix != EXPECTED_SUFFIX:
            raise ValueError("unexpected_account_suffix")
        for name in (self.key_env, self.secret_env, self.account_number_env):
            if not isinstance(name, str) or not _ENV_NAME.fullmatch(name):
                raise ValueError("invalid_environment_variable_name")
        if len({self.key_env, self.secret_env, self.account_number_env}) != 3:
            raise ValueError("credential_environment_names_must_differ")
        _symbols(self.stock_symbols, 8)
        _symbols(self.option_symbols, 32, option=True)
        _positive(self.request_timeout_seconds, "request_timeout", 15)
        for value, name, lower, upper in ((self.max_response_bytes, "response_budget", 1024, 2_097_152),
                                         (self.max_url_bytes, "url_budget", 256, 8192),
                                         (self.contract_limit, "contract_limit", 1, 50)):
            if isinstance(value, bool) or not isinstance(value, int) or not lower <= value <= upper:
                raise ValueError("invalid_" + name)


class SharedRateLimiter:
    """One aggregate process-wide rolling-window cap for all provider endpoints.

    Smooth spacing also prevents a startup burst. Does not coordinate independent
    processes; deploy at most one API observer or supply a shared external gate.
    """
    def __init__(self, requests_per_minute: int = 200, *, monotonic: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        if isinstance(requests_per_minute, bool) or not isinstance(requests_per_minute, int) or not 1 <= requests_per_minute <= 200:
            raise ValueError("invalid_rate_limit")
        self.limit = requests_per_minute
        self.monotonic, self.sleep = monotonic, sleep
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()
        self._last = float("-inf")

    def acquire(self, deadline: float) -> None:
        while True:
            with self._lock:
                now = self.monotonic()
                if now >= deadline:
                    raise ProviderError("DEADLINE", retryable=True)
                while self._calls and self._calls[0] <= now - 60:
                    self._calls.popleft()
                wait = max(0.0, self._last + 60.0 / self.limit - now)
                if len(self._calls) >= self.limit:
                    wait = max(wait, self._calls[0] + 60.0 - now)
                if wait == 0:
                    self._calls.append(now)
                    self._last = now
                    return
                if now + wait >= deadline:
                    raise ProviderError("RATE_LIMIT_DEADLINE", retryable=True)
            self.sleep(wait)


_DEFAULT_LIMITER = SharedRateLimiter()


@dataclass(frozen=True)
class HTTPResult:
    status: int
    body: bytes = field(repr=False)
    headers: Mapping[str, str] = field(default_factory=dict, repr=False)


class Transport(Protocol):
    def get(self, url: str, headers: Mapping[str, str], *, timeout: float,
            max_bytes: int, deadline: float) -> HTTPResult: ...


def validate_url(url: str) -> None:
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        raise ProviderError("URL_REJECTED") from None
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment:
        raise ProviderError("URL_REJECTED")
    if parsed.netloc not in (PAPER_HOST, DATA_HOST):
        raise ProviderError("HOST_REJECTED")
    if (parsed.netloc, parsed.path) not in ENDPOINTS.values():
        raise ProviderError("ENDPOINT_REJECTED")


class HTTPSGetTransport:
    """HTTPS only. No redirects/proxies, retries, cookies or alternate auth.

    Read/socket watchdogs bound ordinary network stalls. Python's blocking DNS
    resolver cannot be reliably interrupted; see operational limitation in docs.
    """
    def get(self, url: str, headers: Mapping[str, str], *, timeout: float,
            max_bytes: int, deadline: float) -> HTTPResult:
        validate_url(url)
        parsed = urlsplit(url)
        left = deadline - time.monotonic()
        if left <= 0:
            raise ProviderError("DEADLINE", retryable=True)
        conn = http.client.HTTPSConnection(parsed.hostname, timeout=min(timeout, left),
                                           context=ssl.create_default_context())
        expired = threading.Event()
        def expire() -> None:
            expired.set()
            try:
                if conn.sock:
                    conn.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            conn.close()
        watchdog = threading.Timer(min(timeout, left), expire)
        watchdog.daemon = True
        watchdog.start()
        try:
            conn.connect()
            if expired.is_set() or time.monotonic() >= deadline:
                raise ProviderError("DEADLINE", retryable=True)
            conn.request("GET", parsed.path + ("?" + parsed.query if parsed.query else ""),
                         headers=dict(headers))
            if expired.is_set():
                raise ProviderError("DEADLINE", retryable=True)
            response = conn.getresponse()
            if 300 <= response.status < 400:
                raise ProviderError("REDIRECT_REJECTED")
            content_length = response.getheader("Content-Length")
            if content_length is not None:
                try:
                    if int(content_length) < 0 or int(content_length) > max_bytes:
                        raise ProviderError("RESPONSE_TOO_LARGE")
                except ValueError:
                    raise ProviderError("INVALID_CONTENT_LENGTH") from None
            if response.getheader("Content-Encoding", "identity") != "identity":
                raise ProviderError("CONTENT_ENCODING_REJECTED")
            chunks, size = [], 0
            while True:
                if expired.is_set() or time.monotonic() >= deadline:
                    raise ProviderError("DEADLINE", retryable=True)
                data = response.read1(min(65536, max_bytes - size + 1))
                if not data:
                    break
                size += len(data)
                if size > max_bytes:
                    raise ProviderError("RESPONSE_TOO_LARGE")
                chunks.append(data)
            return HTTPResult(response.status, b"".join(chunks),
                              {"retry-after": response.getheader("Retry-After", "")})
        except ProviderError:
            raise
        except (OSError, http.client.HTTPException, ValueError):
            raise ProviderError("NETWORK_ERROR", retryable=True) from None
        finally:
            watchdog.cancel()
            conn.close()


def _json(body: bytes) -> dict | list:
    def pairs(items: list[tuple[str, Any]]) -> dict:
        result = {}
        for key, value in items:
            if key in result:
                raise ObservationError("duplicate_json_key")
            result[key] = value
        return result
    def invalid_constant(_: str) -> None:
        raise ObservationError("non_finite_number")
    try:
        result = json.loads(body, object_pairs_hook=pairs, parse_constant=invalid_constant)
        if not isinstance(result, (dict, list)):
            raise ObservationError("response_requires_object_or_array")
        return json_safe(result)
    except (ValueError, TypeError, UnicodeError, RecursionError, ObservationError):
        raise ProviderError("MALFORMED_RESPONSE") from None


@dataclass
class PollResult:
    observations: list[dict]
    gaps: list[dict]
    market_open: bool | None
    source: str
    error: ProviderError | None = None


def _text(value: Any) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 256 or not value.isprintable():
        raise ProviderError("MALFORMED_BROKER_FIELD")
    return value


def _decimal(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ProviderError("MALFORMED_DECIMAL")
    if len(str(value)) > 256:
        raise ProviderError("MALFORMED_DECIMAL")
    try:
        result = Decimal(str(value))
        if not result.is_finite() or abs(result) > Decimal("1e15") or not -12 <= result.as_tuple().exponent <= 12:
            raise InvalidOperation()
        return format(result, "f")
    except (InvalidOperation, ValueError):
        raise ProviderError("MALFORMED_DECIMAL") from None


def _order(row: Any, depth: int = 0) -> dict:
    if not isinstance(row, dict) or depth > 1:
        raise ProviderError("MALFORMED_ORDER")
    try:
        result = {key: _text(row[key]) for key in ("id", "client_order_id", "status", "side", "type")}
        if row.get("symbol") is not None:
            result["symbol"] = validate_symbol(row["symbol"])
        for key in ("qty", "filled_qty", "limit_price", "filled_avg_price"):
            result[key] = _decimal(row[key]) if row.get(key) is not None else None
        for key in ("submitted_at", "updated_at", "canceled_at", "failed_at", "expired_at", "filled_at"):
            result[key] = utc_timestamp(row[key]) if row.get(key) is not None else None
        legs = row.get("legs")
        if legs is not None:
            if not isinstance(legs, list) or len(legs) > 4:
                raise ValueError()
            result["legs"] = [_order(leg, depth + 1) for leg in legs]
        return result
    except (KeyError, TypeError, ValueError):
        raise ProviderError("MALFORMED_ORDER") from None


class AlpacaBasicProvider:
    name = "alpaca_basic_read_only"
    synthetic = False
    broker_authority = "NONE"

    def __init__(self, config: APIConfig | None = None, *, transport: Transport | None = None,
                 limiter: SharedRateLimiter | None = None,
                 utcnow: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 monotonic: Callable[[], float] = time.monotonic):
        self.config = config or APIConfig()
        self._transport = transport or HTTPSGetTransport()
        self._limiter = limiter or _DEFAULT_LIMITER
        self._utcnow, self._monotonic = utcnow, monotonic
        self._verified = False
        self._headers: dict[str, str] = {}
        self._expected_account = ""
        self._metadata_done = False
        self._account_capabilities: dict[str, Any] = {}

    def __repr__(self) -> str:
        return f"AlpacaBasicProvider(enabled={self.config.enable_api_read}, verified={self._verified}, authority=NONE)"

    def _load_external_credentials(self) -> None:
        if not self.config.enable_api_read:
            raise ProviderError("API_READ_NOT_ENABLED")
        # Deliberately lazy. No .env loading, files, secrets managers, logging or
        # credential discovery. Only exact externally configured variable names.
        key = os.environ.get(self.config.key_env, "")
        secret = os.environ.get(self.config.secret_env, "")
        account = os.environ.get(self.config.account_number_env, "")
        if not key or not secret or not account:
            raise ProviderError("EXTERNAL_CONFIGURATION_MISSING")
        if any(len(value) > 256 or not value.isascii() or not value.isprintable() or any(c.isspace() for c in value)
               for value in (key, secret, account)):
            raise ProviderError("EXTERNAL_CONFIGURATION_INVALID")
        if not account.endswith(EXPECTED_SUFFIX):
            raise ProviderError("EXPECTED_ACCOUNT_SUFFIX_MISMATCH")
        self._headers = {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret,
                         "Accept": "application/json", "Accept-Encoding": "identity",
                         "User-Agent": "theta-basic-observer/1-read-only"}
        self._expected_account = account

    def _request(self, endpoint: str, params: Mapping[str, Any], deadline: float) -> dict | list:
        if not self.config.enable_api_read:
            raise ProviderError("API_READ_NOT_ENABLED")
        if endpoint not in ENDPOINTS or set(params) - QUERY_KEYS[endpoint]:
            raise ProviderError("REQUEST_REJECTED")
        if endpoint != "account" and not self._verified:
            raise ProviderError("ACCOUNT_NOT_VERIFIED")
        if any(isinstance(v, bool) or not isinstance(v, (str, int)) for v in params.values()):
            raise ProviderError("REQUEST_REJECTED")
        expected_feed = "iex" if endpoint.startswith("stock_") else "indicative" if endpoint.startswith("option_") else None
        if expected_feed is not None and params.get("feed") != expected_feed:
            raise ProviderError("FEED_REJECTED")
        host, path = ENDPOINTS[endpoint]
        url = f"https://{host}{path}" + ("?" + urlencode(params) if params else "")
        if len(url.encode()) > self.config.max_url_bytes:
            raise ProviderError("REQUEST_TOO_LARGE")
        validate_url(url)
        self._limiter.acquire(deadline)
        timeout = min(self.config.request_timeout_seconds, deadline - self._monotonic())
        if timeout <= 0:
            raise ProviderError("DEADLINE", retryable=True)
        try:
            response = self._transport.get(url, self._headers, timeout=timeout,
                                           max_bytes=self.config.max_response_bytes, deadline=deadline)
        except ProviderError:
            raise
        except Exception:
            # An injected transport must not leak a URL/header/error body either.
            raise ProviderError("TRANSPORT_ERROR", retryable=True) from None
        if len(response.body) > self.config.max_response_bytes:
            raise ProviderError("RESPONSE_TOO_LARGE")
        if 300 <= response.status < 400:
            raise ProviderError("REDIRECT_REJECTED")
        if response.status == 429:
            retry_after = None
            try:
                seconds = float(response.headers.get("retry-after", ""))
                if 0 <= seconds <= 120:
                    retry_after = seconds
            except (ValueError, TypeError):
                pass
            raise ProviderError("HTTP_429", retryable=True, retry_after=retry_after)
        if response.status in (401, 403):
            self._verified = False
            raise ProviderError("AUTHORIZATION_REJECTED")
        if response.status != 200:
            raise ProviderError("HTTP_ERROR", retryable=500 <= response.status < 600)
        result = _json(response.body)
        expected_type = list if endpoint in {"positions", "orders", "fills", "calendar"} else dict
        if not isinstance(result, expected_type):
            raise ProviderError("MALFORMED_RESPONSE")
        return result

    def verify_account(self, deadline: float) -> dict:
        self._verified = False
        self._load_external_credentials()
        account = self._request("account", {}, deadline)
        if not isinstance(account.get("account_number"), str) or account["account_number"] != self._expected_account:
            self._headers.clear()
            self._expected_account = ""
            raise ProviderError("ACCOUNT_IDENTITY_MISMATCH")
        if account.get("status") != "ACTIVE":
            raise ProviderError("ACCOUNT_NOT_ACTIVE")
        self._verified = True
        self._account_capabilities = {
            "verified": True, "paper_host": True, "account_suffix": EXPECTED_SUFFIX,
            "account_identity_hash": hashlib.sha256(self._expected_account.encode()).hexdigest(),
            "broker_authority": "NONE", "status": "ACTIVE", "observed_at": utc_timestamp(self._utcnow()),
        }
        for key in ("trading_blocked", "transfers_blocked", "account_blocked"):
            value = account.get(key)
            if value is not None and not isinstance(value, bool):
                self._verified = False
                raise ProviderError("MALFORMED_ACCOUNT_CAPABILITIES")
            self._account_capabilities[key] = value
        for key in ("options_trading_level", "options_approved_level"):
            value = account.get(key)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 9):
                self._verified = False
                raise ProviderError("MALFORMED_ACCOUNT_CAPABILITIES")
            self._account_capabilities[key] = value
        # Optional funds stay in memory, never in market envelopes, heartbeat or CLI output.
        for key in ("cash", "buying_power", "options_buying_power"):
            self._account_capabilities[key] = _decimal(account[key]) if account.get(key) is not None else None
        return dict(self._account_capabilities)

    def account_capabilities(self, deadline: float) -> dict:
        return self.verify_account(deadline)

    def market_calendar(self, start: str, end: str, deadline: float) -> dict:
        try:
            first, last = date.fromisoformat(start), date.fromisoformat(end)
        except (ValueError, TypeError):
            raise ProviderError("INVALID_CALENDAR_RANGE") from None
        if not 0 <= (last - first).days <= 31:
            raise ProviderError("INVALID_CALENDAR_RANGE")
        if not self._verified:
            self.verify_account(deadline)
        rows = self._request("calendar", {"start": start, "end": end}, deadline)
        if len(rows) > 32:
            raise ProviderError("MALFORMED_CALENDAR")
        result = []
        for row in rows:
            try:
                day = date.fromisoformat(row["date"])
                if not first <= day <= last:
                    raise ValueError()
                boundaries = []
                for field in ("open", "close"):
                    value = row[field]
                    if not isinstance(value, str) or not re.fullmatch(r"\d{2}:\d{2}(?::\d{2})?", value):
                        raise ValueError()
                    boundary = datetime.fromisoformat(day.isoformat() + "T" + value).replace(tzinfo=ZoneInfo("America/New_York"))
                    boundaries.append(utc_timestamp(boundary))
                if boundaries[0] >= boundaries[1]:
                    raise ValueError()
            except (KeyError, TypeError, ValueError):
                raise ProviderError("MALFORMED_CALENDAR") from None
            result.append({"date": day.isoformat(), "session_open": boundaries[0], "session_close": boundaries[1],
                           "source": "alpaca", "event_blackout_clear": None})
        return {"records": result, "complete": True, "start": start, "end": end,
                "observed_at": utc_timestamp(self._utcnow()), "published_at": None}

    def positions(self, deadline: float) -> dict:
        if not self._verified:
            self.verify_account(deadline)
        rows = self._request("positions", {}, deadline)
        if len(rows) > 200:
            raise ProviderError("POSITION_CAP_EXCEEDED")
        result = []
        for row in rows:
            try:
                symbol = validate_symbol(row["symbol"])
                qty = _decimal(row["qty"])
                side = row["side"]
                if side not in {"long", "short"}:
                    raise ValueError()
                item = {"symbol": symbol, "qty": qty, "side": side}
                for key in ("asset_class", "asset_id"):
                    if row.get(key) is not None:
                        item[key] = _text(row[key])
                if row.get("avg_entry_price") is not None:
                    item["avg_entry_price"] = _decimal(row["avg_entry_price"])
                result.append(item)
            except (KeyError, TypeError, ValueError):
                raise ProviderError("MALFORMED_POSITION") from None
        return {"records": result, "complete": True, "observed_at": utc_timestamp(self._utcnow())}

    def orders(self, deadline: float, *, status: str = "all", limit: int = 50,
               after: str | None = None, until: str | None = None) -> dict:
        if status not in {"open", "closed", "all"} or isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ProviderError("INVALID_ORDER_QUERY")
        now = self._utcnow()
        after = utc_timestamp(after or now - timedelta(days=1))
        until = utc_timestamp(until or now)
        if after >= until or (datetime.fromisoformat(until.replace("Z", "+00:00")) - datetime.fromisoformat(after.replace("Z", "+00:00"))).total_seconds() > 7 * 86400:
            raise ProviderError("INVALID_ORDER_WINDOW")
        if not self._verified:
            self.verify_account(deadline)
        rows = self._request("orders", {"status": status, "limit": limit, "after": after,
                                         "until": until, "direction": "asc", "nested": "true"}, deadline)
        if len(rows) > limit:
            raise ProviderError("ORDER_CAP_EXCEEDED")
        records = [_order(row) for row in rows]
        return {"records": records, "complete": len(rows) < limit,
                "potentially_truncated": len(rows) == limit, "status_filter": status,
                "after": after, "until": until, "history_complete": False,
                "observed_at": utc_timestamp(self._utcnow())}

    def trade_activities(self, deadline: float, *, after: str | None = None,
                         until: str | None = None, page_size: int = 50, max_pages: int = 3) -> dict:
        if any(isinstance(x, bool) or not isinstance(x, int) for x in (page_size, max_pages)) or not 1 <= page_size <= 50 or not 1 <= max_pages <= 3:
            raise ProviderError("INVALID_ACTIVITY_QUERY")
        now = self._utcnow()
        after, until = utc_timestamp(after or now - timedelta(days=1)), utc_timestamp(until or now)
        if after >= until or (datetime.fromisoformat(until.replace("Z", "+00:00")) - datetime.fromisoformat(after.replace("Z", "+00:00"))).total_seconds() > 7 * 86400:
            raise ProviderError("INVALID_ACTIVITY_WINDOW")
        if not self._verified:
            self.verify_account(deadline)
        records, seen, token, complete = [], set(), None, False
        for _ in range(max_pages):
            params = {"after": after, "until": until, "page_size": page_size, "direction": "asc"}
            if token:
                params["page_token"] = token
            rows = self._request("fills", params, deadline)
            if len(rows) > page_size:
                raise ProviderError("ACTIVITY_CAP_EXCEEDED")
            for row in rows:
                try:
                    identity = _text(row["id"])
                    if identity in seen:
                        raise ProviderError("ACTIVITY_PAGINATION_CONFLICT")
                    seen.add(identity)
                    if row.get("activity_type") != "FILL":
                        raise ValueError()
                    records.append({"id": identity, "order_id": _text(row["order_id"]),
                                    "symbol": validate_symbol(row["symbol"]), "activity_type": "FILL",
                                    "side": _text(row["side"]), "qty": _decimal(row["qty"]),
                                    "price": _decimal(row["price"]), "transaction_time": utc_timestamp(row["transaction_time"])})
                except (KeyError, TypeError, ValueError):
                    raise ProviderError("MALFORMED_ACTIVITY") from None
            if len(rows) < page_size:
                complete = True
                break
            token = records[-1]["id"]
        return {"records": records, "complete": complete, "potentially_truncated": not complete,
                "after": after, "until": until, "history_complete": False,
                "settlement_verified": False, "observed_at": utc_timestamp(self._utcnow())}

    def read_broker_state(self, deadline: float, *, after: str | None = None, order_limit: int = 50) -> dict:
        account = self.account_capabilities(deadline)
        positions = self.positions(deadline)
        orders = self.orders(deadline, status="all", limit=order_limit, after=after)
        activities = self.trade_activities(deadline, after=after)
        return {"account": account, "positions": positions, "orders": orders, "trade_activities": activities,
                "paper": True, "identity_verified": True, "complete": False, "settled": False,
                "incomplete_reasons": ["REST_READS_NOT_ATOMIC", "BOUNDED_ACTIVITY_WINDOW", "SETTLEMENT_NOT_VERIFIED"],
                "observed_at": utc_timestamp(self._utcnow()), "broker_authority": "NONE"}

    def poll(self, deadline: float) -> PollResult:
        if not self._verified:
            self.verify_account(deadline)
        observations, gaps = [], []
        clock = normalize_clock(self._request("clock", {}, deadline), self._utcnow())
        observations.append(clock)
        if "future_timestamp" in clock["quality"] or "stale" in clock["quality"]:
            return PollResult(observations, [{"code": "CLOCK_UNRELIABLE"}], None, "alpaca")
        is_open = clock["payload"]["is_open"]
        if not is_open:
            return PollResult(observations, [{"code": "MARKET_CLOSED"}], False, "alpaca")
        tasks = []
        if self.config.stock_symbols:
            tasks += [("stock_bars", "bars", self.config.stock_symbols, normalize_bar, "iex"),
                      ("stock_trades", "trades", self.config.stock_symbols, normalize_trade, "iex")]
        if self.config.option_symbols:
            tasks += [("option_quotes", "quotes", self.config.option_symbols, normalize_option_quote, "indicative"),
                      ("option_snapshots", "snapshots", self.config.option_symbols, normalize_snapshot, "indicative")]
        for endpoint, key, symbols, normalizer, feed in tasks:
            params = {"symbols": ",".join(symbols), "feed": feed}
            if endpoint == "option_snapshots":
                params["limit"] = len(symbols)
            try:
                data = self._request(endpoint, params, deadline)
            except ProviderError as exc:
                return PollResult(observations, gaps, True, "alpaca", error=exc)
            received = self._utcnow()
            records = data.get(key)
            if not isinstance(records, dict):
                return PollResult(observations, gaps, True, "alpaca", error=ProviderError("MALFORMED_RESPONSE"))
            for symbol in symbols:
                if records.get(symbol) is None:
                    gaps.append({"code": "MISSING_SYMBOL", "endpoint": endpoint, "symbol": symbol})
                    continue
                try:
                    observations.append(normalizer(records[symbol], received, symbol=symbol, feed=feed))
                except ObservationError:
                    gaps.append({"code": "INVALID_OBSERVATION", "endpoint": endpoint, "symbol": symbol})
            if data.get("next_page_token"):
                gaps.append({"code": "RESPONSE_TRUNCATED", "endpoint": endpoint})
        if not self._metadata_done and self.config.stock_symbols:
            market_day = datetime.fromisoformat(clock["event_at"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York")).date()
            try:
                data = self._request("contracts", {"underlying_symbols": ",".join(self.config.stock_symbols),
                                                    "status": "active", "limit": self.config.contract_limit,
                                                    "expiration_date_gte": (market_day + timedelta(days=7)).isoformat(),
                                                    "expiration_date_lte": (market_day + timedelta(days=14)).isoformat()}, deadline)
            except ProviderError as exc:
                return PollResult(observations, gaps, True, "alpaca", error=exc)
            records = data.get("option_contracts")
            if not isinstance(records, list) or len(records) > self.config.contract_limit:
                return PollResult(observations, gaps, True, "alpaca", error=ProviderError("MALFORMED_RESPONSE"))
            received = self._utcnow()
            for record in records:
                try:
                    item = normalize_contract(record, received)
                    item["provenance"]["query_expiration_date_gte"] = (market_day + timedelta(days=7)).isoformat()
                    item["provenance"]["query_expiration_date_lte"] = (market_day + timedelta(days=14)).isoformat()
                    item["provenance"]["chain_coverage_complete"] = not bool(data.get("next_page_token"))
                    observations.append(item)
                except ObservationError:
                    gaps.append({"code": "INVALID_CONTRACT_METADATA"})
            if data.get("next_page_token"):
                gaps.append({"code": "METADATA_TRUNCATED", "limit": self.config.contract_limit})
            self._metadata_done = True
        return PollResult(observations, gaps, True, "alpaca")


class MockProvider:
    """Finite-run fixture source. Every envelope is synthetic and non-executable."""
    name = "mock_synthetic"
    synthetic = True
    broker_authority = "NONE"

    def __init__(self, *, utcnow: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 market_open: bool = True, batches: list[PollResult | Exception] | None = None):
        if not isinstance(market_open, bool):
            raise ValueError("invalid_market_open")
        self._utcnow, self.market_open, self.batches, self.cycles = utcnow, market_open, batches, 0

    def poll(self, deadline: float) -> PollResult:
        index = self.cycles
        self.cycles += 1
        if self.batches is not None:
            if index >= len(self.batches):
                return PollResult([], [{"code": "MOCK_FIXTURE_EXHAUSTED"}], None, "mock")
            result = self.batches[index]
            if isinstance(result, Exception):
                raise result
            return result
        now = self._utcnow()
        clock = normalize_clock({"timestamp": utc_timestamp(now), "is_open": self.market_open,
                                 "next_open": utc_timestamp(now + timedelta(days=1)),
                                 "next_close": utc_timestamp(now + timedelta(hours=4))}, now, source="mock")
        if not self.market_open:
            return PollResult([clock], [{"code": "MARKET_CLOSED"}], False, "mock")
        minute = now.replace(second=0, microsecond=0) - timedelta(minutes=1)
        bar = normalize_bar({"t": utc_timestamp(minute), "o": 500, "h": 501, "l": 499,
                             "c": 500.5, "v": 1000, "n": 20, "vw": 500.2}, now, symbol="SPY", source="mock")
        quote = normalize_option_quote({"t": utc_timestamp(now - timedelta(seconds=1)), "bp": 1.1,
                                        "ap": 1.2, "bs": 10, "as": 12}, now,
                                       symbol="SPY261016C00500000", source="mock")
        return PollResult([clock, bar, quote], [], True, "mock")
