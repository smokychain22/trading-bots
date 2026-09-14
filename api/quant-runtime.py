"""Private Vercel Python boundary for THETA's deterministic quant contracts.

The Node control plane calls this function because Vercel's Node runtime does
not provide a Python child-process executable. Only fixed, reviewed model
families can be invoked. The endpoint performs no provider or broker I/O and
cannot submit orders.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler
import hmac
import importlib
import json
import os
from typing import Any


MODEL_MODULES = {
    "ownership": "bots.theta.quant.runtime.ownership_contract",
    "regime": "bots.theta.quant.runtime.regime_contract",
    "strategyRouter": "bots.theta.quant.runtime.strategy_router_contract",
    "thetaQ": "bots.theta.quant.runtime.theta_q_contract",
    "paretoFrontier": "bots.theta.quant.runtime.pareto_frontier_contract",
    "opportunityFrontier": "bots.theta.quant.runtime.opportunity_frontier_contract",
    "aegis": "bots.theta.quant.runtime.aegis_contract",
    "sizing": "bots.theta.quant.runtime.sizing_contract",
    "executionQuality": "bots.theta.quant.runtime.execution_quality_contract",
    "management": "bots.theta.quant.runtime.management_contract",
    "assignment": "bots.theta.quant.runtime.assignment_contract",
    "recovery": "bots.theta.quant.runtime.recovery_contract",
    "coveredCall": "bots.theta.quant.runtime.covered_call_contract",
}

MAX_BODY_BYTES = 2_000_000


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        expected = os.environ.get("CRON_SECRET", "")
        supplied = self.headers.get("Authorization", "")
        if len(expected) < 32 or not hmac.compare_digest(supplied, f"Bearer {expected}"):
            self._send(401, {"error": {"code": "UNAUTHORIZED"}})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, {"error": {"code": "INVALID_CONTENT_LENGTH"}})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(413, {"error": {"code": "REQUEST_SIZE_INVALID"}})
            return
        try:
            body = json.loads(self.rfile.read(length))
            family = body.get("modelFamily") if isinstance(body, dict) else None
            if family not in MODEL_MODULES:
                self._send(404, {"error": {"code": "UNKNOWN_MODEL_FAMILY"}})
                return
            module = importlib.import_module(MODEL_MODULES[family])
            result = module.evaluate_request(body.get("payload"))
            self._send(200, result)
        except (KeyError, TypeError, ValueError, RuntimeError, json.JSONDecodeError):
            self._send(422, {"error": {"code": "MODEL_REQUEST_INVALID"}})
        except Exception:
            self._send(503, {"error": {"code": "MODEL_RUNTIME_UNAVAILABLE"}})

    def do_GET(self) -> None:
        self._send(405, {"error": {"code": "METHOD_NOT_ALLOWED"}})

    def log_message(self, _format: str, *_args: Any) -> None:
        # Request headers and payloads can contain private runtime evidence.
        return

    def _send(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
