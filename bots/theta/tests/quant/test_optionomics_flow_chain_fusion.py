"""Tests for bots/theta/quant/research/optionomics_flow_chain_fusion.py.
All flow events and chain snapshots are synthetic fixtures."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.optionomics_flow_chain_fusion import (  # noqa: E402
    ChainSnapshotContract,
    ClassificationConsistency,
    CompositeQuoteState,
    ContractMatchMethod,
    build_composite_quote,
    check_classification_bbo_consistency,
    match_contract_identity,
)
from research.optionomics_flow_event import (  # noqa: E402
    ExecutionClassification,
    FlowEventContractIdentity,
    FlowEventEvidenceClass,
    ParsedFlowEvent,
)


def _event(
    occ=None, underlying=None, expiration=None, option_type=None, strike=None,
    trade_timestamp_utc="2026-09-14T14:30:00Z", trade_price=2.35,
    execution_classification=ExecutionClassification.AT_ASK,
):
    return ParsedFlowEvent(
        evidence_class=FlowEventEvidenceClass.PARSED,
        contract=FlowEventContractIdentity(occ, underlying, expiration, option_type, strike),
        trade_timestamp_utc=trade_timestamp_utc, trade_price=trade_price, trade_size=10,
        execution_classification=execution_classification, reported_bid=None, reported_ask=None,
        sweep=None, block=None, multi_leg=None, event_id="evt-1", blocker=None,
    )


def _chain(occ=None, underlying=None, expiration=None, option_type=None, strike=None, bid=2.30, ask=2.35, ts="2026-09-14T14:30:00.500Z"):
    return ChainSnapshotContract(occ, underlying, expiration, option_type, strike, bid, ask, ts)


class MatchContractIdentityTests(unittest.TestCase):
    def test_exact_occ_symbol_match(self):
        event = FlowEventContractIdentity("AAPL251017C00150000", None, None, None, None)
        chain = [_chain(occ="AAPL251017C00150000")]
        method, matched = match_contract_identity(event, chain)
        self.assertEqual(method, ContractMatchMethod.EXACT_OCC_SYMBOL)
        self.assertIsNotNone(matched)

    def test_exact_underlying_expiration_type_strike_match_without_occ(self):
        event = FlowEventContractIdentity(None, "MSFT", "2025-11-21", "PUT", 300.0)
        chain = [_chain(underlying="MSFT", expiration="2025-11-21", option_type="PUT", strike=300.0)]
        method, matched = match_contract_identity(event, chain)
        self.assertEqual(method, ContractMatchMethod.EXACT_UNDERLYING_EXPIRATION_TYPE_STRIKE)
        self.assertIsNotNone(matched)

    def test_no_match_is_unmatched_never_fuzzy(self):
        event = FlowEventContractIdentity(None, "MSFT", "2025-11-21", "PUT", 300.0)
        chain = [_chain(underlying="MSFT", expiration="2025-11-21", option_type="PUT", strike=305.0)]  # different strike
        method, matched = match_contract_identity(event, chain)
        self.assertEqual(method, ContractMatchMethod.UNMATCHED)
        self.assertIsNone(matched)

    def test_empty_chain_is_unmatched(self):
        event = FlowEventContractIdentity("X", None, None, None, None)
        method, matched = match_contract_identity(event, [])
        self.assertEqual(method, ContractMatchMethod.UNMATCHED)


class ClassificationConsistencyTests(unittest.TestCase):
    def test_at_ask_consistent_within_tolerance(self):
        result = check_classification_bbo_consistency(ExecutionClassification.AT_ASK, 2.35, 2.30, 2.35, 0.01)
        self.assertEqual(result, ClassificationConsistency.CONSISTENT)

    def test_at_bid_inconsistent_when_trade_price_is_at_ask(self):
        result = check_classification_bbo_consistency(ExecutionClassification.AT_BID, 2.35, 2.30, 2.35, 0.01)
        self.assertEqual(result, ClassificationConsistency.INCONSISTENT)

    def test_mid_consistent_inside_spread(self):
        result = check_classification_bbo_consistency(ExecutionClassification.MID, 2.325, 2.30, 2.35, 0.01)
        self.assertEqual(result, ClassificationConsistency.CONSISTENT)

    def test_above_ask_requires_price_above_ask_plus_tolerance(self):
        self.assertEqual(check_classification_bbo_consistency(ExecutionClassification.ABOVE_ASK, 2.40, 2.30, 2.35, 0.01), ClassificationConsistency.CONSISTENT)
        self.assertEqual(check_classification_bbo_consistency(ExecutionClassification.ABOVE_ASK, 2.35, 2.30, 2.35, 0.01), ClassificationConsistency.INCONSISTENT)

    def test_unknown_classification_is_not_applicable(self):
        result = check_classification_bbo_consistency(ExecutionClassification.UNKNOWN, 2.35, 2.30, 2.35, 0.01)
        self.assertEqual(result, ClassificationConsistency.NOT_APPLICABLE)

    def test_missing_bbo_is_not_applicable(self):
        result = check_classification_bbo_consistency(ExecutionClassification.AT_ASK, 2.35, None, None, 0.01)
        self.assertEqual(result, ClassificationConsistency.NOT_APPLICABLE)

    def test_crossed_bbo_is_unknown_not_guessed(self):
        result = check_classification_bbo_consistency(ExecutionClassification.AT_ASK, 2.35, 2.40, 2.30, 0.01)
        self.assertEqual(result, ClassificationConsistency.UNKNOWN)


class BuildCompositeQuoteTests(unittest.TestCase):
    def test_happy_path_produces_composite_candidate(self):
        event = _event(occ="AAPL251017C00150000")
        chain = [_chain(occ="AAPL251017C00150000")]
        result = build_composite_quote(event, chain, max_event_to_chain_latency_seconds=2.0, classification_tolerance=0.01)
        self.assertEqual(result.state, CompositeQuoteState.COMPOSITE_CANDIDATE)
        self.assertEqual(result.match_method, ContractMatchMethod.EXACT_OCC_SYMBOL)
        self.assertAlmostEqual(result.event_to_chain_latency_seconds, 0.5, places=3)
        self.assertEqual(result.classification_consistency, ClassificationConsistency.CONSISTENT)

    def test_incomplete_event_rejected_before_matching(self):
        event = _event(occ="X", trade_price=None)
        result = build_composite_quote(event, [_chain(occ="X")], 2.0, 0.01)
        self.assertEqual(result.state, CompositeQuoteState.REJECTED_INCOMPLETE_EVENT)

    def test_unmatched_contract_rejected(self):
        event = _event(occ="NOT-IN-CHAIN")
        result = build_composite_quote(event, [_chain(occ="OTHER")], 2.0, 0.01)
        self.assertEqual(result.state, CompositeQuoteState.REJECTED_CONTRACT_UNMATCHED)

    def test_latency_exceeded_rejected(self):
        event = _event(occ="X", trade_timestamp_utc="2026-09-14T14:30:00Z")
        chain = [_chain(occ="X", ts="2026-09-14T14:30:05Z")]  # 5s later
        result = build_composite_quote(event, chain, max_event_to_chain_latency_seconds=2.0, classification_tolerance=0.01)
        self.assertEqual(result.state, CompositeQuoteState.REJECTED_LATENCY_EXCEEDED)
        self.assertAlmostEqual(result.event_to_chain_latency_seconds, 5.0, places=3)

    def test_classification_inconsistency_rejected(self):
        event = _event(occ="X", trade_price=2.30, execution_classification=ExecutionClassification.AT_ASK)
        chain = [_chain(occ="X", bid=2.10, ask=2.15)]  # trade price nowhere near ask
        result = build_composite_quote(event, chain, max_event_to_chain_latency_seconds=2.0, classification_tolerance=0.01)
        self.assertEqual(result.state, CompositeQuoteState.REJECTED_CLASSIFICATION_INCONSISTENT)

    def test_unknown_classification_never_blocks_composite_candidate(self):
        event = _event(occ="X", execution_classification=ExecutionClassification.UNKNOWN)
        result = build_composite_quote(event, [_chain(occ="X")], 2.0, 0.01)
        self.assertEqual(result.state, CompositeQuoteState.COMPOSITE_CANDIDATE)

    def test_source_semantics_gap_note_always_present(self):
        event = _event(occ="X")
        result = build_composite_quote(event, [_chain(occ="X")], 2.0, 0.01)
        self.assertIn("sourceSemantics", result.source_semantics_gap_note)


if __name__ == "__main__":
    unittest.main()
