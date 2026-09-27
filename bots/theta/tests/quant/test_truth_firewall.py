import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.truth_firewall import assert_truth_class_transition_allowed


def evidence(**overrides):
    base = {'promotedBy': 'owner', 'promotedAt': '2026-01-01T00:00:00Z',
            'evidenceReference': 'promotion-doc-1', 'promotionDecisionId': 'decision-1'}
    base.update(overrides)
    return base


class TruthFirewallTests(unittest.TestCase):
    def test_allowed_transition_passes_without_evidence(self):
        self.assertTrue(assert_truth_class_transition_allowed('MARKET_OBSERVED', 'DERIVED_FROM_OBSERVED'))

    def test_modeled_research_to_broker_actual_blocked_without_evidence(self):
        with self.assertRaisesRegex(ValueError, 'SILENT_PROMOTION_BLOCKED'):
            assert_truth_class_transition_allowed('MODELED_RESEARCH', 'BROKER_ACTUAL')

    def test_modeled_research_to_broker_actual_allowed_with_complete_evidence(self):
        self.assertTrue(assert_truth_class_transition_allowed('MODELED_RESEARCH', 'BROKER_ACTUAL', evidence()))

    def test_incomplete_evidence_rejected(self):
        incomplete = evidence()
        del incomplete['promotionDecisionId']
        with self.assertRaisesRegex(ValueError, 'EVIDENCE_INCOMPLETE:promotionDecisionId'):
            assert_truth_class_transition_allowed('MODELED_RESEARCH', 'BROKER_ACTUAL', incomplete)

    def test_all_four_forbidden_transitions_blocked_without_evidence(self):
        for from_class, to_class in (
            ('MODELED_RESEARCH', 'BROKER_ACTUAL'), ('SYNTHETIC_FIXTURE', 'REAL_HISTORICAL'),
            ('RECONSTRUCTED', 'BROKER_ACTUAL'), ('RESEARCH_BASELINE', 'PRODUCTION_CANONICAL'),
        ):
            with self.assertRaises(ValueError):
                assert_truth_class_transition_allowed(from_class, to_class)

    def test_research_baseline_to_production_canonical_allowed_with_evidence(self):
        self.assertTrue(assert_truth_class_transition_allowed('RESEARCH_BASELINE', 'PRODUCTION_CANONICAL', evidence()))


if __name__ == '__main__':
    unittest.main()
