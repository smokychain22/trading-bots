"""Tests for bots/theta/quant/research/optionomics_flow_event.py. All
payloads are synthetic research fixtures -- no real Optionomics flow
payload has been observed."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.optionomics_flow_event import (  # noqa: E402
    ExecutionClassification,
    FlowEventEvidenceClass,
    FlowEventFieldMap,
    classify_execution_label,
    parse_flow_event,
)

_FULL_MAP = FlowEventFieldMap(
    underlying_key="ticker", expiration_key="exp", option_type_key="type", strike_key="strike",
    occ_symbol_key="occ", trade_timestamp_key="ts", trade_price_key="price", trade_size_key="size",
    execution_classification_key="side", reported_bid_key="bid", reported_ask_key="ask",
    sweep_key="is_sweep", block_key="is_block", multi_leg_key="is_multi_leg", event_id_key="id",
)


class ExecutionClassificationTests(unittest.TestCase):
    def test_recognized_labels_map_correctly(self):
        self.assertEqual(classify_execution_label("AT_ASK"), ExecutionClassification.AT_ASK)
        self.assertEqual(classify_execution_label("at_bid"), ExecutionClassification.AT_BID)
        self.assertEqual(classify_execution_label(" Mid "), ExecutionClassification.MID)

    def test_unknown_label_never_coerced_to_mid_or_pass(self):
        self.assertEqual(classify_execution_label("SWEEP_ABOVE"), ExecutionClassification.UNKNOWN)
        self.assertEqual(classify_execution_label("PASS"), ExecutionClassification.UNKNOWN)
        self.assertEqual(classify_execution_label(None), ExecutionClassification.UNKNOWN)
        self.assertEqual(classify_execution_label(123), ExecutionClassification.UNKNOWN)
        self.assertEqual(classify_execution_label(""), ExecutionClassification.UNKNOWN)


class ParseFlowEventTests(unittest.TestCase):
    def test_no_field_map_yields_unmapped_schema(self):
        result = parse_flow_event({"ticker": "AAPL"}, FlowEventFieldMap())
        self.assertEqual(result.evidence_class, FlowEventEvidenceClass.UNMAPPED_SCHEMA)
        self.assertIsNone(result.trade_price)
        self.assertIn("NO_FLOW_EVENT_FIELD_MAP_SUPPLIED", result.blocker)

    def test_non_dict_payload_is_unmapped_schema(self):
        result = parse_flow_event("not-a-dict", _FULL_MAP)  # type: ignore[arg-type]
        self.assertEqual(result.evidence_class, FlowEventEvidenceClass.UNMAPPED_SCHEMA)
        self.assertEqual(result.blocker, "RAW_PAYLOAD_NOT_A_MAPPING")

    def test_full_payload_parses_with_occ_symbol_identity(self):
        payload = {
            "occ": "AAPL251017C00150000", "ticker": "AAPL", "exp": "2025-10-17", "type": "CALL",
            "strike": 150.0, "ts": "2026-09-14T14:30:00Z", "price": 2.35, "size": 10,
            "side": "AT_ASK", "bid": 2.30, "ask": 2.35, "is_sweep": True, "is_block": False,
            "is_multi_leg": False, "id": "evt-1",
        }
        result = parse_flow_event(payload, _FULL_MAP)
        self.assertEqual(result.evidence_class, FlowEventEvidenceClass.PARSED)
        self.assertEqual(result.contract.occ_symbol, "AAPL251017C00150000")
        self.assertEqual(result.execution_classification, ExecutionClassification.AT_ASK)
        self.assertEqual(result.trade_price, 2.35)
        self.assertTrue(result.sweep)
        self.assertIsNone(result.blocker)

    def test_identity_resolves_from_underlying_expiration_type_strike_without_occ(self):
        payload = {"ticker": "MSFT", "exp": "2025-11-21", "type": "PUT", "strike": 300.0, "ts": "2026-09-14T15:00:00Z", "price": 4.1, "id": "evt-2"}
        result = parse_flow_event(payload, _FULL_MAP)
        self.assertEqual(result.evidence_class, FlowEventEvidenceClass.PARSED)
        self.assertIsNone(result.contract.occ_symbol)
        self.assertEqual(result.contract.underlying, "MSFT")

    def test_missing_trade_price_is_partial_fields(self):
        payload = {"occ": "AAPL251017C00150000", "ts": "2026-09-14T14:30:00Z", "id": "evt-3"}
        result = parse_flow_event(payload, _FULL_MAP)
        self.assertEqual(result.evidence_class, FlowEventEvidenceClass.PARTIAL_FIELDS)
        self.assertIn("TRADE_PRICE", result.blocker)

    def test_missing_identity_is_partial_fields(self):
        payload = {"ts": "2026-09-14T14:30:00Z", "price": 2.0, "id": "evt-4"}
        result = parse_flow_event(payload, _FULL_MAP)
        self.assertEqual(result.evidence_class, FlowEventEvidenceClass.PARTIAL_FIELDS)
        self.assertIn("CONTRACT_IDENTITY", result.blocker)

    def test_unrecognized_option_type_label_is_not_guessed(self):
        payload = {"ticker": "AAPL", "exp": "2025-10-17", "type": "STRADDLE", "strike": 150.0, "ts": "t", "price": 1.0, "id": "evt-5"}
        result = parse_flow_event(payload, _FULL_MAP)
        self.assertIsNone(result.contract.option_type)
        # No occ symbol and option_type unresolved -> identity incomplete -> PARTIAL_FIELDS
        self.assertEqual(result.evidence_class, FlowEventEvidenceClass.PARTIAL_FIELDS)

    def test_unknown_execution_classification_label_preserved_as_unknown(self):
        payload = {"occ": "X", "ts": "t", "price": 1.0, "side": "SOMETHING_NEW", "id": "evt-6"}
        result = parse_flow_event(payload, _FULL_MAP)
        self.assertEqual(result.execution_classification, ExecutionClassification.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
