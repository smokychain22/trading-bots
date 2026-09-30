import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.wait_outcome import T0WaitDecision, build_matured_wait_outcome
from research.wait_analysis import WaitRegretClassification, classify_wait_regret


def decision(best_rejected_utility=0.02):
    return T0WaitDecision(
        underlying_symbol='AAPL', decision_timestamp='2026-01-01T14:30:00Z', wait_reason_code='NO_ELIGIBLE_CANDIDATE',
        best_rejected_candidate_id='c1', best_rejected_candidate_utility=best_rejected_utility,
    )


def alternative(value):
    return {'candidateId': 'c1', 'evidenceId': 'test-only', 'costModelVersion': 'test-costs',
            'units': 'AFTER_COST_RETURN_FRACTION_ON_SAME_CAPITAL', 'horizonStart': '2026-01-01T14:30:00Z',
            'horizonEnd': '2026-01-02T00:00:00Z', 'labelAvailableAt': '2026-01-02T00:00:01Z',
            'truthClass': 'SYNTHETIC_TEST', 'alternativeReturn': value, 'waitReturn': 0.0}


class WaitAnalysisTests(unittest.TestCase):
    def test_comparable_returns_bind_identity_horizon_units_and_truth(self):
        from research.research_cli import _dispatch
        from dataclasses import asdict
        payload = {'decision': asdict(decision()), 'underlyingPriceAtDecision': 100,
                   'underlyingPriceAtMaturation': 110, 'maturationTimestamp': '2026-01-02T00:00:00Z', 'alternative': alternative(0)}
        result = _dispatch('wait-outcome', payload)
        self.assertEqual(result['economicComparison'], 'EQUAL_RETURN')
        self.assertEqual(result['outcome']['counterfactual_truth_class'], 'SYNTHETIC_TEST')
        self.assertEqual(result['decisionAssessment'], 'NOT_ASSESSED_NO_GATE_OVERRIDE')
        for override in ({'units': 'DOLLARS'}, {'candidateId': 'wrong'}, {'truthClass': 'BROKER_ACTUAL'},
                         {'horizonEnd': '2026-01-03T00:00:00Z'}, {'alternativeReturn': float('nan')}):
            with self.assertRaises(ValueError):
                _dispatch('wait-outcome', {**payload, 'alternative': {**alternative(0), **override}})

    def test_missed_opportunity_when_rejected_alternative_would_have_done_better(self):
        outcome = build_matured_wait_outcome(decision(best_rejected_utility=0.10),
            underlying_price_at_decision=100.0, underlying_price_at_maturation=100.0, maturation_timestamp='2026-01-02T00:00:00Z', alternative=alternative(.1))
        self.assertEqual(classify_wait_regret(outcome), WaitRegretClassification.MISSED_OPPORTUNITY)

    def test_avoided_loss_when_rejected_alternative_would_have_done_worse(self):
        outcome = build_matured_wait_outcome(decision(best_rejected_utility=-0.10),
            underlying_price_at_decision=100.0, underlying_price_at_maturation=100.0, maturation_timestamp='2026-01-02T00:00:00Z', alternative=alternative(-.1))
        self.assertEqual(classify_wait_regret(outcome), WaitRegretClassification.AVOIDED_LOSS)

    def test_unidentifiable_when_best_rejected_utility_unknown(self):
        outcome = build_matured_wait_outcome(decision(best_rejected_utility=None),
            underlying_price_at_decision=100.0, underlying_price_at_maturation=110.0, maturation_timestamp='2026-01-02T00:00:00Z')
        self.assertEqual(classify_wait_regret(outcome), WaitRegretClassification.UNIDENTIFIABLE_COUNTERFACTUAL)

    def test_unidentifiable_when_decision_price_unknown(self):
        outcome = build_matured_wait_outcome(decision(), underlying_price_at_decision=None,
            underlying_price_at_maturation=110.0, maturation_timestamp='2026-01-02T00:00:00Z')
        self.assertEqual(classify_wait_regret(outcome), WaitRegretClassification.UNIDENTIFIABLE_COUNTERFACTUAL)


if __name__ == '__main__':
    unittest.main()
