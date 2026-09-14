"""Pure validation logic for a hypothetical Optionomics webhook delivery
-- schema validation, secret redaction, duplicate/replay rejection, and
receipt timestamping ONLY.

This module deliberately implements NO network listener, NO HTTP server,
and NO route handler of any kind. It is research/validation logic a
future Codex-owned Production webhook receiver COULD call, not a
running service. Building an actual listener is Codex/production-owner
territory (network ingress, secrets, deployment) and out of scope for
this branch under the standing "Claude never touches Production
runtime" rule.

Optionomics' own developer documentation (`optionomics.ai/docs/api`,
fetched 2026-09-14) states there is currently no webhook functionality
for Option Alerts or Options Flow, even though the marketing page
(`optionomics.ai/features/api`) advertises "Webhooks with receipts:
Post to your own endpoint and read back every delivery" as a supported
transport for other alert channels. No delivery-envelope shape (headers,
signature scheme, retry/replay semantics) has been observed. Every
function below therefore operates on a caller-supplied, already-decoded
JSON body plus explicit configuration -- it invents no header names,
no signature algorithm, and no delivery-envelope shape.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, FrozenSet, Optional


class WebhookValidationState(str, Enum):
    ACCEPTED = "ACCEPTED"
    REJECTED_INVALID_SCHEMA = "REJECTED_INVALID_SCHEMA"
    REJECTED_DUPLICATE_EVENT_ID = "REJECTED_DUPLICATE_EVENT_ID"
    REJECTED_STALE_OR_OUT_OF_ORDER = "REJECTED_STALE_OR_OUT_OF_ORDER"
    REJECTED_MISSING_EVENT_ID = "REJECTED_MISSING_EVENT_ID"


@dataclass(frozen=True)
class WebhookValidationResult:
    state: WebhookValidationState
    event_id: Optional[str]
    reason: Optional[str]
    sanitized_payload_hash: Optional[str]  # SHA-256 of the redacted payload -- never the raw secret-bearing body
    received_at_utc: str  # caller-supplied local receipt clock, never provider-claimed


def validate_schema(raw_body: Any, required_keys: FrozenSet[str]) -> Optional[str]:
    """Returns None when `raw_body` is a JSON object containing every key
    in `required_keys`; otherwise a specific reason string. `required_
    keys` must be supplied by the caller -- this module has no built-in
    notion of what a real Optionomics webhook body must contain, since no
    real schema has been observed."""
    if not isinstance(raw_body, dict):
        return "PAYLOAD_NOT_A_JSON_OBJECT"
    missing = sorted(required_keys - raw_body.keys())
    if missing:
        return f"MISSING_REQUIRED_KEYS:{','.join(missing)}"
    return None


#: Key-name fragments this module refuses to include in a sanitized
#: hash input or evidence export -- a conservative, explicit denylist
#: rather than an attempt to enumerate every possible secret field name.
_SECRET_KEY_FRAGMENTS = ("key", "secret", "token", "password", "authorization", "signature", "credential")


def redact_secrets(raw_body: Dict[str, Any]) -> Dict[str, Any]:
    """Returns a shallow copy of `raw_body` with any key whose name
    contains a denylisted fragment (case-insensitive) replaced by the
    literal string 'REDACTED'. Nested dict values are redacted
    recursively; nested lists are left as-is (list-of-scalars payloads
    are not expected to carry secrets, and this module does not invent
    a shape for list-of-object entries beyond what's already denylisted
    at this level)."""
    redacted: Dict[str, Any] = {}
    for key, value in raw_body.items():
        if any(fragment in key.lower() for fragment in _SECRET_KEY_FRAGMENTS):
            redacted[key] = "REDACTED"
        elif isinstance(value, dict):
            redacted[key] = redact_secrets(value)
        else:
            redacted[key] = value
    return redacted


def sanitized_payload_hash(raw_body: Dict[str, Any]) -> str:
    """SHA-256 hex digest of the redacted payload's canonical (sorted-key)
    JSON-like string form. Used as tamper-evident, secret-free evidence
    of what was received -- never the raw body itself."""
    import json

    redacted = redact_secrets(raw_body)
    canonical = json.dumps(redacted, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class ReplayGuard:
    """In-memory duplicate/replay tracker for research/testing only --
    NOT a durable store. A real receiver would need a persistent,
    Codex-owned store; this class exists so tests can exercise the
    rejection logic deterministically without one."""

    _seen_event_ids: set = field(default_factory=set)
    _last_timestamp_by_contract: Dict[str, str] = field(default_factory=dict)

    def is_duplicate(self, event_id: str) -> bool:
        return event_id in self._seen_event_ids

    def record(self, event_id: str) -> None:
        self._seen_event_ids.add(event_id)

    def is_stale(self, contract_key: str, candidate_timestamp: str) -> bool:
        """True when `candidate_timestamp` is not strictly newer than the
        last timestamp recorded for this exact contract key (lexical ISO-
        8601 comparison only -- callers must supply comparable, zero-padded
        UTC timestamps; this function does not parse or normalize them)."""
        last = self._last_timestamp_by_contract.get(contract_key)
        return last is not None and candidate_timestamp <= last

    def record_timestamp(self, contract_key: str, timestamp: str) -> None:
        self._last_timestamp_by_contract[contract_key] = timestamp


def validate_webhook_delivery(
    raw_body: Any,
    required_keys: FrozenSet[str],
    event_id_key: str,
    contract_key_fn: Optional[Any],
    timestamp_key: Optional[str],
    replay_guard: ReplayGuard,
    received_at_utc: str,
) -> WebhookValidationResult:
    """Composes schema validation, duplicate rejection, and staleness
    rejection into one deterministic result. `contract_key_fn`, if
    supplied, is a caller-provided `Dict[str, Any] -> str` used to derive
    a per-contract staleness key (e.g. from a real flow event's parsed
    identity) -- this module does not know how to derive that key on its
    own, since it has no confirmed payload shape to derive it from."""
    schema_reason = validate_schema(raw_body, required_keys)
    if schema_reason is not None:
        return WebhookValidationResult(WebhookValidationState.REJECTED_INVALID_SCHEMA, None, schema_reason, None, received_at_utc)

    event_id = raw_body.get(event_id_key)
    if not isinstance(event_id, str) or not event_id:
        return WebhookValidationResult(
            WebhookValidationState.REJECTED_MISSING_EVENT_ID, None,
            f"EVENT_ID_KEY_ABSENT_OR_NOT_A_STRING:{event_id_key}", sanitized_payload_hash(raw_body), received_at_utc,
        )

    if replay_guard.is_duplicate(event_id):
        return WebhookValidationResult(
            WebhookValidationState.REJECTED_DUPLICATE_EVENT_ID, event_id,
            "EVENT_ID_ALREADY_SEEN", sanitized_payload_hash(raw_body), received_at_utc,
        )

    if contract_key_fn is not None and timestamp_key is not None:
        timestamp = raw_body.get(timestamp_key)
        if isinstance(timestamp, str):
            contract_key = contract_key_fn(raw_body)
            if isinstance(contract_key, str) and replay_guard.is_stale(contract_key, timestamp):
                return WebhookValidationResult(
                    WebhookValidationState.REJECTED_STALE_OR_OUT_OF_ORDER, event_id,
                    "TIMESTAMP_NOT_NEWER_THAN_LAST_SEEN_FOR_THIS_CONTRACT", sanitized_payload_hash(raw_body), received_at_utc,
                )
            if isinstance(contract_key, str):
                replay_guard.record_timestamp(contract_key, timestamp)

    replay_guard.record(event_id)
    return WebhookValidationResult(WebhookValidationState.ACCEPTED, event_id, None, sanitized_payload_hash(raw_body), received_at_utc)
