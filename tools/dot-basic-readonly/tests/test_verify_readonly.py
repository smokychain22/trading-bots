"""Synthetic fixtures only. No credentials or remote endpoints are consulted."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import io
import json
import os
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
from contextlib import redirect_stderr, redirect_stdout
from urllib.parse import parse_qs, urlsplit

from theta_basic_lab.providers import HTTPResult, ProviderError
from theta_basic_lab import verify_readonly as verifier

NOW = datetime(2026, 10, 9, 14, 31, 2, tzinfo=timezone.utc)
PRIVATE = "NEVER_RELEASE_SYNTHETIC_PRIVATE_SENTINEL"
OPTION = "SPY261016C00500000"
ENV = {
    "THETA_ALPACA_PAPER_KEY_ID": PRIVATE + "KEY",
    "THETA_ALPACA_PAPER_SECRET_KEY": PRIVATE + "SECRET",
    "THETA_ALPACA_PAPER_ACCOUNT_NUMBER": PRIVATE + "48RC9",
    "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
    "THETA_GITHUB_ENVIRONMENT": verifier.ENVIRONMENT,
}


def fixtures():
    quote = {"t": (NOW - timedelta(seconds=1)).isoformat(), "bp": 1.1, "ap": 1.2, "bs": 1, "as": 1}
    return [
        {"account_number": ENV["THETA_ALPACA_PAPER_ACCOUNT_NUMBER"], "status": "ACTIVE",
         "options_trading_level": 3, "options_approved_level": 3, "trading_blocked": False,
         "account_blocked": False, "buying_power": "987654.32", "options_buying_power": "54321.98",
         "cash": "23456.78", "private_server_diagnostic": PRIVATE},
        {"timestamp": NOW.isoformat(), "is_open": True, "next_open": "2026-10-12T13:30:00Z",
         "next_close": "2026-10-09T20:00:00Z"},
        [{"symbol": "PRIVATEHOLDING", "qty": "1", "side": "long", "asset_id": PRIVATE}],
        [],
        {"bars": {"SPY": {"t": "2026-10-09T14:30:00Z", "o": 500, "h": 501,
                            "l": 499, "c": 500, "v": 10}}},
        {"trades": {"SPY": {"t": (NOW - timedelta(seconds=1)).isoformat(), "p": 500, "s": 1}}},
        {"option_contracts": [{"symbol": OPTION, "underlying_symbol": "SPY", "status": "active",
                               "tradable": True, "type": "call", "expiration_date": "2026-10-16",
                               "strike_price": "500", "id": PRIVATE}], "next_page_token": None},
        {"quotes": {OPTION: deepcopy(quote)}},
        {"snapshots": {OPTION: {"latestQuote": deepcopy(quote), "greeks": {"delta": .5},
                                  "impliedVolatility": .25}}},
    ]


def order(identity="synthetic_order", **changes):
    row = {"id": identity, "client_order_id": PRIVATE, "status": "new", "side": "buy", "type": "limit",
           "symbol": "PRIVATEHOLDING", "qty": "1", "filled_qty": "0", "limit_price": "987.65",
           "submitted_at": "2020-01-02T10:00:00Z"}
    row.update(changes)
    return row


class FakeTime:
    def __init__(self):
        self.value = 0.0

    def monotonic(self):
        return self.value

    def sleep(self, amount):
        self.value += amount


class FixtureTransport:
    def __init__(self, rows, clock, *, noisy=False):
        self.rows, self.clock, self.noisy, self.calls = list(rows), clock, noisy, []

    def get(self, url, headers, **kwargs):
        self.calls.append((url, dict(headers), dict(kwargs)))
        if self.noisy:
            print(PRIVATE, file=sys.stdout)
            print(PRIVATE, file=sys.stderr)
        if not self.rows:
            raise AssertionError(PRIVATE + "unexpected_request")
        value = self.rows.pop(0)
        if isinstance(value, BaseException):
            raise value
        if callable(value):
            value = value(self.clock)
        return value if isinstance(value, HTTPResult) else HTTPResult(200, json.dumps(value).encode())


class VerifierTests(unittest.TestCase):
    def setUp(self):
        # Accidental real transport use fails the test before any DNS or socket.
        self.network = patch("theta_basic_lab.providers.HTTPSGetTransport.get", side_effect=AssertionError("NETWORK_FORBIDDEN"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def run_case(self, rows=None, *, env=None, noisy=False, **kwargs):
        clock = FakeTime()
        transport = FixtureTransport(fixtures() if rows is None else rows, clock, noisy=noisy)
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, ENV if env is None else env, clear=True), redirect_stdout(out), redirect_stderr(err):
            report = verifier.verify(enable_api_read=True, require_github_environment=verifier.ENVIRONMENT,
                                     transport=transport, utcnow=lambda: NOW,
                                     monotonic=clock.monotonic, sleep=clock.sleep, **kwargs)
        self.assertTrue(verifier.valid_report(report))
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")
        self.assertNotIn(PRIVATE, json.dumps(report))
        for secret in ("PRIVATEHOLDING", OPTION, "987654.32", "54321.98", "23456.78", "987.65"):
            self.assertNotIn(secret, json.dumps(report))
        return report, transport, clock

    def test_full_synthetic_path_strictly_get_only_and_sanitized(self):
        report, transport, clock = self.run_case(noisy=True)
        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(report["evidence"], "SYNTHETIC_FIXTURE")
        self.assertEqual(report["counts"], {"requests": 9, "positions": 1, "open_orders": 0, "metadata_records": 1})
        self.assertEqual(len(transport.calls), 9)
        self.assertLess(clock.value, 40)
        paths = [urlsplit(call[0]).path for call in transport.calls]
        self.assertEqual(paths[0], "/v2/account")
        self.assertNotIn("/v2/account/activities/FILL", paths)
        self.assertNotIn("/v2/calendar", paths)
        for url, headers, options in transport.calls:
            self.assertIn(urlsplit(url).netloc, {"paper-api.alpaca.markets", "data.alpaca.markets"})
            self.assertLessEqual(options["max_bytes"], 262144)
            self.assertLessEqual(options["timeout"], 4)
            self.assertEqual(headers["APCA-API-KEY-ID"], ENV["THETA_ALPACA_PAPER_KEY_ID"])
        queries = [parse_qs(urlsplit(call[0]).query) for call in transport.calls]
        self.assertEqual(queries[4]["feed"], ["iex"])
        self.assertEqual(queries[5]["feed"], ["iex"])
        self.assertEqual(queries[7]["feed"], ["indicative"])
        self.assertEqual(queries[8]["feed"], ["indicative"])
        self.assertEqual(queries[6]["expiration_date_gte"], ["2026-10-16"])
        self.assertEqual(queries[6]["expiration_date_lte"], ["2026-10-23"])
        self.assertEqual(report["limits"], verifier.INVARIANTS)

    def test_default_never_reads_environment_or_network(self):
        with patch("theta_basic_lab.verify_readonly.os.environ.get", side_effect=AssertionError("MUST_NOT_READ")):
            report = verifier.verify()
        self.assertEqual(report["status"], "REFUSED")
        self.assertEqual(report["counts"]["requests"], 0)

    def test_missing_config_or_environment_refuses_without_network(self):
        for name in ENV:
            env = dict(ENV)
            del env[name]
            with self.subTest(name=name):
                report, transport, _ = self.run_case(env=env)
                self.assertEqual(report["status"], "REFUSED")
                self.assertEqual(transport.calls, [])

    def test_environment_guard_rejects_untrusted_modes(self):
        for key, value in (("GITHUB_ACTIONS", "false"), ("GITHUB_EVENT_NAME", "pull_request"),
                           ("GITHUB_EVENT_NAME", "push"), ("THETA_GITHUB_ENVIRONMENT", "wrong")):
            with self.subTest(key=key, value=value):
                report, transport, _ = self.run_case(env=dict(ENV, **{key: value}))
                self.assertEqual(report["status"], "REFUSED")
                self.assertEqual(transport.calls, [])

    def test_exact_identity_not_suffix_matching(self):
        rows = fixtures()
        rows[0]["account_number"] = "WRONG48RC9"
        report, transport, _ = self.run_case(rows)
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["stage"], "ACCOUNT")
        self.assertFalse(report["checks"]["exact_paper_identity"])
        self.assertEqual(len(transport.calls), 1)

    def test_bad_expected_account_or_credentials_never_reach_endpoint(self):
        for key, value in (("THETA_ALPACA_PAPER_ACCOUNT_NUMBER", "wrong_suffix"),
                           ("THETA_ALPACA_PAPER_KEY_ID", "bad key"),
                           ("THETA_ALPACA_PAPER_SECRET_KEY", "x\n")):
            with self.subTest(key=key):
                report, transport, _ = self.run_case(env=dict(ENV, **{key: value}))
                self.assertEqual(report["status"], "FAILED")
                self.assertEqual(transport.calls, [])

    def test_account_capabilities_fail_closed_before_other_reads(self):
        for key, value in (("status", "REJECTED"), ("options_trading_level", 2),
                           ("options_approved_level", None), ("options_trading_level", True),
                           ("trading_blocked", True), ("account_blocked", None),
                           ("buying_power", None), ("buying_power", "-1"),
                           ("options_buying_power", "NaN"), ("options_buying_power", "1e9999999"),
                           ("options_buying_power", True)):
            rows = fixtures()
            rows[0][key] = value
            with self.subTest(key=key, value=value):
                report, transport, _ = self.run_case(rows)
                self.assertNotEqual(report["status"], "PASSED")
                self.assertEqual(len(transport.calls), 1)

    def test_zero_buying_power_is_valid_not_an_order_budget(self):
        rows = fixtures()
        rows[0]["buying_power"] = rows[0]["options_buying_power"] = "0"
        report, _, _ = self.run_case(rows)
        self.assertEqual(report["status"], "PASSED")
        self.assertFalse(report["limits"]["execution_authority"])

    def test_stale_future_and_malformed_clock_stop_all_later_reads(self):
        for key, value in (("timestamp", (NOW - timedelta(seconds=6)).isoformat()),
                           ("timestamp", (NOW + timedelta(seconds=3)).isoformat()),
                           ("timestamp", PRIVATE), ("is_open", "true"),
                           ("next_close", NOW.isoformat())):
            rows = fixtures()
            rows[1][key] = value
            with self.subTest(key=key, value=value):
                report, transport, _ = self.run_case(rows)
                self.assertNotEqual(report["status"], "PASSED")
                self.assertEqual(len(transport.calls), 2)
                self.assertFalse(report["checks"]["authenticated_clock_valid"])

    def test_closed_market_does_not_make_data_or_complete_claim(self):
        rows = fixtures()
        rows[1]["is_open"] = False
        rows[1]["next_close"] = "2026-10-12T20:00:00Z"
        report, transport, _ = self.run_case(rows)
        self.assertEqual(report["status"], "INCOMPLETE")
        self.assertTrue(report["checks"]["authenticated_clock_valid"])
        self.assertTrue(report["checks"]["market_open_known"])
        self.assertFalse(report["checks"]["market_open"])
        self.assertEqual(len(transport.calls), 4)

    def test_positions_reject_duplicate_malformed_zero_and_cap(self):
        for positions in ([{"symbol": "BAD VALUE", "qty": "1", "side": "long"}],
                          fixtures()[2] * 2,
                          [{"symbol": "SPY", "qty": "0", "side": "long"}],
                          [{"symbol": "SPY", "qty": "-1", "side": "long"}], fixtures()[2] * 201):
            rows = fixtures()
            rows[2] = positions
            with self.subTest(positions=len(positions)):
                report, transport, _ = self.run_case(rows)
                self.assertNotEqual(report["status"], "PASSED")
                self.assertEqual(len(transport.calls), 3)

    def test_empty_and_short_positions_are_accepted(self):
        for positions in ([], [{"symbol": "SPY", "qty": "-1", "side": "short"}]):
            rows = fixtures()
            rows[2] = positions
            report, _, _ = self.run_case(rows)
            self.assertEqual(report["status"], "PASSED")
            self.assertTrue(report["checks"]["positions_complete"])

    def test_open_orders_have_no_submission_window_and_accept_old_gtc(self):
        rows = fixtures()
        rows[3] = [order()]
        report, transport, _ = self.run_case(rows)
        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(parse_qs(urlsplit(transport.calls[3][0]).query), {
            "status": ["open"], "limit": ["100"], "direction": ["desc"], "nested": ["true"]})

    def test_order_cap_is_not_complete(self):
        rows = fixtures()
        rows[3] = [order(str(i)) for i in range(100)]
        report, transport, _ = self.run_case(rows)
        self.assertEqual(report["status"], "INCOMPLETE")
        self.assertEqual(report["counts"]["open_orders"], 100)
        self.assertFalse(report["checks"]["open_orders_complete"])
        self.assertEqual(len(transport.calls), 4)

    def test_malformed_order_incomplete_including_duplicate_nested_ids(self):
        for orders in ([order(status="filled")], [order(qty="NaN")],
                       [order(qty="0")], [order(filled_qty="2")], [order(submitted_at=None)],
                       [order(), order()], [order(legs=[order()])], [order(str(i)) for i in range(101)]):
            rows = fixtures()
            rows[3] = orders
            with self.subTest(orders=len(orders)):
                report, transport, _ = self.run_case(rows)
                self.assertNotEqual(report["status"], "PASSED")
                self.assertEqual(len(transport.calls), 4)

    def test_stale_invalid_missing_extra_and_incomplete_iex_data(self):
        for index, key, row in ((4, "bars", {"t": "2026-10-09T14:31:00Z", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}),
                                (5, "trades", {"t": (NOW - timedelta(seconds=121)).isoformat(), "p": 1, "s": 1}),
                                (5, "trades", {"t": (NOW + timedelta(seconds=3)).isoformat(), "p": 1, "s": 1}),
                                (5, "trades", {"t": NOW.isoformat(), "p": -1, "s": 1})):
            rows = fixtures()
            rows[index] = {key: {"SPY": row}}
            report, _, _ = self.run_case(rows)
            self.assertNotEqual(report["status"], "PASSED")
        for content in ({"trades": {}}, {"trades": {"SPY": fixtures()[5]["trades"]["SPY"], "WRONG": {}}},
                        {**fixtures()[5], "next_page_token": PRIVATE}):
            rows = fixtures()
            rows[5] = content
            report, _, _ = self.run_case(rows)
            self.assertNotEqual(report["status"], "PASSED")

    def test_metadata_truncation_never_certifies_chain_but_can_probe(self):
        rows = fixtures()
        rows[6]["next_page_token"] = PRIVATE
        report, transport, _ = self.run_case(rows)
        self.assertEqual(report["status"], "PASSED")
        self.assertFalse(report["checks"]["metadata_page_complete"])
        self.assertFalse(report["limits"]["complete_option_chain_verified"])
        self.assertEqual(len(transport.calls), 9)

    def test_invalid_metadata_never_selects_an_option(self):
        for key, value in (("underlying_symbol", "QQQ"), ("symbol", "QQQ261016C00500000"),
                           ("expiration_date", "2026-10-15"), ("type", "put"),
                           ("tradable", "true"), ("tradable", False), ("strike_price", "NaN"),
                           ("strike_price", "501"), ("status", "inactive")):
            rows = fixtures()
            rows[6]["option_contracts"][0][key] = value
            with self.subTest(key=key, value=value):
                report, transport, _ = self.run_case(rows)
                self.assertNotEqual(report["status"], "PASSED")
                self.assertEqual(len(transport.calls), 7)
        for count in (0, 2, 21):
            rows = fixtures()
            rows[6]["option_contracts"] *= count
            report, _, _ = self.run_case(rows)
            self.assertNotEqual(report["status"], "PASSED")

    def test_stale_crossed_zero_future_and_missing_indicative_quote(self):
        for key, value in (("t", (NOW - timedelta(seconds=121)).isoformat()),
                           ("t", (NOW + timedelta(seconds=3)).isoformat()),
                           ("bp", 4), ("bs", 0), ("ap", True)):
            rows = fixtures()
            rows[7]["quotes"][OPTION][key] = value
            with self.subTest(key=key, value=value):
                report, transport, _ = self.run_case(rows)
                self.assertNotEqual(report["status"], "PASSED")
                self.assertEqual(len(transport.calls), 8)
        rows = fixtures()
        rows[7]["quotes"] = {}
        report, _, _ = self.run_case(rows)
        self.assertNotEqual(report["status"], "PASSED")

    def test_snapshot_new_trade_cannot_hide_stale_quote(self):
        rows = fixtures()
        body = rows[8]["snapshots"][OPTION]
        body["latestQuote"]["t"] = (NOW - timedelta(minutes=10)).isoformat()
        body["latestTrade"] = {"t": NOW.isoformat(), "p": 1, "s": 1}
        report, _, _ = self.run_case(rows)
        self.assertNotEqual(report["status"], "PASSED")
        self.assertFalse(report["checks"]["indicative_snapshot_valid"])

    def test_snapshot_delayed_trade_is_not_called_fresh_or_executable(self):
        rows = fixtures()
        rows[8]["snapshots"][OPTION]["latestTrade"] = {
            "t": (NOW - timedelta(minutes=16)).isoformat(), "p": 1, "s": 1}
        report, _, _ = self.run_case(rows)
        self.assertEqual(report["status"], "PASSED")
        self.assertFalse(report["limits"]["indicative_is_executable"])
        self.assertFalse(report["limits"]["greeks_publication_time_qualified"])

    def test_snapshot_missing_quote_bad_greek_future_trade(self):
        for replacement in ({"greeks": {"delta": .5}}, {"latestQuote": {}, "greeks": {}},
                            {**fixtures()[8]["snapshots"][OPTION], "greeks": {"delta": PRIVATE}},
                            {**fixtures()[8]["snapshots"][OPTION], "latestTrade": {
                                "t": (NOW + timedelta(seconds=3)).isoformat(), "p": 1, "s": 1}}):
            rows = fixtures()
            rows[8]["snapshots"][OPTION] = replacement
            report, _, _ = self.run_case(rows)
            self.assertNotEqual(report["status"], "PASSED")

    def test_http_and_transport_failures_never_echo(self):
        failures = [HTTPResult(status, PRIVATE.encode(), {"location": PRIVATE}) for status in (301, 401, 403, 429, 500)]
        failures += [RuntimeError(PRIVATE), SystemExit(PRIVATE), TimeoutError(PRIVATE),
                     HTTPResult(200, b'{"x":NaN}'), HTTPResult(200, b'{"x":1,"x":2}'),
                     HTTPResult(200, b"x" * (verifier.MAX_RESPONSE_BYTES + 1))]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                report, transport, _ = self.run_case([failure], noisy=True)
                self.assertEqual(report["status"], "FAILED")
                self.assertEqual(len(transport.calls), 1)

    def test_mid_read_authorization_error_stops_without_retry(self):
        rows = fixtures()
        rows[4] = HTTPResult(403, PRIVATE.encode())
        report, transport, _ = self.run_case(rows)
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["stage"], "IEX_BAR")
        self.assertEqual(report["failure_code"], "AUTHORIZATION_REJECTED")
        self.assertEqual(len(transport.calls), 5)

    def test_slow_transport_exceeds_shared_deadline_without_further_requests(self):
        def slow(clock):
            clock.value += 41
            return fixtures()[0]
        report, transport, _ = self.run_case([slow])
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(report["failure_code"], "DEADLINE")

    def test_failure_codes_are_static_and_distinguish_operational_failures(self):
        for response, expected in ((HTTPResult(401, PRIVATE.encode()), "AUTHORIZATION_REJECTED"),
                                   (HTTPResult(429, PRIVATE.encode()), "HTTP_429"),
                                   (ProviderError("NETWORK_ERROR"), "NETWORK_ERROR"),
                                   (ProviderError("DEADLINE"), "DEADLINE"),
                                   (SystemExit(PRIVATE), "UNCLASSIFIED")):
            report, _, _ = self.run_case([response])
            self.assertEqual(report["failure_code"], expected)

    def test_mutated_provider_error_codes_never_escape(self):
        for code in (PRIVATE, [], {}, True, None):
            error = ProviderError("NETWORK_ERROR")
            error.code = code
            report, _, _ = self.run_case([error])
            self.assertEqual(report["failure_code"], "UNCLASSIFIED")
        class NoisyError(ProviderError):
            def __getattribute__(self, name):
                if name in {"code", "__dict__"}:
                    print(PRIVATE)
                    raise RuntimeError(PRIVATE)
                return super().__getattribute__(name)
        report, _, _ = self.run_case([NoisyError("NETWORK_ERROR")])
        self.assertEqual(report["failure_code"], "UNCLASSIFIED")
        class NoisyDict(dict):
            def get(self, *args):
                print(PRIVATE)
                raise RuntimeError(PRIVATE)
        error = ProviderError("NETWORK_ERROR")
        error.__dict__ = NoisyDict(code="NETWORK_ERROR")
        report, _, _ = self.run_case([error])
        self.assertEqual(report["failure_code"], "NETWORK_ERROR")

    def test_report_schema_rejects_dynamic_strings_counts_and_claims(self):
        report, _, _ = self.run_case()
        for path, value in ((('extra',), PRIVATE), (('status',), PRIVATE), (('stage',), PRIVATE),
                            (('evidence',), PRIVATE), (('failure_code',), PRIVATE), (('failure_code',), "NETWORK_ERROR"),
                            (('counts', 'requests'), True),
                            (('counts', 'requests'), 10), (('checks', 'exact_paper_identity'), PRIVATE),
                            (('limits', 'orders_enabled'), True), (('checks', 'metadata_valid'), False)):
            modified = deepcopy(report)
            target = modified
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.assertFalse(verifier.valid_report(modified))


class SupervisorVerifierTests(unittest.TestCase):
    def test_cli_default_is_static_refusal_without_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            report = verifier.run_bounded(wall_seconds=5)
        self.assertEqual(report["status"], "REFUSED")
        self.assertTrue(verifier.valid_report(report))

    def test_missing_environment_cli_is_static_refusal(self):
        # Real subprocess; no credentials supplied and no network opt-in bypass.
        with patch.dict(os.environ, {}, clear=True):
            report = verifier.run_bounded(enable_api_read=True, require_github_environment=verifier.ENVIRONMENT,
                                          wall_seconds=5)
        self.assertEqual(report["status"], "REFUSED")
        self.assertEqual(report["counts"]["requests"], 0)

    def test_cli_invalid_arg_never_echoes_value_or_traceback(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = verifier.main(["--bad-argument", PRIVATE])
        self.assertEqual(code, 2)
        self.assertNotIn(PRIVATE, out.getvalue() + err.getvalue())
        self.assertEqual(err.getvalue(), "")
        self.assertTrue(verifier.valid_report(json.loads(out.getvalue())))

    def test_supervisor_kills_hung_child(self):
        actual_popen = subprocess.Popen
        children = []

        def slow_child(args, **kwargs):
            child = actual_popen([sys.executable, "-c", "import time; time.sleep(60)"], **kwargs)
            children.append(child)
            return child

        started = time.monotonic()
        with patch.object(verifier.subprocess, "Popen", side_effect=slow_child):
            report = verifier.run_bounded(wall_seconds=.05)
        self.assertEqual(report["status"], "TIMEOUT")
        self.assertIsNotNone(children[0].poll())
        self.assertLess(time.monotonic() - started, 3)
        self.assertTrue(verifier.valid_report(report))

    def test_supervisor_discards_hostile_child_output_and_stderr(self):
        actual_popen = subprocess.Popen
        for program in ("import sys; print(%r); print(%r,file=sys.stderr)" % (PRIVATE, PRIVATE),
                        "print('x' * 20000)", "raise RuntimeError(%r)" % PRIVATE,
                        "import json; print(json.dumps({'broker_authority':'NONE','leak':%r}))" % PRIVATE):
            def hostile_child(args, **kwargs):
                return actual_popen([sys.executable, "-c", program], **kwargs)
            out, err = io.StringIO(), io.StringIO()
            with patch.object(verifier.subprocess, "Popen", side_effect=hostile_child), redirect_stdout(out), redirect_stderr(err):
                report = verifier.run_bounded(wall_seconds=5)
            self.assertEqual(report["status"], "FAILED")
            self.assertNotIn(PRIVATE, json.dumps(report) + out.getvalue() + err.getvalue())

    def test_supervisor_rejects_bad_limits_and_configuration(self):
        for value in (True, 0, -1, float("nan"), float("inf"), 46, "10"):
            self.assertEqual(verifier.run_bounded(wall_seconds=value)["status"], "REFUSED")
        self.assertEqual(verifier.run_bounded(require_github_environment=PRIVATE)["status"], "REFUSED")

    def test_supervisor_rejects_synthetic_child_evidence(self):
        report = verifier._report("FAILED", "ACCOUNT", "SYNTHETIC_FIXTURE")
        actual_popen = subprocess.Popen
        def child(args, **kwargs):
            self.assertEqual(args[1:5], ["-E", "-s", "-S", "-B"])
            self.assertNotIn("PYTHONPATH", kwargs["env"])
            self.assertTrue(kwargs["pass_fds"])
            return actual_popen([sys.executable, "-c", "import sys; print(%r); sys.exit(2)" % json.dumps(report)], **kwargs)
        with patch.object(verifier.subprocess, "Popen", side_effect=child):
            result = verifier.run_bounded(wall_seconds=5)
        self.assertEqual(result["stage"], "SUPERVISOR")
        self.assertEqual(result["evidence"], "NO_API_EVIDENCE")

    def test_worker_handshake_rejects_wrong_parent_and_nonpipes(self):
        self.assertFalse(verifier._worker_handshake(None))
        self.assertFalse(verifier._worker_handshake(1))
        reader, writer = os.pipe()
        try:
            os.write(writer, b"THETA_READONLY_CHILD:0")
        finally:
            os.close(writer)
        self.assertFalse(verifier._worker_handshake(reader))


if __name__ == "__main__":
    unittest.main()
