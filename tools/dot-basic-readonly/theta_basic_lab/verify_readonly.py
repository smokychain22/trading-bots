"""One bounded, sanitized GET-only integration check; no execution authority.

Import and default invocation perform no credential access or network requests.
The CLI supervises a fixed child process and releases only a closed report schema.
The injected-transport interface is exclusively synthetic test evidence.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
from typing import Callable
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from .observations import (normalize_bar, normalize_clock, normalize_contract,
                           normalize_option_quote, normalize_snapshot,
                           normalize_trade, timestamp_ns, utc_timestamp)
from .providers import (APIConfig, AlpacaBasicProvider, ENDPOINTS,
                        HTTPSGetTransport, PROVIDER_ERROR_CODES, ProviderError, SharedRateLimiter,
                        _decimal, _order, validate_url)

SCHEMA = "THETA_BASIC_READONLY_CHECK_V1"
ENVIRONMENT = "dot-basic-readonly"
SECRET_NAMES = ("THETA_ALPACA_PAPER_KEY_ID", "THETA_ALPACA_PAPER_SECRET_KEY",
                "THETA_ALPACA_PAPER_ACCOUNT_NUMBER")
MAX_REQUESTS = 9
MAX_RESPONSE_BYTES = 262_144
MAX_SECONDS = 40
WALL_SECONDS = 45
MAX_REPORT_BYTES = 16_384
OPEN_ORDER_LIMIT = 100
METADATA_LIMIT = 20
STAGES = frozenset(("CONFIGURATION", "ACCOUNT", "CLOCK", "POSITIONS", "OPEN_ORDERS",
                    "IEX_BAR", "IEX_TRADE", "METADATA", "INDICATIVE_QUOTE",
                    "INDICATIVE_SNAPSHOT", "COMPLETE", "SUPERVISOR"))
STATUSES = frozenset(("REFUSED", "FAILED", "INCOMPLETE", "PASSED", "TIMEOUT"))
EVIDENCE = frozenset(("NO_API_EVIDENCE", "SYNTHETIC_FIXTURE", "AUTHENTICATED_GET_ONLY"))
FAILURE_CODES = PROVIDER_ERROR_CODES | {"NONE", "UNCLASSIFIED"}
CHECK_NAMES = (
    "environment_guard_passed", "configuration_present", "exact_paper_identity",
    "account_active", "options_level_three", "trading_unblocked",
    "buying_power_valid", "options_buying_power_valid", "authenticated_clock_valid",
    "market_open_known", "market_open", "positions_complete", "open_orders_complete",
    "iex_bar_valid", "iex_trade_valid", "metadata_valid", "metadata_page_complete",
    "indicative_quote_valid", "indicative_snapshot_valid", "event_timestamps_valid",
)
INVARIANTS = {
    "get_only": True, "orders_enabled": False, "execution_authority": False,
    "fills_requested": False, "actual_fill_evidence": False,
    "iex_is_consolidated": False, "stock_quotes_checked": False,
    "indicative_is_executable": False, "snapshot_is_atomic": False,
    "greeks_publication_time_qualified": False, "metadata_publication_time_known": False,
    "complete_option_chain_verified": False, "broker_state_atomic": False,
    "durable_observation_history_verified": False, "owner_protection_verified_by_code": False,
}
COUNT_LIMITS = {"requests": MAX_REQUESTS, "positions": 200,
                "open_orders": OPEN_ORDER_LIMIT, "metadata_records": METADATA_LIMIT}
_OPEN_STATUSES = frozenset(("new", "accepted", "pending_new", "partially_filled",
                           "pending_cancel", "pending_replace", "accepted_for_bidding", "held"))
_ORDER_STATUSES = _OPEN_STATUSES | {"filled", "canceled", "expired", "rejected", "done_for_day",
                                    "replaced", "stopped", "suspended", "calculated"}
_ALLOWED_PATHS = frozenset(ENDPOINTS[name] for name in (
    "account", "clock", "positions", "orders", "stock_bars", "stock_trades",
    "contracts", "option_quotes", "option_snapshots"))


def _report(status="REFUSED", stage="CONFIGURATION", evidence="NO_API_EVIDENCE") -> dict:
    return {"schema": SCHEMA, "status": status, "stage": stage, "evidence": evidence,
            "failure_code": "DEADLINE" if status == "TIMEOUT" else "UNCLASSIFIED" if status == "FAILED" else "NONE",
            "checks": {key: False for key in CHECK_NAMES},
            "counts": {key: 0 for key in COUNT_LIMITS}, "limits": dict(INVARIANTS)}


def valid_report(value: object) -> bool:
    """Reject extra fields, dynamic text, bool-as-count, and forged invariants."""
    if type(value) is not dict or set(value) != set(_report()):
        return False
    if (any(type(value[key]) is not str for key in ("schema", "status", "stage", "evidence", "failure_code"))
            or value["schema"] != SCHEMA or value["status"] not in STATUSES
            or value["stage"] not in STAGES or value["evidence"] not in EVIDENCE
            or value["failure_code"] not in FAILURE_CODES):
        return False
    checks, counts, limits = value["checks"], value["counts"], value["limits"]
    if (type(checks) is not dict or set(checks) != set(CHECK_NAMES)
            or any(type(v) is not bool for v in checks.values())):
        return False
    if (type(counts) is not dict or set(counts) != set(COUNT_LIMITS)
            or any(type(counts[k]) is not int or not 0 <= counts[k] <= cap
                   for k, cap in COUNT_LIMITS.items())):
        return False
    if (type(limits) is not dict or set(limits) != set(INVARIANTS)
            or any(type(limits[k]) is not bool or limits[k] is not v
                   for k, v in INVARIANTS.items())):
        return False
    if value["evidence"] == "AUTHENTICATED_GET_ONLY" and (
            not checks["environment_guard_passed"] or not checks["exact_paper_identity"]
            or not checks["account_active"] or counts["requests"] < 1):
        return False
    # A partial or unconfigured report can never be promoted into a pass.
    required = set(CHECK_NAMES) - {"environment_guard_passed", "metadata_page_complete"}
    if value["status"] == "PASSED" and (value["stage"] != "COMPLETE"
            or value["failure_code"] != "NONE"
            or value["evidence"] == "NO_API_EVIDENCE"
            or not all(checks[k] for k in required) or counts["requests"] != MAX_REQUESTS):
        return False
    return True


class _Incomplete(Exception):
    pass


class _BudgetTransport:
    """Tighter verifier-only endpoint/request/time boundary around the provider."""
    def __init__(self, transport, monotonic):
        self.transport, self.monotonic, self.calls = transport, monotonic, 0

    def get(self, url, headers, *, timeout, max_bytes, deadline):
        validate_url(url)
        parsed = urlsplit(url)
        if (parsed.netloc, parsed.path) not in _ALLOWED_PATHS:
            raise ProviderError("ENDPOINT_REJECTED")
        if self.calls >= MAX_REQUESTS or self.monotonic() >= deadline:
            raise ProviderError("DEADLINE")
        if self.calls == 0 and parsed.path != "/v2/account":
            raise ProviderError("ACCOUNT_NOT_VERIFIED")
        query = parse_qs(parsed.query)
        if parsed.path == "/v2/orders" and query != {
                "status": ["open"], "limit": [str(OPEN_ORDER_LIMIT)],
                "direction": ["desc"], "nested": ["true"]}:
            raise ProviderError("INVALID_ORDER_QUERY")
        self.calls += 1
        result = self.transport.get(url, headers, timeout=min(timeout, 4),
                                    max_bytes=min(max_bytes, MAX_RESPONSE_BYTES), deadline=deadline)
        if self.monotonic() >= deadline:
            raise ProviderError("DEADLINE")
        return result


def _require(condition: bool) -> None:
    if not condition:
        raise _Incomplete()


def _fresh(item: dict, *, maximum_age=120) -> bool:
    age = timestamp_ns(item["observed_at"]) - timestamp_ns(item["event_at"])
    return (0 <= age <= maximum_age * 1_000_000_000
            and not set(item["quality"]) & {"stale", "future_timestamp", "incomplete",
                                            "crossed_quote", "one_sided_or_zero_quote"})


def _funds_valid(value) -> bool:
    return value is not None and Decimal(_decimal(value)) >= 0


def _positive_size(value) -> bool:
    return type(value) is int and value > 0


def _valid_quote(item: dict) -> bool:
    body = item["payload"]
    return (_fresh(item) and body["bid"] > 0 and body["ask"] > 0
            and _positive_size(body["bid_size"]) and _positive_size(body["ask_size"]))


def _one_record(data, key):
    _require(type(data.get(key)) is dict and set(data[key]) == {"SPY"}
             and not data.get("next_page_token"))
    return data[key]["SPY"]


def _validate_orders(rows, received):
    _require(type(rows) is list and len(rows) <= OPEN_ORDER_LIMIT)
    seen = set()

    def check(row, *, top=True):
        item = _order(row)
        _require(item["id"] not in seen and item["side"] in {"buy", "sell"}
                 and item["type"] in {"market", "limit", "stop", "stop_limit", "trailing_stop"}
                 and item["qty"] is not None and Decimal(item["qty"]) > 0
                 and item["filled_qty"] is not None
                 and 0 <= Decimal(item["filled_qty"]) <= Decimal(item["qty"])
                 and item["submitted_at"] is not None)
        _require(item["status"] in _ORDER_STATUSES
                 and timestamp_ns(item["submitted_at"]) <= timestamp_ns(received))
        for field in ("updated_at", "canceled_at", "failed_at", "expired_at", "filled_at"):
            if item[field] is not None:
                _require(timestamp_ns(item["submitted_at"]) <= timestamp_ns(item[field])
                         <= timestamp_ns(received))
        for field in ("limit_price", "filled_avg_price"):
            if item[field] is not None:
                _require(Decimal(item[field]) > 0)
        if row.get("stop_price") is not None:
            _require(Decimal(_decimal(row["stop_price"])) > 0)
        if item["type"] in {"limit", "stop_limit"}:
            _require(item["limit_price"] is not None)
        if item["type"] in {"stop", "stop_limit"}:
            _require(row.get("stop_price") is not None)
        if Decimal(item["filled_qty"]) > 0:
            _require(item["filled_avg_price"] is not None)
        if top:
            _require(item["status"] in _OPEN_STATUSES and Decimal(item["filled_qty"]) < Decimal(item["qty"]))
        seen.add(item["id"])
        _require(item.get("symbol") is not None or bool(item.get("legs")))
        for leg in row.get("legs") or []:
            check(leg, top=False)

    for row in rows:
        check(row)
    return len(rows)


def _select_contract(data, received, market_day):
    rows = data.get("option_contracts")
    _require(type(rows) is list and 0 < len(rows) <= METADATA_LIMIT)
    selected, seen = [], set()
    for row in rows:
        item = normalize_contract(row, received)
        symbol = item["symbol"]
        match = re.fullmatch(r"SPY(\d{6})([CP])(\d{8})", symbol)
        _require(match is not None and symbol not in seen)
        expiry = date.fromisoformat(row["expiration_date"])
        _require(row.get("underlying_symbol") == "SPY" and row.get("status") == "active"
                 and type(row.get("tradable")) is bool
                 and market_day + timedelta(days=7) <= expiry <= market_day + timedelta(days=14)
                 and expiry.strftime("%y%m%d") == match[1]
                 and row.get("type") == ("call" if match[2] == "C" else "put")
                 and Decimal(_decimal(row["strike_price"])) == Decimal(match[3]) / 1000
                 and Decimal(_decimal(row["strike_price"])) > 0)
        seen.add(symbol)
        if row["tradable"]:
            selected.append(symbol)
    _require(bool(selected))
    # Probe selection is deterministic and not a recommendation or trade decision.
    return sorted(selected)[0], len(rows), not bool(data.get("next_page_token"))


def verify(*, enable_api_read=False, require_github_environment=None,
           transport=None, utcnow: Callable = lambda: datetime.now(timezone.utc),
           monotonic: Callable = time.monotonic, sleep: Callable = time.sleep) -> dict:
    """Run once. Only tests supply a transport; all such results are synthetic.

    No exception text, source payload, symbol, account amount, identifier, hash,
    timestamp, URL, response header, or secret is included in the report.
    """
    result = _report()
    budget = None
    try:
        # Suppress accidental library/transport diagnostics, including hostile test
        # transports. The outer CLI additionally discards child stderr entirely.
        with open(os.devnull, "w") as discard, redirect_stdout(discard), redirect_stderr(discard):
            if enable_api_read is not True:
                return result
            if transport is None and require_github_environment != ENVIRONMENT:
                return result
            if require_github_environment is not None:
                if (require_github_environment != ENVIRONMENT
                        or os.environ.get("GITHUB_ACTIONS") != "true"
                        or os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
                        or os.environ.get("THETA_GITHUB_ENVIRONMENT") != ENVIRONMENT):
                    return result
                result["checks"]["environment_guard_passed"] = True
            if not all(os.environ.get(key) for key in SECRET_NAMES):
                return result
            result["checks"]["configuration_present"] = True
            result["evidence"] = "SYNTHETIC_FIXTURE" if transport is not None else "NO_API_EVIDENCE"
            budget = _BudgetTransport(transport if transport is not None else HTTPSGetTransport(), monotonic)
            provider = AlpacaBasicProvider(
                APIConfig(enable_api_read=True, stock_symbols=("SPY",), request_timeout_seconds=4,
                          max_response_bytes=MAX_RESPONSE_BYTES, contract_limit=METADATA_LIMIT),
                transport=budget, limiter=SharedRateLimiter(120, monotonic=monotonic, sleep=sleep),
                utcnow=utcnow, monotonic=monotonic)
            deadline = monotonic() + MAX_SECONDS
            checks = result["checks"]
            result["status"], result["stage"] = "FAILED", "ACCOUNT"
            account = provider.verify_account(deadline)
            checks["exact_paper_identity"] = account["verified"] is True and account["paper_host"] is True
            checks["account_active"] = account["status"] == "ACTIVE"
            if transport is None:
                result["evidence"] = "AUTHENTICATED_GET_ONLY"
            checks["options_level_three"] = (account.get("options_trading_level") == 3
                                              and account.get("options_approved_level") == 3)
            checks["trading_unblocked"] = (account.get("trading_blocked") is False
                                            and account.get("account_blocked") is False)
            checks["buying_power_valid"] = _funds_valid(account.get("buying_power"))
            checks["options_buying_power_valid"] = _funds_valid(account.get("options_buying_power"))
            _require(all(checks[key] for key in ("exact_paper_identity", "account_active",
                     "options_level_three", "trading_unblocked", "buying_power_valid",
                     "options_buying_power_valid")))

            result["stage"] = "CLOCK"
            clock = normalize_clock(provider._request("clock", {}, deadline), utcnow())
            opening, closing = clock["payload"]["next_open"], clock["payload"]["next_close"]
            boundaries_ordered = closing < opening if clock["payload"]["is_open"] else opening < closing
            checks["authenticated_clock_valid"] = _fresh(clock, maximum_age=5) and boundaries_ordered
            _require(checks["authenticated_clock_valid"])
            checks["market_open_known"], checks["market_open"] = True, clock["payload"]["is_open"]

            result["stage"] = "POSITIONS"
            positions = provider.positions(deadline)
            symbols = set()
            for row in positions["records"]:
                quantity = Decimal(row["qty"])
                _require(row["symbol"] not in symbols and quantity != 0
                         and ((quantity > 0 and row["side"] == "long")
                              or (quantity < 0 and row["side"] == "short")))
                symbols.add(row["symbol"])
            checks["positions_complete"] = positions["complete"] is True
            result["counts"]["positions"] = len(positions["records"])

            result["stage"] = "OPEN_ORDERS"
            # Existing orders() adds a recent submission window. This deliberately
            # uses the same guarded GET primitive without after/until so old GTC
            # orders cannot silently disappear from the completeness check.
            orders = provider._request("orders", {"status": "open", "limit": OPEN_ORDER_LIMIT,
                                                  "direction": "desc", "nested": "true"}, deadline)
            result["counts"]["open_orders"] = _validate_orders(orders, utcnow())
            checks["open_orders_complete"] = len(orders) < OPEN_ORDER_LIMIT
            _require(checks["positions_complete"] and checks["open_orders_complete"])
            if not checks["market_open"]:
                result["stage"] = "CLOCK"
                raise _Incomplete()

            result["stage"] = "IEX_BAR"
            raw = provider._request("stock_bars", {"symbols": "SPY", "feed": "iex"}, deadline)
            bar = normalize_bar(_one_record(raw, "bars"), utcnow(), symbol="SPY", feed="iex")
            checks["iex_bar_valid"] = (_fresh(bar)
                and all(bar["payload"][field] > 0 for field in ("open", "high", "low", "close"))
                and _positive_size(bar["payload"]["volume"])
                and ("trade_count" not in bar["payload"] or _positive_size(bar["payload"]["trade_count"])))
            _require(checks["iex_bar_valid"])
            result["stage"] = "IEX_TRADE"
            raw = provider._request("stock_trades", {"symbols": "SPY", "feed": "iex"}, deadline)
            trade = normalize_trade(_one_record(raw, "trades"), utcnow(), symbol="SPY", feed="iex")
            checks["iex_trade_valid"] = (_fresh(trade) and trade["payload"]["price"] > 0
                                         and _positive_size(trade["payload"]["size"]))
            _require(checks["iex_trade_valid"])

            result["stage"] = "METADATA"
            market_day = datetime.fromisoformat(clock["event_at"].replace("Z", "+00:00")).astimezone(
                ZoneInfo("America/New_York")).date()
            raw = provider._request("contracts", {"underlying_symbols": "SPY", "status": "active",
                "limit": METADATA_LIMIT, "expiration_date_gte": (market_day + timedelta(days=7)).isoformat(),
                "expiration_date_lte": (market_day + timedelta(days=14)).isoformat()}, deadline)
            option, count, complete = _select_contract(raw, utcnow(), market_day)
            result["counts"]["metadata_records"] = count
            checks["metadata_valid"], checks["metadata_page_complete"] = True, complete

            result["stage"] = "INDICATIVE_QUOTE"
            raw = provider._request("option_quotes", {"symbols": option, "feed": "indicative"}, deadline)
            _require(type(raw.get("quotes")) is dict and set(raw["quotes"]) == {option}
                     and not raw.get("next_page_token"))
            quote = normalize_option_quote(raw["quotes"][option], utcnow(), symbol=option)
            checks["indicative_quote_valid"] = _valid_quote(quote)
            _require(checks["indicative_quote_valid"])

            result["stage"] = "INDICATIVE_SNAPSHOT"
            raw = provider._request("option_snapshots", {"symbols": option, "feed": "indicative", "limit": 1}, deadline)
            _require(type(raw.get("snapshots")) is dict and set(raw["snapshots"]) == {option}
                     and not raw.get("next_page_token"))
            received, body = utcnow(), raw["snapshots"][option]
            snapshot = normalize_snapshot(body, received, symbol=option)
            # Check each quote component, not only the maximum component time.
            component = normalize_option_quote(body["latestQuote"], received, symbol=option)
            checks["indicative_snapshot_valid"] = _valid_quote(component) and _fresh(snapshot)
            if body.get("latestTrade") is not None:
                age = timestamp_ns(received) - timestamp_ns(body["latestTrade"]["t"])
                # Indicative trades can be delayed. Do not certify their freshness.
                _require(age >= 0 and body["latestTrade"]["p"] > 0
                         and _positive_size(body["latestTrade"]["s"]))
            _require(checks["indicative_snapshot_valid"])
            checks["event_timestamps_valid"] = True
            result["stage"], result["status"] = "COMPLETE", "PASSED"
    except _Incomplete:
        result["status"] = "INCOMPLETE"
    except ProviderError as exc:
        result["status"] = "FAILED"
        # Never stringify an exception or trust an arbitrary exception property.
        # Exact-type errors are created by the fixed provider; even a mutated
        # code must be an exact str present in its static allowlist.
        code = dict.get(exc.__dict__, "code") if type(exc) is ProviderError else None
        result["failure_code"] = code if type(code) is str and code in PROVIDER_ERROR_CODES else "UNCLASSIFIED"
    except BaseException:
        # This boundary deliberately swallows arbitrary messages and tracebacks,
        # including a transport's SystemExit. No failure detail is serialized.
        result["status"] = "FAILED"
        result["failure_code"] = "UNCLASSIFIED"
    finally:
        if budget is not None:
            result["counts"]["requests"] = budget.calls
    return result if valid_report(result) else _report("FAILED", "SUPERVISOR")


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError("INVALID_CONFIGURATION")


def _parse(argv):
    parser = _Parser(add_help=False)
    parser.add_argument("--enable-api-read", action="store_true")
    parser.add_argument("--require-github-environment", choices=(ENVIRONMENT,))
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--_worker-fd", type=int, help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def _worker_handshake(fd):
    """An inherited anonymous pipe makes a bare private-worker invocation refuse.

    This is a process-launch integrity check, not authentication or authorization.
    The protected environment and owner's approval remain external requirements.
    """
    if type(fd) is not int or fd < 3:
        return False
    try:
        if not stat.S_ISFIFO(os.fstat(fd).st_mode):
            return False
        os.set_blocking(fd, False)
        return os.read(fd, 128) == b"THETA_READONLY_CHILD:" + str(os.getppid()).encode("ascii")
    except (OSError, ValueError):
        return False
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def _worker_limits():
    # The supported runner is Linux. Refuse on unsupported platforms rather than
    # silently dropping CPU, address-space, descriptor, or output-file limits.
    import resource
    for name, limit in (("RLIMIT_CPU", 40), ("RLIMIT_AS", 256 * 1024 * 1024),
                        ("RLIMIT_NOFILE", 64), ("RLIMIT_FSIZE", MAX_REPORT_BYTES)):
        kind = getattr(resource, name)
        _, hard = resource.getrlimit(kind)
        cap = limit if hard == resource.RLIM_INFINITY else min(limit, hard)
        resource.setrlimit(kind, (cap, cap))


def run_bounded(*, enable_api_read=False, require_github_environment=None,
                wall_seconds=WALL_SECONDS) -> dict:
    """Fixed-module process bound, including a stuck resolver; never echo stderr."""
    if (type(enable_api_read) is not bool
            or require_github_environment not in (None, ENVIRONMENT)
            or (enable_api_read and require_github_environment != ENVIRONMENT)
            or type(wall_seconds) not in (int, float) or not 0.001 <= wall_seconds <= WALL_SECONDS):
        return _report("REFUSED", "CONFIGURATION")
    if enable_api_read and (os.environ.get("GITHUB_ACTIONS") != "true"
                           or os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
                           or os.environ.get("THETA_GITHUB_ENVIRONMENT") != ENVIRONMENT):
        return _report("REFUSED", "CONFIGURATION")
    args = [sys.executable, "-E", "-s", "-S", "-B", "-m", "theta_basic_lab.verify_readonly", "--_worker"]
    if enable_api_read:
        args.append("--enable-api-read")
    if require_github_environment is not None:
        args += ["--require-github-environment", require_github_environment]
    # Do not pass unrelated secrets or user-selected Python startup hooks onward.
    names = SECRET_NAMES + ("PATH", "LANG", "LC_ALL", "GITHUB_ACTIONS", "GITHUB_EVENT_NAME",
                            "THETA_GITHUB_ENVIRONMENT")
    env = {name: os.environ[name] for name in names if name in os.environ} if enable_api_read else {}
    reader = None
    try:
        reader, writer = os.pipe()
        try:
            os.write(writer, b"THETA_READONLY_CHILD:" + str(os.getpid()).encode("ascii"))
        finally:
            os.close(writer)
        args += ["--_worker-fd", str(reader)]
        with tempfile.TemporaryFile() as output:
            child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.DEVNULL, start_new_session=True,
                                     cwd=str(Path(__file__).resolve().parents[1]), env=env,
                                     pass_fds=(reader,))
            os.close(reader)
            reader = None
            try:
                child.wait(timeout=wall_seconds)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=2)
                except (subprocess.TimeoutExpired, OSError):
                    pass
                return _report("TIMEOUT", "SUPERVISOR")
            output.seek(0)
            raw = output.read(MAX_REPORT_BYTES + 1)
            if len(raw) > MAX_REPORT_BYTES or child.returncode not in (0, 2):
                return _report("FAILED", "SUPERVISOR")
            value = json.loads(raw)
            if (not valid_report(value) or value["evidence"] == "SYNTHETIC_FIXTURE"
                    or (value["evidence"] == "AUTHENTICATED_GET_ONLY" and not enable_api_read)
                    or (child.returncode == 0) is not (value["status"] == "PASSED")):
                return _report("FAILED", "SUPERVISOR")
            return value
    except BaseException:
        # Ensure interruption cannot leave an authorized read child running.
        if "child" in locals() and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=2)
            except BaseException:
                pass
        return _report("FAILED", "SUPERVISOR")
    finally:
        if reader is not None:
            try:
                os.close(reader)
            except OSError:
                pass


def main(argv=None):
    try:
        args = _parse(argv)
        if args._worker:
            if not _worker_handshake(args._worker_fd):
                raise ValueError("UNSUPERVISED_WORKER")
            _worker_limits()
            def expired(signum, frame):
                raise TimeoutError("WORKER_DEADLINE")
            signal.signal(signal.SIGALRM, expired)
            signal.alarm(WALL_SECONDS)
            result = verify(enable_api_read=args.enable_api_read,
                            require_github_environment=args.require_github_environment)
        else:
            if args._worker_fd is not None:
                raise ValueError("INVALID_CONFIGURATION")
            result = run_bounded(enable_api_read=args.enable_api_read,
                                 require_github_environment=args.require_github_environment)
    except BaseException:
        result = _report("REFUSED", "CONFIGURATION")
    print(json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False))
    return 0 if result["status"] == "PASSED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
