"""Independent regression tests. Synthetic transport only; never real credentials/API."""
from copy import deepcopy
from datetime import timedelta
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch

from theta_basic_lab import verify_readonly as verifier
from theta_basic_lab.providers import HTTPResult, ProviderError
from test_verify_readonly import ENV, NOW, OPTION, FixtureTransport, FakeTime, fixtures, order


class IndependentReadonlyTests(unittest.TestCase):
    def setUp(self):
        self.network = patch("theta_basic_lab.providers.HTTPSGetTransport.get",
                             side_effect=AssertionError("NETWORK_FORBIDDEN"))
        self.real_get = self.network.start()
        self.addCleanup(self.network.stop)

    def check_rows(self, mutate):
        rows = fixtures()
        mutate(rows)
        clock = FakeTime()
        transport = FixtureTransport(rows, clock)
        with patch.dict(os.environ, ENV, clear=True):
            report = verifier.verify(enable_api_read=True,
                                     require_github_environment=verifier.ENVIRONMENT,
                                     transport=transport, utcnow=lambda: NOW,
                                     monotonic=clock.monotonic, sleep=clock.sleep)
        self.assertTrue(verifier.valid_report(report))
        self.real_get.assert_not_called()
        return report, transport

    def test_invalid_iex_trade_must_not_pass(self):
        for field in ("p", "s"):
            with self.subTest(field=field):
                report, _ = self.check_rows(lambda rows: rows[5]["trades"]["SPY"].update({field: 0}))
                self.assertNotEqual(report["status"], "PASSED")

    def test_zero_iex_ohlc_must_not_pass(self):
        report, _ = self.check_rows(lambda rows: rows[4]["bars"]["SPY"].update(o=0, h=0, l=0, c=0))
        self.assertNotEqual(report["status"], "PASSED")

    def test_fractional_option_contract_size_must_not_pass(self):
        for target in ("quote", "snapshot"):
            with self.subTest(target=target):
                def mutate(rows):
                    body = rows[7]["quotes"][OPTION] if target == "quote" else rows[8]["snapshots"][OPTION]["latestQuote"]
                    body["bs"] = 0.5
                report, _ = self.check_rows(mutate)
                self.assertNotEqual(report["status"], "PASSED")

    def test_open_clock_boundary_order_must_not_pass(self):
        report, transport = self.check_rows(lambda rows: rows[1].update(
            next_open="2026-10-09T15:00:00Z", next_close="2026-10-09T20:00:00Z"))
        self.assertNotEqual(report["status"], "PASSED")
        self.assertEqual(len(transport.calls), 2)

    def test_future_order_submission_must_not_pass(self):
        report, _ = self.check_rows(lambda rows: rows.__setitem__(3, [order(
            submitted_at=(NOW + timedelta(days=1)).isoformat())]))
        self.assertNotEqual(report["status"], "PASSED")

    def test_invalid_negative_order_price_must_not_pass(self):
        report, _ = self.check_rows(lambda rows: rows.__setitem__(3, [order(limit_price="-1")]))
        self.assertNotEqual(report["status"], "PASSED")

    def test_unknown_nested_order_status_must_not_pass(self):
        report, _ = self.check_rows(lambda rows: rows.__setitem__(3, [order(legs=[
            order("independent_child", status="not_a_status")])]))
        self.assertNotEqual(report["status"], "PASSED")

    def test_guard_is_mandatory_for_real_transport(self):
        # HTTPS is mocked, so even the defective implementation cannot contact API.
        with patch.dict(os.environ, ENV, clear=True):
            report = verifier.verify(enable_api_read=True, utcnow=lambda: NOW)
        self.assertEqual(report["status"], "REFUSED")
        self.assertEqual(report["counts"]["requests"], 0)
        self.real_get.assert_not_called()

    def test_supervisor_must_require_guard_before_spawning_real_read(self):
        with patch.dict(os.environ, ENV, clear=True), patch.object(verifier.subprocess, "Popen") as popen:
            report = verifier.run_bounded(enable_api_read=True)
        self.assertEqual(report["status"], "REFUSED")
        popen.assert_not_called()

    def test_hidden_worker_rejects_direct_cli_invocation(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(verifier, "verify", return_value=verifier._report()) as verify, \
             patch.object(verifier, "_worker_limits") as limits, \
             redirect_stdout(out), redirect_stderr(err):
            code = verifier.main(["--_worker", "--enable-api-read",
                                  "--require-github-environment", verifier.ENVIRONMENT])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(out.getvalue())["status"], "REFUSED")
        verify.assert_not_called()

    def test_authenticated_pass_requires_environment_guard(self):
        report, _ = self.check_rows(lambda rows: None)
        self.assertEqual(report["status"], "PASSED")
        report["evidence"] = "AUTHENTICATED_GET_ONLY"
        report["checks"]["environment_guard_passed"] = False
        self.assertFalse(verifier.valid_report(report))

    def test_account_malformed_types_stop_at_first_request(self):
        for field in ("options_trading_level", "options_approved_level"):
            for value in (True, False, 3.0, "3", [], {}, None):
                with self.subTest(field=field, value=repr(value)):
                    report, transport = self.check_rows(lambda rows: rows[0].update({field: value}))
                    self.assertNotEqual(report["status"], "PASSED")
                    self.assertEqual(len(transport.calls), 1)
        for field in ("trading_blocked", "account_blocked"):
            for value in (0, 1, "false", [], {}, None):
                with self.subTest(field=field, value=repr(value)):
                    report, transport = self.check_rows(lambda rows: rows[0].update({field: value}))
                    self.assertNotEqual(report["status"], "PASSED")
                    self.assertEqual(len(transport.calls), 1)

    def test_quotes_boolean_nan_shapes_and_symbol_mismatch_rejected(self):
        for field in ("bp", "ap", "bs", "as"):
            for value in (True, False, "1", None, [], {}):
                with self.subTest(field=field, value=repr(value)):
                    report, transport = self.check_rows(lambda rows: rows[7]["quotes"][OPTION].update({field: value}))
                    self.assertNotEqual(report["status"], "PASSED")
                    self.assertEqual(len(transport.calls), 8)
        for key in ("SPY261023C00500000", "QQQ261016C00500000"):
            def mutate(rows):
                rows[7]["quotes"] = {key: rows[7]["quotes"][OPTION]}
            report, transport = self.check_rows(mutate)
            self.assertNotEqual(report["status"], "PASSED")
            self.assertEqual(len(transport.calls), 8)

    def test_worker_handshake_rejects_missing_regular_empty_and_wrong_pipe(self):
        for fd in (None, True, -1, 0, 1, 2, 999999):
            self.assertFalse(verifier._worker_handshake(fd))
        with tempfile.TemporaryFile() as regular:
            self.assertFalse(verifier._worker_handshake(os.dup(regular.fileno())))
        for marker in (None, b"WRONG", b"THETA_READONLY_CHILD:99999999"):
            reader, writer = os.pipe()
            try:
                if marker is not None:
                    os.write(writer, marker)
                started = time.monotonic()
                self.assertFalse(verifier._worker_handshake(reader))
                self.assertLess(time.monotonic() - started, 0.2)
            finally:
                os.close(writer)

    def test_worker_handshake_accepts_only_exact_parent_marker(self):
        reader, writer = os.pipe()
        try:
            os.write(writer, b"THETA_READONLY_CHILD:" + str(os.getppid()).encode("ascii"))
            self.assertTrue(verifier._worker_handshake(reader))
        finally:
            os.close(writer)

    def test_subprocess_isolates_startup_environment_and_unrelated_secrets(self):
        actual_popen = subprocess.Popen
        launches = []
        def launch(args, **kwargs):
            launches.append((list(args), dict(kwargs)))
            return actual_popen(args, **kwargs)
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "startup_executed"
            (Path(directory) / "sitecustomize.py").write_text(
                "from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('bad')\n")
            env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
                   "THETA_GITHUB_ENVIRONMENT": verifier.ENVIRONMENT,
                   "PYTHONPATH": directory, "PYTHONSTARTUP": str(Path(directory) / "sitecustomize.py"),
                   "UNRELATED_SECRET": "SYNTHETIC_UNRELATED_SENTINEL"}
            # No Alpaca credential variables exist, including in the real child.
            with patch.dict(os.environ, env, clear=True), patch.object(verifier.subprocess, "Popen", side_effect=launch):
                report = verifier.run_bounded(enable_api_read=True,
                    require_github_environment=verifier.ENVIRONMENT, wall_seconds=5)
            self.assertEqual(report["status"], "REFUSED")
            self.assertFalse(marker.exists())
        self.assertEqual(len(launches), 1)
        args, options = launches[0]
        self.assertTrue({"-E", "-s", "-S", "-B"}.issubset(args))
        self.assertFalse({"PYTHONPATH", "PYTHONSTARTUP", "UNRELATED_SECRET"}.intersection(options["env"]))
        self.assertEqual(len(options["pass_fds"]), 1)
        self.assertTrue(options["start_new_session"])
        self.assertEqual(options["stderr"], subprocess.DEVNULL)

    def test_future_one_nanosecond_never_passes(self):
        future = NOW.strftime("%Y-%m-%dT%H:%M:%S") + ".000000001Z"
        cases = {
            "clock": lambda rows: rows[1].update(timestamp=future),
            "iex_trade": lambda rows: rows[5]["trades"]["SPY"].update(t=future),
            "quote": lambda rows: rows[7]["quotes"][OPTION].update(t=future),
            "snapshot_quote": lambda rows: rows[8]["snapshots"][OPTION]["latestQuote"].update(t=future),
            "snapshot_trade": lambda rows: rows[8]["snapshots"][OPTION].update(latestTrade={"t": future, "p": 1, "s": 1}),
            "order_submission": lambda rows: rows.__setitem__(3, [order(submitted_at=future)]),
            "order_update": lambda rows: rows.__setitem__(3, [order(updated_at=future)]),
        }
        for name, mutate in cases.items():
            with self.subTest(component=name):
                report, _ = self.check_rows(mutate)
                self.assertNotEqual(report["status"], "PASSED")

    def test_failure_codes_preserve_only_allowlisted_provider_codes(self):
        for code in ("AUTHORIZATION_REJECTED", "HTTP_429", "NETWORK_ERROR", "DEADLINE"):
            with self.subTest(code=code):
                report, transport = self.check_rows(lambda rows: rows.__setitem__(0, ProviderError(code)))
                self.assertEqual(report["status"], "FAILED")
                self.assertEqual(report["failure_code"], code)
                self.assertEqual(len(transport.calls), 1)
        for status, expected in ((401, "AUTHORIZATION_REJECTED"), (403, "AUTHORIZATION_REJECTED"),
                                 (429, "HTTP_429"), (500, "HTTP_ERROR")):
            report, _ = self.check_rows(lambda rows: rows.__setitem__(0, HTTPResult(
                status, b"SYNTHETIC_PRIVATE_ERROR_BODY", {"location": "SYNTHETIC_PRIVATE_HEADER"})))
            self.assertEqual(report["failure_code"], expected)
            self.assertNotIn("SYNTHETIC_PRIVATE", json.dumps(report))

    def test_failure_codes_reject_mutated_subclass_and_unknown_exceptions(self):
        sentinel = "SYNTHETIC_PRIVATE_EXCEPTION_SENTINEL"
        class StringSubclass(str):
            def __hash__(self):
                raise AssertionError("Must not hash a string subclass")
        class ErrorSubclass(ProviderError):
            def __getattribute__(self, key):
                if key == "code":
                    raise AssertionError("Must not inspect code on exception subclass")
                return super().__getattribute__(key)
        errors = [SystemExit(sentinel), KeyboardInterrupt(sentinel), ErrorSubclass("NETWORK_ERROR")]
        for value in (sentinel, [], {}, True, None, StringSubclass("NETWORK_ERROR")):
            error = ProviderError("NETWORK_ERROR")
            error.code = value
            errors.append(error)
        for error in errors:
            with self.subTest(error=type(error).__name__):
                out, err = io.StringIO(), io.StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    report, _ = self.check_rows(lambda rows: rows.__setitem__(0, error))
                self.assertEqual(report["status"], "FAILED")
                self.assertEqual(report["failure_code"], "UNCLASSIFIED")
                self.assertEqual(out.getvalue() + err.getvalue(), "")
                self.assertNotIn(sentinel, json.dumps(report))
        with patch.object(verifier, "_funds_valid", side_effect=RuntimeError(sentinel)):
            report, _ = self.check_rows(lambda rows: None)
        self.assertEqual(report["failure_code"], "UNCLASSIFIED")
        self.assertNotIn(sentinel, json.dumps(report))

    def test_failure_code_closed_schema_and_pass_consistency(self):
        report, _ = self.check_rows(lambda rows: None)
        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(report["failure_code"], "NONE")
        for value in ("SYNTHETIC_PRIVATE_UNRECOGNIZED", [], {}, True, None, "DEADLINE"):
            changed = deepcopy(report)
            changed["failure_code"] = value
            with self.subTest(value=repr(value)):
                self.assertFalse(verifier.valid_report(changed))
        missing = deepcopy(report)
        del missing["failure_code"]
        self.assertFalse(verifier.valid_report(missing))

    def test_valid_report_rejects_unhashable_enums_without_throwing(self):
        for field in ("status", "stage", "evidence"):
            for invalid in ([], {}, ["PASSED"]):
                report = verifier._report()
                report[field] = invalid
                with self.subTest(field=field, invalid=type(invalid).__name__):
                    self.assertFalse(verifier.valid_report(report))


if __name__ == "__main__":
    unittest.main()
