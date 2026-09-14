"""Tests for bots/theta/quant/research/optionomics_webhook_validation.py.
Pure validation-logic tests only -- no network, no listener, no server."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.optionomics_webhook_validation import (  # noqa: E402
    ReplayGuard,
    WebhookValidationState,
    redact_secrets,
    sanitized_payload_hash,
    validate_schema,
    validate_webhook_delivery,
)

_REQUIRED = frozenset({"id", "ts", "payload"})


class SchemaValidationTests(unittest.TestCase):
    def test_non_dict_body_is_invalid(self):
        self.assertEqual(validate_schema("not-a-dict", _REQUIRED), "PAYLOAD_NOT_A_JSON_OBJECT")

    def test_missing_keys_named_exactly(self):
        reason = validate_schema({"id": "1"}, _REQUIRED)
        self.assertIn("ts", reason)
        self.assertIn("payload", reason)

    def test_complete_body_is_valid(self):
        self.assertIsNone(validate_schema({"id": "1", "ts": "t", "payload": {}}, _REQUIRED))


class RedactSecretsTests(unittest.TestCase):
    def test_redacts_key_like_field_names_case_insensitively(self):
        body = {"OPTIONOMICS_API_KEY": "abc123", "Authorization": "Bearer xyz", "safe_field": "ok"}
        redacted = redact_secrets(body)
        self.assertEqual(redacted["OPTIONOMICS_API_KEY"], "REDACTED")
        self.assertEqual(redacted["Authorization"], "REDACTED")
        self.assertEqual(redacted["safe_field"], "ok")

    def test_redacts_nested_dict_secrets(self):
        body = {"meta": {"signature": "deadbeef", "size": 10}}
        redacted = redact_secrets(body)
        self.assertEqual(redacted["meta"]["signature"], "REDACTED")
        self.assertEqual(redacted["meta"]["size"], 10)

    def test_hash_is_deterministic_and_secret_free(self):
        body = {"secret_token": "s3cr3t", "price": 2.35}
        digest1 = sanitized_payload_hash(body)
        digest2 = sanitized_payload_hash(body)
        self.assertEqual(digest1, digest2)
        self.assertEqual(len(digest1), 64)


class ReplayGuardTests(unittest.TestCase):
    def test_first_event_is_not_duplicate(self):
        guard = ReplayGuard()
        self.assertFalse(guard.is_duplicate("evt-1"))

    def test_recorded_event_is_duplicate(self):
        guard = ReplayGuard()
        guard.record("evt-1")
        self.assertTrue(guard.is_duplicate("evt-1"))

    def test_staleness_requires_strictly_newer_timestamp(self):
        guard = ReplayGuard()
        guard.record_timestamp("AAPL-C-150-2025-10-17", "2026-09-14T14:00:00Z")
        self.assertTrue(guard.is_stale("AAPL-C-150-2025-10-17", "2026-09-14T13:59:59Z"))
        self.assertTrue(guard.is_stale("AAPL-C-150-2025-10-17", "2026-09-14T14:00:00Z"))  # equal -> stale
        self.assertFalse(guard.is_stale("AAPL-C-150-2025-10-17", "2026-09-14T14:00:01Z"))

    def test_unseen_contract_is_never_stale(self):
        guard = ReplayGuard()
        self.assertFalse(guard.is_stale("NEW-CONTRACT", "2026-09-14T14:00:00Z"))


class ValidateWebhookDeliveryTests(unittest.TestCase):
    def test_invalid_schema_rejected_before_event_id_check(self):
        guard = ReplayGuard()
        result = validate_webhook_delivery({"id": "1"}, _REQUIRED, "id", None, None, guard, "2026-09-14T00:00:00Z")
        self.assertEqual(result.state, WebhookValidationState.REJECTED_INVALID_SCHEMA)

    def test_missing_event_id_key_rejected(self):
        guard = ReplayGuard()
        body = {"id": None, "ts": "t", "payload": {}}
        result = validate_webhook_delivery(body, _REQUIRED, "id", None, None, guard, "2026-09-14T00:00:00Z")
        self.assertEqual(result.state, WebhookValidationState.REJECTED_MISSING_EVENT_ID)

    def test_first_delivery_accepted(self):
        guard = ReplayGuard()
        body = {"id": "evt-1", "ts": "t", "payload": {}}
        result = validate_webhook_delivery(body, _REQUIRED, "id", None, None, guard, "2026-09-14T00:00:00Z")
        self.assertEqual(result.state, WebhookValidationState.ACCEPTED)
        self.assertEqual(result.event_id, "evt-1")

    def test_replayed_event_id_rejected(self):
        guard = ReplayGuard()
        body = {"id": "evt-1", "ts": "t", "payload": {}}
        validate_webhook_delivery(body, _REQUIRED, "id", None, None, guard, "2026-09-14T00:00:00Z")
        result = validate_webhook_delivery(body, _REQUIRED, "id", None, None, guard, "2026-09-14T00:00:01Z")
        self.assertEqual(result.state, WebhookValidationState.REJECTED_DUPLICATE_EVENT_ID)

    def test_stale_timestamp_for_same_contract_rejected(self):
        guard = ReplayGuard()

        def contract_key_fn(body):
            return body["contract"]

        first = {"id": "evt-1", "ts": "t", "payload": {}, "contract": "AAPL-C-150", "trade_ts": "2026-09-14T14:00:00Z"}
        second = {"id": "evt-2", "ts": "t", "payload": {}, "contract": "AAPL-C-150", "trade_ts": "2026-09-14T13:59:00Z"}
        validate_webhook_delivery(first, _REQUIRED, "id", contract_key_fn, "trade_ts", guard, "r1")
        result = validate_webhook_delivery(second, _REQUIRED, "id", contract_key_fn, "trade_ts", guard, "r2")
        self.assertEqual(result.state, WebhookValidationState.REJECTED_STALE_OR_OUT_OF_ORDER)

    def test_sanitized_hash_present_on_rejection_paths_that_reach_hashing(self):
        guard = ReplayGuard()
        body = {"id": "evt-1", "ts": "t", "payload": {}}
        validate_webhook_delivery(body, _REQUIRED, "id", None, None, guard, "r1")
        result = validate_webhook_delivery(body, _REQUIRED, "id", None, None, guard, "r2")
        self.assertIsNotNone(result.sanitized_payload_hash)


if __name__ == "__main__":
    unittest.main()
